import type { SearchHit } from '../shared/workflow'
export type { SearchHit } from '../shared/workflow'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '../shared/api'

type Row = { seq: number; kind: string; recordedAt?: string; text: string }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const get = (value: unknown, key: string): unknown => object(value)[key] ?? object(value)[key[0].toLowerCase() + key.slice(1)]

export function searchableText(event: AgentEvent): string {
  if (event.event === 'operation.update') {
    const state = get(event.payload, 'State')
    return JSON.stringify({ command: get(get(state, 'Input'), 'Command'), output: get(state, 'Result'), stdout: get(state, 'InlineOut'), stderr: get(state, 'InlineErr'), error: get(state, 'TerminalError') })
  }
  if (event.event !== 'session.item') return ''
  const kind = get(event.payload, 'Kind'), data = get(event.payload, 'Data')
  if (kind === 'input' && get(data, 'Kind') === 'external') {
    const payload = get(data, 'Payload')
    return typeof payload === 'string' ? payload : String(get(payload, 'Prompt') || '')
  }
  if (kind === 'model_response') {
    const output = get(get(data, 'Response'), 'Output')
    return Array.isArray(output) ? output.flatMap((item) => get(item, 'Type') === 'message' ? [String(get(get(item, 'Data'), 'Text') || '')] : []).join('\n') : ''
  }
  return ''
}

export class LegacyConversationIndex {
  async flush():Promise<void>{await this.writes}
  private rows = new Map<string, Map<number, Row>>()
  private loading: Promise<void> | null = null
  private writes: Promise<void> = Promise.resolve()
  constructor(readonly project: string, private directory: string) {}
  private file(sessionId: string): string {
    if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('Invalid search session')
    return join(this.directory, `${sessionId}.jsonl`)
  }
  private load(): Promise<void> {
    if (!this.loading) this.loading = (async () => {
      const names = await fs.readdir(this.directory).catch(() => [] as string[])
      for (const name of names.filter((name) => /^[a-f0-9-]{36}\.jsonl$/.test(name))) {
        const values = new Map<number, Row>()
        for (const line of (await fs.readFile(join(this.directory, name), 'utf8')).split('\n').filter(Boolean)) {
          try { const row = JSON.parse(line) as Row; if (Number.isSafeInteger(row.seq) && typeof row.text === 'string') values.set(row.seq, row) } catch { /* An interrupted append is replayed from the canonical log. */ }
        }
        this.rows.set(name.slice(0, -6), values)
      }
    })()
    return this.loading
  }
  async cursor(sessionId: string): Promise<number> {
    await this.load()
    const rows = this.rows.get(sessionId)
    let sequence = 0
    while (rows?.has(sequence + 1)) sequence++
    return sequence
  }
  ingest(event: AgentEvent): Promise<void> {
    const write = this.writes.then(async () => {
      await this.load()
      if (!Number.isSafeInteger(event.seq) || event.seq < 1) return
      const path = this.file(event.sessionId)
      const rows = this.rows.get(event.sessionId) || new Map<number, Row>()
      if (rows.has(event.seq)) return
      const row: Row = { seq: event.seq, kind: event.event, recordedAt: event.recordedAt, text: searchableText(event) }
      await fs.mkdir(this.directory, { recursive: true })
      // A leading newline isolates a partial final record left by an interrupted append.
      await fs.appendFile(path, `\n${JSON.stringify(row)}\n`, { mode: 0o600 })
      rows.set(event.seq, row); this.rows.set(event.sessionId, rows)
    })
    this.writes = write.catch(() => {})
    return write
  }
  addFiles(sessionId: string, seq: number, paths: string[]): Promise<void> {
    // File names augment an existing canonical event rather than inventing sequence numbers.
    const write = this.writes.then(async () => {
      await this.load()
      const row = this.rows.get(sessionId)?.get(seq)
      if (!row || !paths.length) return
      const text = `${row.text}\nChanged files:\n${paths.join('\n')}`
      const updated = { ...row, text }
      await fs.appendFile(this.file(sessionId), `\n${JSON.stringify(updated)}\n`, { mode: 0o600 })
      this.rows.get(sessionId)!.set(seq, updated)
    })
    this.writes = write.catch(() => {})
    return write
  }
  async search(query: string, sessionId?: string): Promise<SearchHit[]> {
    if (typeof query !== 'string' || query.length > 500) throw new Error('Search query must be below 500 characters')
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    await this.writes; await this.load()
    const hits: SearchHit[] = []
    let inspected = 0
    for (const [id, rows] of this.rows) {
      if (sessionId && sessionId !== id) continue
      for (const row of rows.values()) {
        const offset = row.text.toLowerCase().indexOf(needle)
        if (offset >= 0) hits.push({ project: this.project, sessionId: id, seq: row.seq, kind: row.kind, recordedAt: row.recordedAt, snippet: row.text.slice(Math.max(0, offset - 90), offset + needle.length + 160) })
        if (++inspected % 1000 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    return hits.sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || '') || b.seq - a.seq).slice(0, 200)
  }
}
