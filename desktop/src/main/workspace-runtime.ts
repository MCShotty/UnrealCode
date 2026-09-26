import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent, BridgeSessionConfig, SessionInfo } from '../shared/api'
import type { ContextSelection, ContextView, HandoffPreview } from '../shared/workflow'
import { DockerBridge } from './docker'
import { SessionUsageService } from './session-usage'
import { CheckpointService } from './checkpoint-service'
import { ProjectContext } from './project-context'
import { TaskQueue } from './task-queue'
import { ConversationIndex } from './conversation-index'
import { handoffSummary } from './handoff'
import { credentialFor, getSettings } from './settings'
import { gitChanges } from './files'
import { TaskWorkspaces } from './task-workspaces'
import type { TaskWorkspace } from '../shared/task-workspaces'
import { RepositoryIndex } from './repository-index'
import { AgentTeams } from './agent-teams'
import { validateTeamOptions,type TeamOptions,type SpecialistWorker } from '../shared/teams'
import { VerificationWorkflows } from './verification-workflows'
import type { VerificationProfile,VerificationResult } from '../shared/verification'

export const projectData = (data: string, project: string): string => join(data, 'workspaces', createHash('sha256').update(project.toLowerCase()).digest('hex'))
type Hooks = { event(event: AgentEvent): void; changed(): void; notify(sessionId: string, state: string): void; configure(bridge: DockerBridge): Promise<unknown>; hasTerminal(): boolean; reviewWorkspace?(workspace: TaskWorkspace): Promise<'isolated' | 'project' | 'cancel'> }

