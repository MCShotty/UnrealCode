import {expect,it} from 'vitest'
import {validateTimelineStages} from './timeline'
import {timelineDuration,timelineStages} from '../shared/timeline'
const evidence=[{seq:1,kind:'tool',text:'ReadFile completed',at:'2026-09-30T00:00:00Z'}]
const row={id:'new:inspect',title:'Inspect project',detail:'Read source',phase:'working',evidence:[1]}
it('assigns durable stage IDs, retains earlier stages and rejects fabricated references',()=>{
 const first=validateTimelineStages(JSON.stringify({stages:[row]}),evidence,undefined)
 const next=validateTimelineStages(JSON.stringify({stages:[{...row,id:first[0].id,phase:'completed'}]}),evidence,undefined,first)
 expect(next).toHaveLength(1);expect(next[0].id).toBe(first[0].id)
 for(const patch of [{id:'arbitrary'},{evidence:[2]},{title:'x'.repeat(121)},{phase:'verified'}])expect(()=>validateTimelineStages(JSON.stringify({stages:[{...row,...patch}]}),evidence,undefined)).toThrow()
})
it('accepts an active plan milestone outside the first thirty and preserves its approved title',()=>{
 const plan={revision:1,approvedRevision:1,objective:'Task',body:'',acceptance:[],updatedAt:'now',milestones:Array.from({length:80},(_,i)=>({id:'stage-'+i,text:'Approved '+i,state:'pending' as const,evidence:[]}))}
 const result=validateTimelineStages(JSON.stringify({stages:[{...row,id:'stage-70',title:'Model renamed it'}]}),evidence,plan)
 expect(result[0].title).toBe('Approved 70')
})
it('overlays recorded failure and required wait over older inferred completion',()=>{
 const summary={id:'s',workId:'w',fromSeq:1,toSeq:1,planRevision:0,summary:'Done',phase:'completed' as const,evidence:[1],createdAt:'now',provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1},stages:[{...row,id:'stable',phase:'completed' as const,source:'inferred' as const}]}
 expect(timelineStages({evidence,summaries:[summary],workId:'w',state:'failed'})[0]).toMatchObject({phase:'blocked',verified:false})
 expect(timelineStages({evidence,summaries:[summary],workId:'w',state:'waiting_input'})[0].phase).toBe('waiting')
})
it('subtracts only whole human waits and rejects reversed or absent timestamps',()=>{
 const at=(s:number)=>new Date(s*1000).toISOString()
 const rows=[{seq:1,kind:'request',text:'Start',at:at(0)},{seq:2,kind:'question',text:'Wait',humanWait:true,at:at(2)},{seq:3,kind:'question',text:'Answer',humanWait:false,at:at(8)},{seq:4,kind:'complete',text:'Done',at:at(10)}]
 expect(timelineDuration(rows,1,4)).toBe(4000)
 expect(timelineDuration([{...rows[0],at:undefined}],1,1)).toBeUndefined()
 expect(timelineDuration([rows[0],{...rows[1],at:at(-1)}],1,2)).toBeUndefined()
 const busy=[rows[0],{seq:2,kind:'tool',text:'Parallel start',at:at(1),busy:'start' as const,operationId:'op'},{...rows[1],seq:3},{seq:4,kind:'tool',text:'Parallel done',at:at(6),busy:'end' as const,operationId:'op'},{...rows[2],seq:5},{...rows[3],seq:6}]
 expect(timelineDuration(busy,1,6)).toBe(8000)
})

it('replaces stale success narrative with the recorded failure and its evidence',()=>{
 const summary={id:'s',workId:'w',fromSeq:1,toSeq:1,planRevision:0,summary:'All checks passed',phase:'completed' as const,evidence:[1],createdAt:'now',provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1},stages:[{...row,id:'stable',detail:'All checks passed',phase:'completed' as const,source:'inferred' as const}]}
 const stages=timelineStages({evidence:[...evidence,{seq:2,kind:'failure',text:'Verification failed',at:'2026-09-30T00:00:01Z'}],summaries:[summary],workId:'w',state:'failed'})
 expect(stages[0]).toMatchObject({phase:'blocked',detail:'Verification failed',verified:false});expect(stages[0].evidence).toContain(2)
})

it('uses saved inferred stages when an approved plan has no explicit milestones',()=>{
 const plan={revision:1,approvedRevision:1,objective:'Task',body:'A narrative plan',acceptance:[],milestones:[],updatedAt:'now'},summary={id:'s',workId:'w',fromSeq:1,toSeq:1,planRevision:1,summary:'Inspect project',phase:'working' as const,evidence:[1],createdAt:'now',provider:'fixture',model:'fixture',usage:{inputTokens:1,outputTokens:1},stages:[{...row,id:'stable',phase:'working' as const,source:'inferred' as const}]}
 expect(timelineStages({evidence,summaries:[summary],plan,workId:'w',state:'running'})[0]).toMatchObject({id:'stable',title:'Inspect project',source:'inferred',verified:false})
})
