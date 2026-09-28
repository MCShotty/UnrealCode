export type PendingComposerAction = 'send' | 'stop'
export type ComposerAction = { kind: PendingComposerAction; label: string; disabled: boolean; pending: boolean }

export function composerAction({ draft, running, online, localCommand, pending, unavailable = false }: {
  draft: boolean; running: boolean; online: boolean; localCommand: boolean; pending?: PendingComposerAction; unavailable?: boolean
}): ComposerAction {
  if (pending) return { kind: pending, label: pending === 'send' ? 'Sending…' : 'Stopping…', disabled: true, pending: true }
  if (!draft && running && online) return { kind: 'stop', label: 'Stop', disabled: unavailable, pending: false }
  return { kind: 'send', label: 'Send', disabled: unavailable || !draft || (!online && !localCommand), pending: false }
}

export function isWorkRunning(state?: string): boolean {
  return ['running', 'waiting_input', 'waiting for input', 'waiting_approval', 'starting', 'cancelling'].includes(state || '')
}

export function sendsOnEnter(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number }, action: ComposerAction): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && action.kind === 'send' && !action.disabled
}
