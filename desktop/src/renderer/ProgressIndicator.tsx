import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, CircleAlert, Pause, Square } from 'lucide-react'
import { useReducedMotion } from './useReducedMotion'

export type ProgressState = 'running' | 'waiting' | 'success' | 'error' | 'stopped' | 'idle'
const subscribeVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify)
  return () => document.removeEventListener('visibilitychange', notify)
}
const visibleDocument = () => document.visibilityState === 'visible'
const noVisibilitySubscription = () => () => {}
const notVisible = () => false

/** CSS owns the loop: no animation frames update React or the conversation. */
export function ProgressIndicator({ state = 'running', animate = true, label }: { state?: ProgressState; animate?: boolean; label?: string }) {
  const reduced = useReducedMotion(), visible = useSyncExternalStore(animate ? subscribeVisibility : noVisibilitySubscription, animate ? visibleDocument : notVisible)
  const root = useRef<HTMLSpanElement>(null), previous = useRef(state)
  const [inView, setInView] = useState(false), [celebrate, setCelebrate] = useState(false)
  useEffect(() => {
    if (!animate) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [animate, state])
  useEffect(() => {
    const fresh = previous.current === 'running' && state === 'success'
    previous.current = state
    setCelebrate(fresh && animate && !reduced && visible && inView)
    if (fresh) { const timer = setTimeout(() => setCelebrate(false), 600); return () => clearTimeout(timer) }
  }, [state, animate, reduced, visible, inView])
  const playing = animate && visible && inView && !reduced && state === 'running'
  return <span ref={root} className={`expressive-progress ${state} ${celebrate ? 'fresh-success' : ''}`} data-playing={playing} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {celebrate&&<span className="success-shapes" aria-hidden="true"><i/><i/><i/></span>}
    {state === 'success' ? <Check size={16}/> : state === 'waiting' ? <Pause size={15}/> : state === 'error' ? <CircleAlert size={16}/> : state === 'stopped' ? <Square size={13}/> : <span className="progress-orbit"><span className="progress-shape"/></span>}
  </span>
}
