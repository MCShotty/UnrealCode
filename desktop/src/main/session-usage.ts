import type { AgentEvent, ExecutionSummary, OperationLane, Provider, SessionInfo, SessionUsage, UsageTotals } from '../shared/api'
import type { DockerBridge } from './docker'
import { emptyTotals } from './account-usage'
import { ContextLimitService } from './context-limits'

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function field(value: unknown, ...names: string[]): unknown { const row = record(value); for (const name of names) if (name in row) return row[name]; return undefined }
function number(value: unknown): number { const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : 0 }
function text(value: unknown): string { return typeof value === 'string' ? value : '' }

type Stored = { seq: number; totals: UsageTotals; events: AgentEvent[]; provider: Provider; model: string; rateLimits?: Record<string, string> }
export function consumeUsage(totals: UsageTotals, event: AgentEvent): void {
  if (event.event === 'decision.result') {
    const usage = field(event.payload, 'usage')
    totals.decisionCalls++
    totals.decisionInput += number(field(usage, 'input_tokens'))
    totals.decisionOutput += number(field(usage, 'output_tokens'))
    return
  }
  if (event.event !== 'session.item') return
  const item = event.payload
  const kind = field(item, 'Kind', 'kind')
  if (kind === 'fork') { Object.assign(totals, emptyTotals()); return }
  if (kind !== 'model_response') return
  const usage = field(field(field(item, 'Data', 'data'), 'Response', 'response'), 'Usage', 'usage')
  const input = number(field(usage, 'InputTokens', 'inputTokens'))
  totals.input += input
  totals.output += number(field(usage, 'OutputTokens', 'outputTokens'))
  totals.cached += number(field(usage, 'CachedInputTokens', 'cachedInputTokens'))
  totals.cacheWrite += number(field(usage, 'CacheWriteInputTokens', 'cacheWriteInputTokens'))
  totals.reasoning += number(field(usage, 'ReasoningTokens', 'reasoningTokens'))
  totals.latestInput = input
  totals.calls++
}

