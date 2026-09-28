import { useRef } from 'react'
import { motion } from 'motion/react'
import { Send, Square } from 'lucide-react'
import type { ComposerAction } from './composer-action'
import { ProgressIndicator } from './ProgressIndicator'
import { useReducedMotion } from './useReducedMotion'
import { spatial, instant } from './motion'

export function ComposerActionButton({ action, onSend, onStop }: { action: ComposerAction; onSend(): void; onStop(): void }) {
  const reduced = useReducedMotion(), pressed = useRef<string | undefined>(undefined), lastActivation = useRef(-Infinity)
  const identity = `${action.kind}:${action.pending}:${action.disabled}`
  return <motion.button type="button" className={`primary-button composer-smart-action ${action.kind}`} disabled={action.disabled} aria-busy={action.pending} aria-label={action.label}
    onPointerDown={() => { pressed.current = identity }} onPointerCancel={() => { pressed.current = undefined }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { if (event.repeat) event.preventDefault(); else pressed.current = identity } }}
    onClick={() => { const initial = pressed.current; pressed.current = undefined; const now=performance.now(); if (action.disabled || (initial && initial !== identity) || now-lastActivation.current<300) return; lastActivation.current=now; (action.kind === 'send' ? onSend : onStop)() }}
    animate={{ borderRadius: action.kind === 'stop' ? 16 : 26 }} transition={reduced ? instant : spatial.fast}>
    <motion.span className="composer-action-symbol" key={`${action.kind}:${action.pending}`} initial={reduced ? false : { opacity: 0, scale: .65, rotate: -25 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={reduced ? instant : spatial.fast}>
      {action.pending ? <ProgressIndicator/> : action.kind === 'send' ? <Send size={18}/> : <Square size={16}/>}
    </motion.span><span>{action.label}</span>
  </motion.button>
}
