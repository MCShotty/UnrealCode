import { afterEach, expect, it } from 'vitest'
import { mkdtemp,rm,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HistoryCache } from './history-cache'
import type { AgentEvent } from '../shared/api'
import {DatabaseSync} from 'node:sqlite'
const cleanup:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const task of cleanup.splice(0).reverse())await task()})
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'unreal-activity-')),cache=new HistoryCache(dir);cleanup.push(()=>rm(dir,{recursive:true,force:true}),()=>cache.close());let seq=0;return {cache,event:(event:string,payload:unknown,ms:number):AgentEvent=>({v:1,sessionId:'s',seq:++seq,event,payload,recordedAt:new Date(1700000000000+ms).toISOString()}),put:async(events:AgentEvent[])=>{await Promise.all(events.map(e=>cache.ingest('p',e)));await cache.synced('p','s')}}}
const input=(id='m')=>({Kind:'input',Data:{Kind:'external',ID:id,Payload:{prompt:'Build'}}})
const calls=(names:string[])=>({Kind:'model_response',Data:{TurnID:'t',Response:{Output:names.map(id=>({Type:'tool_call',Data:{CallID:id,Name:id,Arguments:'{}'}}))}}})
const linked=(id:string)=>({Kind:'tool_call_status',Data:{TurnID:'t',CallID:id,Status:{WaitingFor:[id]}}})
it('reports unknown work timing after recorded clocks move backwards',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input(),2000),event('model.request.started',{id:'r'},1000),event('model.request.completed',{id:'r'},3000),event('session.idle',{messageIds:['m'],outcome:{state:'completed'}},4000)])
 expect((await cache.workView('p','s',false)).works[0].elapsedMs).toBeUndefined()
})
it('rebuilds legacy cache projections so steering anchors survive a 1.0.3 upgrade',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input('first'),0),event('session.item',calls(['ReadFile']),1),event('session.item',input('steering'),2)])
 await cache.close();const db=new DatabaseSync(cache.path);db.exec('DROP TABLE work_segments; PRAGMA user_version=5');db.close()
 await writeFile(cache.path+'.before-1.0.4.sqlite','interrupted backup')
 const reopened=new HistoryCache(cache.profile);cleanup.push(()=>reopened.close())
 const view=await reopened.workView('p','s',false,{from:2,to:3})
 expect(view.works[0].segments).toEqual([{seq:1,id:'first'},{seq:3,id:'steering'}]);expect((await reopened.page('p','s')).events).toHaveLength(3)
 const backup=new DatabaseSync(cache.path+'.before-1.0.4.sqlite',{readOnly:true});try{expect(backup.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(5);expect(backup.prepare('SELECT COUNT(*) n FROM events').get()?.n).toBe(3)}finally{backup.close()}
})
it('projects unique calls and excludes human-only waiting while preserving parallel work',async()=>{
 const {cache,event,put}=await fixture(),q={id:'question',sessionId:'s',workspaceId:'workspace',revision:1,mode:'required',state:'pending',questions:[{id:'q1',title:'Choose'}]}
 await put([event('session.item',input(),0),event('model.request.started',{id:'req'},0),event('session.item',calls(['question','Bash']),100),event('model.request.completed',{id:'req'},100),event('operation.started',{ID:'question',Type:'remote_job',Status:'awaiting'},100),event('operation.started',{ID:'Bash',Type:'shell',Status:'awaiting'},100),event('session.item',linked('question'),100),event('session.item',linked('Bash'),100),event('question.updated',q,100),event('session.needs_input',{questionId:'question',operationId:'question'},100)])
 let page=await cache.activityPage('p','s',true)
 expect(page.rows).toHaveLength(2);expect(page.executing).toBe(1);expect(page.waitingInput).toBe(1)
 await put([event('operation.update',{ID:'Bash',Status:'completed',State:{Result:{ExitCode:0}}},500),event('question.updated',{...q,state:'answered',answers:[{questionId:'q1',text:'Yes'}]},2000),event('operation.update',{ID:'question',Status:'completed',State:{TerminalResult:'Yes'}},2000),event('model.request.started',{id:'next'},2000),event('session.item',{Kind:'model_response',Data:{TurnID:'next',Response:{Output:[{Type:'message',Data:{Text:'Final answer'}}]}}},2300),event('model.request.completed',{id:'next'},2300),event('session.idle',{messageIds:['m']},2300)])
 const view=await cache.workView('p','s',false),work=view.works[0]
 expect(work.elapsedMs).toBe(800);expect(work.modelMs).toBe(400);expect(work.toolMs).toBe(400);expect(work.finalMessageId).toBe('15:message:0');expect(work.state).toBe('completed');expect(view.questions[0].state).toBe('answered')
 page=await cache.activityPage('p','s',false);expect(page.executing).toBe(0);expect(page.rows.every(row=>row.status==='completed')).toBe(true)
})
it('keeps background cards pending after their acknowledgement and rebuilds historical failures',async()=>{
 const {cache,event,put}=await fixture();await cache.putSessions('p',[{id:'s',title:'Keep title',lastUpdatedAt:'2026-09-28',active:false}])
 const entries=[event('session.item',input(),0),event('question.updated',{id:'q',sessionId:'s',mode:'background',state:'pending',revision:1,questions:[{id:'one',title:'Later?'}]},5),event('operation.update',{ID:'q',Status:'completed',State:{TerminalResult:'acknowledged'}},6),event('session.item',{Kind:'model_response',Data:{Response:{Failure:{Code:'server_error',Message:'JSON error injected into SSE stream'}}}},10),event('session.idle',{messageIds:['m'],outcome:{state:'completed'}},11)]
 await put(entries.slice(2));await put(entries.slice(0,2));await put(entries)
 expect((await cache.workView('p','s',true)).questions[0].state).toBe('pending')
 const view=await cache.workView('p','s',false);expect(view.questions[0].state).toBe('interrupted');expect(view.works).toHaveLength(1);expect(view.works[0].state).toBe('failed');expect(view.works[0].failureSequence).toBe(4);expect((await cache.sessions('p'))[0]).toMatchObject({title:'Keep title',state:'failed'})
})
it('pages bounded outputs and does not revive terminal tools from stale snapshots',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input(),0),event('session.item',calls(['Bash']),1),event('operation.started',{ID:'Bash',Status:'awaiting'},2),event('session.item',linked('Bash'),3),event('operation.update',{ID:'Bash',Status:'completed',State:{TerminalResult:'result-'.repeat(20000)}},9),event('operation.update',{ID:'Bash',Status:'awaiting'},10),event('session.idle',{messageIds:['m']},11)])
 const page=await cache.activityPage('p','s',true,{search:'bash',status:'completed',limit:1});expect(page.total).toBe(1);expect(page.executing).toBe(0)
 const detail=await cache.activityDetail('p','s',true,page.rows[0].id);expect(detail.output.length).toBe(16384);expect(detail.hasMore).toBe(true);expect(detail.row.durationMs).toBe(7)
 const second=await cache.activityDetail('p','s',true,page.rows[0].id,16384);expect(second.offset).toBe(16384);expect(second.output.length).toBe(16384)
 await put([event('operation.update',{ID:'Bash',Status:'completed',State:{TerminalResult:'🛠️'.repeat(12000)}},12)])
 const unicode=await cache.activityDetail('p','s',true,page.rows[0].id);expect(unicode.hasMore).toBe(true);expect(Array.from(unicode.output)).toHaveLength(16384)
 const remaining=await cache.activityDetail('p','s',true,page.rows[0].id,16384);expect(remaining.hasMore).toBe(false);expect(JSON.parse(unicode.output+remaining.output).output).toBe('🛠️'.repeat(12000))
})
it('infers legacy answered cards and retains final text until concurrent operations settle',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input(),0),event('session.needs_input',{operationId:'legacy',question:'Choose'},1),event('operation.update',{ID:'legacy',Status:'completed',State:{TerminalResult:'Alpha'}},4),event('operation.started',{ID:'slow',Status:'awaiting'},5),event('session.item',{Kind:'model_response',Data:{Response:{Output:[{Type:'message',Data:{Text:'Final',Phase:'final_answer'}}]}}},6),event('session.idle',{messageIds:['m']},7)])
 expect((await cache.workView('p','s',true)).works[0].open).toBe(true);expect((await cache.workView('p','s',false)).questions[0].answers?.[0].text).toBe('Alpha')
 await put([event('operation.update',{ID:'slow',Status:'completed'},50)])
 const work=(await cache.workView('p','s',false)).works[0];expect(work.open).toBe(false);expect(work.endedAt).toBe(new Date(1700000000050).toISOString());expect(work.finalMessageId).toBe('5:message:0')
})
it('does not expose live cancellation for a historical operation after coordinator restart',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input(),0),event('operation.started',{ID:'old',Status:'awaiting'},1),event('session.status',{status:'running'},9000)])
 expect((await cache.activityPage('p','s',true)).rows[0].status).toBe('interrupted')
 await put([event('operation.started',{ID:'old',Status:'awaiting'},9001)])
 expect((await cache.activityPage('p','s',true)).rows[0].status).toBe('executing')
 expect((await cache.workView('p','s',true)).works[0].state).toBe('running')
})
it('does not accumulate missing message identities during legacy backfills',async()=>{
 const {cache,event,put}=await fixture();await put(Array.from({length:750},(_,i)=>event('session.item',{Kind:'input',Data:{Kind:'external',Payload:'Legacy input'}},i)))
 expect((await cache.workView('p','s',false)).works[0].messageIds).toEqual([])
})
it('keeps later steering active when an earlier idle acknowledgement arrives',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input('first'),0),event('session.item',input('steer'),1),event('session.idle',{messageIds:['first'],outcome:{state:'running'}},2)])
 expect((await cache.workView('p','s',true)).works[0].open).toBe(true)
 await put([event('session.idle',{messageIds:['steer']},3)])
 expect((await cache.workView('p','s',false)).works[0].state).toBe('completed')
})
it('keeps retained worker notices in the initiating work and preserves earlier final answers',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input(),0),event('session.item',{Kind:'model_response',Data:{Response:{Output:[{Type:'message',Data:{Text:'Initial findings'}}]}}},1),event('session.idle',{messageIds:['m']},2),event('session.item',{Kind:'input',Data:{Kind:'external',ID:'worker-notice',Payload:{prompt:'<unrealcode_worker_event>Findings</unrealcode_worker_event>'}}},20),event('session.item',{Kind:'model_response',Data:{Response:{Output:[{Type:'message',Data:{Text:'Reviewed worker findings'}}]}}},21),event('session.idle',{messageIds:['worker-notice']},22)])
 const view=await cache.workView('p','s',false);expect(view.works).toHaveLength(1);expect(view.works[0].finalMessageIds).toEqual(['2:message:0','5:message:0']);expect(view.works[0].elapsedMs).toBeUndefined()
})
it('replays a legacy refused stop as failure even after a historical completed idle',async()=>{
 const {cache,event,put}=await fixture()
 await put([event('session.item',input(),0),event('session.item',{Kind:'model_response',Data:{TurnID:'t',Response:{Stop:'refused',Output:[{Type:'message',Data:{Text:'Declined'}}]}}},100),event('session.idle',{messageIds:['m'],outcome:{state:'completed'}},110)])
 expect((await cache.workView('p','s',false)).works.at(-1)?.state).toBe('failed')
 expect((await cache.page('p','s')).events[1].failure?.providerIssue?.category).toBe('refusal')
})

