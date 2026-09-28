import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import { motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { expressive, instant, spatial } from './motion'
import type { Provider, Settings } from '../shared/api'

const providers: [Provider, string][] = [['openai-codex', 'Codex subscription'], ['openai', 'OpenAI API'], ['anthropic', 'Claude API'], ['ollama', 'Ollama'], ['openai-compatible', 'Local compatible'], ['openrouter', 'OpenRouter'], ['fireworks', 'Fireworks']]
export function ModelPicker({ settings, onSave, onModel }: { settings: Settings; onSave(value: Partial<Settings>): Promise<void>; onModel(value: string): void }) {
  const root = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && root.current) root.current.open = false }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  return <details ref={root} className="model-picker" onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={event => { if (event.key === 'Escape' && root.current?.open) { root.current.open = false; root.current.querySelector('summary')?.focus(); event.stopPropagation() } }}>
    <summary aria-label="Model for next session"><Cpu size={17}/><span>{settings.model || providers.find(([id]) => id === settings.provider)?.[1]}</span><motion.span className="disclosure-chevron" animate={{ rotate: open ? 180 : 0 }} transition={reduced ? instant : spatial.fast}><ChevronDown size={14}/></motion.span></summary>
    <motion.div className="model-picker-panel" initial={false} animate={open ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: reduced ? 0 : -8, scale: reduced ? 1 : .97 }} transition={reduced ? instant : expressive.panel}><h2>Next session</h2><p>Existing sessions keep their current provider and model.</p>
      <label>Provider<select value={settings.provider} onChange={event => void onSave({ provider: event.target.value as Provider, model: '' })}>{providers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Model<input value={settings.model} onChange={event => onModel(event.target.value)} onBlur={() => void onSave({ model: settings.model })} placeholder="Model ID"/></label>
    </motion.div>
  </details>
}
