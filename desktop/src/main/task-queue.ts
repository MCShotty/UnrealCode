import type { QueueTask, QueueSnapshot } from '../shared/workflow'
export type { QueueTask, QueueSnapshot } from '../shared/workflow'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BridgeSessionConfig } from '../shared/api'
import { readBoundedJSONSync } from './bounded-file-read'
import { redactDiagnostic } from './failures'

export type QueueRunner = { canStart(): Promise<boolean>; create(task: QueueTask): Promise<string>; send(task: QueueTask): Promise<void>; stop(sessionId: string): Promise<void> }
function validTask(task:QueueTask):boolean{
  if(!task||typeof task!=='object'||typeof task.id!=='string'||!(/^[a-f0-9-]{36}$/).test(task.id))return false
  if(typeof task.prompt!=='string'||!task.prompt.trim()||Buffer.byteLength(task.prompt)>256*1024)return false
  if(typeof task.createdAt!=='string'||task.createdAt.length>64||!Number.isFinite(Date.parse(task.createdAt)))return false
  if(!['pending','starting','running','waiting_input','completed','failed','cancelled','interrupted','waiting_review'].includes(task.state))return false
  if(task.sessionId!==undefined&&(typeof task.sessionId!=='string'||!task.sessionId||task.sessionId.length>128))return false
  if(task.attemptId!==undefined&&(typeof task.attemptId!=='string'||!(/^[a-f0-9-]{36}$/).test(task.attemptId)))return false
  if(task.workspaceChoice!==undefined&&!['project','isolated'].includes(task.workspaceChoice))return false
  if(task.message!==undefined&&(typeof task.message!=='string'||task.message.length>4096))return false
  const config=task.config
  if(!config||typeof config!=='object'||!['openai','openai-codex','anthropic','openrouter','fireworks','ollama','openai-compatible'].includes(config.provider))return false
  if(typeof config.model!=='string'||config.model.length>1024||typeof config.baseUrl!=='string'||config.baseUrl.length>4096)return false
  if(typeof config.thinkingLevel!=='string'||config.thinkingLevel.length>50||typeof config.systemPrompt!=='string'||Buffer.byteLength(config.systemPrompt)>4*1024*1024)return false
  if(!Array.isArray(config.disallowedTools)||config.disallowedTools.length>1000||config.disallowedTools.some(name=>typeof name!=='string'||!name||name.length>256))return false
  return Buffer.byteLength(JSON.stringify(task))<=512*1024
}
function validSnapshot(value:QueueSnapshot):void{
  if(!value||value.version!==1||typeof value.paused!=='boolean'||!Array.isArray(value.tasks)||value.tasks.length>200)throw Error('Invalid saved task queue; original data is preserved')
  const ids=new Set<string>()
  for(const task of value.tasks){
    if(!validTask(task)||ids.has(task.id))throw Error('Invalid saved queue task; original data is preserved')
    ids.add(task.id)
  }
}

