import {afterEach,expect,it,vi} from 'vitest'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ReleaseNotifications,eligibleRelease,compareReleaseVersions,releaseURL} from './release-notifications'
const roots:string[]=[],services:ReleaseNotifications[]=[]
afterEach(async()=>{for(const service of services.splice(0)){service.close();await service.settled()}vi.useRealTimers();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
function release(v='1.0.2'){return {draft:false,prerelease:v.includes('-'),tag_name:'v'+v,html_url:releaseURL(v),assets:[`UnrealCode-Setup-${v}.exe`,'SHA256SUMS'].map(name=>({name,state:'uploaded',size:12,browser_download_url:`https://github.com/MCShotty/UnrealCode/releases/download/v${v}/${name}`}))}}
const response=(rows:unknown,headers:Record<string,string>={})=>new Response(JSON.stringify(rows),{headers:{'content-type':'application/json',...headers}})
async function setup(fetcher=vi.fn<typeof fetch>(async()=>response([release()]))){const root=await mkdtemp(join(tmpdir(),'unrealcode-release-unit-'));roots.push(root);let now=Date.now();const service=new ReleaseNotifications(join(root,'release.json'),'1.0.1',fetcher,()=>{},()=>now);services.push(service);await service.initialize({automaticChecks:true,channel:'stable'},false);return {service,fetcher,root,advance:(ms:number)=>now+=ms}}
it.each([['1.0.2','1.0.1',1],['1.0.1','1.0.1',0],['1.0.0','1.0.1',-1],['1.0.2-preview.2','1.0.2-preview.10',-1],['1.0.2','1.0.2-preview.10',1]] as const)('compares %s with %s',(a,b,result)=>expect(compareReleaseVersions(a,b)).toBe(result))
it.each(['1.0','01.2.3','1.0.1-beta.1','1.0.2/../../../x','https://other.test'])('rejects invalid versions %s',value=>expect(()=>releaseURL(value)).toThrow())
it('requires complete published assets and the exact owned release URLs',()=>{
 expect(eligibleRelease(release())?.version).toBe('1.0.2')
 for(const raw of [{...release(),draft:true},{...release(),assets:[]},{...release(),html_url:'https://evil.test'},{...release(),prerelease:true},{...release(),assets:release().assets.map(a=>({...a,browser_download_url:'https://evil.test'}))}])expect(eligibleRelease(raw)).toBeUndefined()
})
it('filters channels and never offers a downgrade or uses credentials',async()=>{
 const {service,fetcher}=await setup(vi.fn(async()=>response([release('1.0.0'),release('1.0.1'),release('1.0.2-preview.1'),release('1.0.2')])) as any)
 expect(await service.check()).toMatchObject({state:'available',delivery:'manual',version:'1.0.2'})
 service.configure({automaticChecks:false,channel:'preview'});expect(service.view().version).toBe('1.0.2')
 expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('authorization')).toBe(false);expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
 const older=await setup(vi.fn(async()=>response([release('1.0.0'),release('1.0.1')])) as any);expect((await older.service.check()).version).toBeUndefined()
})
it('offers preview versions only in preview channel',async()=>{const {service}=await setup(vi.fn(async()=>response([release('1.0.2-preview.1')])) as any);expect((await service.check()).version).toBeUndefined();service.configure({automaticChecks:true,channel:'preview'});expect(service.view().version).toBe('1.0.2-preview.1')})
it('reads bounded pagination and revalidates every cached page with ETags',async()=>{
 const next='<https://api.github.com/repos/MCShotty/UnrealCode/releases?per_page=100&page=2>; rel="next"'
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response([release('1.0.1')],{etag:'"a"',link:next})).mockResolvedValueOnce(response([release()],{etag:'"b"'})).mockResolvedValueOnce(new Response(null,{status:304})).mockResolvedValueOnce(new Response(null,{status:304}))
 const {service,advance}=await setup(fetcher);expect((await service.check()).version).toBe('1.0.2');advance(61000);expect((await service.check()).version).toBe('1.0.2')
 expect((fetcher.mock.calls[2][1]!.headers as any)['If-None-Match']).toBe('"a"');expect((fetcher.mock.calls[3][1]!.headers as any)['If-None-Match']).toBe('"b"')
})
it.each([response({bad:true}),response([],{link:'<https://evil.test/page>; rel="next"'}),new Response(null,{status:304})])('reports malformed responses without claiming current',async result=>{const {service}=await setup(vi.fn(async()=>result) as any);expect((await service.check()).state).toBe('error')})
it('deduplicates concurrent checks and retains a stale result after network failure',async()=>{
 let releaseResponse!:(value:Response)=>void;const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(resolve=>releaseResponse=resolve)).mockRejectedValueOnce(Error('offline'))
 const {service,advance}=await setup(fetcher);const first=service.check(),second=service.check();await vi.waitFor(()=>expect(releaseResponse).toBeTypeOf('function'));releaseResponse(response([release()]));await Promise.all([first,second]);expect(fetcher).toHaveBeenCalledTimes(1)
 advance(61000);expect(await service.check()).toMatchObject({state:'error',stale:true,version:'1.0.2'});expect(service.releaseToOpen()).toBe(releaseURL('1.0.2'))
})
it('respects Retry-After and rate-reset times across checks',async()=>{
 const {service,advance,fetcher}=await setup(vi.fn(async()=>new Response(null,{status:429,headers:{'retry-after':'120'}})) as any)
 expect(await service.check()).toMatchObject({state:'error',stale:true});advance(61000);await service.check();expect(fetcher).toHaveBeenCalledTimes(1);advance(60000);await service.check();expect(fetcher).toHaveBeenCalledTimes(2)
})
it('uses rate-reset headers and bounds malformed retry delays',async()=>{
 const reset=String(Math.floor(Date.now()/1000)+7200),{service}=await setup(vi.fn(async()=>new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':reset}})) as any)
 expect(Date.parse((await service.check()).retryAt!)).toBeGreaterThan(Date.now()+7000000)
 const other=await setup(vi.fn(async()=>new Response(null,{status:429,headers:{'retry-after':'999999999999999999'}})) as any)
 expect(Date.parse((await other.service.check()).retryAt!)-Date.now()).toBeLessThanOrEqual(7*86400000)
})
it('does not overwrite a preference changed while initialization is loading',async()=>{
 const {service}=await setup();const initializing=service.initialize({automaticChecks:true,channel:'stable'},false)
 service.configure({automaticChecks:false,channel:'preview'});await initializing
 expect(service.view()).toMatchObject({channel:'preview',automaticChecks:false})
})
it('persists dismissal and cadence across restart while allowing manual checks with automation off',async()=>{
 const {service,root,fetcher}=await setup();await service.check();await service.dismiss('1.0.2');service.close()
 const next=new ReleaseNotifications(join(root,'release.json'),'1.0.1',fetcher);services.push(next);await next.initialize({automaticChecks:false,channel:'stable'},false)
 expect(next.view()).toMatchObject({version:'1.0.2',dismissed:true,automaticChecks:false});await next.check();expect(fetcher).toHaveBeenCalledTimes(1);await expect(next.dismiss('1.0.3')).rejects.toThrow('changed')
})
it('preserves offline status across restart rather than announcing a stale cached release',async()=>{
 const {service,root,advance}=await setup(vi.fn<typeof fetch>().mockResolvedValueOnce(response([release()])).mockRejectedValueOnce(Error('offline')))
 await service.check();advance(61000);await service.check();service.close()
 const reopened=new ReleaseNotifications(join(root,'release.json'),'1.0.1');services.push(reopened);await reopened.initialize({automaticChecks:false,channel:'stable'},false)
 expect(reopened.view()).toMatchObject({state:'error',stale:true,version:'1.0.2'})
})
it('ignores unsafe cached release URLs',async()=>{const {root,service}=await setup();service.close();await writeFile(join(root,'release.json'),JSON.stringify({version:1,pages:[],releases:[{version:'1.0.2',url:'file:///secret',preview:false}],lastAttempt:0,retryAt:0,dismissed:[]}));const next=new ReleaseNotifications(join(root,'release.json'),'1.0.1');services.push(next);await next.initialize({automaticChecks:false,channel:'stable'},false);expect(next.view().releaseUrl).toBeUndefined();expect(()=>next.releaseToOpen()).toThrow()})
it('checks after startup and daily, handles resume, and stops when disabled',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));const root=await mkdtemp(join(tmpdir(),'unrealcode-release-timer-'));roots.push(root)
 const fetcher=vi.fn<typeof fetch>(async()=>response([release()])),service=new ReleaseNotifications(join(root,'release.json'),'1.0.1',fetcher);services.push(service)
 await service.initialize({automaticChecks:true,channel:'stable'});await vi.advanceTimersByTimeAsync(3000);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));await service.settled()
 service.wake();await vi.advanceTimersByTimeAsync(1000);expect(fetcher).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(86400000);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));await service.settled()
 service.configure({automaticChecks:false,channel:'stable'});await vi.advanceTimersByTimeAsync(86400000);expect(fetcher).toHaveBeenCalledTimes(2);await service.check(true);expect(fetcher).toHaveBeenCalledTimes(3)
})
