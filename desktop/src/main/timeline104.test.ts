import {afterEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
vi.mock('./atomic-metadata',()=>({atomicMetadata:vi.fn(async()=>{})}))
import {TimelineService} from './timeline'

afterEach(()=>vi.useRealTimers())
it('revisits meaningful dirty activity after three seconds without overlapping requests',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000)
 const service=new TimelineService(()=>({}) as any,()=>{}),releases:Array<()=>void>=[],starts:string[]=[]
 vi.spyOn(service as any,'run').mockImplementation(async(job:any)=>{starts.push(job.session);await new Promise<void>(r=>releases.push(r))})
 const owner={project:'p'} as any
 service.changed(owner,'a');await vi.advanceTimersByTimeAsync(1);service.changed(owner,'a')
 await vi.advanceTimersByTimeAsync(3000);expect(starts).toEqual(['a'])
 releases.shift()!();await vi.advanceTimersByTimeAsync(1);expect(starts).toEqual(['a','a'])
 releases.shift()!();service.close();await service.settled()
})

async function fixture(native: boolean|undefined){
 let release!:(x:any)=>void
 const memory={status:vi.fn(async()=>({settings:{enabled:true,globalConsent:true}})),generation:vi.fn(async()=>1),analyse:vi.fn((_text:string)=>new Promise(r=>release=r))}
 const cache={putTimeline:vi.fn(async()=>{}),nativeContext:vi.fn(async()=>native),timelineInput:vi.fn(async()=>[])}
 const owner={project:'p',directory:'fixture',profileDirectory:'fixture',index:{flush:vi.fn(),cache},context:{isExcluded:()=>false},owner:vi.fn()} as any;owner.owner.mockResolvedValue(owner)
 const service=new TimelineService(()=>memory as any,()=>{}),evidence=[{seq:10,kind:'tool',text:'ReadFile completed',at:'2026-09-30T00:00:00Z'}]
 const initial={evidence,workId:'w',state:'running',summaries:[],status:'idle',plan:undefined}
 const view=vi.spyOn(service,'view').mockResolvedValue(initial as any)
 vi.spyOn(service as any,'saved').mockResolvedValue([]);vi.spyOn(service as any,'file').mockReturnValue('fixture-timeline.json')
 const finish=()=>release({text:JSON.stringify({summary:'Inspecting source',phase:'working',evidence:[10]}),provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1}})
 return {service,owner,cache,memory,initial,view,finish}
}
it('keeps a valid captured snapshot when newer ordinary events arrive',async()=>{
 const f=await fixture(false),work=(f.service as any).run({owner:f.owner,session:'s',changed:false,running:true,last:0})
 await vi.waitFor(()=>expect(f.memory.analyse).toHaveBeenCalled())
 f.view.mockResolvedValue({...f.initial,evidence:[...f.initial.evidence,{seq:11,kind:'tool',text:'Another file read'}]} as any)
 f.finish();await work;expect(f.cache.putTimeline).toHaveBeenCalled();f.service.close()
})
it.each([true,undefined])('does not infer from native-tainted or unknown provenance (%s)',async native=>{
 const f=await fixture(native),work=(f.service as any).run({owner:f.owner,session:'s',changed:false,running:true,last:0})
 // The legacy implementation would enter inference and require release.
 await new Promise(r=>setTimeout(r,20));if(f.memory.analyse.mock.calls.length)f.finish()
 await work;expect(f.memory.analyse).not.toHaveBeenCalled();f.service.close()
})

it('discards captured narrative after native provenance or context exclusions change',async()=>{
 for(const change of ['native','exclusions']){
  const f=await fixture(false);let excluded:string[]=[];f.owner.context.get=()=>({excluded})
  const pending=(f.service as any).run({owner:f.owner,session:'s',changed:false,running:true,last:0})
  await vi.waitFor(()=>expect(f.memory.analyse).toHaveBeenCalled())
  if(change==='native')f.cache.nativeContext.mockResolvedValue(true);else excluded=['private']
  f.finish();await pending;expect(f.cache.putTimeline).not.toHaveBeenCalled();f.service.close()
 }
})
it('keeps all milestone identities and the active milestone in a bounded prompt',async()=>{
 const f=await fixture(false),plan={revision:1,approvedRevision:1,objective:'Task',body:'',acceptance:[],updatedAt:'now',milestones:Array.from({length:100},(_,i)=>({id:'m'+i,text:'Milestone '+i+' '.repeat(1900),state:i===90?'running':'pending',evidence:[]}))}
 f.view.mockResolvedValue({...f.initial,plan} as any)
 const pending=(f.service as any).run({owner:f.owner,session:'s',changed:false,running:true,last:0})
 await vi.waitFor(()=>expect(f.memory.analyse).toHaveBeenCalled())
 const prompt=String(f.memory.analyse.mock.calls[0][0]),packet=JSON.parse(prompt)
 expect(prompt.length).toBeLessThanOrEqual(32000);expect(packet.plan.milestones).toHaveLength(100);expect(packet.plan.milestones[90]).toMatchObject({id:'m90',state:'running'})
 f.finish();await pending;expect(f.cache.putTimeline).toHaveBeenCalled();f.service.close()
})
it('does not let activity arrivals reset transient backoff or discard congested jobs',async()=>{
 vi.useFakeTimers();const service=new TimelineService(()=>({}) as any,()=>{}),owner={project:'p'} as any
 const run=vi.spyOn(service as any,'run').mockRejectedValue(Error('Memory inference is busy'))
 service.changed(owner,'a');await vi.advanceTimersByTimeAsync(1)
 service.changed(owner,'a');await vi.advanceTimersByTimeAsync(3000);expect(run).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(3000);expect(run).toHaveBeenCalledTimes(2)
 expect((service as any).jobs.get('p\0a').retries).toBe(2)
 service.close();await service.settled()
})
it('suppresses denied analyses through new events until a new work or profile is observed',async()=>{
 const f=await fixture(false),job={owner:f.owner,session:'s',changed:false,running:true,last:0,generation:1,blockedGeneration:1,workId:'w'}
 await (f.service as any).run(job);expect(f.memory.analyse).not.toHaveBeenCalled()
 f.view.mockResolvedValue({...f.initial,workId:'new-work'} as any)
 const pending=(f.service as any).run(job);await vi.waitFor(()=>expect(f.memory.analyse).toHaveBeenCalled())
 f.finish();await pending;f.service.close()
})

