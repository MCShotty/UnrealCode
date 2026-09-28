import type { KeyboardEvent } from 'react'

export const settingsTabs = [
  { id: 'provider', label: 'Provider' },
  { id: 'memory', label: 'Memory' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'agent', label: 'Agent' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'usage', label: 'Usage' },
  { id: 'recovery', label: 'Recovery' }
] as const
export type SettingsTab = typeof settingsTabs[number]['id']
export function isSettingsTab(value: unknown): value is SettingsTab {
  return settingsTabs.some(tab => tab.id === value)
}

export function SettingsNavigation({ value, onChange }: { value: SettingsTab; onChange(tab: SettingsTab): void }) {
  const move = (event: KeyboardEvent<HTMLElement>) => {
    const origin = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]')
    if (!origin || !event.currentTarget.contains(origin)) return
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const index = tabs.indexOf(origin)
    if (index < 0) return
    const backwards = getComputedStyle(event.currentTarget).direction === 'rtl'
    let next = index
    if (event.key === 'ArrowRight') next = (index + (backwards ? -1 : 1) + tabs.length) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + (backwards ? 1 : -1) + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    tabs[next].focus()
    onChange(settingsTabs[next].id)
  }
  return <nav className="settings-navigation" role="tablist" aria-label="Settings sections" aria-orientation="horizontal" onKeyDown={move}>
    {settingsTabs.map(tab => <button key={tab.id} id={'settings-tab-' + tab.id} type="button" role="tab" aria-selected={value === tab.id} aria-controls={'settings-panel-' + tab.id} tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>{tab.label}</button>)}
  </nav>
}
