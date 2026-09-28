import {afterEach,expect,it,vi} from 'vitest'
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
vi.mock('playwright-core',()=>({chromium:{}}))
import {ProjectBrowser,browserFailureSummary,normalizeBrowserGrant} from './project-browser'
let root='';afterEach(async()=>{vi.restoreAllMocks();if(root)await rm(root,{recursive:true,force:true})})
it('reviews the effective whole origin and rejects path-qualified browser grants',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-origin-'))
 const browser=new ProjectBrowser(root,'project',join(root,'grant.json'))
 const grant={enabled:true,ports:[],origins:['https://fixture.example/private'],interactOrigins:[]}
 expect(()=>normalizeBrowserGrant(grant)).toThrow('bare origin')
 await expect(browser.configure(grant)).rejects.toThrow('bare origin')
 expect(normalizeBrowserGrant({...grant,origins:['https://fixture.example/']})).toEqual({...grant,origins:['https://fixture.example']})
})
it('keeps a committed browser grant when its renderer notification fails',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-notify-'))
 const browser=new ProjectBrowser(root,'project',join(root,'grant.json'))
 browser.onChanged=()=>{throw Error('renderer closed')}
 await browser.configure({enabled:true,ports:[],origins:['https://fixture.example'],interactOrigins:[]})
 expect((await browser.state()).grant.origins).toEqual(['https://fixture.example'])
})
it('does not activate broader browser access when saving the grant fails',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-failed-grant-'))
 const path=join(root,'grant.json'),browser=new ProjectBrowser(root,'project',path)
 await browser.state()
 vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(Error('disk full'),{code:'ENOSPC'}))
 await expect(browser.configure({enabled:true,ports:[],origins:['https://fixture.example'],interactOrigins:['https://fixture.example']})).rejects.toThrow('disk full')
 expect((await browser.state()).grant.enabled).toBe(false)
 await expect(readFile(path,'utf8')).rejects.toMatchObject({code:'ENOENT'})
})
it('keeps pending browser permission changes within the old and requested grants',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-pending-grant-'))
 const browser=new ProjectBrowser(root,'project',join(root,'grant.json'))
 await browser.state()
 const realRename=fs.rename.bind(fs)
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 const rename=vi.spyOn(fs,'rename').mockImplementationOnce(async(from,to)=>{await gate;return realRename(from,to)})
 const pending=browser.configure({enabled:true,ports:[],origins:['https://fixture.example'],interactOrigins:['https://fixture.example']})
 await vi.waitFor(()=>expect(rename).toHaveBeenCalled())
 expect((await browser.state()).grant.enabled).toBe(false)
 release();await pending
 expect((await browser.state()).grant.enabled).toBe(true)
})
it('rejects a persisted browser grant that lists ungranted interaction origins',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-invalid-grant-'))
 const path=join(root,'grant.json'),content=JSON.stringify({enabled:true,ports:[],origins:['https://fixture.example'],interactOrigins:['https://ungranted.example']})
 await writeFile(path,content)
 const browser=new ProjectBrowser(root,'project',path)
 await expect(browser.state()).rejects.toThrow('Saved browser permissions are invalid')
 expect(await readFile(path,'utf8')).toBe(content)
})
it('lets an explicit new grant recover damaged metadata after keeping a dated original copy',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-repair-grant-'))
 const path=join(root,'grant.json'),content='{"enabled":true,"origins":['
 await writeFile(path,content)
 const browser=new ProjectBrowser(root,'project',path)
 await expect(browser.state()).rejects.toThrow()
 await browser.configure({enabled:false,ports:[],origins:[],interactOrigins:[]})
 expect((await browser.state()).grant.enabled).toBe(false)
 const copies=(await readdir(root)).filter(name=>name.endsWith('.browser-grants-invalid.json'))
 expect(copies).toHaveLength(1)
 expect(await readFile(join(root,copies[0]),'utf8')).toBe(content)
})
it('refuses oversized browser-grant metadata without copying or replacing it',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-oversized-grant-'))
 const path=join(root,'grant.json')
 await writeFile(path,'x'.repeat(1024*1024+1))
 const browser=new ProjectBrowser(root,'project',path)
 await expect(browser.state()).rejects.toThrow('size limit')
 await expect(browser.configure({enabled:false,ports:[],origins:[],interactOrigins:[]})).rejects.toThrow('size limit')
 expect((await readFile(path)).length).toBe(1024*1024+1)
 expect((await readdir(root)).filter(name=>name.endsWith('.browser-grants-invalid.json'))).toHaveLength(0)
})
it('does not bring a tab forward after its origin grant is revoked',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-takeover-'))
 const browser=new ProjectBrowser(root,'project',join(root,'grant.json'))
 const sessionId=randomUUID(),id=randomUUID(),page={url:()=> 'https://fixture.example/private',bringToFront:vi.fn()}
 await browser.configure({enabled:true,ports:[],origins:['https://fixture.example'],interactOrigins:[]})
 ;(browser as any).tabs.set(id,{page,sessionId,log:[]})
 ;(browser as any).start=async()=>{}
 await browser.configure({enabled:true,ports:[],origins:[],interactOrigins:[]})
 await expect(browser.call(sessionId,{type:'takeover',tabId:id})).rejects.toThrow('revoked')
 expect(page.bringToFront).not.toHaveBeenCalled()
})
it('limits failed-request diagnostics to an origin and error code',()=>{
 const privatePath='private-path-token',url=`https://fixture.example/${privatePath}?token=query-token`
 const summary=browserFailureSummary('GET',url,`net::ERR_FAILED while loading ${url}`)
 expect(summary).toBe('GET https://fixture.example: net::ERR_FAILED')
 expect(summary).not.toContain(privatePath)
 expect(summary).not.toContain('query-token')
 expect(browserFailureSummary('POST','file:///C:/private/path','blockedbyclient')).toBe('POST blocked target: blockedbyclient')
})
it('applies parent grant revocation to existing worker browser routes without broadening access',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-browser-grants-'));const parent=new ProjectBrowser(root,'parent',join(root,'parent.json')),worker=new ProjectBrowser(root,'worker',join(root,'worker.json'))
 const grant={enabled:true,ports:[],origins:['https://fixture.example'],interactOrigins:['https://fixture.example']}
 await parent.configure(grant);await worker.configure(grant);worker.inherit(parent)
 expect((worker as any).allowed('https://fixture.example',true)).toBe(true)
 await parent.configure({...grant,interactOrigins:[]});expect((worker as any).allowed('https://fixture.example',true)).toBe(false);expect((worker as any).allowed('https://fixture.example')).toBe(true)
 await parent.configure({...grant,origins:[...grant.origins,'https://other.example']});expect((worker as any).allowed('https://other.example')).toBe(false)
 await parent.configure({...grant,enabled:false});expect((worker as any).allowed('https://fixture.example')).toBe(false)
})
