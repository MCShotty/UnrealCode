import {afterEach,expect,it,vi} from 'vitest'
vi.mock('./atomic-metadata',()=>({atomicMetadata:vi.fn(async()=>{})}))
import {validateTimelineSummary,TimelineService} from './timeline'
import {timelineDisplayPage} from '../shared/timeline'
const evidence=[{seq:10,kind:'verification.result',text:'exitCode=1'}]
afterEach(()=>vi.useRealTimers())
it('rejects fabricated evidence, absent citations, and unknown plan stages',()=>{
 const plan={revision:1,objective:'Task',body:'',acceptance:[],updatedAt:'now',milestones:[{id:'one',text:'Build',state:'pending' as const,evidence:[]}]}
 expect(validateTimelineSummary(JSON.stringify({summary:'Test failed',phase:'blocked',evidence:[10],stageId:'one'}),evidence,plan).phase).toBe('blocked')
 for(const patch of [{evidence:[11]},{evidence:[]},{stageId:'invented'},{summary:'x'.repeat(1001)}])expect(()=>validateTimelineSummary(JSON.stringify({summary:'Test failed',phase:'blocked',evidence:[10],...patch}),evidence,plan)).toThrow()
})
it('coalesces events, bounds global concurrency, and waits 20 seconds between updates',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000);const service=new TimelineService(()=>({}) as any,()=>{}),releases:Array<()=>void>=[],starts:string[]=[]
 vi.spyOn(service as any,'run').mockImplementation(async(...args:any[])=>{starts.push(args[0].session);await new Promise<void>(resolve=>releases.push(resolve))})
 const owner={project:'project'} as any
 service.changed(owner,'a');service.changed(owner,'a');service.changed(owner,'b');service.changed(owner,'c');await vi.advanceTimersByTimeAsync(1)
 expect(starts).toEqual(['a','b']);service.changed(owner,'a');releases.shift()!();await vi.advanceTimersByTimeAsync(1);expect(starts).toEqual(['a','b','c']);releases.shift()!();releases.shift()!();await vi.advanceTimersByTimeAsync(19000);expect(starts).toHaveLength(3);await vi.advanceTimersByTimeAsync(1000);expect(starts).toEqual(['a','b','c','a']);releases.shift()!();service.close();await vi.advanceTimersByTimeAsync(60000);expect(starts).toHaveLength(4)
})
it.each(['profile','plan','turn','disable','failure','progress'])('discards an observer response after %s changes',async(change)=>{
 let epoch=0,enabled=true,release!:(value:any)=>void
 const memory={status:vi.fn(async()=>({settings:{enabled,globalConsent:true}})),generation:vi.fn(async()=>epoch),analyse:vi.fn(()=>new Promise(resolve=>release=resolve))}
 const cache={putTimeline:vi.fn()},owner={project:'p',index:{flush:vi.fn(),cache},owner:vi.fn()} as any;owner.owner.mockResolvedValue(owner)
 const service=new TimelineService(()=>memory as any,()=>{}),initial={evidence,workId:'work',state:'running',summaries:[],status:'idle',plan:{revision:1,approvedRevision:1,objective:'Task',body:'',acceptance:[],updatedAt:'now',milestones:[]}}
 const view=vi.spyOn(service,'view').mockResolvedValue(initial as any);vi.spyOn(service as any,'saved').mockResolvedValue([]);vi.spyOn(service as any,'file').mockReturnValue('fixture-timeline.json')
 const pending=(service as any).run({owner,session:'session',changed:false,running:true,last:0})
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 if(change==='profile')epoch++
 if(change==='disable')enabled=false
 if(change==='plan')view.mockResolvedValue({...initial,plan:{...initial.plan,revision:2}} as any)
 if(change==='turn')view.mockResolvedValue({...initial,workId:'new-work'} as any)
 if(change==='failure')view.mockResolvedValue({...initial,state:'failed',evidence:[...evidence,{seq:11,kind:'session.idle',text:'Required verification failed'}]} as any)
 if(change==='progress')view.mockResolvedValue({...initial,plan:{...initial.plan,updatedAt:'later',milestones:[{id:'verified',text:'Verify',state:'completed',evidence:['event:11']}]}} as any)
 release({text:JSON.stringify({summary:'Working',phase:'working',evidence:[10]}),provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1}})
 await pending;expect(cache.putTimeline).not.toHaveBeenCalled();service.close()
})
it('keeps factual history available when optional memory metadata cannot be read',async()=>{
 const memory={status:vi.fn(async()=>{throw Error('Memory metadata unavailable')})},cache={timelineEvidence:vi.fn(async()=>evidence),workView:vi.fn(async()=>({works:[{id:'work',state:'failed'}]})),timelineSummaries:vi.fn(async()=>[]),putTimeline:vi.fn()}
 const owner={project:'p',owner:vi.fn(),index:{cache},planning:{read:vi.fn(async()=>({}))},bridge:{status:()=>({ready:false})}} as any;owner.owner.mockResolvedValue(owner)
 const service=new TimelineService(()=>memory as any,()=>{});vi.spyOn(service as any,'saved').mockResolvedValue([])
 try { const view=await service.view(owner,'session');expect(view.evidence).toEqual(evidence);expect(view).toMatchObject({state:'failed',status:'unavailable'});expect(view.message).toContain('Recorded events') } finally {service.close()}
})
it('settles observer work before maintenance and rejects new scheduling after close',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000);const service=new TimelineService(()=>({}) as any,()=>{});let release!:()=>void,settled=false
 const run=vi.spyOn(service as any,'run').mockImplementation(()=>new Promise<void>(resolve=>release=resolve))
 service.changed({project:'p'} as any,'one');await vi.advanceTimersByTimeAsync(1);service.close()
 const barrier=service.settled().then(()=>{settled=true});service.changed({project:'p'} as any,'two');await vi.advanceTimersByTimeAsync(60000)
 expect(settled).toBe(false);expect(run).toHaveBeenCalledTimes(1);release();await barrier;expect(settled).toBe(true)
})
it('visits every event when the compact timeline pages through a larger observer window',async()=>{
 const all=Array.from({length:155},(_,i)=>({seq:i+1,kind:'session.item',text:'event'})),seen:number[]=[];let before=Infinity
 for(;;){const evidence=all.filter(row=>row.seq<before).slice(-60),view={evidence,summaries:[],workId:'w',state:'completed' as const,status:'idle' as const,before:evidence.length===60?evidence[0].seq:undefined};const page=timelineDisplayPage(view);seen.push(...page.rows.map(row=>row.seq));if(!page.before)break;before=page.before}
 expect(seen).toEqual([...all].reverse().map(row=>row.seq))
})