export class TaskQueue {
  private value: QueueSnapshot = { version: 1, paused: true, tasks: [] }
  private launching = false
  private launchingId = ''
  onChange: (snapshot: QueueSnapshot) => void = () => {}
  onError: (error: unknown) => void = () => {}
  private schedule(): void { void this.kick().catch((error) => { try { this.onError(error) } catch { /* UI notification cannot decide queue state. */ } }) }
  constructor(private path: string, private runner: QueueRunner) {
    if (existsSync(path)) {
      const stored = readBoundedJSONSync<QueueSnapshot>(path,128*1024*1024)
      validSnapshot(stored)
      this.value = stored
      this.value.paused = true
      for (const task of this.value.tasks) if (['starting', 'running', 'waiting_input'].includes(task.state)) {
        const hadLink=!!task.sessionId
        task.state='interrupted';task.message=hadLink?'Application restarted. Inspect the linked session before retrying.':'Application restarted during session creation. Inspect session history for an unlinked session before retrying.'
      }
      this.save()
    }
  }
  snapshot(): QueueSnapshot { return structuredClone(this.value) }
  needsReview(sessionId: string, message = 'Review and integrate the isolated task changes before resuming the project queue.'): void {
    const task = this.value.tasks.find(item => item.sessionId === sessionId)
    if (!task || !['running', 'waiting_input'].includes(task.state)) return
    task.state = 'waiting_review'; task.message = message.slice(0,4096); this.value.paused = true; this.save()
  }
  reviewed(sessionId: string, message = 'Changes integrated. Resume the queue when ready.'): void {
    const task = this.value.tasks.find(item => item.sessionId === sessionId)
    if (task?.state === 'waiting_review') { const prior=task.message;task.state='completed';task.message=message.slice(0,4096);try{this.save()}catch(error){task.state='waiting_review';task.message=prior;throw error} }
  }
  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const encoded=JSON.stringify(this.value)
    if(Buffer.byteLength(encoded)>128*1024*1024)throw new Error('Task queue metadata exceeds its safe size limit')
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try{writeFileSync(temporary, encoded, { mode: 0o600 });renameSync(temporary, this.path)}finally{try{unlinkSync(temporary)}catch{/* Preserve the write error. */}}
    try { this.onChange(this.snapshot()) } catch { /* A closed renderer cannot undo the saved queue. */ }
  }
  private task(id: string): QueueTask {
    const task = this.value.tasks.find((item) => item.id === id)
    if (!task) throw new Error('Task not found in this project')
    return task
  }
  recordWorkspaceChoice(id:string,choice:'project'|'isolated'):void{
    const task=this.task(id)
    if(task.state!=='starting')throw Error('Only a starting queued task can select its workspace')
    if(task.workspaceChoice&&task.workspaceChoice!==choice)throw Error('Queued task workspace choice has already been recorded')
    if(task.workspaceChoice===choice)return
    task.workspaceChoice=choice
    try{this.save()}catch(error){task.workspaceChoice=undefined;throw error}
  }
  recordCreatedSession(id:string,sessionId:string):void{
    const task=this.task(id)
    if(!['starting','cancelled'].includes(task.state)||typeof sessionId!=='string'||!sessionId||sessionId.length>128)throw Error('Invalid queued session link')
    if(task.sessionId&&task.sessionId!==sessionId)throw Error('Queued task already links another session')
    if(task.sessionId===sessionId)return
    task.sessionId=sessionId
    // Retain the in-memory link even if persistence fails so the launch
    // handler can stop the created session before surfacing the write error.
    this.save()
  }
  add(prompt: string, config: BridgeSessionConfig,source?: import('../shared/github-workflow').GitHubTaskSource,teamOptions?:import('../shared/teams').TeamOptions): QueueSnapshot {
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 256 * 1024) throw new Error('Task must contain text below 256 KB')
    if (this.value.tasks.length >= 200) throw new Error('Remove finished tasks before adding more; the queue holds 200 tasks')
    const task:QueueTask={ id: randomUUID(), prompt: prompt.trim(), config: structuredClone(config), createdAt: new Date().toISOString(), state: 'pending',...(source?{source:structuredClone(source)}:{}),...(teamOptions?{teamOptions:structuredClone(teamOptions)}:{}) }
    if(Buffer.byteLength(JSON.stringify(task))>512*1024)throw new Error('Task details exceed the queue record limit')
    if(!validTask(task))throw new Error('Invalid saved queue task; original data is preserved')
    this.value.tasks.push(task)
    try{this.save()}catch(error){this.value.tasks.pop();throw error}
    this.schedule(); return this.snapshot()
  }
  edit(id: string, prompt: string): QueueSnapshot {
    const task = this.task(id)
    if (task.state !== 'pending') throw new Error('Only pending tasks can be edited')
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 256 * 1024) throw new Error('Task must contain text below 256 KB')
    if(Buffer.byteLength(JSON.stringify({...task,prompt:prompt.trim()}))>512*1024)throw new Error('Task details exceed the queue record limit')
    const previous=task.prompt;task.prompt=prompt.trim();try{this.save()}catch(error){task.prompt=previous;throw error}return this.snapshot()
  }
  reorder(ids: string[]): QueueSnapshot {
    const pending = this.value.tasks.filter((task) => task.state === 'pending')
    if (ids.length !== pending.length || new Set(ids).size !== ids.length || ids.some((id) => !pending.some((task) => task.id === id))) throw new Error('Provide each pending task exactly once')
    let position = 0
    const previous=this.value.tasks
    this.value.tasks = this.value.tasks.map((task) => task.state === 'pending' ? this.task(ids[position++]) : task)
    try{this.save()}catch(error){this.value.tasks=previous;throw error}return this.snapshot()
  }
  pause(): QueueSnapshot { this.value.paused = true; this.save(); return this.snapshot() }
  resume(): QueueSnapshot { const previous=this.value.paused;this.value.paused=false;try{this.save()}catch(error){this.value.paused=previous;throw error}this.schedule();return this.snapshot() }
  retry(id: string): QueueSnapshot {
    if (this.launching) throw new Error('Wait for the current task launch to finish before retrying')
    const task = this.task(id)
    if (!['failed', 'cancelled', 'interrupted'].includes(task.state)) throw new Error('Only stopped or failed tasks can be retried')
    const previous={state:task.state,sessionId:task.sessionId,message:task.message,attemptId:task.attemptId,workspaceChoice:task.workspaceChoice}
    if(task.sessionId){task.attemptId=randomUUID();task.workspaceChoice=undefined}
    task.state='pending';task.sessionId=undefined;task.message=undefined
    try{this.save()}catch(error){Object.assign(task,previous);throw error}return this.snapshot()
  }
  remove(id: string): QueueSnapshot {
    if (this.launchingId === id) throw new Error('Wait for the task launch to finish before removing it')
    if (['starting', 'running', 'waiting_input'].includes(this.task(id).state)) throw new Error('Cancel the active task first')
    const previous=this.value.tasks;this.value.tasks=this.value.tasks.filter((task)=>task.id!==id)
    try{this.save()}catch(error){this.value.tasks=previous;throw error}return this.snapshot()
  }
  async cancel(id: string): Promise<QueueSnapshot> {
    const task = this.task(id)
    this.value.paused = true
    if (task.state === 'starting') { task.state = 'cancelled'; this.save(); return this.snapshot() }
    if (task.sessionId && ['running', 'waiting_input', 'waiting_review'].includes(task.state)) await this.runner.stop(task.sessionId)
    task.state = 'cancelled'; task.message = 'Cancelled by user'; this.save(); return this.snapshot()
  }
  needsInput(sessionId: string, question: string): void {
    const task = this.value.tasks.find((task) => task.sessionId === sessionId && task.state === 'running')
    if (!task) return
    task.state = 'waiting_input'; task.message = question.slice(0,4096); this.value.paused = true; this.save()
  }
  continueExisting(sessionId:string,explicitTaskAction=false):void {
    const task=this.value.tasks.find(item=>item.sessionId===sessionId)
    if(!task||['running','waiting_input'].includes(task.state))return
    if(this.value.paused&&!explicitTaskAction)throw Error('Resume the project queue explicitly before continuing this task.')
    if(task.state==='waiting_review')throw Error('Review and integrate this task before continuing it.')
    if(this.value.tasks.some(item=>item!==task&&['starting','running','waiting_input'].includes(item.state)))throw Error('Another queued task is active.')
    const previous={state:task.state,message:task.message};task.state='running';task.message=undefined
    try{this.save()}catch(error){Object.assign(task,previous);throw error}
  }
  settled(sessionId: string, state: 'idle' | 'failed' | 'stopped', message?: string): void {
    const task = this.value.tasks.find((task) => task.sessionId === sessionId && ['running', 'waiting_input'].includes(task.state))
    if (task) {
      const previous={state:task.state,message:task.message,paused:this.value.paused}
      task.state = state === 'idle' ? 'completed' : state === 'failed' ? 'failed' : 'cancelled'
      task.message = message?.slice(0,4096)
      if (state !== 'idle') this.value.paused = true
      try{this.save()}catch(error){task.state=previous.state;task.message=previous.message;this.value.paused=previous.paused;throw error}
    }
    this.schedule()
  }
  async kick(): Promise<void> {
    if (this.launching || this.value.paused || this.value.tasks.some((task) => ['starting', 'running', 'waiting_input', 'waiting_review'].includes(task.state))) return
    let task = this.value.tasks.find((task) => task.state === 'pending')
    if (!task) return
    this.launching = true
    let attempted = false,createdSessionId='',stopped=false,sendAttempted=false
    try {
      if (!await this.runner.canStart() || this.value.paused) return
      // The user may edit, remove, or reorder pending work during the idle check.
      task = this.value.tasks.find((item) => item.state === 'pending')
      if (!task) return
      attempted = true; this.launchingId = task.id; task.state = 'starting'; this.save()
      const sessionId = await this.runner.create(structuredClone(task))
      createdSessionId=sessionId
      task.sessionId = sessionId
      if (this.task(task.id).state === 'cancelled') { await this.runner.stop(sessionId);stopped=true;this.save();return }
      task.state = 'running'; this.save()
      sendAttempted=true
      await this.runner.send(structuredClone(task))
    } catch (error) {
      this.value.paused=true
      const linkedSessionId=createdSessionId||task?.sessionId||''
      if(task&&this.value.tasks.includes(task)){
        task.state=linkedSessionId?'interrupted':'failed'
        task.message=linkedSessionId?`${sendAttempted?'Message delivery could not be confirmed.':'Session metadata could not be saved after creation.'} Inspect the linked session before retrying. ${redactDiagnostic(String(error))}`.slice(0,4096):redactDiagnostic(String(error))
      }
      if(linkedSessionId&&!stopped)try{await this.runner.stop(linkedSessionId);stopped=true}catch{if(task&&this.value.tasks.includes(task))task.message=`${task.message||'Session outcome is uncertain.'} Stopping the linked session could not be confirmed.`.slice(0,4096)}
      this.save()
    } finally {
      this.launching = false
      this.launchingId = ''
      if (attempted && !this.value.paused && !this.value.tasks.some((task) => ['starting', 'running', 'waiting_input'].includes(task.state))) queueMicrotask(() => this.schedule())
    }
  }
}
