import type { SessionInfo } from './api'

export type TurnState = 'idle' | 'running' | 'waiting_input' | 'completed' | 'completed_with_warnings' | 'failed' | 'stopped' | 'interrupted'
export type TurnOutcome = { state: TurnState; turnId?: string; messageIds?: string[]; warnings?: string[]; updatedAt: string }
export function offlineSession(item: SessionInfo): SessionInfo {
  const state = item.outcome?.state || item.state || 'idle'
  return { ...item, active: false, state: ['running', 'waiting_input', 'cancelling', 'starting'].includes(state) ? 'interrupted' : state }
}
export function terminalTurn(state: string): boolean { return ['idle','completed','completed_with_warnings','failed','stopped','interrupted'].includes(state) }
export function successfulTurn(state: string): boolean { return ['idle','completed'].includes(state) }
