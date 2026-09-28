import { Worker } from 'node:worker_threads'
import { join } from 'node:path'

type Job = {
  id: number
  revision: string
  schema: unknown
  args: unknown
  compileOnly: boolean
  signal?: AbortSignal
  resolve(value: boolean): void
  reject(error: Error): void
  timer?: ReturnType<typeof setTimeout>
  abort?: () => void
}
type Slot = { worker: Worker; job?: Job; dead: boolean }

export class McpSchemaValidator {
  private slots: Slot[] = []
  private pending: Job[] = []
  private next = 0
  private closed = false
  private workerFailures = 0
  private blockedRevisions = new Set<string>()

  constructor(private readonly path = join(__dirname, 'mcp-schema-worker.cjs'), private readonly size = 4, private readonly timeoutMs = 1500) {}

  validate(revision: string, schema: unknown, args?: unknown, signal?: AbortSignal): Promise<boolean> {
    if (this.closed) return Promise.reject(new Error('MCP schema validation is closed'))
    if (this.blockedRevisions.has(revision)) return Promise.reject(new Error('MCP tool schema previously timed out; change the server schema before retrying'))
    if (signal?.aborted) return Promise.reject(new Error('MCP call cancelled'))
    let bytes: number
    try { bytes = Buffer.byteLength(JSON.stringify({ schema, args })) }
    catch { return Promise.reject(new Error('MCP tool schema or arguments are invalid')) }
    if (bytes > 512 * 1024) return Promise.reject(new Error('MCP tool schema or arguments exceed the validation limit'))
    if (this.pending.length + this.slots.filter(slot => !!slot.job).length >= 64) return Promise.reject(new Error('MCP schema validation queue is full'))
    return new Promise<boolean>((resolve, reject) => {
      const job: Job = { id: ++this.next, revision, schema, args, compileOnly: args === undefined, signal, resolve, reject }
      job.abort = () => {
        const queued = this.pending.indexOf(job)
        if (queued >= 0) {
          this.pending.splice(queued, 1)
          job.signal?.removeEventListener('abort', job.abort!)
          job.reject(new Error('MCP call cancelled'))
          this.pump()
          return
        }
        const active = this.slots.find(slot => slot.job === job)
        if (active) this.failSlot(active, new Error('MCP call cancelled'), false)
      }
      signal?.addEventListener('abort', job.abort, { once: true })
      this.pending.push(job)
      if (signal?.aborted) job.abort?.()
      else this.pump()
    })
  }

  private createSlot(): Slot {
    const worker = new Worker(this.path)
    worker.unref()
    const slot: Slot = { worker, dead: false }
    worker.on('message', (message: { id: number; ok: boolean; valid?: boolean }) => {
      const job = slot.job
      if (slot.dead || !job || message.id !== job.id) return
      this.release(slot)
      if (message.ok) job.resolve(!!message.valid)
      else job.reject(new Error('MCP tool schema is invalid or unsupported'))
      this.pump()
    })
    worker.on('error', () => this.failSlot(slot, new Error('MCP schema worker failed; reconnect or restart UnrealCode')))
    worker.on('exit', () => this.failSlot(slot, new Error('MCP schema worker exited; reconnect or restart UnrealCode')))
    this.slots.push(slot)
    return slot
  }

  private release(slot: Slot): Job | undefined {
    const job = slot.job
    slot.job = undefined
    if (job?.timer) clearTimeout(job.timer)
    if (job?.signal && job.abort) job.signal.removeEventListener('abort', job.abort)
    return job
  }

  private failSlot(slot: Slot, error: Error, workerFailure = true, blockRevision = false): void {
    if (slot.dead) return
    slot.dead = true
    const job = this.release(slot)
    if (blockRevision && job) {
      if (this.blockedRevisions.size >= 1024) this.blockedRevisions.delete(this.blockedRevisions.values().next().value!)
      this.blockedRevisions.add(job.revision)
    }
    this.slots = this.slots.filter(item => item !== slot)
    void slot.worker.terminate().catch(() => {})
    job?.reject(error)
    if (workerFailure) this.workerFailures++
    if (this.workerFailures >= 3) {
      this.closed = true
      for (const waiting of this.pending.splice(0)) { if (waiting.signal && waiting.abort) waiting.signal.removeEventListener('abort', waiting.abort); waiting.reject(new Error('MCP schema workers are unavailable; rebuild or restart UnrealCode')) }
    } else this.pump()
  }

  private pump(): void {
    while (this.pending.length && !this.closed) {
      let slot = this.slots.find(item => !item.job && !item.dead)
      if (!slot) {
        if (this.slots.length >= this.size) break
        try { slot = this.createSlot() }
        catch { this.closed = true; for (const waiting of this.pending.splice(0)) { if (waiting.signal && waiting.abort) waiting.signal.removeEventListener('abort', waiting.abort); waiting.reject(new Error('MCP schema worker could not start; rebuild UnrealCode')) } return }
      }
      const job = this.pending.shift()!
      slot.job = job
      job.timer = setTimeout(() => this.failSlot(slot!, new Error('MCP schema validation timed out; tool was not called'), false, true), this.timeoutMs)
      try { slot.worker.postMessage({ id: job.id, revision: job.revision, schema: job.schema, arguments: job.args, compileOnly: job.compileOnly }) }
      catch { this.failSlot(slot, new Error('MCP schema arguments could not be transferred')) }
      if (job.signal?.aborted) job.abort?.()
    }
  }

  async close(): Promise<void> {
    this.closed = true
    for (const job of this.pending.splice(0)) { if (job.signal && job.abort) job.signal.removeEventListener('abort', job.abort); job.reject(new Error('MCP schema validation closed')) }
    const slots = this.slots.splice(0)
    await Promise.all(slots.map(async slot => {
      slot.dead = true
      this.release(slot)?.reject(new Error('MCP schema validation closed'))
      await slot.worker.terminate().catch(() => {})
    }))
  }
}