it('measures a continuous thirty-second fixture and makes no additional idle requests',async()=>{
 vi.useFakeTimers();const f=await fixture(false);let sequence=10
 f.view.mockImplementation(async()=>({...f.initial,evidence:[{seq:sequence,kind:'tool',text:'ReadFile completed',at:'2026-09-30T00:00:00Z'}]}) as any)
 f.memory.analyse.mockImplementation(async()=>({text:JSON.stringify({summary:'Inspecting source',phase:'working',evidence:[sequence]}),provider:'fixture',model:'fixture',usage:{inputTokens:101,outputTokens:17}}))
 for(let second=0;second<30;second++){sequence=10+second;f.service.changed(f.owner,'s');await vi.advanceTimersByTimeAsync(1000)}
 expect(f.memory.analyse).toHaveBeenCalledTimes(11)
 const results=await Promise.all(f.memory.analyse.mock.results.map(result=>result.value as any))
 expect(results.reduce((sum,result)=>sum+result.usage.inputTokens,0)).toBe(1111)
 expect(results.reduce((sum,result)=>sum+result.usage.outputTokens,0)).toBe(187)
 await vi.advanceTimersByTimeAsync(60000);expect(f.memory.analyse).toHaveBeenCalledTimes(11)
 f.service.close();await f.service.settled()
})

it('polls cached timeline views without scheduling model analysis',async()=>{
 vi.useFakeTimers()
 const memory={status:vi.fn(async()=>({settings:{enabled:true,globalConsent:true}})),analyse:vi.fn()}
 const cache={timelineEvidence:vi.fn(async()=>[{seq:1,kind:'request',text:'Inspect the project',at:'2026-09-30T00:00:00Z'}]),workView:vi.fn(async()=>({works:[{id:'w',seq:1,state:'running',open:true,elapsedMs:0}]})),timelineSummaries:vi.fn(async()=>[]),nativeContext:vi.fn(async()=>false)}
 const owner={project:'p',directory:'fixture',profileDirectory:'fixture',index:{cache},bridge:{status:()=>({ready:true})},planning:{read:async()=>({})},owner:vi.fn()} as any;owner.owner.mockResolvedValue(owner)
 const service=new TimelineService(()=>memory as any,()=>{});vi.spyOn(service as any,'saved').mockResolvedValue([])
 for(let tick=0;tick<10;tick++){await service.view(owner,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');await vi.advanceTimersByTimeAsync(3000)}
 expect(cache.timelineEvidence).toHaveBeenCalledTimes(10);expect(memory.analyse).not.toHaveBeenCalled();expect((service as any).jobs.size).toBe(0)
 service.close();await service.settled()
})

it('recovers after malformed output when new evidence arrives without retrying the same snapshot',async()=>{
 vi.useFakeTimers();const f=await fixture(false)
 f.memory.analyse.mockResolvedValueOnce({text:'{broken',provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1}}).mockResolvedValue({text:JSON.stringify({summary:'Inspecting source',phase:'working',evidence:[11]}),provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1}})
 f.service.changed(f.owner,'s');await vi.advanceTimersByTimeAsync(1);expect(f.cache.putTimeline).not.toHaveBeenCalled()
 f.service.changed(f.owner,'s');await vi.advanceTimersByTimeAsync(3000);expect(f.memory.analyse).toHaveBeenCalledTimes(1)
 f.view.mockResolvedValue({...f.initial,evidence:[{seq:11,kind:'tool',text:'Another file read',at:'2026-09-30T00:00:01Z'}]} as any)
 f.service.changed(f.owner,'s');await vi.advanceTimersByTimeAsync(3000)
 expect(f.memory.analyse).toHaveBeenCalledTimes(2);expect(f.cache.putTimeline).toHaveBeenCalledTimes(1)
 f.service.close();await f.service.settled()
})
it('analyses changed same-revision plan progress even when the recorded event range is unchanged',async()=>{
 const f=await fixture(false),plan={revision:1,approvedRevision:1,objective:'Task',body:'',acceptance:[],updatedAt:'now',milestones:[{id:'m1',text:'Inspect',state:'completed',evidence:['event:10']},{id:'m2',text:'Verify',state:'running',evidence:[]}]}
 f.view.mockResolvedValue({...f.initial,plan} as any)
 vi.spyOn(f.service as any,'saved').mockResolvedValue([{id:'prior',workId:'w',fromSeq:10,toSeq:10,planRevision:1,summary:'Inspect',phase:'working',evidence:[10],stages:[{id:'m1',title:'Inspect',detail:'Inspecting',phase:'working',evidence:[10],source:'inferred'}]}])
 const pending=(f.service as any).run({owner:f.owner,session:'s',changed:false,running:true,last:0})
 await new Promise(resolve=>setTimeout(resolve,30));if(f.memory.analyse.mock.calls.length)f.finish()
 await pending;expect(f.memory.analyse).toHaveBeenCalledTimes(1);expect(f.cache.putTimeline).toHaveBeenCalled()
 f.service.close()
})

