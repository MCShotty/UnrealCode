import { promises as fs } from 'node:fs'
import { createReadStream } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AgentEvent } from '../shared/api'
import type { DecisionTrace } from '../shared/diagnostics'

const overrideWrites = new Map<string, Promise<void>>()
const overrideKey = (path:string):string => process.platform==='win32'?resolve(path).toLowerCase():resolve(path)

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
    const wanted = new Set(traces.map(trace => trace.id)), notes = new Map<string, string>()
    if (!wanted.size) return traces
    await overrideWrites.get(overrideKey(this.path(session)))
    let fragments: Buffer[] = [], length = 0, discard = false
    const line = () => {
      if (!discard && length) {
        try { const value = JSON.parse(Buffer.concat(fragments, length).toString('utf8')); if (wanted.has(value.id) && typeof value.note === 'string' && value.note.length <= 8000) notes.set(value.id, value.note) }
        catch { /* Interrupted or damaged individual records remain on disk. */ }
      }
      fragments = []; length = 0; discard = false
    }
    try {
      for await (const chunk of createReadStream(this.path(session), { highWaterMark: 64 * 1024 })) {
        let start = 0
        while (start < chunk.length) {
          const newline = chunk.indexOf(10, start), end = newline < 0 ? chunk.length : newline
          if (!discard && length + end - start <= 16 * 1024) { fragments.push(chunk.subarray(start, end)); length += end - start }
          else { fragments = []; length = 0; discard = true }
          if (newline >= 0) line()
          start = end + 1
        }
      }
      line()
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return traces.map(trace => ({ ...trace, override: notes.get(trace.id) }))
  }
  async save(session: string, id: string, note: string, traces: DecisionTrace[]): Promise<void> {
    if (!traces.some(trace => trace.id === id)) throw new Error('Decision is not in this session')
    if (typeof note !== 'string' || note.length > 8000) throw new Error('Override note must be below 8000 characters')
    const path = this.path(session),key=overrideKey(path),previous=overrideWrites.get(key)||Promise.resolve()
    const write=previous.catch(()=>{}).then(async()=>{await fs.mkdir(this.directory,{recursive:true});await fs.appendFile(path,`\n${JSON.stringify({id,note,actor:'user',recordedAt:new Date().toISOString()})}\n`,{mode:0o600})})
    overrideWrites.set(key,write)
    try{await write}finally{if(overrideWrites.get(key)===write)overrideWrites.delete(key)}
  }
}
