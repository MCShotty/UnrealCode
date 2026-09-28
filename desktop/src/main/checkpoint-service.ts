import { CheckpointStore } from './checkpoints'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '../shared/api'

type Active = { id: string; pending: Set<string>; overlap: boolean }
export class CheckpointService {
  readonly store: CheckpointStore
  private active = new Map<string, Active>()
  private external = new Map<string,{sessionId:string;overlap:boolean}>()
  private tail: Promise<unknown> = Promise.resolve()
  onState: (sessionId: string, state: string, checkpointId?: string) => void = () => {}
  constructor(project: string, data: string) { this.store = new CheckpointStore(project, data) }
  get busy(): boolean { return this.active.size > 0 || this.external.size > 0 }
  beginExternal(sessionId:string,title:string):Promise<string>{return this.exclusive(async()=>{if(this.busy)throw new Error('Finish project operations before starting verification');const id=await this.store.begin(sessionId,randomUUID(),title);this.external.set(id,{sessionId,overlap:false});return id})}
  finishExternal(id:string,reason?:string):Promise<void>{return this.exclusive(async()=>{const active=this.external.get(id);if(!active)return;await this.store.finish(id,active.overlap?'Verification overlapped another task; restoration is disabled':reason);this.external.delete(id)})}
  async delegationSource(sessionId: string): Promise<{ id:string; phase:'before'|'after'; snapshot:import('./checkpoints').Snapshot }> {
    return this.exclusive(async () => {
      const active = this.active.get(sessionId)
      if (active) {
        if (active.overlap) throw new Error('Concurrent source edits prevent a reliable specialist snapshot')
        return { id:active.id, phase:'before', snapshot:await this.store.recordedSnapshot(active.id,'before') }
      }
      const completed = (await this.store.list()).find(item=>item.sessionId===sessionId&&item.state==='complete')
      if (!completed) throw new Error('Send the parent task first so specialists have a recorded checkpoint')
      return { id:completed.id, phase:'after', snapshot:await this.store.recordedSnapshot(completed.id,'after') }
    })
  }
  markExternalWork(): void { for (const active of this.active.values()) active.overlap = true;for(const active of this.external.values())active.overlap=true }
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work)
    this.tail = next.catch(() => {})
    return next
  }
  send(sessionId: string, messageId: string, prompt: string, submit: () => Promise<unknown>, externalWork = false): Promise<void> {
    return this.exclusive(async () => {
      let active = this.active.get(sessionId)
      if (!active && (await this.store.list()).some((item) => item.sessionId === sessionId && item.messageIds.includes(messageId))) { await submit(); return }
      if (!active) {
        const overlap = this.active.size > 0 || externalWork || this.external.size > 0
        for (const other of this.active.values()) other.overlap = true
        for (const other of this.external.values()) other.overlap = true
        const id = await this.store.begin(sessionId, messageId, prompt)
        active = { id, pending: new Set(), overlap }
        this.active.set(sessionId, active)
      } else await this.store.addMessage(active.id, messageId)
      if (externalWork) active.overlap = true
      active.pending.add(messageId)
      this.onState(sessionId, 'running', active.id)
      try { await submit() }
      catch (error) {
        active.pending.delete(messageId)
        if (!active.pending.size) { await this.store.finish(active.id, 'Message submission failed'); this.active.delete(sessionId); this.onState(sessionId, 'failed', active.id) }
        throw error
      }
    })
  }
  async event(event: AgentEvent): Promise<void> {
    if (!['session.idle', 'session.status'].includes(event.event)) return
    await this.exclusive(async () => {
      const active = this.active.get(event.sessionId)
      if (!active) return
      const payload = event.payload as { messageIds?: string[]; status?: string; outcome?: {state:string} }
      if (event.event === 'session.idle') {
        for (const id of payload.messageIds || []) active.pending.delete(id)
        if (active.pending.size) return
      } else if (!['stopped', 'error'].includes(payload.status || '')) return
      const interrupted = event.event !== 'session.idle'
      await this.store.finish(active.id, active.overlap ? 'Concurrent sessions or a container terminal could change this workspace; restoration is disabled' : payload.status === 'error' ? 'Turn failed before normal completion' : undefined)
      this.active.delete(event.sessionId)
      this.onState(event.sessionId, payload.outcome?.state || (interrupted ? payload.status === 'error' ? 'failed' : 'stopped' : 'idle'), active.id)
    })
  }
}
