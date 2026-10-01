import { Monitor, Activity, BarChart3, BookOpen, Brain, Clock3, Code2, File, Folder, GitBranch, GitPullRequest, Globe2, ListTodo, MessageCircle, Plus, Search, Settings2, SlidersHorizontal, TerminalSquare, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { BrandMark } from './BrandMark'
import { spatial } from './motion'
import { ExpressiveButton } from './ExpressiveButton'

export type View = 'computer' | 'fieldnotes' | 'control' | 'memory' | 'browser' | 'documents' | 'hooks' | 'context' | 'connections' | 'diagnostics' | 'workflow' | 'review' | 'projects' | 'chat' | 'sessions' | 'files' | 'skills' | 'usage' | 'github' | 'settings' | 'terminal'
export const navigation: { id: View; label: string; icon: typeof Folder; group: string }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle, group: 'Workspace' },
  { id: 'sessions', label: 'Sessions', icon: Clock3, group: 'Workspace' },
  { id: 'files', label: 'Files', icon: File, group: 'Workspace' },
  { id: 'review', label: 'Review', icon: GitBranch, group: 'Workspace' },
  { id: 'workflow', label: 'Workflow', icon: ListTodo, group: 'Workspace' },
  { id: 'control', label: 'Task controls', icon: SlidersHorizontal, group: 'Workspace' },
  { id: 'computer', label: 'Computer', icon: Monitor, group: 'Tools & knowledge' },
  { id: 'browser', label: 'Browser', icon: Globe2, group: 'Tools & knowledge' },
  { id: 'documents', label: 'Documents', icon: BookOpen, group: 'Tools & knowledge' },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare, group: 'Tools & knowledge' },
  { id: 'github', label: 'GitHub', icon: GitPullRequest, group: 'Tools & knowledge' },
  { id: 'context', label: 'Context', icon: BookOpen, group: 'Tools & knowledge' },
  { id: 'skills', label: 'Abilities', icon: Code2, group: 'Tools & knowledge' },
  { id: 'fieldnotes', label: 'Fieldnotes', icon: File, group: 'Tools & knowledge' },
  { id: 'memory', label: 'Memory', icon: Brain, group: 'Tools & knowledge' },
  { id: 'hooks', label: 'Hooks', icon: Zap, group: 'Tools & knowledge' },
  { id: 'projects', label: 'Projects', icon: Folder, group: 'Manage' },
  { id: 'usage', label: 'Usage', icon: BarChart3, group: 'Manage' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity, group: 'Manage' },
  { id: 'settings', label: 'Settings', icon: Settings2, group: 'Manage' }
]

export function WorkspaceNavigation({ view, onNavigate, onNew, onCommands, ready, busy, project, version }: {
  view: View; onNavigate(view: View): void; onNew(): void; onCommands(): void; ready: boolean; busy: boolean; project: string; version: string
}) {
  const reduced = useReducedMotion()
  return <aside className="nav-rail" aria-label="Workspace navigation">
    <div className="brand"><BrandMark/><div><strong>UnrealCode</strong><small>DESKTOP</small></div></div>
    <div className="nav-actions">
      <ExpressiveButton className="new-task-button" aria-label="New session" title="New session" disabled={!ready || busy} onClick={onNew}><Plus size={20}/><span>New session</span></ExpressiveButton>
      <button className="nav-search" title="Commands (Ctrl+K)" aria-label="Commands" onClick={onCommands}><Search size={16}/><span>Find anything</span><kbd>Ctrl K</kbd></button>
    </div>
    <nav aria-label="Main navigation">{['Workspace', 'Tools & knowledge', 'Manage'].map(group => <section className="nav-group" key={group} aria-label={group}>
      <h2>{group}</h2>
      {navigation.filter(item => item.group === group).map(({ id, label, icon: Icon }) => { const selected = view === id || (id === 'skills' && view === 'connections'); return <button className={`nav-item ${selected ? 'active' : ''}`} key={id} aria-label={label} aria-current={selected ? 'page' : undefined} title={label} onClick={() => onNavigate(id)}>
        {selected && (reduced ? <span className="active-nav-bg"/> : <motion.span layoutId="active-nav" className="active-nav-bg" transition={spatial.fast}/>)}
        <Icon size={19}/><span className="nav-label"><span className="full-nav-label">{label}</span><span className="compact-nav-label">{({ control: 'Controls', connections: 'Connect', diagnostics: 'Diagnose' } as Partial<Record<View, string>>)[id] || label}</span></span>
      </button>})}
    </section>)}</nav>
    <div className="rail-bottom"><small title={project}>{project}</small><small>v{version}</small></div>
  </aside>
}
