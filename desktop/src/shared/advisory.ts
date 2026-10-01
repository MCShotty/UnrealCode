export const asyncAdvisoryCapability = 'async_advisory_v1'
export type AdvisoryBinding = {
  projectId: string; workspaceId: string; sessionId: string; runId: string; sourceInputId: string
  requestGeneration: number; decisionGeneration: number; contextRevision: number
}
export type AdvisoryState = 'queued' | 'analysing' | 'ready' | 'delivered' | 'skipped' | 'failed' | 'cancelled' | 'interrupted'
export type AdvisoryStatus = { version: 1; id: string; binding: AdvisoryBinding; state: AdvisoryState; message?: string; issue?:{code:string;httpStatus?:number;requestId?:string;retryAfterMs?:number} }
export type AdvisorySlotMessage = { id: string; binding: AdvisoryBinding; granted?: boolean }
export type AcceptedMessage = {messageId:string;advisoryBinding?:AdvisoryBinding|null}
export type MemoryRecall = {text:string;valid():Promise<boolean>}
export type MemoryRecallOptions={fieldnoteIds:string[];maximumFieldnotes:number;remainingFieldnoteBytes:number}
const states: AdvisoryState[] = ['queued','analysing','ready','delivered','skipped','failed','cancelled','interrupted']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function validAdvisorySlot(value: unknown, projectId: string, sessionId: string): value is AdvisorySlotMessage {
  if(!value || typeof value !== 'object') return false
  const p = value as AdvisorySlotMessage, b = p.binding
  return typeof p.id === 'string' && uuid.test(p.id) && !!b && b.projectId === projectId && b.sessionId === sessionId && uuid.test(b.sessionId) && uuid.test(b.runId) && uuid.test(b.sourceInputId)
    && typeof b.workspaceId === 'string' && b.workspaceId.length > 0 && b.workspaceId.length <= 4096
    && [b.requestGeneration,b.decisionGeneration,b.contextRevision].every(n=>Number.isSafeInteger(n)&&n>0)
}
export function advisoryStatus(value: unknown): AdvisoryStatus | undefined {
  if(!value || typeof value !== 'object') return
  const p = value as AdvisoryStatus
  if(p.version === 1 && states.includes(p.state) && p.binding && validAdvisorySlot(p,p.binding.projectId,p.binding.sessionId) && (p.message === undefined || typeof p.message === 'string' && p.message.length <= 1024)) return p
}
