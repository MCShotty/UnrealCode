import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { HostApproval, HostOperation, HostResult } from '../shared/connections'

export function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
type RecordEntry = { digest: string; status: 'started' | 'finished'; result?: HostResult }
type Pending = { value: HostApproval; resolve(allow: boolean): void; timer: NodeJS.Timeout }
export class HostOperations {
  private records: Record<string, RecordEntry> = {}
  private pending = new Map<string, Pending>()
  private active = new Map<string, AbortController>()
  onChanged: () => void = () => {}
  constructor(private path: string) { if (existsSync(path)) this.records = JSON.parse(readFileSync(path, 'utf8')) }
  private save(): void { mkdirSync(dirname(this.path), { recursive: true }); const temp = `${this.path}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(this.records), { mode: 0o600 }); renameSync(temp, this.path) }
  approvals(project: string, sessionId: string): HostApproval[] { return [...this.pending.values()].filter(item => item.value.project === project && item.value.sessionId === sessionId).map(item => structuredClone(item.value)) }
  respond(project: string, sessionId: string, id: string, digest: string, allow: boolean): void {
    const item = this.pending.get(id)
    if (!item || item.value.project !== project || item.value.sessionId !== sessionId || item.value.digest !== digest || Date.parse(item.value.expiresAt) <= Date.now()) throw new Error('Host approval expired or does not match this operation')
    item.resolve(allow)
  }
  cancel(project: string, sessionId: string, operationId: string): void { this.active.get(stableJSON([project, sessionId, operationId]))?.abort() }
  cancelAll(): void { for (const controller of this.active.values()) controller.abort() }
  cancelSession(project: string, sessionId: string): void { for (const [key, controller] of this.active) { const [root,id] = JSON.parse(key); if (root === project && id === sessionId) controller.abort() } }
  async run(project: string, operation: HostOperation, target: string, execute: (signal: AbortSignal) => Promise<HostResult>): Promise<HostResult> {
    if (![operation.sessionId, operation.operationId, operation.requestId].every(value => /^[a-f0-9-]{36}$/.test(value)) || !operation.workspaceId || Buffer.byteLength(stableJSON(operation)) > 256 * 1024) throw new Error('Invalid host operation identity or arguments')
    const key = stableJSON([project, operation.sessionId, operation.operationId])
    const digest = createHash('sha256').update(stableJSON({ project, sessionId: operation.sessionId, operationId: operation.operationId, workspaceId: operation.workspaceId, tool: operation.tool, arguments: operation.arguments, target })).digest('hex')
    const previous = this.records[key]
    if (previous) {
      if (previous.digest !== digest) throw new Error('Replayed host operation arguments changed')
      if (previous.status === 'finished') return previous.result!
      throw new Error('An earlier host call may have executed before interruption. Inspect the server before requesting a new operation.')
    }
    if (this.active.has(key)) throw new Error('Host operation already pending')
    const controller = new AbortController(); this.active.set(key, controller)
    try {
      const id = randomUUID()
      const allowed = await new Promise<boolean>(resolve => {
        const finish = (allow: boolean) => { const pending = this.pending.get(id); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(id); controller.signal.removeEventListener('abort', abort); resolve(allow); this.onChanged() }
        const abort = () => finish(false)
        this.pending.set(id, { value: { ...structuredClone(operation), id, project, digest, target, expiresAt: new Date(Date.now() + 600000).toISOString() }, resolve: finish, timer: setTimeout(() => finish(false), 600000) })
        controller.signal.addEventListener('abort', abort, { once: true }); this.onChanged()
      })
      if (!allowed || controller.signal.aborted) return { text: 'Host operation denied, cancelled, or approval expired.', error: true }
      this.records[key] = { digest, status: 'started' }; this.save()
      let result: HostResult
      try { result = await execute(controller.signal) } catch { result = { text: 'External call failed or was cancelled. It may have executed on the server; inspect its state before requesting a new call.', error: true } }
      this.records[key] = { digest, status: 'finished', result }; this.save(); return result
    } finally { this.active.delete(key) }
  }
}
