import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Settings } from '../shared/api'
import { motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { effects, expressive, instant } from './motion'

export function useTheme(theme: Settings['theme'] | undefined): void {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => { document.documentElement.dataset.theme = theme === 'system' || !theme ? (media.matches ? 'dark' : 'light') : theme }
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [theme])
}

export function ResizeHandle({ label, value, min, max, reverse = false, onChange }: { label: string; value: number; min: number; max: number; reverse?: boolean; onChange: (value: number) => void }): ReactNode {
  const current = useRef(value)
  current.current = value
  const measured = (element: HTMLElement): number => Math.round((reverse ? element.parentElement : element.previousElementSibling)?.getBoundingClientRect().width || value)
  return <div className="panel-resizer" role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(Math.max(min, Math.min(max, measured(event.currentTarget) + (event.key === 'ArrowRight' ? 10 : -10) * (reverse ? -1 : 1)))) } }}
    onPointerDown={(event) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.dataset.origin = String(event.clientX)
      event.currentTarget.dataset.width = String(measured(event.currentTarget))
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const delta = (event.clientX - Number(event.currentTarget.dataset.origin)) * (reverse ? -1 : 1)
      onChange(Math.max(min, Math.min(max, Number(event.currentTarget.dataset.width) + delta)))
    }}/>
}

export type Command = { id: string; label: string; shortcut?: string; run: () => void }
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }): ReactNode {
  const reduced = useReducedMotion()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const matches = commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => previous?.focus()
  }, [])
  const execute = (command: Command): void => { onClose(); command.run() }
  return <motion.div className="palette-overlay" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={reduced ? instant : effects.fast} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <motion.div role="dialog" aria-modal="true" aria-label="Command palette" className="command-palette" initial={reduced ? false : { y: -18, scale: .97 }} animate={{ y: 0, scale: 1 }} transition={reduced ? instant : expressive.dialog} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') { event.preventDefault(); input.current?.focus() }
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, matches.length - 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)) }
      if (event.key === 'Enter' && matches[selected]) { event.preventDefault(); execute(matches[selected]) }
    }}>
      <input ref={input} aria-label="Search commands" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0) }} placeholder="Search commands…"/>
      <div className="command-results">{matches.map((command, index) => <button key={command.id} className={index === selected ? 'selected' : ''} onMouseEnter={() => setSelected(index)} onClick={() => execute(command)}><span>{command.label}</span><kbd>{command.shortcut}</kbd></button>)}{!matches.length && <p>No matching commands.</p>}</div>
      <small>↑ ↓ to choose · Enter to run · Esc to close</small>
    </motion.div>
  </motion.div>
}
