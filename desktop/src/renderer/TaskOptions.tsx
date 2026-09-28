import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { Check, ChevronDown, SlidersHorizontal, Square, X } from 'lucide-react'
import { defaultTeamOptions, type TeamOptions, type TeamView, type DelegationPolicy } from '../shared/teams'
import { appliedPolicy, editTaskOptions, commitTaskOptions, type TaskOptionsDraft } from './task-options'
import { ExpressiveButton } from './ExpressiveButton'
import { useReducedMotion } from './useReducedMotion'
import { expressive, spatial, instant } from './motion'

const policies: { value: DelegationPolicy; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'The main agent works on this task without specialist agents.' },
  { value: 'manual', label: 'Manual', description: 'You choose when to assign specialists from the task team.' },
  { value: 'automatic', label: 'Automatic', description: 'The agent may delegate within this task’s permissions and limits.' }
]

export function TaskTeamControls({ sessionId, draft, onDraft, canStop = false, stopping = false, onStop }: {
  sessionId?: string; draft: TeamOptions; onDraft(value: TeamOptions): void; canStop?: boolean; stopping?: boolean; onStop?(): void
}) {
  const [team, setTeam] = useState<TeamView | null>(), [error, setError] = useState(''), [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let live = true, pending = false
    setTeam(undefined); setError(''); setOpen(false)
    const refresh = () => { if (!sessionId || pending) return; pending = true; void window.unreal.teamView(sessionId).then(value => { if (live) { setTeam(value); setError('') } }).catch(reason => { if (live) setError(String(reason)) }).finally(() => { pending = false }) }
    refresh(); const dispose = window.unreal.onWorkflowChanged(refresh)
    return () => { live = false; dispose() }
  }, [sessionId])
  const applied = sessionId ? team === null ? defaultTeamOptions : team?.options : draft, worker = !!team && team.parentSessionId !== sessionId
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })) }
  const policy = applied ? policies.find(item => item.value === appliedPolicy(applied))!.label : error ? 'Unavailable' : 'Loading…'
  return <div className="task-options-control">
    <button type="button" ref={trigger} className="task-options-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><SlidersHorizontal size={15}/><span>Task options · {worker ? 'Inherited' : policy}</span><ChevronDown size={13}/></button>
    {open && createPortal(<TaskOptionsDialog key={sessionId || 'draft'} anchor={trigger.current} sessionId={sessionId} applied={applied} worker={worker} loadError={error} onClose={close}
      onApply={async value => { if (sessionId) await window.unreal.teamConfigure(sessionId, value); else onDraft(value) }}
      onSaved={value => { setTeam(current => current ? { ...current, options: value } : current); close() }} canStop={canStop} stopping={stopping} onStop={() => { onStop?.(); close() }}/>, document.body)}
  </div>
}

