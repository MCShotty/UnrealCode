import {afterEach,expect,it,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
vi.mock('electron',()=>({BrowserWindow:class{},WebContentsView:class{},session:{fromPartition:()=>Object.assign(new EventEmitter(),{setPermissionRequestHandler:vi.fn()})}}))
vi.mock('./editor-files',()=>({editorPath:vi.fn(async()=>{})}))
vi.mock('./project-fs',()=>({projectBytes:vi.fn(async()=>({bytes:Buffer.from('approved project file')})),projectWrite:vi.fn(async()=>{})}))
import {SharedProjectBrowser} from './shared-browser'
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it.each(['takeover','revocation','cancel'])('does not upload after %s during asynchronous preparation',async(change)=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-shared-browser-'));roots.push(root)
 const browser=new SharedProjectBrowser('project',root),origin='https://fixture.test'
 const grant={enabled:true,origins:[origin],interactOrigins:[origin],cloudOrigins:[],ports:[]};await browser.configure(grant)
 let release!:(value:any)=>void
 const send=vi.fn(async(method:string)=>method==='DOM.getDocument'?await new Promise(resolve=>release=resolve):method==='DOM.querySelector'?{nodeId:2}:{})
 const wc={getURL:()=>origin,mainFrame:{framesInSubtree:[{url:origin}]},debugger:{isAttached:()=>true,sendCommand:send},getTitle:()=> 'Fixture',isLoading:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},getZoomFactor:()=>1}
 ;(browser as any).tabs.set('tab',{id:'tab',view:{webContents:wc},control:'agent',controlEpoch:0,errors:[],agentInput:false})
 const controller=new AbortController(),pending=browser.agent({type:'upload',tabId:'tab',path:'source.txt',selector:'input'},'project',controller.signal),rejected=expect(pending).rejects.toThrow(/control|grant|cancel|abort|access/i)
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 if(change==='takeover'){await browser.command({type:'takeover',tabId:'tab'});await browser.command({type:'handback',tabId:'tab'})}
 if(change==='revocation'){await browser.configure({...grant,interactOrigins:[]});await browser.configure(grant)}
 if(change==='cancel')controller.abort()
 release({root:{nodeId:1}});await rejected
 expect(send.mock.calls.map(row=>row[0])).not.toContain('DOM.setFileInputFiles')
})
