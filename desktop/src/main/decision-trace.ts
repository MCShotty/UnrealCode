import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '../shared/api'
import type { DecisionTrace } from '../shared/diagnostics'

export function decisionTraces(events: AgentEvent[]): DecisionTrace[] {
  return events.filter(event => event.event === 'decision.result').map(event => {
    const result = event.payload as Record<string, any>
    return { id: String(result.id || `event-${event.seq}`), purpose: result.purpose || 'Legacy decision (purpose not recorded)', engine: result.engine, model: result.model, sourceRefs: result.sourceRefs || [], questions: result.questions || {}, evidence: result.evidence ?? null, answers: result.answers, usage: result.usage, durationMs: result.durationMs, recordedAt: event.recordedAt }
  })
}
export class DecisionOverrides {
  constructor(private directory: string) {}
  private path(session: string): string { if (!/^[a-f0-9-]{36}$/.test(session)) throw new Error('Invalid session'); return join(this.directory, `${session}.jsonl`) }
  async apply(session: string, traces: DecisionTrace[]): Promise<DecisionTrace[]> {
    const rows = (await fs.readFile(this.path(session), 'utf8').catch(() => '')).split('\n')
    const notes = new Map<string, string>()
    for (const row of rows) { try { const value = JSON.parse(row); if (typeof value.id === 'string' && typeof value.note === 'string') notes.set(value.id, value.note) } catch { /* Interrupted final record remains recoverable. */ } }
    return traces.map(trace => ({ ...trace, override: notes.get(trace.id) }))
  }
  async save(session: string, id: string, note: string, traces: DecisionTrace[]): Promise<void> {
    if (!traces.some(trace => trace.id === id)) throw new Error('Decision is not in this session')
    if (typeof note !== 'string' || note.length > 8000) throw new Error('Override note must be below 8000 characters')
    const path = this.path(session); await fs.mkdir(this.directory, { recursive: true })
    await fs.appendFile(path, `\n${JSON.stringify({ id, note, actor: 'user', recordedAt: new Date().toISOString() })}\n`, { mode: 0o600 })
  }
}