it('preserves a recorded provider failure if disconnect occurs before the idle event',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input(),0),event('session.item',{Kind:'model_response',Data:{TurnID:'t',Response:{Failure:{Code:'server_error',Message:'Provider failed before disconnect'}}}},10)])
 const work=(await cache.workView('p','s',false)).works[0]
 expect(work.state).toBe('failed');expect(work.open).toBe(false);expect(work.failureSequence).toBe(2)
})

it.each([false,true])('excludes settled failure time but counts remaining parallel tool work (%s)',async parallel=>{
 const {cache,event,put}=await fixture(),events=[event('session.item',input(),0)]
 if(parallel)events.push(event('session.item',calls(['Bash']),1),event('operation.started',{ID:'Bash',Status:'executing'},2),event('session.item',linked('Bash'),2))
 events.push(event('session.item',{Kind:'model_response',Data:{TurnID:'failed',Response:{Failure:{Code:'server_error',Message:'Failed'}}}},10))
 if(parallel)events.push(event('operation.update',{ID:'Bash',Status:'completed',State:{TerminalResult:'Done'}},20))
 events.push(event('session.idle',{outcome:{state:'failed'}},1000));await put(events)
 expect((await cache.workView('p','s',false)).works[0].elapsedMs).toBe(parallel?20:10)
})

