import { it,expect,vi } from 'vitest'
import {promises as fs} from 'node:fs'
import { mkdtemp,rename,mkdir,readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentTeams,WorkerSlots,sumTeamUsage } from './agent-teams'
import { defaultTeamOptions } from '../shared/teams'

it('does not publish a failed specialist opt-in or later persist its rejected permissions',async()=>{
 const {service,path}=await fixture();await service.configure('parent',defaultTeamOptions)
 const failure=vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(Error('disk full'),{code:'ENOSPC'}))
 try{await expect(service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})).rejects.toThrow('disk full')}finally{failure.mockRestore()}
 expect(service.view('parent')?.options.allowSpecialists).toBe(false)
 await service.parentState('parent','idle')
 expect(JSON.parse(await readFile(path,'utf8')).tasks[0].options.allowSpecialists).toBe(false)
})

const assignment={role:'implementer' as const,assignment:'Fix the parser and run its focused tests',ownership:['parser.ts','parser tests']}
async function fixture(slots=new WorkerSlots()) {
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-teams-')),'teams.json'),sent:string[]=[],stopped:string[]=[]
 const runner={prepare:async(_parent:string,worker:{id:string})=>({sessionId:worker.id,path:'fixture',workspaceId:worker.id,snapshot:'recorded-before'}),send:async(session:string)=>{sent.push(session)},stop:async(session:string)=>{stopped.push(session)}}
 return{service:new AgentTeams(path,runner,slots),runner,path,sent,stopped,slots}
}
it('requires task opt-in, explicit ownership and refuses nested delegation',async()=>{
 const {service}=await fixture();await service.configure('parent',defaultTeamOptions)
 await expect(service.dispatch('parent',assignment,'off')).rejects.toThrow('not enabled')
 await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})
 await expect(service.dispatch('parent',{...assignment,ownership:[]},'empty')).rejects.toThrow('ownership')
 const worker=await service.dispatch('parent',assignment,'first')
 await expect(service.dispatch(worker.sessionId!,assignment,'nested')).rejects.toThrow('Nested')
 await expect(service.configure(worker.sessionId!,{...defaultTeamOptions,allowSpecialists:true})).rejects.toThrow('nested')
})
it('does not reject committed team state when its renderer notification fails',async()=>{
 const {service,path}=await fixture()
 service.onChanged=()=>{throw Error('renderer closed')}
 await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})
 const worker=await service.dispatch('parent',assignment,'notification-failure')
 const waiting=service.wait('parent',1000)
 await service.settled(worker.sessionId!,'completed','Done')
 expect((await waiting as {workers:Array<{state:string}>}).workers[0].state).toBe('completed')
 expect(JSON.parse(await readFile(path,'utf8')).tasks[0].workers[0].state).toBe('completed')
})
it('releases a reserved slot when dispatch metadata cannot be persisted',async()=>{
 const {service,path,slots,sent}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})
 await rename(path,`${path}.previous`);await mkdir(path)
 await expect(service.dispatch('parent',assignment,'blocked-save')).rejects.toThrow()
 expect(slots.size).toBe(0);expect(sent).toHaveLength(0);expect(service.view('parent')?.workers).toHaveLength(0)
})
it('releases a resume reservation when metadata cannot be persisted',async()=>{
 const {service,path,slots,sent}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true});const worker=await service.dispatch('parent',assignment,'worker');await service.settled(worker.sessionId!,'completed')
 await rename(path,`${path}.previous`);await mkdir(path)
 await expect(service.resumeWorker('parent',worker.id)).rejects.toThrow();expect(slots.size).toBe(0);expect(sent).toHaveLength(1);expect(service.worker(worker.sessionId!)?.state).toBe('completed')
})
it('holds the worker slot when a failed start cannot be confirmed stopped',async()=>{
 const {service,runner,slots}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true});runner.send=async()=>{throw Error('lost connection')};runner.stop=async()=>{throw Error('unconfirmed stop')}
 await expect(service.dispatch('parent',assignment,'worker')).rejects.toThrow('lost connection');expect(slots.size).toBe(1);const worker=service.view('parent')!.workers[0];expect(worker.state).toBe('waiting_input')
 runner.stop=async()=>{};await service.cancel('parent',worker.id);expect(slots.size).toBe(0)
})
it('reserves concurrent starts, caps global workers, cancels independently and binds replay',async()=>{
 const slots=new WorkerSlots(),a=await fixture(slots),b=await fixture(slots)
 for(const item of [a,b])await item.service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})
 const [one,two]=await Promise.all([a.service.dispatch('parent',assignment,'a1'),a.service.dispatch('parent',assignment,'a2')])
 const queued=await a.service.dispatch('parent',assignment,'a3');expect(queued.state).toBe('queued');await a.service.cancel('parent',queued.id)
 await b.service.dispatch('parent',assignment,'b1');await b.service.dispatch('parent',assignment,'b2');expect(slots.size).toBe(4)
 await a.service.cancel('parent',one.id);expect(a.stopped).toEqual([one.sessionId]);expect(a.service.worker(two.sessionId!)?.state).toBe('running');expect(slots.size).toBe(3)
 const repeat=await a.service.dispatch('parent',assignment,'a1');expect(repeat.state).toBe('cancelled');expect(a.sent).toHaveLength(2)
 await expect(a.service.dispatch('parent',{...assignment,assignment:'Changed'},'a1')).rejects.toThrow('arguments changed')
 await a.service.dispatch('parent',assignment,'a4');expect(slots.size).toBe(4)
 const c=await fixture(slots);await c.service.configure('parent',{...defaultTeamOptions,allowSpecialists:true});const queuedGlobal=await c.service.dispatch('parent',assignment,'c1');expect(queuedGlobal.state).toBe('queued');await a.service.cancel('parent',two.id);await new Promise(resolve=>setTimeout(resolve,30));await c.service.flush();expect(c.service.view('parent')?.workers[0].state).toBe('running');expect(slots.size).toBe(4)
})
it('counts reported parent/child usage once and enforces logical request and elapsed limits',async()=>{
 const {service,stopped}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true,modelRequestLimit:2,elapsedMinutes:1,tokenLimit:100})
 const worker=await service.dispatch('parent',assignment,'worker')
 const usage={...sumTeamUsage([]),input:30,output:5,cached:15,reasoning:2}
 await service.usage('parent',usage);await service.usage('parent',usage);await service.usage(worker.sessionId!,usage)
 expect(service.view('parent')?.totalUsage.input).toBe(60)
 await service.permit('parent','r1');await service.permit('parent','r1');await service.permit(worker.sessionId!,'r2')
 await expect(service.permit('parent','r3')).rejects.toThrow('request limit')
 expect(service.view('parent')?.modelRequests).toBe(2)
 await service.parentState('parent','running');await service.advanceTime(60000)
 expect(service.view('parent')?.paused).toBe(true);expect(stopped).toContain(worker.sessionId)
})
it('blocks subsequent dispatch on reported tokens and restores interrupted state without execution',async()=>{
 const {service,path,runner,sent}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true,tokenLimit:50})
 const worker=await service.dispatch('parent',assignment,'worker');await service.usage(worker.sessionId!,{...sumTeamUsage([]),input:45,output:10})
 await expect(service.permit('parent','r')).rejects.toThrow('token limit')
 const restored=new AgentTeams(path,runner,new WorkerSlots());expect(restored.view('parent')?.paused).toBe(true);expect(restored.worker(worker.sessionId!)?.state).toBe('interrupted');expect(sent).toHaveLength(1)
 await expect(restored.dispatch('parent',assignment,'next')).rejects.toThrow('Restarted')
 expect(restored.hasPending('parent')).toBe(true);await restored.reviewed('parent',worker.id,'retained');expect(restored.hasPending('parent')).toBe(false)
})
it('waits for worker state changes without waking the parent for usage telemetry',async()=>{
 const {service}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true});const worker=await service.dispatch('parent',assignment,'wait')
 let woke=false;const waiting=service.wait('parent',1000).then(()=>{woke=true})
 await service.usage(worker.sessionId!,{...sumTeamUsage([]),input:30});await new Promise(resolve=>setTimeout(resolve,20));expect(woke).toBe(false)
 await service.settled(worker.sessionId!,'completed','Done');await waiting;expect(woke).toBe(true)
})
it('attempts parent and specialist stops even when the pause record cannot be saved',async()=>{
 const {service,path,stopped,slots}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})
 const worker=await service.dispatch('parent',assignment,'worker')
 await rename(path,`${path}.previous`);await mkdir(path)
 await expect(service.stopAll('parent')).rejects.toThrow('could not be stopped or saved')
 expect(stopped).toContain('parent')
 expect(stopped).toContain(worker.sessionId)
 expect(service.view('parent')?.paused).toBe(true)
 expect(slots.size).toBe(0)
})
it('attempts specialist shutdown after a metadata failure and reports unconfirmed stops',async()=>{
 const {service,path,stopped,slots,runner}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})
 const worker=await service.dispatch('parent',assignment,'worker')
 await rename(path,`${path}.previous`);await mkdir(path)
 await expect(service.shutdown()).rejects.toThrow('could not be stopped or saved')
 expect(stopped).toContain(worker.sessionId)
 expect(slots.size).toBe(0)
 runner.stop=async()=>{throw Error('unconfirmed stop')}
 const another=await fixture();await another.service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})
 await another.service.dispatch('parent',assignment,'another')
 another.runner.stop=runner.stop
 await expect(another.service.shutdown()).rejects.toThrow('could not be stopped or saved')
 expect(another.slots.size).toBe(1)
})
it('persists a denied resume limit and omits the permit journal from views',async()=>{
 const {service,path}=await fixture()
 await service.configure('parent',{...defaultTeamOptions,modelRequestLimit:1})
 await service.permit('parent','request-1')
 await expect(service.resume('parent')).rejects.toThrow('request limit')
 const saved=JSON.parse(await readFile(path,'utf8'))
 expect(saved.tasks[0]).toMatchObject({paused:true,message:'Model request limit reached'})
 const permits=(service as any).tasks.get('parent').permits
 Object.defineProperty(permits,0,{get(){throw Error('permit journal was cloned')},enumerable:true})
 expect(service.view('parent')).toMatchObject({paused:true,modelRequests:1})
})
it('rejects oversized resume prompts before restarting a retained worker',async()=>{
 const {service,sent}=await fixture();await service.configure('parent',{...defaultTeamOptions,allowSpecialists:true})
 const worker=await service.dispatch('parent',assignment,'worker');await service.settled(worker.sessionId!,'completed')
 await expect(service.resumeWorker('parent',worker.id,'x'.repeat(16001))).rejects.toThrow('bounded text')
 expect(service.worker(worker.sessionId!)?.state).toBe('completed')
 expect(sent).toHaveLength(1)
})