export class WorkspaceRuntime {
  readonly teams: AgentTeams
  readonly workflows: VerificationWorkflows
  private specialistOwners = new Map<string,WorkspaceRuntime>()
  private workerStores = new Map<string,TaskWorkspaces>()
  private teamTimer?: NodeJS.Timeout
  private starting: Promise<void> | null = null
  readonly tasks: TaskWorkspaces
  active: WorkspaceRuntime = this
  private children = new Map<string, WorkspaceRuntime>()
  readonly bridge = new DockerBridge()
  readonly usage = new SessionUsageService(this.bridge)
  readonly checkpoints: CheckpointService
  readonly context: ProjectContext
  readonly queue: TaskQueue
  readonly index: ConversationIndex
  readonly repository: RepositoryIndex
  private directory: string
  private sequences = new Map<string, number>()
  private failures = new Set<string>()
  private pending = 0
  private indexSync: Promise<void> | null = null
  constructor(readonly project: string, private data: string, private hooks: Hooks, readonly isolated = false) {
    this.directory = projectData(data, project)
    this.teams = new AgentTeams(join(this.directory,'teams.json'),{
      prepare:(parent,worker,signal,record)=>this.prepareSpecialist(parent,worker,signal,record),
      send:async(session,prompt,id)=>{const owner=await this.owner(session),worker=this.teams.worker(session);if(worker){const parent=await this.owner(worker.parentSessionId),[parentConfig,childConfig]=await Promise.all([parent.bridge.request<BridgeSessionConfig>('session.config',{sessionId:worker.parentSessionId}),owner.bridge.request<BridgeSessionConfig>('session.config',{sessionId:session})]);if(childConfig.mode==='agent'&&parentConfig.mode!=='agent'||childConfig.mode==='ask'&&parentConfig.mode==='plan')throw new Error('The parent now has narrower permissions. Start a new specialist with those restrictions.');await owner.updateContext(session,{excluded:parent.context.get(worker.parentSessionId).excluded})}await owner.send(session,prompt,id)},
      stop:async(session)=>{this.workflows.cancelSession(session);const owner=await this.owner(session);await owner.stop(session)}
    })
    this.teams.onChanged=()=>hooks.changed()
    this.workflows=new VerificationWorkflows(join(this.directory,'workflows.json'),{verify:(session,profile,id,signal)=>this.verifyProfile(session,profile,id,signal),repair:(session,prompt,id,signal)=>this.repairFromVerification(session,prompt,id,signal)})
    this.workflows.onChanged=()=>hooks.changed()
    this.checkpoints = new CheckpointService(project, data)
    this.tasks = new TaskWorkspaces(project, join(this.directory, 'tasks'), this.checkpoints.store)
    this.context = new ProjectContext(project, join(this.directory, 'context.json'))
    this.index = new ConversationIndex(project, join(this.directory, 'search'))
    this.repository = new RepositoryIndex(project,join(this.directory,'repository-index.json'),()=>this.context.get().excluded)
    this.queue = new TaskQueue(join(this.directory, 'queue.json'), {
      canStart: async () => !this.pending && !this.workflows.busy && !this.teams.list().some(task=>this.teams.hasPending(task.parentSessionId)) && ![...this.children.values()].some(child => child.pending || child.checkpoints.busy) && !hooks.hasTerminal() && !this.checkpoints.busy && await this.bridge.request<boolean>('project.idle', {}),
      create: async (task) => {const options=task.teamOptions?validateTeamOptions(task.teamOptions):undefined;const config={...task.config,teamEnabled:options?.allowSpecialists,teamManaged:!!options&&(options.allowSpecialists||options.modelRequestLimit>0||options.elapsedMinutes>0||options.tokenLimit>0)};const id=await this.create(config,false);if(options&&config.teamManaged)await this.teams.configure(id,options);return id},
      send: (task) => this.send(task.sessionId!, task.prompt, task.id),
      stop: (sessionId) => this.teams.view(sessionId) ? this.teams.stopAll(sessionId) : this.stop(sessionId)
    })
    this.queue.onChange = () => hooks.changed()
    this.queue.onError = () => hooks.changed()
    this.checkpoints.onState = (sessionId, state, checkpointId) => {
      const failed = ['idle', 'failed', 'stopped'].includes(state) && this.failures.delete(sessionId)
      hooks.event({ v: 1, event: 'desktop.state', sessionId, seq: -Date.now(), payload: { state: failed ? 'failed' : state, checkpointId } })
      void this.observeTeam({ v:1,event:'desktop.state',sessionId,seq:-Date.now(),payload:{state:failed?'failed':state} }).catch(()=>hooks.changed())
      if (['idle', 'failed', 'stopped'].includes(state)) {
        if(state==='idle'&&this.teams.hasPending(sessionId))this.queue.needsReview(sessionId)
        else this.queue.settled(sessionId, failed ? 'failed' : state as 'idle' | 'failed' | 'stopped', failed ? 'An operation failed. Review the session before resuming the queue.' : undefined)
        hooks.notify(sessionId, failed ? 'failed' : state)
        if (checkpointId) void this.checkpoints.store.list().then((items) => {
          const checkpoint = items.find((item) => item.id === checkpointId)
          if (checkpoint) return this.index.addFiles(sessionId, this.sequences.get(sessionId) || 0, checkpoint.files.map((file) => file.path))
        }).catch(() => {})
      }
    }
    this.bridge.onEvent = (event) => {
      this.sequences.set(event.sessionId, Math.max(this.sequences.get(event.sessionId) || 0, event.seq))
      hooks.event(event)
      void this.observeTeam(event).catch(()=>hooks.changed())
      void this.index.ingest(event).catch(() => hooks.changed())
      const payload = event.payload as Record<string, unknown>
      if (event.event === 'session.needs_input') { this.queue.needsInput(event.sessionId, String(payload.question || 'Input required')); hooks.notify(event.sessionId, 'waiting_input') }
      if (event.event === 'permission.requested' || event.event === 'host.request') { this.queue.needsInput(event.sessionId, `${String(payload.tool || 'Operation')} needs approval`); hooks.notify(event.sessionId, 'waiting_input') }
      if (event.event === 'operation.update' && payload.Type !== 'verification' && (payload.Status || payload.status) === 'failed') this.failures.add(event.sessionId)
      if (event.event === 'model.request.completed' && payload.success === false) this.failures.add(event.sessionId)
      void this.checkpoints.event(event).catch((error) => hooks.event({ ...event, event: 'desktop.state', payload: { state: 'failed', message: String(error) } }))
      if (event.event === 'session.activity' && !payload.busy) void this.queue.kick().catch(() => hooks.changed())
    }
  }
  start(): Promise<void> {
    if(!this.starting)this.starting=this.startFresh().finally(()=>{this.starting=null})
    return this.starting
  }
  async ensureStarted(): Promise<void> {if(this.starting)await this.starting;else if(!this.bridge.status().ready)await this.start()}
  private async startFresh(): Promise<void> {
    await this.bridge.start(this.project, this.isolated)
    await this.tasks.recover()
    await this.checkpoints.store.recover()
    await this.bridge.request('context.configure', { excluded: this.context.get().excluded })
    await this.hooks.configure(this.bridge)
    this.repository.start()
    if(!this.isolated&&!this.teamTimer){let last=performance.now();this.teamTimer=setInterval(()=>{const now=performance.now(),elapsed=now-last;last=now;void this.teams.advanceTime(elapsed).catch(()=>this.hooks.changed())},1000);this.teamTimer.unref()}
    void this.syncIndex().catch(() => this.hooks.changed())
  }
  config(): BridgeSessionConfig {
    const settings = getSettings()
    return { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, thinkingLevel: settings.thinkingLevel, systemPrompt: settings.projectInstructions[this.project] || settings.systemPrompt, disallowedTools: [...settings.disallowedTools], mode: settings.executionMode, workspaceId: this.directory, workspace: !this.isolated && settings.taskIsolation ? 'isolated' : 'project' }
  }
  private async child(task: TaskWorkspace): Promise<WorkspaceRuntime> {
    let child = this.children.get(task.id)
    if (!child) {
      child = new WorkspaceRuntime(task.path, this.data, { ...this.hooks,
        event: event => { this.hooks.event(event); void this.observeTeam(event).catch(()=>this.hooks.changed()); void this.index.ingest(event).catch(() => {})
          if (event.event === 'session.needs_input') this.queue.needsInput(event.sessionId, 'Task needs your input')
          if (event.event === 'permission.requested' || event.event === 'host.request') this.queue.needsInput(event.sessionId, 'Task needs operation approval')
          if (event.event === 'desktop.state') {
            const state = (event.payload as { state: string }).state
            if (['idle', 'failed', 'stopped'].includes(state)) void (async () => {
              const usageRecords = await child!.usage.summaries()
              const preview = state === 'idle' ? await this.tasks.preview(task.id) : undefined
              const needsReview = !!preview && (preview.changes.length > 0 || Object.keys(preview.omitted).length > 0)
              await this.tasks.update(task.id, { state: state === 'idle' ? needsReview ? 'review' : 'integrated' : 'interrupted', usageRecords })
              if (needsReview || this.teams.hasPending(event.sessionId)) this.queue.needsReview(event.sessionId); else this.queue.settled(event.sessionId, state as 'idle' | 'failed' | 'stopped')
              this.hooks.changed()
            })().catch(() => this.hooks.changed())
          }
        }
      }, true)
      this.children.set(task.id, child)
    }
    await child.ensureStarted()
    return child
  }
  async owner(sessionId: string): Promise<WorkspaceRuntime> {
    const worker=this.teams.worker(sessionId)
    if(worker)return this.specialistOwner(worker)
    if (this.isolated) return this
    const task = (await this.tasks.list()).find(item => item.sessionId === sessionId || item.linkedSessions?.includes(sessionId))
    return task ? this.child(task) : this
  }
  async select(sessionId: string): Promise<WorkspaceRuntime> { this.active = await this.owner(sessionId); return this.active }
  async sessions(): Promise<SessionInfo[]> {
    const [sessions, tasks] = await Promise.all([this.bridge.request<SessionInfo[]>('session.list', {}), this.tasks.list()])
    return [...sessions, ...tasks.filter(item => item.sessionId).flatMap(item => [item.sessionId!, ...(item.linkedSessions || [])].map(id => ({ id, title: `${id === item.sessionId ? 'Isolated' : 'Continuation'} · ${item.title}`, lastUpdatedAt: item.createdAt, active: item.state === 'running', state: item.state === 'running' ? 'running' : 'stopped' }))), ...this.teams.list().flatMap(task=>task.workers.filter(worker=>worker.sessionId).map(worker=>({id:worker.sessionId!,title:`${worker.role} · ${worker.assignment.slice(0,90)}`,lastUpdatedAt:worker.createdAt,active:['running','waiting_input'].includes(worker.state),state:worker.state,parentSessionId:task.parentSessionId})))]
  }
  async fork(sessionId: string): Promise<{ sessionId: string }> {
    if(this.teams.worker(sessionId))throw new Error('Fork the parent task; specialists keep their original restrictions')
    const owner = await this.owner(sessionId), result = await owner.bridge.request<{ sessionId: string }>('session.fork', { sessionId, credential: await owner.credential(sessionId) })
    if (owner !== this) { const task = (await this.tasks.list()).find(item => item.path === owner.project)!; await this.tasks.link(task.id, result.sessionId) }
    this.active = owner; return result
  }
  async summaries() {
    const all = await this.usage.summaries()
    for (const task of await this.tasks.list()) { const child = this.children.get(task.id); if (child?.bridge.status().ready) all.push(...await child.usage.summaries()); else all.push(...task.usageRecords || (task.usage ? [task.usage] : [])) }
    for(const child of this.specialistOwners.values())if(child.bridge.status().ready)all.push(...await child.usage.summaries())
    // Inactive specialist totals remain available after restart without launching it.
    for(const task of this.teams.list())for(const worker of task.workers)if(worker.sessionId&&!all.some(item=>item.sessionId===worker.sessionId)&&task.usage[worker.sessionId]){const parent=all.find(item=>item.sessionId===task.parentSessionId);if(parent)all.push({sessionId:worker.sessionId,title:`${worker.role} · ${worker.assignment}`,provider:parent.provider,model:parent.model,totals:task.usage[worker.sessionId]})}
    return all
  }
  async stopAll(): Promise<void> { this.workflows.stopAll();clearInterval(this.teamTimer);this.teamTimer=undefined;this.repository.close();await Promise.all([this.bridge.stop(), ...[...this.children.values(),...this.specialistOwners.values()].map(child => child.stopAll())]) }
  async configureAll(): Promise<void> { await this.hooks.configure(this.bridge); await Promise.all([...this.children.values(),...this.specialistOwners.values()].filter(child => child.bridge.status().ready).map(child => child.configureAll())) }
  async visitBridges(work: (bridge: DockerBridge) => Promise<void>): Promise<void> { if (this.bridge.status().ready) await work(this.bridge); await Promise.all([...this.children.values(),...this.specialistOwners.values()].map(child => child.visitBridges(work))) }
  private async workerStore(parentSessionId:string):Promise<TaskWorkspaces>{
    let store=this.workerStores.get(parentSessionId)
    if(!store){if(!/^[a-f0-9-]{36}$/.test(parentSessionId))throw new Error('Invalid parent session');const parent=await this.owner(parentSessionId);const projectId=createHash('sha256').update(this.project.toLowerCase()).digest('hex').slice(0,12);store=new TaskWorkspaces(parent.project,join(this.data,'specialists',projectId,parentSessionId),parent.checkpoints.store);this.workerStores.set(parentSessionId,store)}
    return store
  }
  private async specialistOwner(worker:SpecialistWorker):Promise<WorkspaceRuntime>{
    let child=this.specialistOwners.get(worker.id)
    if(!child){
      const workspace=(await(await this.workerStore(worker.parentSessionId)).list()).find(item=>item.id===worker.workspaceId)
      if(!workspace||workspace.path!==worker.path)throw new Error('Specialist workspace does not match its recorded task')
      child=new WorkspaceRuntime(workspace.path,this.data,{...this.hooks,event:event=>{this.hooks.event(event);void this.observeTeam(event).catch(()=>this.hooks.changed());void this.index.ingest(event).catch(()=>{})}},true)
      child.bridge.onStatus=status=>{const current=this.teams.list().flatMap(task=>task.workers).find(item=>item.id===worker.id);if(!status.ready&&!child!.starting&&current?.sessionId&&['running','waiting_input'].includes(current.state))void this.teams.settled(current.sessionId,'failed','Specialist backend disconnected. Retained work needs inspection before resuming.').catch(()=>this.hooks.changed())}
      this.specialistOwners.set(worker.id,child)
    }
    await child.ensureStarted()
    return child
  }
  private async prepareSpecialist(parentSessionId:string,worker:SpecialistWorker,signal:AbortSignal,record:(value:Pick<SpecialistWorker,'sessionId'|'workspaceId'|'path'|'snapshot'|'omitted'>)=>Promise<void>):Promise<Pick<SpecialistWorker,'sessionId'|'workspaceId'|'path'|'snapshot'|'omitted'>>{
    const parent=await this.owner(parentSessionId),config=await parent.bridge.request<BridgeSessionConfig>('session.config',{sessionId:parentSessionId})
    if(config.specialist||!config.teamEnabled)throw new Error('Delegation is not enabled for this parent')
    if(config.mode==='plan'&&worker.role==='implementer')throw new Error('A Plan task can only dispatch read-only explorers and reviewers')
    const source=await parent.checkpoints.delegationSource(parentSessionId),store=await this.workerStore(parentSessionId)
    signal.throwIfAborted()
    const snapshot=await store.prepare({store:parent.checkpoints.store,snapshot:source.snapshot,label:`${source.id}:${source.phase}`})
    await record({workspaceId:snapshot.id,path:snapshot.path,snapshot:`${source.id}:${source.phase}`,omitted:snapshot.omitted})
    signal.throwIfAborted()
    const workspace=await store.materialize(snapshot.id)
    const prepared={workspaceId:workspace.id,path:workspace.path,snapshot:`${source.id}:${source.phase}`,omitted:workspace.omitted}
    const child=await this.specialistOwner({...worker,...prepared})
    child.context.update('draft',parent.context.get(parentSessionId));await child.bridge.request('context.configure',{excluded:parent.context.get(parentSessionId).excluded})
    signal.throwIfAborted()
    const sessionId=await child.create({...config,parentSessionId,workspace:'project',workspaceId:workspace.id,mode:worker.role==='implementer'?config.mode:'plan',teamEnabled:false,teamManaged:true,specialist:true},true)
    await record({...prepared,sessionId})
    await store.update(workspace.id,{sessionId,title:`${worker.role} · ${worker.assignment.slice(0,100)}`,state:'running'})
    return {...prepared,sessionId}
  }
  async configureTeam(sessionId:string,options:TeamOptions):Promise<void>{
    const valid=validateTeamOptions(options)
    if(valid.allowSpecialists&&!await this.tasks.available())throw new Error('Specialists require a Git repository opened at its root with an initial commit. Disable specialists to continue in this folder.')
    if(this.teams.worker(sessionId))throw new Error('Specialist permissions are inherited; nested delegation is disabled')
    const owner=await this.owner(sessionId)
    await owner.checkpoints.exclusive(async()=>{
      if(owner.checkpoints.busy||!await owner.bridge.request<boolean>('project.idle',{}))throw new Error('Finish or stop task operations before changing its team settings')
      const config=await owner.bridge.request<BridgeSessionConfig>('session.config',{sessionId})
      if(config.specialist)throw new Error('Specialist permissions are inherited')
      if(this.teams.view(sessionId))await this.teams.parentState(sessionId,'idle')
      await this.teams.configure(sessionId,valid)
      await owner.bridge.request('session.team',{sessionId,enabled:valid.allowSpecialists,managed:valid.allowSpecialists||valid.modelRequestLimit>0||valid.elapsedMinutes>0||valid.tokenLimit>0})
    })
  }
  async refreshTeamUsage(sessionId:string):Promise<void>{
    if(!this.teams.parent(sessionId))return
    const owner=await this.owner(sessionId),usage=(await owner.usage.summaries()).find(item=>item.sessionId===sessionId)
    if(usage)await this.teams.usage(sessionId,usage.totals)
  }
  async teamPermit(sessionId:string,requestId:string):Promise<void>{
    if(!this.teams.parent(sessionId))throw new Error('Task budget metadata is unavailable; restore it before resuming')
    await this.refreshTeamUsage(sessionId);await this.teams.permit(sessionId,requestId)
  }
  private async observeTeam(event:AgentEvent):Promise<void>{
    const parent=this.teams.parent(event.sessionId);if(!parent)return
    const payload=event.payload as {busy?:boolean;state?:string;status?:string;Kind?:string}
    if(event.event==='session.activity'&&payload.busy)await this.teams.parentState(event.sessionId,'running')
    if(['session.needs_input','permission.requested','host.request'].includes(event.event))await this.teams.parentState(event.sessionId,'waiting_input')
    if(event.event==='decision.result'||(event.event==='session.item'&&payload.Kind==='model_response'))await this.refreshTeamUsage(event.sessionId)
    if(event.event!=='desktop.state'||!['idle','failed','stopped'].includes(payload.state||''))return
    const worker=this.teams.worker(event.sessionId)
    if(!worker){await this.teams.parentState(event.sessionId,payload.state==='idle'?'idle':payload.state==='failed'?'failed':'stopped');return}
    const owner=await this.owner(event.sessionId),store=await this.workerStore(parent)
    const preview=await store.preview(worker.workspaceId!)
    const events=await owner.events(event.sessionId)
    const findings=events.flatMap(item=>{const value=item.payload as {Kind?:string;Data?:{Response?:{Output?:Array<{Type?:string;Data?:{Text?:string}}>}}};return item.event==='session.item'&&value.Kind==='model_response'?(value.Data?.Response?.Output||[]).filter(output=>output.Type==='message').map(output=>output.Data?.Text||''):[]}).slice(-2).join('\n')
    const state=payload.state==='failed'?'failed':payload.state==='stopped'?'cancelled':preview.changes.length||Object.keys(preview.omitted).length?'review':'completed'
    await store.update(worker.workspaceId!,{state:state==='review'?'review':state==='completed'?'integrated':'interrupted'})
    await this.refreshTeamUsage(event.sessionId);await this.teams.settled(event.sessionId,state,findings)
    if(this.teams.hasPending(parent))this.queue.needsReview(parent)
    else await this.releaseTeamQueue(parent)
  }
  private async releaseTeamQueue(parent:string):Promise<void>{
    if(this.teams.hasPending(parent))return
    const task=(await this.tasks.list()).find(item=>item.sessionId===parent)
    if(task){const preview=await this.tasks.preview(task.id);if(preview.changes.length||Object.keys(preview.omitted).length)return}
    if(this.teams.view(parent)?.parentState==='idle')this.queue.reviewed(parent,'Specialist review settled. Resume the queue when ready.')
    await this.queue.kick()
  }
  async specialistPreview(parent:string,id:string):Promise<import('../shared/task-workspaces').WorkspacePreview>{
    const worker=this.teams.view(parent)?.workers.find(item=>item.id===id)
    if(!worker?.workspaceId)throw new Error('Specialist workspace is not ready')
    return(await this.workerStore(parent)).preview(worker.workspaceId)
  }
  async specialistIntegrate(parent:string,id:string,paths:string[]):Promise<string>{
    const worker=this.teams.view(parent)?.workers.find(item=>item.id===id)
    if(!worker?.sessionId||!worker.workspaceId)throw new Error('Specialist workspace is not ready')
    const parentOwner=await this.owner(parent),child=await this.owner(worker.sessionId)
    return parentOwner.checkpoints.exclusive(async()=>{
      if(this.hooks.hasTerminal()||parentOwner.checkpoints.busy||child.checkpoints.busy||!await parentOwner.bridge.request('project.idle',{})||!await child.bridge.request('project.idle',{}))throw new Error('Finish or stop parent and specialist operations and close terminals before integration')
      const store=await this.workerStore(parent),recovery=await store.integrate(worker.workspaceId!,paths),remaining=await store.preview(worker.workspaceId!)
      if(!remaining.changes.length&&!Object.keys(remaining.omitted).length)await this.teams.reviewed(parent,id,'integrated')
      await this.releaseTeamQueue(parent);return recovery
    })
  }
  async specialistRetain(parent:string,id:string):Promise<void>{await this.teams.reviewed(parent,id,'retained');await this.releaseTeamQueue(parent)}
  async workflowReady(sessionId:string):Promise<WorkspaceRuntime>{
    if(this.teams.worker(sessionId)||this.teams.hasPending(sessionId))throw new Error('Resolve specialists and run saved workflows from the parent task')
    const owner=await this.owner(sessionId)
    if(this.hooks.hasTerminal()||owner.checkpoints.busy||!await owner.bridge.request<boolean>('project.idle',{}))throw new Error('Finish or stop project operations and close terminals before verification')
    const config=await owner.bridge.request<BridgeSessionConfig>('session.config',{sessionId})
    if(config.mode==='plan'||config.disallowedTools.includes('Bash'))throw new Error('This session does not grant verification command execution')
    return owner
  }
  private async verifyProfile(sessionId:string,profile:VerificationProfile,id:string,signal:AbortSignal):Promise<VerificationResult>{
    const owner=await this.workflowReady(sessionId);signal.throwIfAborted()
    const checkpoint=await owner.checkpoints.beginExternal(sessionId,`Verification · ${profile.name}`)
    let cancellationTimer:NodeJS.Timeout|undefined
    const cancel=()=>{void owner.bridge.request('verification.cancel',{sessionId,id}).catch(()=>{});cancellationTimer??=setInterval(()=>{void owner.bridge.request('verification.cancel',{sessionId,id}).catch(()=>{})},250);cancellationTimer.unref()}
    signal.addEventListener('abort',cancel,{once:true})
    let incomplete:string|undefined
    try{signal.throwIfAborted();const result=await owner.bridge.request<VerificationResult>('verification.run',{sessionId,id,command:profile.command,timeoutMs:profile.timeoutSeconds*1000},profile.timeoutSeconds*1000+30000);if(result.cancelled)incomplete='Verification was cancelled or timed out';return result}
    catch(error){incomplete='Verification was interrupted; inspect retained output and project state';throw error}
    finally{clearInterval(cancellationTimer);signal.removeEventListener('abort',cancel);await owner.checkpoints.finishExternal(checkpoint,incomplete);this.hooks.changed()}
  }
  private async repairFromVerification(sessionId:string,prompt:string,messageId:string,signal:AbortSignal):Promise<void>{
    const owner=await this.workflowReady(sessionId);signal.throwIfAborted()
    const after=(await owner.events(sessionId)).at(-1)?.seq||0
    const cancel=()=>{void owner.stop(sessionId).catch(()=>{})};signal.addEventListener('abort',cancel,{once:true})
    try{
      await this.send(sessionId,prompt,messageId)
      const deadline=Date.now()+10*60000
      while(owner.checkpoints.busy||!await owner.bridge.request<boolean>('project.idle',{})){
        signal.throwIfAborted();if(Date.now()>deadline){await owner.stop(sessionId);throw new Error('Repair attempt exceeded ten minutes. Review the session before starting another workflow.')}
        await new Promise(resolve=>setTimeout(resolve,200))
      }
      signal.throwIfAborted()
      const events=await owner.bridge.request<AgentEvent[]>('session.events',{sessionId,after,limit:1000})
      if(events.some(event=>event.event==='session.status'&&['error','stopped'].includes(String((event.payload as {status:string}).status))))throw new Error('Repair session stopped or failed; inspect it before another verification run')
      if(this.teams.hasPending(sessionId))throw new Error('Specialists need review or integration before verification can continue')
    }finally{signal.removeEventListener('abort',cancel)}
  }
  async create(config = this.config(), consumeDraft = true): Promise<string> {
    if (!this.isolated && config.workspace === 'isolated' && await this.tasks.available()) {
      return this.checkpoints.exclusive(async () => {
      if (this.checkpoints.busy || this.hooks.hasTerminal() || !await this.bridge.request('project.idle', {})) throw new Error('Finish source-project operations and close terminals before capturing a task snapshot')
      const snapshot = await this.tasks.prepare()
      const choice = await this.hooks.reviewWorkspace?.(snapshot) || 'cancel'
      if (choice === 'cancel') throw new Error('Task workspace cancelled')
      if (choice === 'isolated') {
        const task = await this.tasks.materialize(snapshot.id), child = await this.child(task)
        child.context.update('draft', this.context.get())
        await child.bridge.request('context.configure', { excluded: this.context.get().excluded })
        const id = await child.create({ ...config, workspace: 'project', workspaceId: task.id }, consumeDraft)
        await this.tasks.update(task.id, { sessionId: id }); if (consumeDraft) this.active = child; return id
      }
      return this.createLocal(config, consumeDraft)
      })
    }
    return this.createLocal(config, consumeDraft)
  }
  private async createLocal(config: BridgeSessionConfig, consumeDraft: boolean): Promise<string> {
    if (Buffer.byteLength(config.systemPrompt) > 256 * 1024) throw new Error('Project instructions exceed 256 KB')
    const credential = credentialFor(config.provider, config.baseUrl)
    const result = await this.bridge.request<{ sessionId: string }>('session.create', { config, credential })
    if (consumeDraft) this.context.inheritDraft(result.sessionId)
    if (consumeDraft) this.active = this
    return result.sessionId
  }
  async credential(sessionId: string): Promise<Record<string, string>> {
    const config = await this.bridge.request<BridgeSessionConfig>('session.config', { sessionId })
    return credentialFor(config.provider, config.baseUrl)
  }
  async open(sessionId: string): Promise<void> { const worker=this.teams.worker(sessionId);if(worker){await this.teams.resumeWorker(worker.parentSessionId,worker.id);await this.select(sessionId);return}if(this.teams.view(sessionId)?.paused)throw new Error('Resume the task team controls before resuming its session');const owner = await this.select(sessionId); await owner.checkpoints.exclusive(async () => { await owner.bridge.request('session.open', { sessionId, credential: await owner.credential(sessionId) }) }) }
  async send(sessionId: string, prompt: string, messageId: string, terminalOpen = false): Promise<void> {
    if(this.teams.worker(sessionId)){const worker=this.teams.worker(sessionId)!;await this.teams.steer(worker.parentSessionId,worker.id,prompt,messageId);return}
    const team=this.teams.view(sessionId)
    if(team?.paused)throw new Error('This task is paused. Review its limits and choose Resume in the task team controls.')
    const owner = await this.owner(sessionId)
    if (owner !== this) { const task = (await this.tasks.list()).find(item => item.path === owner.project)!; await this.tasks.update(task.id, { state: 'running', title: task.title === 'New isolated task' ? prompt.slice(0,100) : task.title }); return owner.send(sessionId, prompt, messageId, terminalOpen) }
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 768 * 1024) throw new Error('Message must contain text below 768 KB')
    this.pending++
    try {
      if(getSettings().autoCompaction&&!this.checkpoints.busy&&this.pending===1) {
        const usage=(await this.usage.summaries()).find(item=>item.sessionId===sessionId)
        if(usage?.contextLimit&&usage.totals.latestInput>=usage.contextLimit*0.8&&await this.bridge.request<boolean>('project.idle',{})&&this.pending===1&&!this.checkpoints.busy)await this.compactContext(sessionId)
      }
      const [credential, context] = await Promise.all([this.credential(sessionId), this.context.prepare(sessionId)])
      const missing = context.files.find((file) => !file.included && file.reason !== 'Excluded from automatic context')
      if (missing) throw new Error(`Review context file ${missing.path}: ${missing.reason}`)
      const augmented = context.text ? `${prompt}\n\n${context.text}` : prompt
      await this.checkpoints.send(sessionId, messageId, prompt, () => this.bridge.request('session.send', { sessionId, prompt: augmented, messageId, credential }), terminalOpen || this.hooks.hasTerminal())
    } finally { this.pending--; void this.queue.kick().catch(() => this.hooks.changed()) }
  }
  async stop(sessionId: string): Promise<void> {
    this.workflows.cancelSession(sessionId)
    const owner = await this.owner(sessionId); if (owner !== this) return owner.stop(sessionId)
    this.hooks.event({ v: 1, event: 'desktop.state', sessionId, seq: -Date.now(), payload: { state: 'cancelling' } })
    await this.bridge.request('session.stop', { sessionId })
  }
  async events(sessionId: string): Promise<AgentEvent[]> {
    const owner = await this.owner(sessionId); if (owner !== this) return owner.events(sessionId)
    const result: AgentEvent[] = []; let after = 0
    for (;;) {
      const page = await this.bridge.request<AgentEvent[]>('session.events', { sessionId, after, limit: 1000 })
      if (!page.length) break
      result.push(...page); after = page.at(-1)!.seq
      if (page.length < 1000) break
    }
    return result
  }
  syncIndex(): Promise<void> {
    if (!this.indexSync) this.indexSync = (async () => {
      const sessions = await this.bridge.request<SessionInfo[]>('session.list', {})
      for (const session of sessions) {
        let after = await this.index.cursor(session.id)
        for (;;) {
          const page = await this.bridge.request<AgentEvent[]>('session.events', { sessionId: session.id, after, limit: 1000 })
          if (!page.length) break
          for (const event of page) await this.index.ingest(event)
          after = page.at(-1)!.seq
          if (page.length < 1000) break
        }
      }
    })().finally(() => { this.indexSync = null })
    return this.indexSync
  }
  async contextView(sessionId = 'draft'): Promise<ContextView> {
    if (sessionId !== 'draft') { const owner = await this.owner(sessionId); if (owner !== this) return owner.contextView(sessionId) }
    const prepared = await this.context.prepare(sessionId)
    const usage = sessionId === 'draft' ? undefined : (await this.usage.summaries()).find((item) => item.sessionId === sessionId)
    return { ...prepared, instructions: this.config().systemPrompt, latestInput: usage?.totals.latestInput, contextLimit: usage?.contextLimit }
  }
  async contextSummaries(sessionId:string):Promise<import('../shared/repository-context').ContextSummary[]> {
    const owner=await this.owner(sessionId);if(owner!==this)return owner.contextSummaries(sessionId)
    const summaries=await this.bridge.request<import('../shared/repository-context').ContextSummary[]>('context.summaries',{sessionId})
    const directory=join(this.directory,'context-summaries');await fs.mkdir(directory,{recursive:true});const target=join(directory,`${sessionId}.json`),temporary=`${target}.${randomUUID()}.tmp`;await fs.writeFile(temporary,JSON.stringify(summaries),{mode:0o600});await fs.rename(temporary,target)
    return summaries
  }
  async compactContext(sessionId:string):Promise<import('../shared/repository-context').ContextSummary> {
    const owner=await this.owner(sessionId);if(owner!==this)return owner.compactContext(sessionId)
    return this.checkpoints.exclusive(async()=>{
      if(this.checkpoints.busy||!await this.bridge.request<boolean>('project.idle',{}))throw new Error('Finish or stop active work before compacting context')
      const summary=await this.bridge.request<import('../shared/repository-context').ContextSummary>('context.compact',{sessionId,credential:await this.credential(sessionId)},150000)
      await this.contextSummaries(sessionId);this.hooks.changed();return summary
    })
  }
  async selectSummary(sessionId:string,id:string):Promise<void>{
    const owner=await this.owner(sessionId);if(owner!==this)return owner.selectSummary(sessionId,id)
    await this.checkpoints.exclusive(async()=>{if(this.checkpoints.busy||!await this.bridge.request<boolean>('project.idle',{}))throw new Error('Finish or stop active work before changing context');await this.bridge.request('context.summary.select',{sessionId,id});await this.contextSummaries(sessionId);this.hooks.changed()})
  }
  async updateContext(sessionId: string, patch: Partial<ContextSelection>): Promise<ContextSelection> {
    if (sessionId !== 'draft') { const owner = await this.owner(sessionId); if (owner !== this) return owner.updateContext(sessionId, patch) }
    const result = this.context.update(sessionId, patch)
    await this.bridge.request('context.configure', { excluded: result.excluded })
    return result
  }
  async previewHandoff(sessionId: string): Promise<HandoffPreview> {
    if(this.teams.worker(sessionId)||this.teams.hasPending(sessionId))throw new Error('Resolve specialists and use the parent task for handoff')
    const owner = await this.owner(sessionId); if (owner !== this) return owner.previewHandoff(sessionId)
    if (this.pending || this.checkpoints.busy || !await this.bridge.request<boolean>('project.idle', {})) throw new Error('Finish or stop active project operations before preparing a handoff')
    const [events, changes, config] = await Promise.all([this.events(sessionId), gitChanges(this.project), this.bridge.request<BridgeSessionConfig>('session.config', { sessionId })])
    return { parentSessionId: sessionId, config, summary: handoffSummary(events, changes) }
  }
  async handoff(sessionId: string, summary: string, destination: Pick<BridgeSessionConfig, 'provider' | 'model' | 'baseUrl' | 'thinkingLevel'>): Promise<string> {
    if(this.teams.worker(sessionId))throw new Error('Use the parent task for provider handoff')
    const owner = await this.owner(sessionId)
    if (owner !== this) { const id = await owner.handoff(sessionId, summary, destination); const task = (await this.tasks.list()).find(item => item.path === owner.project)!; await this.tasks.link(task.id, id); this.active = owner; return id }
    if (typeof summary !== 'string' || !summary.trim() || Buffer.byteLength(summary) > 64 * 1024) throw new Error('Handoff summary must contain text below 64 KB')
    const preview = await this.previewHandoff(sessionId)
    const config = { ...preview.config, parentSessionId: sessionId, teamEnabled:false,teamManaged:false,specialist:false, provider: destination.provider, model: destination.model, baseUrl: destination.baseUrl, thinkingLevel: destination.thinkingLevel }
    const id = await this.create(config, false)
    this.context.update(id, { attached: this.context.get(sessionId).attached, summary })
    await fs.mkdir(join(this.directory, 'handoffs'), { recursive: true })
    await fs.writeFile(join(this.directory, 'handoffs', `${id}.json`), JSON.stringify({ parentSessionId: sessionId, sessionId: id, summary, createdAt: new Date().toISOString() }), { mode: 0o600 })
    await this.send(id, 'Continue the task from the reviewed handoff summary. Inspect the current project state before acting.', randomUUID())
    return id
  }
}
