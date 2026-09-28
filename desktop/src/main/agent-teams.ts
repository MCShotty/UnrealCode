import { createHash,randomUUID } from 'node:crypto'
import { existsSync,readFileSync } from 'node:fs'
import type { UsageTotals } from '../shared/api'
import { defaultTeamOptions,validateTeamOptions,validateAssignment,type TeamOptions,type TeamTask,type TeamView,type SpecialistWorker,type WorkerAssignment } from '../shared/teams'
import { atomicMetadata } from './atomic-metadata'

export class WorkerSlots {
  private owners=new Set<string>()
  private waiting=new Map<string,{ready:()=>boolean;launch:()=>void}>()
  private pumping=false
  enqueue(id:string,ready:()=>boolean,launch:()=>void):void{if(!this.waiting.has(id))this.waiting.set(id,{ready,launch});this.pump()}
  remove(id:string):void{this.waiting.delete(id)}
  pump():void{if(this.pumping)return;this.pumping=true;queueMicrotask(()=>{this.pumping=false;for(const [id,job] of this.waiting){if(this.size>=4)break;if(job.ready()){this.waiting.delete(id);this.reserve(id);job.launch()}}})}
  get size():number{return this.owners.size}
  reserve(id:string):void{if(this.owners.has(id))return;if(this.owners.size>=4)throw new Error('Four specialists are already active across projects');this.owners.add(id)}
  release(id:string):void{this.owners.delete(id);this.pump()}
}
export const globalWorkerSlots=new WorkerSlots()
const active=(worker:SpecialistWorker)=>['starting','running','waiting_input'].includes(worker.state)
const totals=():UsageTotals=>({input:0,output:0,cached:0,cacheWrite:0,reasoning:0,calls:0,decisionInput:0,decisionOutput:0,decisionCalls:0,latestInput:0})
export function sumTeamUsage(values:UsageTotals[]):UsageTotals {
  const result=totals();for(const value of values)for(const key of Object.keys(result) as (keyof UsageTotals)[])if(key!=='latestInput')result[key]+=value[key]||0
  return result
}
type Runner={
  prepare(parent:string,worker:SpecialistWorker,signal:AbortSignal,record:(value:Pick<SpecialistWorker,'sessionId'|'workspaceId'|'path'|'snapshot'|'omitted'|'limits'>)=>Promise<void>):Promise<Pick<SpecialistWorker,'sessionId'|'workspaceId'|'path'|'snapshot'|'omitted'|'limits'>>;
  send(session:string,prompt:string,messageId:string):Promise<void>;
  stop(session:string):Promise<void>;
}
export class AgentTeams {
  async flush():Promise<void>{await this.tail}
  async shutdown():Promise<void>{let metadataError:unknown;const mark=()=>{for(const task of this.tasks.values()){task.paused=true;for(const worker of task.workers){this.slots.remove(worker.id);this.launches.get(worker.id)?.abort();if(worker.state==='queued')worker.state='interrupted'}}};try{await this.mutate(mark)}catch(error){metadataError=error;mark()}const results=await Promise.allSettled([...this.tasks.values()].flatMap(task=>task.workers.filter(active).map(worker=>this.cancel(task.parentSessionId,worker.id))));await this.tail;const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected').map(result=>result.reason);if(metadataError||failures.length)throw new AggregateError([...(metadataError?[metadataError]:[]),...failures],'Some specialists could not be stopped or saved. Inspect their retained sessions before resuming.')}
  modelView(session:string):unknown{const view=this.view(session);if(!view)return null;return {parentSessionId:view.parentSessionId,paused:view.paused,message:view.message?.slice(0,500),modelRequests:view.modelRequests,elapsedMs:view.elapsedMs,totalUsage:view.totalUsage,workers:view.workers.map(worker=>({id:worker.id,role:worker.role,state:worker.state,assignment:worker.assignment.slice(0,300),findings:worker.findings?.slice(0,1800),findingsTruncated:(worker.findings?.length||0)>1800,message:worker.message?.slice(0,300)}))}}
  private tasks=new Map<string,TeamTask>()
  private tail:Promise<unknown>=Promise.resolve()
  private launches=new Map<string,AbortController>()
  private changing=new Set<string>()
  onChanged:()=>void=()=>{}
  onSettled:(parent:string,worker:SpecialistWorker)=>void=()=>{}
  private waiters=new Set<()=>void>()
  private changed():void{try{this.onChanged()}catch{/* Renderer teardown cannot undo committed team state. */}for(const wake of this.waiters)wake()}
  wait(session:string,timeoutMs=30000):Promise<unknown>{
    const parent=this.parent(session);if(!parent)return Promise.resolve(null)
    const task=this.task(parent);if(!task.workers.some(worker=>active(worker)||worker.state==='queued'))return Promise.resolve(this.modelView(parent))
    const signature=()=>JSON.stringify({paused:task.paused,workers:task.workers.map(worker=>[worker.id,worker.state])}),before=signature()
    return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);this.waiters.delete(changed);resolve(this.modelView(parent))};const changed=()=>{if(signature()!==before)finish()};const timer=setTimeout(finish,Math.max(1,Math.min(30000,timeoutMs)));this.waiters.add(changed)})
  }
  constructor(private path:string,private runner:Runner,private slots=globalWorkerSlots) {
    if(existsSync(path)) {
      const saved=JSON.parse(readFileSync(path,'utf8')) as {version:number;tasks:TeamTask[]}
      if(saved.version!==1||!Array.isArray(saved.tasks))throw new Error('Unsupported team metadata; prior data has been retained')
      for(const task of saved.tasks){validateTeamOptions(task.options);task.paused=true;task.parentState='stopped';task.message='Restarted. Review retained workers and choose Resume.';for(const worker of task.workers)if(active(worker)||worker.state==='queued')worker.state='interrupted';this.tasks.set(task.parentSessionId,task)}
    }
  }
  private mutate<T>(work:()=>T|Promise<T>):Promise<T>{const run=this.tail.then(async()=>{const result=await work();await atomicMetadata(this.path,JSON.stringify({version:1,tasks:[...this.tasks.values()]}));this.changed();return result});this.tail=run.catch(()=>{});return run}
  private task(parent:string):TeamTask{const task=this.tasks.get(parent);if(!task)throw new Error('This session has no task team');return task}
  parent(session:string):string|undefined{return this.tasks.has(session)?session:[...this.tasks.values()].find(task=>task.workers.some(worker=>worker.sessionId===session))?.parentSessionId}
  worker(session:string):SpecialistWorker|undefined{return [...this.tasks.values()].flatMap(task=>task.workers).find(worker=>worker.sessionId===session)}
  list():TeamView[]{return [...this.tasks.keys()].map(parent=>this.view(parent)!)}
  view(session:string):TeamView|null{const parent=this.parent(session);if(!parent)return null;const {permits:_,...visible}=this.task(parent),task=structuredClone(visible);const parentUsage=task.usage[parent]||totals(),workerUsage=sumTeamUsage(task.workers.flatMap(worker=>worker.sessionId&&task.usage[worker.sessionId]?[task.usage[worker.sessionId]]:[]));return {...task,parentUsage,workerUsage,totalUsage:sumTeamUsage([parentUsage,workerUsage]),globalActiveWorkers:this.slots.size}}
  hasPending(parent:string):boolean{const task=this.tasks.get(parent);return !!task?.workers.some(worker=>active(worker)||['queued','review','interrupted','failed','cancelled'].includes(worker.state))}
  async configure(parent:string,options:TeamOptions):Promise<void>{
    const valid=validateTeamOptions(options)
    if(this.changing.has(parent))throw Error('Task settings are already being saved')
    this.changing.add(parent)
    // Publish permissions only after persistence. Keep worker object identities
    // stable: active launch/slot callbacks retain references to those objects.
    const run=this.tail.then(async()=>{
      if(this.worker(parent))throw new Error('Specialists cannot enable nested delegation')
      const current=this.tasks.get(parent)
      if(current&&(current.parentState==='running'||current.workers.some(active)))throw new Error('Finish or stop active task work before changing limits')
      const next:TeamTask=current?{...current,options:valid}:{parentSessionId:parent,options:valid,paused:false,parentState:'idle',workers:[],modelRequests:0,elapsedMs:0,usage:{},permits:[]}
      const records=new Map(this.tasks);records.set(parent,next)
      await atomicMetadata(this.path,JSON.stringify({version:1,tasks:[...records.values()]}))
      this.tasks.set(parent,next);this.changed()
    })
    this.tail=run.catch(()=>{});try{await run}finally{this.changing.delete(parent);this.slots.pump()}
  }
  private limit(task:TeamTask,checkPending=true):string|undefined {
    if(checkPending&&this.changing.has(task.parentSessionId))return 'Task settings are being saved'
    if(task.paused)return task.message||'Task is paused; choose Resume'
    if(task.options.modelRequestLimit&&task.modelRequests>=task.options.modelRequestLimit)return 'Model request limit reached'
    if(task.options.elapsedMinutes&&task.elapsedMs>=task.options.elapsedMinutes*60000)return 'Task elapsed-time limit reached'
    const usage=sumTeamUsage(Object.values(task.usage));if(task.options.tokenLimit&&usage.input+usage.output+usage.decisionInput+usage.decisionOutput>=task.options.tokenLimit)return 'Reported task token limit reached; in-flight responses may exceed it'
  }
  async permit(session:string,request:string):Promise<void>{let denied='';await this.mutate(()=>{const task=this.task(this.parent(session)||'');const key=`${session}:${request}`;if(task.permits.includes(key))return;const worker=this.worker(session),usage=task.usage[session],limits=worker?.limits;const reason=this.limit(task)||(limits?.modelRequestLimit&&task.permits.filter(id=>id.startsWith(`${session}:`)).length>=limits.modelRequestLimit?'Specialist request limit reached':limits?.tokenLimit&&usage&&usage.input+usage.output>=limits.tokenLimit?'Specialist token limit reached':limits?.elapsedMinutes&&(worker?.elapsedMs||0)>=limits.elapsedMinutes*60000?'Specialist elapsed limit reached':undefined);if(reason){if(this.limit(task)){task.paused=true;task.message=reason}denied=reason;return}if(task.permits.length>=100000)throw new Error('Task request journal is full');task.permits.push(key);task.modelRequests++});if(denied)throw new Error(denied)}
  async usage(session:string,value:UsageTotals):Promise<void>{const parent=this.parent(session);if(!parent)return;await this.mutate(()=>{const safe=totals();for(const key of Object.keys(safe) as (keyof UsageTotals)[]){const number=value[key];if(!Number.isFinite(number)||number<0)throw new Error('Invalid reported usage');safe[key]=number}this.task(parent).usage[session]=safe})}
  async resume(parent:string):Promise<void>{
    if(this.changing.has(parent))throw Error('Task settings are already being saved')
    this.changing.add(parent)
    const run=this.tail.then(async()=>{const task=this.task(parent),next={...task,paused:false,message:undefined as string|undefined},reason=this.limit(next,false);if(reason){next.paused=true;next.message=reason}const records=[...this.tasks.values()].map(item=>item===task?next:item);await atomicMetadata(this.path,JSON.stringify({version:1,tasks:records}));task.paused=next.paused;task.message=next.message;this.changed();if(reason)throw Error(`${reason}. Edit the task limits before resuming.`)})
    this.tail=run.catch(()=>{});try{await run}finally{this.changing.delete(parent);this.slots.pump()}
  }
  async dispatch(parent:string,input:WorkerAssignment,requestId:string):Promise<SpecialistWorker>{
    if(typeof requestId!=='string'||!requestId||requestId.length>128)throw Error('Invalid dispatch request identity')
    const assignment=validateAssignment(input),digest=createHash('sha256').update(JSON.stringify(assignment)).digest('hex')
    let worker!:SpecialistWorker,existing=false,immediate=false
    try{await this.mutate(()=>{
      if(this.worker(parent))throw Error('Nested delegation is disabled')
      const task=this.task(parent);if(!task.options.allowSpecialists)throw Error('The user has not enabled specialists for this task')
      const prior=task.workers.find(item=>item.requestId===requestId);if(prior){if(prior.requestDigest!==digest)throw Error('Replayed dispatch arguments changed');worker=prior;existing=true;return}
      const reason=this.limit(task);if(reason)throw Error(reason)
      if(task.workers.length>=task.options.workerLimit)throw Error('Task worker-count limit reached')
      immediate=task.workers.filter(active).length<task.options.concurrency&&this.slots.size<4
      worker={...assignment,id:randomUUID(),requestId,requestDigest:digest,parentSessionId:parent,createdAt:new Date().toISOString(),state:immediate?'starting':'queued'}
      if(immediate)this.slots.reserve(worker.id)
      task.workers.push(worker)
    })}catch(error){if(worker&&!existing){this.slots.release(worker.id);const task=this.tasks.get(parent);if(task)task.workers=task.workers.filter(item=>item.id!==worker.id)}throw error}
    if(existing)return structuredClone(worker)
    if(immediate)return this.launch(parent,worker)
    this.slots.enqueue(worker.id,()=>{const task=this.task(parent);return worker.state==='queued'&&!this.limit(task)&&task.options.allowSpecialists&&task.workers.filter(active).length<task.options.concurrency},()=>{worker.state='starting';void this.launch(parent,worker).catch(()=>{})})
    return structuredClone(worker)
  }
  private async launch(parent:string,worker:SpecialistWorker):Promise<SpecialistWorker>{
    const controller=new AbortController();this.launches.set(worker.id,controller)
    try{
      await this.mutate(()=>{if(worker.state!=='starting')throw Error('Specialist start cancelled');const reason=this.limit(this.task(parent));if(reason)throw Error(reason)})
      const prepared=await this.runner.prepare(parent,structuredClone(worker),controller.signal,value=>this.mutate(()=>{Object.assign(worker,value)}))
      await this.mutate(()=>{Object.assign(worker,prepared);if(controller.signal.aborted)throw Error('Specialist start cancelled');worker.state='running'})
      if(!worker.sessionId)throw Error('Specialist session was not created')
      await this.runner.send(worker.sessionId,`Role: ${worker.role}\nAssignment: ${worker.assignment}\nOwned files or responsibility: ${worker.ownership.join(', ')}\nExpected result: ${worker.expectedResult||'Report the completed assignment and verification'}\nAcceptance criteria: ${(worker.acceptance||[]).join('; ')}\nYou are not alone in this task. Do not revert others' work. Stay within the assignment and preserve unrelated changes. Do not delegate or publish changes.`,worker.id)
      return structuredClone(worker)
    }catch(error){let stopped=!worker.sessionId;if(worker.sessionId)try{await this.runner.stop(worker.sessionId);stopped=true}catch{/* Retain its reservation until confirmed stopped. */}
      try{await this.mutate(()=>{worker.state=stopped?controller.signal.aborted?'cancelled':'failed':'waiting_input';worker.message=stopped?error instanceof Error?error.message:'Specialist start failed':'Stopping could not be confirmed. Reconnect and inspect the specialist.'})}finally{if(stopped)this.slots.release(worker.id)}throw error
    }finally{this.launches.delete(worker.id)}
  }
  async settled(session:string,state:'review'|'completed'|'failed'|'cancelled',findings=''):Promise<void>{const worker=this.worker(session);if(!worker)return;await this.mutate(()=>{worker.state=state;worker.findings=findings.slice(-20000);this.slots.release(worker.id)});this.onSettled(worker.parentSessionId,structuredClone(worker))}
  async parentState(session:string,state:TeamTask['parentState']):Promise<void>{const parent=this.parent(session);if(!parent)return;await this.mutate(()=>{const task=this.task(parent),worker=this.worker(session);if(worker){if(state==='waiting_input')worker.state='waiting_input';else if(state==='running'&&active(worker))worker.state='running'}else task.parentState=state})}
  async advanceTime(milliseconds:number):Promise<void>{
    const running=(task:TeamTask)=>['running','waiting_input'].includes(task.parentState)||task.workers.some(active)
    const expiredWorkers:SpecialistWorker[]=[],expired:string[]=[];if(![...this.tasks.values()].some(running))return
    await this.mutate(()=>{for(const task of this.tasks.values()){if(!running(task))continue;task.elapsedMs+=Math.max(0,milliseconds);for(const worker of task.workers.filter(active)){worker.elapsedMs=(worker.elapsedMs||0)+Math.max(0,milliseconds);if(worker.limits?.elapsedMinutes&&worker.elapsedMs>=worker.limits.elapsedMinutes*60000)expiredWorkers.push(worker)}if(task.options.elapsedMinutes&&task.elapsedMs>=task.options.elapsedMinutes*60000)expired.push(task.parentSessionId)}})
    await Promise.all(expiredWorkers.map(worker=>this.cancel(worker.parentSessionId,worker.id)));
    await Promise.all(expired.map(parent=>this.stopAll(parent,'Task elapsed-time limit reached')))
  }
  async steer(parent:string,id:string,prompt:string,messageId:string=randomUUID()):Promise<void>{const task=this.task(parent),worker=task.workers.find(item=>item.id===id);if(!worker?.sessionId||!active(worker)||worker.state==='starting')throw new Error('Resume the specialist explicitly before steering it');if(task.paused)throw new Error(task.message||'Task is paused');if(!prompt.trim()||prompt.length>16000)throw new Error('Steering must contain text below 16000 characters');await this.runner.send(worker.sessionId,prompt,messageId)}
  async cancel(parent:string,id:string):Promise<void>{const worker=this.task(parent).workers.find(item=>item.id===id);if(!worker)throw new Error('Specialist does not belong to this task');this.slots.remove(id);this.launches.get(id)?.abort();if(worker.sessionId)await this.runner.stop(worker.sessionId);await this.mutate(()=>{worker.state='cancelled';this.slots.release(id)})}
  async resumeWorker(parent:string,id:string,followUp?:string):Promise<void>{
    if(followUp!==undefined&&(typeof followUp!=='string'||followUp.length>16000))throw Error('Specialist follow-up must be bounded text')
    const text=followUp?.trim(),retained=this.task(parent).workers.find(item=>item.id===id);if(retained&&!retained.sessionId&&retained.state==='interrupted'){if(text)throw Error('This specialist has no retained session to steer. Resume its original assignment first.');await this.mutate(()=>{const reason=this.limit(this.task(parent));if(reason)throw Error(reason);retained.state='queued'});this.slots.enqueue(id,()=>{const task=this.task(parent);return retained.state==='queued'&&task.options.allowSpecialists&&!this.limit(task)&&task.workers.filter(active).length<task.options.concurrency},()=>{retained.state='starting';void this.launch(parent,retained).catch(()=>{})});return}
    let worker!:SpecialistWorker,previous:SpecialistWorker['state']='interrupted',reserved=false
    try{await this.mutate(()=>{const task=this.task(parent);worker=task.workers.find(item=>item.id===id)!;if(!worker?.sessionId||active(worker))throw new Error('Select an inactive specialist with a retained session');const reason=this.limit(task);if(reason)throw new Error(reason);if(task.workers.filter(active).length>=task.options.concurrency)throw new Error('Task concurrency limit reached');this.slots.reserve(id);reserved=true;previous=worker.state;worker.state='running'})}catch(error){if(reserved){this.slots.release(id);worker.state=previous}throw error}
    try{await this.runner.send(worker.sessionId!,`Resume within your original ownership and restrictions. Inspect retained findings first. ${text||'Continue your recorded assignment.'}`,randomUUID())}
    catch(error){await this.settled(worker.sessionId!,'failed',String(error));throw error}
  }
  async followUp(parent:string,id:string,prompt:string):Promise<void>{
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>16000)throw Error('Supply a bounded follow-up')
    const worker=this.task(parent).workers.find(item=>item.id===id);if(!worker?.sessionId)throw Error('Select a retained specialist session')
    if(active(worker)){await this.steer(parent,id,prompt);return}
    await this.resumeWorker(parent,id,prompt)
  }
  async stopAll(parent:string,message='Stopped by user'):Promise<void>{const task=this.task(parent);let metadataError:unknown;try{await this.mutate(()=>{task.paused=true;task.message=message})}catch(error){metadataError=error;task.paused=true;task.message=message}const results=await Promise.allSettled([this.runner.stop(parent),...task.workers.filter(worker=>active(worker)||worker.state==='queued').map(worker=>this.cancel(parent,worker.id))]);const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected').map(result=>result.reason);if(metadataError||failures.length)throw new AggregateError([...(metadataError?[metadataError]:[]),...failures],'Some task sessions could not be stopped or saved. Reconnect and inspect retained work before resuming.')}
  async reviewed(parent:string,id:string,state:'integrated'|'retained'):Promise<void>{await this.mutate(()=>{const worker=this.task(parent).workers.find(item=>item.id===id);if(!worker||active(worker))throw new Error('Finish specialist operations before resolving its review');worker.state=state})}
  options(parent:string):TeamOptions{return structuredClone(this.tasks.get(parent)?.options||defaultTeamOptions)}
}
