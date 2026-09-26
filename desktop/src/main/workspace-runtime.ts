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

export const projectData = (data: string, project: string): string => join(data, 'workspaces', createHash('sha256').update(project.toLowerCase()).digest('hex'))
type Hooks = { event(event: AgentEvent): void; changed(): void; notify(sessionId: string, state: string): void; configure(bridge: DockerBridge): Promise<unknown>; hasTerminal(): boolean; reviewWorkspace?(workspace: TaskWorkspace): Promise<'isolated' | 'project' | 'cancel'> }

export class WorkspaceRuntime {
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
    this.checkpoints = new CheckpointService(project, data)
    this.tasks = new TaskWorkspaces(project, join(this.directory, 'tasks'), this.checkpoints.store)
    this.context = new ProjectContext(project, join(this.directory, 'context.json'))
    this.index = new ConversationIndex(project, join(this.directory, 'search'))
    this.repository = new RepositoryIndex(project,join(this.directory,'repository-index.json'),()=>this.context.get().excluded)
    this.queue = new TaskQueue(join(this.directory, 'queue.json'), {
      canStart: async () => !this.pending && ![...this.children.values()].some(child => child.pending || child.checkpoints.busy) && !hooks.hasTerminal() && !this.checkpoints.busy && await this.bridge.request<boolean>('project.idle', {}),
      create: (task) => this.create(task.config, false),
      send: (task) => this.send(task.sessionId!, task.prompt, task.id),
      stop: (sessionId) => this.stop(sessionId)
    })
    this.queue.onChange = () => hooks.changed()
    this.queue.onError = () => hooks.changed()
    this.checkpoints.onState = (sessionId, state, checkpointId) => {
      const failed = ['idle', 'failed', 'stopped'].includes(state) && this.failures.delete(sessionId)
      hooks.event({ v: 1, event: 'desktop.state', sessionId, seq: -Date.now(), payload: { state: failed ? 'failed' : state, checkpointId } })
      if (['idle', 'failed', 'stopped'].includes(state)) {
        this.queue.settled(sessionId, failed ? 'failed' : state as 'idle' | 'failed' | 'stopped', failed ? 'An operation failed. Review the session before resuming the queue.' : undefined)
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
      void this.index.ingest(event).catch(() => hooks.changed())
      const payload = event.payload as Record<string, unknown>
      if (event.event === 'session.needs_input') { this.queue.needsInput(event.sessionId, String(payload.question || 'Input required')); hooks.notify(event.sessionId, 'waiting_input') }
      if (event.event === 'permission.requested' || event.event === 'host.request') { this.queue.needsInput(event.sessionId, `${String(payload.tool || 'Operation')} needs approval`); hooks.notify(event.sessionId, 'waiting_input') }
      if (event.event === 'operation.update' && (payload.Status || payload.status) === 'failed') this.failures.add(event.sessionId)
      if (event.event === 'model.request.completed' && payload.success === false) this.failures.add(event.sessionId)
      void this.checkpoints.event(event).catch((error) => hooks.event({ ...event, event: 'desktop.state', payload: { state: 'failed', message: String(error) } }))
      if (event.event === 'session.activity' && !payload.busy) void this.queue.kick().catch(() => hooks.changed())
    }
  }
  async start(): Promise<void> {
    await this.bridge.start(this.project, this.isolated)
    await this.tasks.recover()
    await this.checkpoints.store.recover()
    await this.bridge.request('context.configure', { excluded: this.context.get().excluded })
    await this.hooks.configure(this.bridge)
    this.repository.start()
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
        event: event => { this.hooks.event(event); void this.index.ingest(event).catch(() => {})
          if (event.event === 'session.needs_input') this.queue.needsInput(event.sessionId, 'Task needs your input')
          if (event.event === 'permission.requested' || event.event === 'host.request') this.queue.needsInput(event.sessionId, 'Task needs operation approval')
          if (event.event === 'desktop.state') {
            const state = (event.payload as { state: string }).state
            if (['idle', 'failed', 'stopped'].includes(state)) void (async () => {
              const usageRecords = await child!.usage.summaries()
              const preview = state === 'idle' ? await this.tasks.preview(task.id) : undefined
              const needsReview = !!preview && (preview.changes.length > 0 || Object.keys(preview.omitted).length > 0)
              await this.tasks.update(task.id, { state: state === 'idle' ? needsReview ? 'review' : 'integrated' : 'interrupted', usageRecords })
              if (needsReview) this.queue.needsReview(event.sessionId); else this.queue.settled(event.sessionId, state as 'idle' | 'failed' | 'stopped')
              this.hooks.changed()
            })().catch(() => this.hooks.changed())
          }
        }
      }, true)
      this.children.set(task.id, child)
    }
    if (!child.bridge.status().ready) await child.start()
    return child
  }
  async owner(sessionId: string): Promise<WorkspaceRuntime> {
    if (this.isolated) return this
    const task = (await this.tasks.list()).find(item => item.sessionId === sessionId || item.linkedSessions?.includes(sessionId))
    return task ? this.child(task) : this
  }
  async select(sessionId: string): Promise<WorkspaceRuntime> { this.active = await this.owner(sessionId); return this.active }
  async sessions(): Promise<SessionInfo[]> {
    const [sessions, tasks] = await Promise.all([this.bridge.request<SessionInfo[]>('session.list', {}), this.tasks.list()])
    return [...sessions, ...tasks.filter(item => item.sessionId).flatMap(item => [item.sessionId!, ...(item.linkedSessions || [])].map(id => ({ id, title: `${id === item.sessionId ? 'Isolated' : 'Continuation'} · ${item.title}`, lastUpdatedAt: item.createdAt, active: item.state === 'running', state: item.state === 'running' ? 'running' : 'stopped' })))]
  }
  async fork(sessionId: string): Promise<{ sessionId: string }> {
    const owner = await this.owner(sessionId), result = await owner.bridge.request<{ sessionId: string }>('session.fork', { sessionId, credential: await owner.credential(sessionId) })
    if (owner !== this) { const task = (await this.tasks.list()).find(item => item.path === owner.project)!; await this.tasks.link(task.id, result.sessionId) }
    this.active = owner; return result
  }
  async summaries() {
    const all = await this.usage.summaries()
    for (const task of await this.tasks.list()) { const child = this.children.get(task.id); if (child?.bridge.status().ready) all.push(...await child.usage.summaries()); else all.push(...task.usageRecords || (task.usage ? [task.usage] : [])) }
    return all
  }
  async stopAll(): Promise<void> { this.repository.close();await Promise.all([this.bridge.stop(), ...[...this.children.values()].map(child => child.stopAll())]) }
  async configureAll(): Promise<void> { await this.hooks.configure(this.bridge); await Promise.all([...this.children.values()].filter(child => child.bridge.status().ready).map(child => child.configureAll())) }
  async visitBridges(work: (bridge: DockerBridge) => Promise<void>): Promise<void> { if (this.bridge.status().ready) await work(this.bridge); await Promise.all([...this.children.values()].map(child => child.visitBridges(work))) }
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
  async open(sessionId: string): Promise<void> { const owner = await this.select(sessionId); await owner.checkpoints.exclusive(async () => { await owner.bridge.request('session.open', { sessionId, credential: await owner.credential(sessionId) }) }) }
  async send(sessionId: string, prompt: string, messageId: string, terminalOpen = false): Promise<void> {
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
    const owner = await this.owner(sessionId); if (owner !== this) return owner.previewHandoff(sessionId)
    if (this.pending || this.checkpoints.busy || !await this.bridge.request<boolean>('project.idle', {})) throw new Error('Finish or stop active project operations before preparing a handoff')
    const [events, changes, config] = await Promise.all([this.events(sessionId), gitChanges(this.project), this.bridge.request<BridgeSessionConfig>('session.config', { sessionId })])
    return { parentSessionId: sessionId, config, summary: handoffSummary(events, changes) }
  }
  async handoff(sessionId: string, summary: string, destination: Pick<BridgeSessionConfig, 'provider' | 'model' | 'baseUrl' | 'thinkingLevel'>): Promise<string> {
    const owner = await this.owner(sessionId)
    if (owner !== this) { const id = await owner.handoff(sessionId, summary, destination); const task = (await this.tasks.list()).find(item => item.path === owner.project)!; await this.tasks.link(task.id, id); this.active = owner; return id }
    if (typeof summary !== 'string' || !summary.trim() || Buffer.byteLength(summary) > 64 * 1024) throw new Error('Handoff summary must contain text below 64 KB')
    const preview = await this.previewHandoff(sessionId)
    const config = { ...preview.config, parentSessionId: sessionId, provider: destination.provider, model: destination.model, baseUrl: destination.baseUrl, thinkingLevel: destination.thinkingLevel }
    const id = await this.create(config, false)
    this.context.update(id, { attached: this.context.get(sessionId).attached, summary })
    await fs.mkdir(join(this.directory, 'handoffs'), { recursive: true })
    await fs.writeFile(join(this.directory, 'handoffs', `${id}.json`), JSON.stringify({ parentSessionId: sessionId, sessionId: id, summary, createdAt: new Date().toISOString() }), { mode: 0o600 })
    await this.send(id, 'Continue the task from the reviewed handoff summary. Inspect the current project state before acting.', randomUUID())
    return id
  }
}