it('repairs version-six settled failure timing from canonical events and preserves its backup',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input(),0),event('session.item',{Kind:'model_response',Data:{Response:{Failure:{Code:'server_error',Message:'Failed'}}}},10),event('session.idle',{outcome:{state:'failed'}},1000)])
 await cache.close();const old=new DatabaseSync(cache.path);old.exec("UPDATE work_groups SET data=json_set(data,'$.elapsedMs',1000); PRAGMA user_version=6");old.close()
 const reopened=new HistoryCache(cache.profile);cleanup.push(()=>reopened.close());expect((await reopened.workView('p','s',false)).works[0].elapsedMs).toBe(10);expect((await reopened.page('p','s')).events).toHaveLength(3)
 const backup=new DatabaseSync(cache.path+'.before-1.0.4-v6.sqlite',{readOnly:true});try{expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(6);expect(JSON.parse(backup.prepare('SELECT data FROM work_groups').get()?.data as string).elapsedMs).toBe(1000)}finally{backup.close()}
})

it('counts nonhuman service waiting after a provider failure until the pending tool settles',async()=>{
 const {cache,event,put}=await fixture();await put([event('session.item',input(),0),event('session.item',calls(['Bash']),1),event('operation.update',{ID:'Bash',Status:'awaiting'},2),event('session.item',linked('Bash'),2),event('host.request',{operationId:'Bash'},2),event('session.item',{Kind:'model_response',Data:{Response:{Failure:{Code:'server_error',Message:'Failed'}}}},10),event('operation.update',{ID:'Bash',Status:'completed'},20),event('session.idle',{outcome:{state:'failed'}},1000)])
 expect((await cache.workView('p','s',false)).works[0].elapsedMs).toBe(20)
})