function TaskOptionsDialog({ anchor, sessionId, applied, worker, loadError, onClose, onApply, onSaved, canStop, stopping, onStop }: {
  anchor: HTMLElement | null; sessionId?: string; applied?: TeamOptions; worker: boolean; loadError: string; onClose(): void;
  onApply(value: TeamOptions): Promise<void>; onSaved(value: TeamOptions): void; canStop: boolean; stopping: boolean; onStop(): void
}) {
  const reduced = useReducedMotion(), id = useId(), dialog = useRef<HTMLDialogElement>(null), live = useRef(true), submitting = useRef(false)
  const [value, setValue] = useState<TaskOptionsDraft>(() => editTaskOptions(applied || defaultTeamOptions)), [busy, setBusy] = useState(false), [error, setError] = useState(''), [limitsOpen, setLimitsOpen] = useState(false)
  const edited = useRef(false)
  useEffect(() => { if (applied && !edited.current) setValue(editTaskOptions(applied)) }, [applied])
  const change = (patch: Partial<TaskOptionsDraft>) => { edited.current = true; setValue(current => ({ ...current, ...patch })) }
  useLayoutEffect(() => {
    live.current = true
    const element = dialog.current!
    const place = () => {
      const sheet = window.innerWidth < 700
      element.classList.toggle('sheet', sheet)
      if (sheet) { element.style.removeProperty('left'); element.style.removeProperty('top'); return }
      const bounds = anchor?.getBoundingClientRect(), width = element.offsetWidth, height = element.offsetHeight
      element.style.left = `${Math.max(16, Math.min(bounds?.left || 16, window.innerWidth - width - 16))}px`
      element.style.top = `${Math.max(16, Math.min((bounds?.top || window.innerHeight) - height - 10, window.innerHeight - height - 16))}px`
    }
    element.showModal(); place()
    const observer = new ResizeObserver(place); observer.observe(element)
    window.addEventListener('resize', place)
    return () => { live.current = false; observer.disconnect(); window.removeEventListener('resize', place); element.close() }
  }, [anchor])
  const submit = async () => {
    if (!applied || worker || submitting.current) return
    submitting.current = true; setError(''); setBusy(true)
    try { const options = commitTaskOptions(value); await onApply(options); if (live.current) onSaved(options) }
    catch (reason) { if (live.current) setError(String(reason instanceof Error ? reason.message : reason)) }
    finally { submitting.current = false; if (live.current) setBusy(false) }
  }
  const field = (key: Exclude<keyof TaskOptionsDraft, 'policy'>, label: string, min: number, max: number, optional = false, disabled = false) =>
    <label className="task-option-field" key={key}><span>{label}</span><input aria-label={label} type="number" inputMode="numeric" min={min} max={max} step={1} placeholder={optional ? 'Unlimited' : undefined} value={value[key]} disabled={busy || disabled} onChange={event => change({ [key]: event.target.value })}/></label>
  return <motion.dialog ref={dialog} className="task-options-dialog" aria-labelledby={`${id}-title`} initial={reduced ? false : { opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={reduced ? instant : expressive.dialog}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onClick={event => { if (event.target === event.currentTarget && !busy) { const rect = dialog.current!.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }}>
    <header><div><h2 id={`${id}-title`}>Task options</h2><p>{sessionId ? 'For this conversation' : 'For your next task'}</p></div><button type="button" className="icon-button" aria-label="Close task options" disabled={busy} onClick={onClose}><X size={19}/></button></header>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="task-options-body">
        {loadError && <p role="alert" className="error-inline">{loadError}</p>}
        {!applied ? <p role="status">{loadError ? 'Task settings are unavailable. Reopen this panel to retry.' : 'Loading task settings…'}</p> : worker ? <><p>Specialists inherit their parent task’s limits and permissions. Nested delegation is disabled.</p><dl className="inherited-task-options"><dt>Delegation</dt><dd>{policies.find(p => p.value === value.policy)?.label}</dd><dt>Concurrent specialists</dt><dd>{value.concurrency}</dd><dt>Total specialists</dt><dd>{value.workerLimit}</dd><dt>Model requests</dt><dd>{value.modelRequestLimit || 'Unlimited'}</dd><dt>Active minutes</dt><dd>{value.elapsedMinutes || 'Unlimited'}</dd><dt>Reported tokens</dt><dd>{value.tokenLimit || 'Unlimited'}</dd></dl></> : <>
          <h3>Specialists</h3><div className="delegation-segments" role="group" aria-label="Delegation policy">{policies.map(policy => <button type="button" key={policy.value} aria-pressed={value.policy === policy.value} disabled={busy} onClick={() => change({ policy: policy.value })}>{value.policy === policy.value && <motion.span className="selected-segment" layoutId={`${id}-policy`} transition={reduced ? instant : spatial.fast}/>}<span className="policy-label"><Check size={15} aria-hidden="true" style={{visibility:value.policy===policy.value?'visible':'hidden'}}/>{policy.label}</span></button>)}</div>
          <p className="task-option-hint">{policies.find(policy => policy.value === value.policy)?.description}</p>
          <div className="task-option-grid">{field('concurrency', 'Concurrent specialists', 1, 4, false, value.policy === 'off')}{field('workerLimit', 'Total specialists', 1, 100, false, value.policy === 'off')}</div>
          <p className="task-option-hint">Up to four specialists can run across projects.</p>
          <section className="task-budget-section"><button type="button" className="task-limits-toggle" aria-expanded={limitsOpen} aria-controls={`${id}-limits`} onClick={() => setLimitsOpen(!limitsOpen)}><span><strong>Task limits</strong><small>{[value.modelRequestLimit, value.elapsedMinutes, value.tokenLimit].some(Boolean) ? 'Custom limits' : 'Unlimited'}</small></span><motion.span animate={{ rotate: limitsOpen ? 180 : 0 }} transition={reduced ? instant : spatial.fast}><ChevronDown size={18}/></motion.span></button>
            <motion.div id={`${id}-limits`} className="task-budget-fields" initial={false} animate={{ height: limitsOpen ? 'auto' : 0, opacity: limitsOpen ? 1 : 0 }} transition={reduced ? instant : expressive.panel} inert={!limitsOpen}><div className="task-option-grid">{field('modelRequestLimit', 'Model request limit', 0, 100000, true)}{field('elapsedMinutes', 'Active minutes limit', 0, 10080, true)}{field('tokenLimit', 'Reported token limit', 0, 1000000000, true)}</div><p className="task-option-hint">Leave blank for no limit. Reported token limits stop later requests; responses in flight can exceed them.</p></motion.div>
          </section>
        </>}
        {error && <p className="error-inline" role="alert">{error}</p>}
      </div>
      <footer>{canStop && <button type="button" className="text-button task-stop" disabled={busy || stopping} title="Stop task (Ctrl+Shift+.)" onClick={onStop}><Square size={14}/>Stop task</button>}<span className="task-options-footer-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{worker ? 'Close' : 'Cancel'}</button>{!worker && <ExpressiveButton type="submit" className="primary-button" disabled={busy || !applied} aria-busy={busy}>{busy ? 'Applying…' : 'Apply'}</ExpressiveButton>}</span></footer>
    </form>
  </motion.dialog>
}