function milliseconds(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
function unionLength(intervals: Array<[number, number]>): number {
  const sorted = intervals.filter(([start, end]) => end >= start).sort((a, b) => a[0] - b[0])
  let total = 0, start = -1, end = -1
  for (const [left, right] of sorted) {
    if (start < 0) { start = left; end = right }
    else if (left > end) { total += end - start; start = left; end = right }
    else end = Math.max(end, right)
  }
  if (start >= 0) total += end - start
  return total
}

export function executionFromEvents(sessionId: string, events: AgentEvent[], now = Date.now()): ExecutionSummary {
  const operations = new Map<string, OperationLane>()
  const modelStarts = new Map<string, number>()
  const modelIntervals: Array<[number, number]> = []
  const dispatches = new Map<string, string>()
  const approvalOperations = new Set<string>()
  const approvalWaits = new Map<string, { start: number; end?: number }>()
  for (const event of events) {
    const at = milliseconds(event.recordedAt)
    if (event.event === 'operation.dispatched' && event.recordedAt) dispatches.set(text(field(event.payload, 'ID', 'id')), event.recordedAt)
    if (event.event === 'permission.requested' && at !== undefined) {
      approvalOperations.add(text(field(event.payload, 'operationId')))
      approvalWaits.set(text(field(event.payload, 'id')), { start: at })
    }
    if (event.event === 'permission.resolved' && at !== undefined) { const wait = approvalWaits.get(text(field(event.payload, 'id'))); if (wait) wait.end = at }
    if (event.event === 'session.status' && ['stopped', 'error'].includes(text(field(event.payload, 'status'))) && at !== undefined) for (const wait of approvalWaits.values()) if (wait.end === undefined) wait.end = at
    if (event.event === 'model.request.started') {
      const id = text(field(event.payload, 'id'))
      if (id && at !== undefined) modelStarts.set(id, at)
    } else if (event.event === 'model.request.completed') {
      const id = text(field(event.payload, 'id'))
      const start = modelStarts.get(id)
      if (start !== undefined && at !== undefined && at >= start) modelIntervals.push([start, at])
      modelStarts.delete(id)
    } else if (event.event === 'operation.started' || event.event === 'operation.update' || event.event === 'operation.add.failed') {
      const id = text(field(event.payload, 'ID', 'id'))
      if (!id) continue
      const prior = operations.get(id)
      const status = event.event === 'operation.add.failed' ? 'failed' : text(field(event.payload, 'Status', 'status')) || 'ready'
      const terminal = ['completed', 'failed', 'canceled'].includes(status)
      const startedAt = prior?.startedAt || event.recordedAt
      const endedAt = terminal ? event.recordedAt : prior?.endedAt
      const start = milliseconds(startedAt), end = milliseconds(endedAt)
      operations.set(id, { id, sessionId, type: text(field(event.payload, 'Type', 'type')) || prior?.type || 'operation', status,
        startedAt, endedAt, durationMs: start === undefined ? undefined : Math.max(0, (end ?? now) - start) })
    }
  }
  const lanes = [...operations.values()]
  for (const lane of lanes) {
    if (dispatches.has(lane.id)) lane.startedAt = dispatches.get(lane.id)
    else if (approvalOperations.has(lane.id)) { lane.startedAt = undefined; if (!lane.endedAt) lane.status = 'awaiting_approval' }
    const start = milliseconds(lane.startedAt), end = milliseconds(lane.endedAt)
    lane.durationMs = start === undefined ? approvalOperations.has(lane.id) ? 0 : undefined : Math.max(0, (end ?? now) - start)
  }
  const toolIntervals = lanes.flatMap((lane): Array<[number, number]> => {
    const start = milliseconds(lane.startedAt), end = milliseconds(lane.endedAt)
    return start === undefined ? [] : [[start, end ?? now]]
  })
  const sum = toolIntervals.reduce((total, [start, end]) => total + Math.max(0, end - start), 0)
  return { operations: lanes.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')),
    modelMs: modelIntervals.reduce((total, [start, end]) => total + end - start, 0),
    modelCalls: modelIntervals.length, toolWallMs: unionLength(toolIntervals), toolOverlapMs: Math.max(0, sum - unionLength(toolIntervals)),
    approvalWaitMs: unionLength([...approvalWaits.values()].map(wait => [wait.start, wait.end ?? now])) }
}

export class SessionUsageService {
  private sessions = new Map<string, Stored>()
  private inflight = new Map<string, Promise<Stored>>()
  private generation = 0
  constructor(private bridge: DockerBridge, private contextLimits = new ContextLimitService()) {}
  clear(): void { this.generation++; this.sessions.clear(); this.inflight.clear() }

  private async load(session: SessionInfo): Promise<Stored> {
    const pending = this.inflight.get(session.id)
    if (pending) return pending
    const run = this.loadFresh(session)
    this.inflight.set(session.id, run)
    try { return await run } finally { this.inflight.delete(session.id) }
  }

  private async loadFresh(session: SessionInfo): Promise<Stored> {
    const generation = this.generation
    let current = this.sessions.get(session.id)
    if (!current) {
      const config = await this.bridge.request<{ provider: Provider; model: string }>('session.config', { sessionId: session.id })
      if (generation !== this.generation) throw new Error('Workspace changed during usage refresh')
      current = { seq: 0, totals: emptyTotals(), events: [], provider: config.provider, model: config.model }
      this.sessions.set(session.id, current)
    }
    for (;;) {
      const page = await this.bridge.request<AgentEvent[]>('session.events', { sessionId: session.id, after: current.seq, limit: 1000 })
      if (generation !== this.generation) throw new Error('Workspace changed during usage refresh')
      if (!page.length) break
      for (const event of page) {
        if (event.seq <= current.seq) continue
        consumeUsage(current.totals, event)
        if (event.event === 'session.item' && field(event.payload, 'Kind', 'kind') === 'model_response') {
          const headers = field(field(field(event.payload, 'Data', 'data'), 'Response', 'response'), 'RateLimits', 'rateLimits')
          if (Object.keys(record(headers)).length) current.rateLimits = record(headers) as Record<string, string>
        }
        if (event.event.startsWith('model.request.') || event.event.startsWith('operation.') || event.event.startsWith('permission.') || event.event === 'session.status') current.events.push(event)
        current.seq = event.seq
      }
      if (page.length < 1000) break
    }
    return current
  }

  async summaries(): Promise<SessionUsage[]> {
    if (!this.bridge.projectPath) return []
    const sessions = await this.bridge.request<SessionInfo[]>('session.list', {})
    return Promise.all(sessions.map(async (session) => {
      const stored = await this.load(session)
      const context = await this.contextLimits.read(stored.provider, stored.model)
      return { sessionId: session.id, title: session.title, provider: stored.provider, model: stored.model, totals: { ...stored.totals },
        contextLimit: context?.limit, contextSource: context?.source, rateLimits: stored.rateLimits }
    }))
  }

  async execution(sessionId: string): Promise<ExecutionSummary> {
    if (!this.bridge.projectPath) throw new Error('Open a project first')
    const sessions = await this.bridge.request<SessionInfo[]>('session.list', {})
    const session = sessions.find((item) => item.id === sessionId)
    if (!session) throw new Error('Session does not belong to the open project')
    return executionFromEvents(sessionId, (await this.load(session)).events)
  }
}