it('does not let a withdrawn malformed response block an explicitly refreshed snapshot',async()=>{
 vi.useFakeTimers();const f=await fixture(false);let release!:(value:any)=>void
 f.memory.analyse.mockImplementationOnce(()=>new Promise(resolve=>release=resolve)).mockResolvedValue({text:JSON.stringify({summary:'Inspecting source',phase:'working',evidence:[10]}),provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1}})
 f.service.changed(f.owner,'s');await vi.advanceTimersByTimeAsync(1);expect(f.memory.analyse).toHaveBeenCalledTimes(1)
 f.service.invalidate();f.service.changed(f.owner,'s');release({text:'{broken'})
 await vi.advanceTimersByTimeAsync(3000);expect(f.memory.analyse).toHaveBeenCalledTimes(2);expect(f.cache.putTimeline).toHaveBeenCalledTimes(1)
 f.service.close();await f.service.settled()
})

it.each([false,true])('deduplicates an unchanged current plan snapshot and detects progress changes (%s)',async changed=>{
 const f=await fixture(false),milestones=[{id:'m1',text:'Inspect',state:'running',evidence:[]},{id:'m2',text:'Verify',state:'pending',evidence:[]}],progress=createHash('sha256').update(JSON.stringify(milestones.map(row=>({id:row.id,state:row.state,evidence:row.evidence})))).digest('hex')
 const plan={revision:1,approvedRevision:1,objective:'Task',body:'',acceptance:[],updatedAt:'now',milestones:changed?[{...milestones[0],state:'completed'},{...milestones[1],state:'running'}]:milestones}
 f.view.mockResolvedValue({...f.initial,plan} as any);vi.spyOn(f.service as any,'saved').mockResolvedValue([{id:'prior',workId:'w',fromSeq:10,toSeq:10,planRevision:1,planProgressIdentity:progress,summary:'Inspect',phase:'working',evidence:[10],stages:[{id:'m1',title:'Inspect',detail:'Inspecting',phase:'working',evidence:[10],source:'inferred'}]}])
 const pending=(f.service as any).run({owner:f.owner,session:'s',changed:false,running:true,last:0});await new Promise(resolve=>setTimeout(resolve,20));if(f.memory.analyse.mock.calls.length)f.finish();await pending
 expect(f.memory.analyse).toHaveBeenCalledTimes(changed?1:0);f.service.close()
})

it('redacts approved-plan and prior-stage text before sending it to the memory model',async()=>{
 const f=await fixture(false),secret='sk-'+'abcdefgh'.repeat(5),text='Rotate Bearer '+secret,plan={revision:1,approvedRevision:1,objective:text,body:'',acceptance:[],updatedAt:'now',milestones:[{id:'m1',text,state:'running',evidence:[]}]}
 f.view.mockResolvedValue({...f.initial,plan} as any);vi.spyOn(f.service as any,'saved').mockResolvedValue([{id:'prior',workId:'w',fromSeq:10,toSeq:10,planRevision:1,planProgressIdentity:'0'.repeat(64),summary:text,phase:'working',evidence:[10],stages:[{id:'m1',title:text,detail:text,phase:'working',evidence:[10],source:'plan'}]}])
 const pending=(f.service as any).run({owner:f.owner,session:'s',changed:false,running:true,last:0});await vi.waitFor(()=>expect(f.memory.analyse).toHaveBeenCalled());const packet=JSON.parse(String(f.memory.analyse.mock.calls[0][0]));f.finish();await pending
 expect(JSON.stringify(packet).includes(secret)).toBe(false);expect(plan.milestones[0].text.includes(secret)).toBe(true);f.service.close()
})
