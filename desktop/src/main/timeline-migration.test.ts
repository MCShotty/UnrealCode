import {afterEach,expect,it,vi} from 'vitest'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {TimelineService} from './timeline'
import {validateSavedTimeline} from './timeline-validation'
const roots:string[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})})
it('backs up legacy snapshots and resumes safely after an interrupted atomic write',async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'unreal-timeline-migrate-'));roots.push(root)
 const path=join(root,'timeline.json'),row={id:'s',workId:'w',fromSeq:1,toSeq:2,planRevision:0,summary:'Inspect',phase:'working',evidence:[1],createdAt:'2026-09-30',provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1}},original=JSON.stringify([row])
 await fs.writeFile(path,original)
 const service=new TimelineService(()=>({}) as any,()=>{});vi.spyOn(service as any,'file').mockReturnValue(path)
 const rows=await (service as any).saved({},'s');expect(rows).toEqual([row])
 const rename=vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(Error('disk full'),{code:'ENOSPC'}))
 await expect((service as any).persist({},'s',rows)).rejects.toThrow('disk full');rename.mockRestore()
 expect(await fs.readFile(path,'utf8')).toBe(original);expect(await fs.readFile(path+'.before-1.0.4','utf8')).toBe(original)
 await (service as any).persist({},'s',rows);expect(JSON.parse(await fs.readFile(path,'utf8'))).toEqual({version:2,rows})
 expect(await fs.readFile(path+'.before-1.0.4','utf8')).toBe(original);service.close()
})
it('rejects corrupt stage arrays without trusting their evidence or altering metadata',()=>{
 const row={id:'s',workId:'w',fromSeq:1,toSeq:2,planRevision:0,summary:'Inspect',phase:'working',evidence:[1]}
 expect(()=>validateSavedTimeline([{...row,stages:[{id:'one',title:'Stage',detail:'',phase:'working'}]}])).toThrow('preserved')
 expect(()=>validateSavedTimeline([{...row,evidence:[10]}])).toThrow('preserved')
})

it('keeps saved stages readable if their optional SQLite projection cannot be repaired',async()=>{
 const summary={id:'s',workId:'w',fromSeq:1,toSeq:1,planRevision:0,summary:'Saved interpretation',phase:'completed',evidence:[1],createdAt:'now',provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1},stages:[{id:'stage',title:'Saved interpretation',detail:'Recorded earlier',phase:'completed',source:'inferred',evidence:[1]}]}
 const cache={timelineEvidence:vi.fn(async()=>[{seq:1,kind:'request',text:'Request received',at:'2026-10-01T00:00:00Z'}]),workView:vi.fn(async()=>({works:[{id:'w',seq:1,state:'completed',open:false,elapsedMs:0}]})),timelineSummaries:vi.fn(async()=>[]),putTimeline:vi.fn(async()=>{throw Error('disk full')}),nativeContext:vi.fn(async()=>false)}
 const owner={project:'p',directory:'fixture',profileDirectory:'fixture',index:{cache},planning:{read:async()=>({})},bridge:{status:()=>({ready:false})},owner:vi.fn()} as any;owner.owner.mockResolvedValue(owner)
 const service=new TimelineService(()=>({status:async()=>({settings:{enabled:false}})}) as any,()=>{});vi.spyOn(service as any,'saved').mockResolvedValue([summary])
 const view=await service.view(owner,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');expect(view.stages?.[0].title).toBe('Saved interpretation');expect(view.evidence).toHaveLength(1);expect(view.message).toContain('cache')
 service.close()
})
