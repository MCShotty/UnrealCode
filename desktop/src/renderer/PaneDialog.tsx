import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { expressive, instant } from './motion'

// Native modal semantics provide focus containment and Escape handling. The
// same supporting content remains reachable when the window cannot fit a rail.
export function PaneDialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return <motion.dialog ref={dialog} className="pane-dialog" aria-label={title} initial={reduced ? false : { opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={reduced ? instant : expressive.dialog} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <header><h2>{title}</h2><button className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={19}/></button></header>
    <div className="pane-dialog-body" tabIndex={0} role="region" aria-label={`${title} content`}>{children}</div>
  </motion.dialog>
}
