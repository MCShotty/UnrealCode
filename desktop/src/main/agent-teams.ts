import { createHash,randomUUID } from 'node:crypto'
import { existsSync,readFileSync } from 'node:fs'
import type { UsageTotals } from '../shared/api'
import { defaultTeamOptions,validateTeamOptions,validateAssignment,type TeamOptions,type TeamTask,type TeamView,type SpecialistWorker,type WorkerAssignment } from '../shared/teams'
import { atomicMetadata } from './atomic-metadata'

export class WorkerSlots {
  private owners=new Set<string>()
  get size():number{return this.owners.size}
  reserve(id:string):void{if(this.owners.has(id))return;if(this.owners.size>=4)throw new Error('Four specialists are already active across projects');this.owners.add(id)}
  release(id:string):void{this.owners.delete(id)}
}
export const globalWorkerSlots=new WorkerSlots()
const active=(worker:SpecialistWorker)=>['starting','running','waiting_input'].includes(worker.state)
const totals=():UsageTotals=>({input:0,output:0,cached:0,cacheWrite:0,reasoning:0,calls:0,decisionInput:0,decisionOutput:0,decisionCalls:0,latestInput:0})
export function sumTeamUsage(values:UsageTotals[]):UsageTotals {
  const result=totals();for(const value of values)for(const key of Object.keys(result) as (keyof UsageTotals)[])if(key!=='latestInput')result[key]+=value[key]||0
  return result
}
type Runner={
  prepare(parent:string,worker:SpecialistWorker,signal:AbortSignal,record:(value:Pick<SpecialistWorker,'sessionId'|'workspaceId'|'path'|'snapshot'|'omitted'>)=>Promise<void>):Promise<Pick<SpecialistWorker,'sessionId'|'workspaceId'|'path'|'snapshot'|'omitted'>>;
  send(session:string,prompt:string,messageId:string):Promise<void>;
  stop(session:string):Promise<void>;
}
export class AgentTeams {
  async flush():Promise<void>{await this.tail}
  modelView(session:string):unknown{const view=this.view(session);if(!view)return null;return {parentSessionId:view.parentSessionId,paused:view.paused,message:view.message?.slice(0,500),modelRequests:view.modelRequests,elapsedMs:view.elapsedMs,totalUsage:view.totalUsage,workers:view.workers.map(worker=>({id:worker.id,role:worker.role,state:worker.state,assignment:worker.assignment.slice(0,300),findings:worker.findings?.slice(0,1800),findingsTruncated:(worker.findings?.length||0)>1800,message:worker.message?.slice(0,300)}))}}
  private tasks=new Map<string,TeamTask>()
  private tail:Promise<unknown>=Promise.resolve()
  private launches=new Map<string,AbortController>()
  onChanged:()=>void=()=>{}
  constructor(private path:string,private runner:Runner,private slots=globalWorkerSlots) {
    if(existsSync(path)) {
      const saved=JSON.parse(readFileSync(path,'utf8')) as {version:number;tasks:TeamTask[]}
      if(saved.version!==1||!Array.isArray(saved.tasks))throw new Error('Unsupported team metadata; prior data has been retained')
      for(const task of saved.tasks){validateTeamOptions(task.options);task.paused=true;task.parentState='stopped';task.message='Restarted. Review retained workers and choose Resume.';for(const worker of task.workers)if(active(worker))worker.state='interrupted';this.tasks.set(task.parentSessionId,task)}
    }
  }
  private mutate<T>(work:()=>T|Promise<T>):Promise<T>{const run=this.tail.then(async()=>{const result=await work();await atomicMetadata(this.path,JSON.stringify({version:1,tasks:[...this.tasks.values()]}));this.onChanged();return result});this.tail=run.catch(()=>{});return run}
  private task(parent:string):TeamTask{const task=this.tasks.get(parent);if(!task)throw new Error('This session has no task team');return task}
  parent(session:string):string|undefined{return this.tasks.has(session)?session:[...this.tasks.values()].find(task=>task.workers.some(worker=>worker.sessionId===session))?.parentSessionId}
  worker(session:string):SpecialistWorker|undefined{return [...this.tasks.values()].flatMap(task=>task.workers).find(worker=>worker.sessionId===session)}
  list():TeamView[]{return [...this.tasks.keys()].map(parent=>this.view(parent)!)}
  view(session:string):TeamView|null{const parent=this.parent(session);if(!parent)return null;const {permits:_,...task}=structuredClone(this.task(parent));const parentUsage=task.usage[parent]||totals(),workerUsage=sumTeamUsage(task.workers.flatMap(worker=>worker.sessionId&&task.usage[worker.sessionId]?[task.usage[worker.sessionId]]:[]));return {...task,parentUsage,workerUsage,totalUsage:sumTeamUsage([parentUsage,workerUsage]),globalActiveWorkers:this.slots.size}}
  hasPending(parent:string):boolean{const task=this.tasks.get(parent);return !!task?.workers.some(worker=>active(worker)||['review','interrupted','failed','cancelled'].includes(worker.state))}
  async configure(parent:string,options:TeamOptions):Promise<void>{const valid=validateTeamOptions(options);await this.mutate(()=>{if(this.worker(parent))throw new Error('Specialists cannot enable nested delegation');const current=this.tasks.get(parent);if(current&&(current.parentState==='running'||current.workers.some(active)))throw new Error('Finish or stop active task work before changing limits');this.tasks.set(parent,current?{...current,options:valid}:{parentSessionId:parent,options:valid,paused:false,parentState:'idle',workers:[],modelRequests:0,elapsedMs:0,usage:{},permits:[]})})}
  private limit(task:TeamTask):string|undefined {
    if(task.paused)return task.message||'Task is paused; choose Resume'
    if(task.options.modelRequestLimit&&task.modelRequests>=task.options.modelRequestLimit)return 'Model request limit reached'
    if(task.options.elapsedMinutes&&task.elapsedMs>=task.options.elapsedMinutes*60000)return 'Task elapsed-time limit reached'
    const usage=sumTeamUsage(Object.values(task.usage));if(task.options.tokenLimit&&usage.input+usage.output+usage.decisionInput+usage.decisionOutput>=task.options.tokenLimit)return 'Reported task token limit reached; in-flight responses may exceed it'
  }
  async permit(session:string,request:string):Promise<void>{let denied='';await this.mutate(()=>{const task=this.task(this.parent(session)||'');const key=`${session}:${request}`;if(task.permits.includes(key))return;const reason=this.limit(task);if(reason){task.paused=true;task.message=reason;denied=reason;return}if(task.permits.length>=100000)throw new Error('Task request journal is full');task.permits.push(key);task.modelRequests++});if(denied)throw new Error(denied)}
  async usage(session:string,value:UsageTotals):Promise<void>{const parent=this.parent(session);if(!parent)return;await this.mutate(()=>{const safe=totals();for(const key of Object.keys(safe) as (keyof UsageTotals)[]){const number=value[key];if(!Number.isFinite(number)||number<0)throw new Error('Invalid reported usage');safe[key]=number}this.task(parent).usage[session]=safe})}
  async resume(parent:string):Promise<void>{await this.mutate(()=>{const task=this.task(parent);task.paused=false;task.message=undefined;const reason=this.limit(task);if(reason){task.paused=true;task.message=reason;throw new Error(`${reason}. Edit the task limits before resuming.`)}})}
  async dispatch(parent:string,input:WorkerAssignment,requestId:string):Promise<SpecialistWorker>{
    if(typeof requestId!=='string'||!requestId||requestId.length>128)throw new Error('Invalid dispatch request identity')
    const assignment=validateAssignment(input),digest=createHash('sha256').update(JSON.stringify(assignment)).digest('hex');let worker!:SpecialistWorker,existing=false
    const controller=new AbortController()
    try{await this.mutate(()=>{
      if(this.worker(parent))throw new Error('Nested delegation is disabled')
      const task=this.task(parent);if(!task.options.allowSpecialists)throw new Error('The user has not enabled specialists for this task')
      const prior=task.workers.find(item=>item.requestId===requestId);if(prior){if(prior.requestDigest!==digest)throw new Error('Replayed dispatch arguments changed');worker=prior;existing=true;return}
      const reason=this.limit(task);if(reason)throw new Error(reason)
      if(task.workers.length>=task.options.workerLimit)throw new Error('Task worker-count limit reached')
      if(task.workers.filter(active).length>=task.options.concurrency)throw new Error('This task already has its maximum concurrent specialists')
      worker={...assignment,id:randomUUID(),requestId,requestDigest:digest,parentSessionId:parent,createdAt:new Date().toISOString(),state:'starting'}
      this.slots.reserve(worker.id);task.workers.push(worker);this.launches.set(worker.id,controller)
    })}catch(error){if(worker&&!existing&&this.launches.has(worker.id)){this.slots.release(worker.id);this.launches.delete(worker.id);const task=this.tasks.get(parent);if(task)task.workers=task.workers.filter(item=>item.id!==worker.id)}throw error}
    if(existing)return structuredClone(worker)
    try {
      const prepared=await this.runner.prepare(parent,structuredClone(worker),controller.signal,value=>this.mutate(()=>{Object.assign(worker,value)}))
      await this.mutate(()=>{Object.assign(worker,prepared);if(controller.signal.aborted)throw new Error('Specialist start cancelled');worker.state='running'})
      if(!worker.sessionId)throw new Error('Specialist session was not created')
      await this.runner.send(worker.sessionId,`Role: ${worker.role}\nAssignment: ${worker.assignment}\nOwned files or responsibility: ${worker.ownership.join(', ')}\nYou are not alone in this task. Do not revert others' work. Stay within the assignment, preserve unrelated changes, and report findings and verification. Do not delegate or publish changes.`,worker.id)
      return structuredClone(worker)
    }catch(error){let stopped=!worker.sessionId;if(worker.sessionId)try{await this.runner.stop(worker.sessionId);stopped=true}catch{/* Keep its slot until stopping can be confirmed. */}try{await this.mutate(()=>{worker.state=stopped?controller.signal.aborted?'cancelled':'failed':'waiting_input';worker.message=stopped?error instanceof Error?error.message:'Specialist start failed':'Specialist start failed and stopping could not be confirmed. Inspect the backend, then stop this specialist.'})}finally{if(stopped)this.slots.release(worker.id)}throw error}
    finally{this.launches.delete(worker.id)}
  }
  async settled(session:string,state:'review'|'completed'|'failed'|'cancelled',findings=''):Promise<void>{const worker=this.worker(session);if(!worker)return;await this.mutate(()=>{worker.state=state;worker.findings=findings.slice(-20000);this.slots.release(worker.id)})}
  async parentState(session:string,state:TeamTask['parentState']):Promise<void>{const parent=this.parent(session);if(!parent)return;await this.mutate(()=>{const task=this.task(parent),worker=this.worker(session);if(worker){if(state==='waiting_input')worker.state='waiting_input';else if(state==='running'&&active(worker))worker.state='running'}else task.parentState=state})}
  async advanceTime(milliseconds:number):Promise<void>{
    const running=(task:TeamTask)=>['running','waiting_input'].includes(task.parentState)||task.workers.some(active)
    const expired:string[]=[];if(![...this.tasks.values()].some(running))return
    await this.mutate(()=>{for(const task of this.tasks.values()){if(!running(task))continue;task.elapsedMs+=Math.max(0,milliseconds);if(task.options.elapsedMinutes&&task.elapsedMs>=task.options.elapsedMinutes*60000)expired.push(task.parentSessionId)}})
    await Promise.all(expired.map(parent=>this.stopAll(parent,'Task elapsed-time limit reached')))
  }
  async steer(parent:string,id:string,prompt:string,messageId:string=randomUUID()):Promise<void>{const task=this.task(parent),worker=task.workers.find(item=>item.id===id);if(!worker?.sessionId||!active(worker)||worker.state==='starting')throw new Error('Resume the specialist explicitly before steering it');if(task.paused)throw new Error(task.message||'Task is paused');if(!prompt.trim()||prompt.length>16000)throw new Error('Steering must contain text below 16000 characters');await this.runner.send(worker.sessionId,prompt,messageId)}
  async cancel(parent:string,id:string):Promise<void>{const worker=this.task(parent).workers.find(item=>item.id===id);if(!worker)throw new Error('Specialist does not belong to this task');this.launches.get(id)?.abort();if(worker.sessionId)await this.runner.stop(worker.sessionId);await this.mutate(()=>{worker.state='cancelled';this.slots.release(id)})}
  async resumeWorker(parent:string,id:string):Promise<void>{
    let worker!:SpecialistWorker,previous:SpecialistWorker['state']='interrupted',reserved=false
    try{await this.mutate(()=>{const task=this.task(parent);worker=task.workers.find(item=>item.id===id)!;if(!worker?.sessionId||active(worker))throw new Error('Select an inactive specialist with a retained session');const reason=this.limit(task);if(reason)throw new Error(reason);if(task.workers.filter(active).length>=task.options.concurrency)throw new Error('Task concurrency limit reached');this.slots.reserve(id);reserved=true;previous=worker.state;worker.state='running'})}catch(error){if(reserved){this.slots.release(id);worker.state=previous}throw error}
    try{await this.runner.send(worker.sessionId!,'Resume your recorded assignment. Inspect the retained workspace, account for previous findings and continue within your original ownership and restrictions.',randomUUID())}
    catch(error){await this.settled(worker.sessionId!,'failed',String(error));throw error}
  }
  async stopAll(parent:string,message='Stopped by user'):Promise<void>{const task=this.task(parent);await this.mutate(()=>{task.paused=true;task.message=message});const results=await Promise.allSettled([this.runner.stop(parent),...task.workers.filter(active).map(worker=>this.cancel(parent,worker.id))]);if(results.some(result=>result.status==='rejected'))throw new Error('Some task sessions could not be stopped. Reconnect the backend and inspect retained work before resuming.')}
  async reviewed(parent:string,id:string,state:'integrated'|'retained'):Promise<void>{await this.mutate(()=>{const worker=this.task(parent).workers.find(item=>item.id===id);if(!worker||active(worker))throw new Error('Finish specialist operations before resolving its review');worker.state=state})}
  options(parent:string):TeamOptions{return structuredClone(this.tasks.get(parent)?.options||defaultTeamOptions)}
}
