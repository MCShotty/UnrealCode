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

export const projectData = (data: string, project: string): string => join(data, 'workspaces', createHash('sha256').update(project.toLowerCase()).digest('hex'))
type Hooks = { event(event: AgentEvent): void; changed(): void; notify(sessionId: string, state: string): void; configure(bridge: DockerBridge): Promise<unknown>; hasTerminal(): boolean }

export class WorkspaceRuntime {
  readonly bridge = new DockerBridge()
  readonly usage = new SessionUsageService(this.bridge)
  readonly checkpoints: CheckpointService
  readonly context: ProjectContext
  readonly queue: TaskQueue
  readonly index: ConversationIndex
  private directory: string
  private sequences = new Map<string, number>()
  private failures = new Set<string>()
  private pending = 0
  private indexSync: Promise<void> | null = null
  constructor(readonly project: string, data: string, private hooks: Hooks) {
    this.directory = projectData(data, project)
    this.checkpoints = new CheckpointService(project, data)
    this.context = new ProjectContext(project, join(this.directory, 'context.json'))
    this.index = new ConversationIndex(project, join(this.directory, 'search'))
    this.queue = new TaskQueue(join(this.directory, 'queue.json'), {
      canStart: async () => !this.pending && !hooks.hasTerminal() && !this.checkpoints.busy && await this.bridge.request<boolean>('project.idle', {}),
      create: (task) => this.create(task.config, false),
      send: (task) => this.send(task.sessionId!, task.prompt, task.id),
      stop: (sessionId) => this.stop(sessionId)
    })
    this.queue.onChange = () => hooks.changed()
    this.queue.onError = () => hooks.changed()
    this.checkpoints.onState = (sessionId, state, checkpointId) => {
      hooks.event({ v: 1, event: 'desktop.state', sessionId, seq: -Date.now(), payload: { state, checkpointId } })
      if (['idle', 'failed', 'stopped'].includes(state)) {
        const failed = this.failures.delete(sessionId)
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
      if (event.event === 'operation.update' && (payload.Status || payload.status) === 'failed') this.failures.add(event.sessionId)
      if (event.event === 'model.request.completed' && payload.success === false) this.failures.add(event.sessionId)
      void this.checkpoints.event(event).catch((error) => hooks.event({ ...event, event: 'desktop.state', payload: { state: 'failed', message: String(error) } }))
      if (event.event === 'session.activity' && !payload.busy) void this.queue.kick().catch(() => hooks.changed())
    }
  }
  async start(): Promise<void> {
    await this.bridge.start(this.project)
    await this.checkpoints.store.recover()
    await this.bridge.request('context.configure', { excluded: this.context.get().excluded })
    await this.hooks.configure(this.bridge)
    void this.syncIndex().catch(() => this.hooks.changed())
  }
  config(): BridgeSessionConfig {
    const settings = getSettings()
    return { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, thinkingLevel: settings.thinkingLevel, systemPrompt: settings.projectInstructions[this.project] || settings.systemPrompt, disallowedTools: [...settings.disallowedTools] }
  }
  async create(config = this.config(), consumeDraft = true): Promise<string> {
    if (Buffer.byteLength(config.systemPrompt) > 256 * 1024) throw new Error('Project instructions exceed 256 KB')
    const credential = credentialFor(config.provider, config.baseUrl)
    const result = await this.bridge.request<{ sessionId: string }>('session.create', { config, credential })
    if (consumeDraft) this.context.inheritDraft(result.sessionId)
    return result.sessionId
  }
  async credential(sessionId: string): Promise<Record<string, string>> {
    const config = await this.bridge.request<BridgeSessionConfig>('session.config', { sessionId })
    return credentialFor(config.provider, config.baseUrl)
  }
  async open(sessionId: string): Promise<void> { await this.checkpoints.exclusive(async () => { await this.bridge.request('session.open', { sessionId, credential: await this.credential(sessionId) }) }) }
  async send(sessionId: string, prompt: string, messageId: string, terminalOpen = false): Promise<void> {
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 768 * 1024) throw new Error('Message must contain text below 768 KB')
    this.pending++
    try {
      const [credential, context] = await Promise.all([this.credential(sessionId), this.context.prepare(sessionId)])
      const missing = context.files.find((file) => !file.included && file.reason !== 'Excluded from automatic context')
      if (missing) throw new Error(`Review context file ${missing.path}: ${missing.reason}`)
      const augmented = context.text ? `${prompt}\n\n${context.text}` : prompt
      await this.checkpoints.send(sessionId, messageId, prompt, () => this.bridge.request('session.send', { sessionId, prompt: augmented, messageId, credential }), terminalOpen || this.hooks.hasTerminal())
    } finally { this.pending--; void this.queue.kick().catch(() => this.hooks.changed()) }
  }
  async stop(sessionId: string): Promise<void> {
    this.hooks.event({ v: 1, event: 'desktop.state', sessionId, seq: -Date.now(), payload: { state: 'cancelling' } })
    await this.bridge.request('session.stop', { sessionId })
  }
  async events(sessionId: string): Promise<AgentEvent[]> {
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
    const prepared = await this.context.prepare(sessionId)
    const usage = sessionId === 'draft' ? undefined : (await this.usage.summaries()).find((item) => item.sessionId === sessionId)
    return { ...prepared, instructions: this.config().systemPrompt, latestInput: usage?.totals.latestInput, contextLimit: usage?.contextLimit }
  }
  async updateContext(sessionId: string, patch: Partial<ContextSelection>): Promise<ContextSelection> {
    const result = this.context.update(sessionId, patch)
    await this.bridge.request('context.configure', { excluded: result.excluded })
    return result
  }
  async previewHandoff(sessionId: string): Promise<HandoffPreview> {
    if (this.pending || this.checkpoints.busy || !await this.bridge.request<boolean>('project.idle', {})) throw new Error('Finish or stop active project operations before preparing a handoff')
    const [events, changes, config] = await Promise.all([this.events(sessionId), gitChanges(this.project), this.bridge.request<BridgeSessionConfig>('session.config', { sessionId })])
    return { parentSessionId: sessionId, config, summary: handoffSummary(events, changes) }
  }
  async handoff(sessionId: string, summary: string, destination: Pick<BridgeSessionConfig, 'provider' | 'model' | 'baseUrl' | 'thinkingLevel'>): Promise<string> {
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
