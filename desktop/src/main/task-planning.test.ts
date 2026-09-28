import {afterEach,expect,it} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {TaskPlanning} from './task-planning'
import {parseCommand,validateCommand} from '../shared/commands'
import {documentedCapabilities} from '../shared/model-capabilities'
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function setup(){const root=await mkdtemp(join(tmpdir(),'unrealcode-planning-'));roots.push(root);return {root,id:randomUUID(),store:new TaskPlanning(root)}}
it('charges late goal responses after pause, deduplicates them, and excludes unrelated requests',async()=>{
 const {id,store}=await setup();await store.goal(id,{objective:'Bounded work',requestLimit:10,tokenLimit:100,elapsedMinutes:5})
 await store.goalAction(id,'resume');await store.permit(id,'inflight');await store.goalAction(id,'pause')
 await store.consume(id,1,0,150,0,'inflight');await store.consume(id,1,0,150,0,'inflight');await store.consume(id,2,0,900,0,'unrelated')
 expect((await store.read(id)).goal).toMatchObject({state:'limited',tokens:150,requests:1})
 await expect(store.goalAction(id,'resume')).rejects.toThrow('limits')
})
it('parses only declared commands and explicitly escapes literal slash text',()=>{
 expect(parseCommand('/plan first\nsecond')).toEqual({kind:'command',name:'plan',args:'first\nsecond'})
 expect(parseCommand('//fast')).toEqual({kind:'message',text:'/fast'})
 expect(()=>parseCommand('/erase')).toThrow('Unknown');expect(()=>validateCommand({name:'fast',args:'on'})).toThrow('session')
 expect(documentedCapabilities('openai-compatible','gpt-6-astra').fast).toBe(false)
})
it('preserves revisions and rejects approval of edited plans',async()=>{
 const {id,store}=await setup(),plan={objective:'Fix parser',body:'Inspect and repair',acceptance:['Tests pass'],milestones:[]}
 await store.savePlan(id,plan);await store.savePlan(id,{...plan,body:'Changed scope'})
 await expect(store.approve(id,1)).rejects.toThrow('changed');await store.approve(id,2)
 expect((await store.read(id)).revisions).toHaveLength(1);expect((await store.read(id)).plan?.approvedRevision).toBe(2)
})
it('rejects unbounded milestone evidence without altering stored plans',async()=>{
 const {id,store}=await setup()
 await expect(store.savePlan(id,{objective:'Bound evidence',body:'Plan',acceptance:[],milestones:[{id:'one',text:'Verify',state:'pending',evidence:Array(101).fill('evidence')}]})).rejects.toThrow('bounded')
 expect((await store.read(id)).revisions).toEqual([])
})
it('bounds requests, deduplicates reported tokens, and pauses after restart',async()=>{
 const {root,id,store}=await setup();await store.goal(id,{objective:'Build app',requestLimit:2,tokenLimit:100,elapsedMinutes:5});await store.goalAction(id,'resume')
 await store.permit(id,'r1');await store.permit(id,'r1');await store.consume(id,1,0,60);await store.consume(id,1,0,60)
 expect((await store.read(id)).goal).toMatchObject({requests:1,tokens:60,state:'running'})
 expect((await new TaskPlanning(root).read(id)).goal?.state).toBe('paused')
 await store.consume(id,2,0,50);expect((await store.read(id)).goal?.state).toBe('limited');await expect(store.permit(id,'r2')).rejects.toThrow('budget')
})
it('prevents budget reset during a goal and charges independent worker event sequences once',async()=>{
 const {id,store}=await setup();const limits={objective:'Build',requestLimit:1,tokenLimit:100,elapsedMinutes:5}
 await store.goal(id,limits);await store.goalAction(id,'resume');await store.permit(id,'last');await store.permit(id,'last')
 await expect(store.goal(id,limits)).rejects.toThrow('Pause')
 await store.consumeWorker(id,'worker-a',10,60);await store.consumeWorker(id,'worker-a',10,60);await store.consumeWorker(id,'worker-b',1,45)
 expect((await store.read(id)).goal).toMatchObject({tokens:105,requests:1,state:'limited'})
})
