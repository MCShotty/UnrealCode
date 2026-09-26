import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Check, ChevronDown, ChevronRight,
  CircleAlert, CircleCheck, Clock3, Code2, File, FileText, Folder, FolderOpen,
  GitBranch, GitPullRequest, KeyRound, MessageCircle, MoreHorizontal, Plus, Radio, Search,
  Send, Settings2, ShieldCheck, Square, TerminalSquare, Trash2, WandSparkles,
  X, Zap
} from 'lucide-react'
import type { AgentEvent, BridgeSessionConfig, DockerStatus, FileEntry, Provider, SessionInfo, Settings, SkillEntry } from '../shared/api'
import { GitHubPage } from './GitHubPage'
import { WorkflowPage } from './WorkflowPage'
import { DiagnosticsPage } from './DiagnosticsPage'
import { ReviewWorkspace } from './ReviewWorkspace'
import { UsageDashboard } from './UsageDashboard'
import { ExecutionInspector } from './ExecutionInspector'
import { ExecutionControls } from './ExecutionControls'
import { EditorWorkspace } from './EditorWorkspace'
import { hasDirtyEditors } from './editor-buffers'
import { TaskWorkspaceReview } from './TaskWorkspaceReview'
import { CommandPalette, ResizeHandle, useTheme } from './DesktopControls'

declare global { interface Window { unreal: import('../shared/api').DesktopAPI } }
const api = window.unreal
type View = 'diagnostics' | 'workflow' | 'review' | 'projects' | 'chat' | 'sessions' | 'files' | 'skills' | 'usage' | 'github' | 'settings' | 'terminal'
const spatial = { fast: { type: 'spring' as const, stiffness: 600, damping: 42 }, default: { type: 'spring' as const, stiffness: 390, damping: 36 }, slow: { type: 'spring' as const, stiffness: 250, damping: 32 } }
const navigation: { id: View; label: string; icon: typeof Folder }[] = [
  { id: 'projects', label: 'Projects', icon: Folder }, { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'workflow', label: 'Workflow', icon: Activity }, { id: 'review', label: 'Review', icon: GitBranch }, { id: 'sessions', label: 'Sessions', icon: Clock3 }, { id: 'files', label: 'Files', icon: File },
  { id: 'skills', label: 'Skills', icon: Zap }, { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'diagnostics', label: 'Diagnostics', icon: Radio },
  { id: 'github', label: 'GitHub', icon: GitPullRequest },
  { id: 'settings', label: 'Settings', icon: Settings2 }, { id: 'terminal', label: 'Terminal', icon: TerminalSquare }
]

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function field(value: unknown, ...names: string[]): unknown { const target = record(value); for (const name of names) if (name in target) return target[name]; return undefined }
function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function decisionAnswer(value: unknown): string {
  const answer = record(value)
  if (answer.type === 'choice') return `${string(answer.choice) || 'unknown'}${typeof answer.confidence === 'number' ? ` (${Math.round(answer.confidence * 100)}% confidence)` : ''}`
  if (answer.type === 'noul') return `${Math.round(Number(answer.noul || 0) * 100)}% yes`
  if (answer.type === 'score') return `${String(answer.score ?? 'unknown')}${typeof answer.confidence === 'number' ? ` (${Math.round(answer.confidence * 100)}% confidence)` : ''}`
  return JSON.stringify(answer)
}
function formatTime(value: unknown): string {
  const date = new Date(string(value))
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function asMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return string(field(value, 'prompt', 'Text', 'text'))
  return ''
}
function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  const known = new Set(current.map((item) => item.seq))
  return [...current, ...incoming.filter((item) => !known.has(item.seq))].sort((a, b) => a.seq - b.seq).slice(-3000)
}
async function loadEvents(sessionId: string, maxEvents = 3000): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = []
  let after = 0
  while (collected.length < maxEvents) {
    const page = await api.getEvents(sessionId, after)
    if (!page.length) break
    collected.push(...page)
    const latest = page.at(-1)!.seq
    if (latest <= after) break
    after = latest
    if (page.length < 1000) break
  }
  return collected.slice(-maxEvents)
}

type ParsedEntry = { id: string; kind: 'user' | 'assistant' | 'tool' | 'decision' | 'status' | 'question'; seq?: number; text: string; title: string; timestamp: string; status?: string; raw?: unknown }
function parseEvents(events: AgentEvent[]): ParsedEntry[] {
  const result: ParsedEntry[] = []
  const tools = new Map<string, ParsedEntry>()
  const operationCalls = new Map<string, string>()
  let sequence = 0
  const toolEntry = (key: string, update: Partial<ParsedEntry>): void => {
    update.seq = sequence
    const existing = tools.get(key)
    if (existing) { Object.assign(existing, update); return }
    const created: ParsedEntry = { id: key, kind: 'tool', title: update.title || 'Tool call', text: update.text || '', timestamp: update.timestamp || '', status: update.status, raw: update.raw, seq: sequence }
    tools.set(key, created)
    result.push(created)
  }
  for (const event of events) {
    sequence = event.seq
    if (event.event === 'session.needs_input') {
      result.push({ id: `${event.seq}:question`, kind: 'question', title: 'Your input is needed', text: string(field(event.payload, 'question')), timestamp: formatTime(event.recordedAt), raw: event.payload })
      continue
    }
    if (event.event === 'decision.result') {
      const payload = record(event.payload)
      const answers = record(payload.answers)
      const choices = Object.entries(answers).map(([name, answer]) => `${name}: ${decisionAnswer(answer)}`).join(' · ')
      result.push({ id: `${event.seq}:decision`, kind: 'decision', title: `${string(payload.engine).toUpperCase()} decision batch`, text: choices, timestamp: '', status: `${Number(payload.durationMs || 0)} ms`, raw: payload })
      continue
    }
    if (event.event === 'decision.error') {
      result.push({ id: `${event.seq}:decision-error`, kind: 'status', title: 'Decision engine unavailable', text: string(field(event.payload, 'message')), timestamp: '', status: 'error' })
      continue
    }
    if (event.event === 'session.status') {
      const state = string(field(event.payload, 'status'))
      if (state === 'error') result.push({ id: `${event.seq}:error`, kind: 'status', title: 'Agent error', text: string(field(event.payload, 'message')), timestamp: '', status: 'error' })
      continue
    }
    if (event.event === 'operation.update') {
      const operation = record(event.payload)
      const operationID = string(field(operation, 'ID', 'id'))
      const key = operationCalls.get(operationID) || `operation:${operationID}`
      toolEntry(key, { title: tools.get(key)?.title || string(field(operation, 'Type', 'type')) || 'Operation', text: tools.get(key)?.text || operationID, status: string(field(operation, 'Status', 'status')), raw: event.payload })
      continue
    }
    if (event.event !== 'session.item') continue
    const item = record(event.payload)
    const kind = string(field(item, 'Kind', 'kind'))
    const data = field(item, 'Data', 'data')
    const timestamp = formatTime(field(item, 'RecordedAt', 'recordedAt'))
    if (kind === 'input') {
      if (string(field(data, 'Kind', 'kind')) !== 'external') continue
      const payload = field(data, 'Payload', 'payload')
      const text = (typeof payload === 'string' ? payload : asMessage(payload)).split('<unrealcode_context>')[0].trimEnd()
      result.push({ id: `${event.seq}:input`, kind: 'user', title: 'You', text, timestamp })
    } else if (kind === 'model_response') {
      const response = field(data, 'Response', 'response')
      const outputs = field(response, 'Output', 'output')
      if (!Array.isArray(outputs)) continue
      for (let index = 0; index < outputs.length; index++) {
        const output = outputs[index]
        const outputType = string(field(output, 'Type', 'type'))
        const content = field(output, 'Data', 'data')
        if (outputType === 'message') {
          const text = asMessage(content)
          if (text) result.push({ id: `${event.seq}:message:${index}`, kind: 'assistant', title: 'UnrealCode', text, timestamp })
          if (string(field(content, 'Phase', 'phase')) === 'final_answer') for (const pending of tools.values()) {
            if (pending.status === 'running' || pending.status === 'started' || pending.status === 'awaiting') pending.status = 'completed'
          }
        } else if (outputType === 'tool_call') {
          const callID = string(field(content, 'CallID', 'callId')) || `${event.seq}:${index}`
          toolEntry(`call:${callID}`, { title: string(field(content, 'Name', 'name')) || 'Tool call', text: string(field(content, 'Arguments', 'arguments')), timestamp, status: 'started', raw: content })
        }
      }
    } else if (kind === 'tool_call_status') {
      const callID = string(field(data, 'CallID', 'callId'))
      const key = `call:${callID}`
      const status = field(data, 'Status', 'status')
      const operations = field(status, 'WaitingFor', 'waitingFor')
      if (Array.isArray(operations)) for (const operation of operations) {
        const operationID = typeof operation === 'string' ? operation : string(field(operation, 'ID', 'id'))
        if (operationID) operationCalls.set(operationID, key)
      }
      const hasError = !!string(field(status, 'Error', 'error'))
      toolEntry(key, { title: tools.get(key)?.title || 'Tool call', text: tools.get(key)?.text || callID, timestamp, status: hasError ? 'failed' : Array.isArray(operations) && operations.length > 0 ? 'running' : 'complete', raw: data })
    }
  }
  return result
}

function Brand(): ReactNode {
  return <div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><strong>UnrealCode</strong><small>DESKTOP</small></div></div>
}

function DecisionWelcome({ onChoose }: { onChoose: (engine: Settings['decisionEngine']) => Promise<void> }): ReactNode {
  return <div className="decision-onboarding"><div className="decision-onboarding-card"><Brand/><div className="eyebrow">FIRST-RUN SETUP</div><h1>Choose a decision engine</h1><p>UnrealCode can send small, typed questions to one engine across every project and chat. The main agent still handles planning, coding, and actions.</p><div className="engine-options"><button onClick={() => void onChoose('jev')}><WandSparkles size={21}/><strong>Jev</strong><small>TypeSafe cloud · requires a key and project consent</small></button><button onClick={() => void onChoose('laya')}><Zap size={21}/><strong>Laya</strong><small>Local worker · install on demand</small></button></div><button className="text-button" onClick={() => void onChoose('off')}>Set up later</button></div></div>
}

function EventCard({ entry, onAnswer }: { entry: ParsedEntry; onAnswer?: (answer: string) => void }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const reduceMotion = useReducedMotion()
  if (entry.kind === 'question') return <section className="input-question"><strong>{entry.title}</strong><p>{entry.text}</p>{Array.isArray(field(entry.raw, 'choices')) && (field(entry.raw, 'choices') as string[]).map((choice) => <button className="secondary-button" key={choice} onClick={() => onAnswer?.(choice)}>{choice}</button>)}</section>
  if (entry.kind === 'user') return <div className="chat-entry user-entry"><div className="avatar user-avatar">U</div><div className="entry-body"><div className="entry-heading"><strong>You</strong><time>{entry.timestamp}</time></div><div className="user-bubble">{entry.text}</div></div></div>
  if (entry.kind === 'assistant') return <div className="chat-entry"><div className="avatar agent-avatar"><div className="mini-mark">U</div></div><div className="entry-body"><div className="entry-heading"><strong>UnrealCode</strong><time>{entry.timestamp}</time></div><div className="markdown"><ReactMarkdown>{entry.text}</ReactMarkdown></div></div></div>
  if (entry.kind === 'status') return <div className="error-inline"><CircleAlert size={17}/><span>{entry.text}</span></div>
  return <motion.div layout={!reduceMotion} transition={reduceMotion ? { duration: 0 } : spatial.fast} className={`tool-card ${entry.kind === 'decision' ? 'decision-card' : ''}`}>
    <button className="tool-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className="tool-symbol">{entry.kind === 'decision' ? <WandSparkles size={17}/> : <Code2 size={17}/>}</span><span className="tool-copy"><strong>{entry.title}</strong><small>{entry.text || 'Agent operation'}</small></span>
      <span className={`tool-status ${entry.status || ''}`}>{entry.status === 'completed' || entry.status === 'complete' ? <CircleCheck size={16}/> : <Radio size={16}/>} {entry.status || 'event'}</span>
      {expanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
    </button>
    <AnimatePresence initial={false}>{expanded && <motion.pre initial={reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={reduceMotion ? undefined : { opacity: 0, height: 0 }} transition={reduceMotion ? { duration: 0 } : spatial.fast} className="tool-detail">{JSON.stringify(entry.raw ?? entry.text, null, 2)}</motion.pre>}</AnimatePresence>
  </motion.div>
}

function Welcome({ settings, busy, status, onOpen, onSettings }: { settings: Settings; busy: boolean; status: DockerStatus; onOpen: (path?: string) => void; onSettings: () => void }): ReactNode {
  return <div className="welcome"><div className="welcome-top"><Brand/><span className="welcome-caption">Local first. More control.</span></div>
    <div className="welcome-main"><div className="welcome-symbol"><div className="brand-mark"><span/><span/><span/></div></div>
      <h1>Open a workspace</h1><p>Choose a project for UnrealCode. You’ll confirm trust before its files are mounted in the local container.</p>
      <button className="primary-button large-button" onClick={() => onOpen()} disabled={busy}><FolderOpen size={18}/>{busy ? 'Preparing backend…' : 'Open project folder'}</button>
      <div className={`backend-note ${status.ready ? 'ready' : ''}`}><span className="status-dot"/>{status.message}</div>
      {settings.recentProjects.length > 0 && <div className="recent-projects"><h2>Recent projects</h2>{settings.recentProjects.map((path) => <button key={path} onClick={() => onOpen(path)} disabled={busy}><Folder size={17}/><span>{path}</span><ArrowRight size={16}/></button>)}</div>}
      <button className="text-button" onClick={onSettings}><Settings2 size={16}/> Provider settings</button>
    </div>
  </div>
}

function ChatPanel({ events, session, prompt, setPrompt, onSend, onStop, sending, settings, onSave }: { events: AgentEvent[]; session: SessionInfo | undefined; prompt: string; setPrompt: (value: string) => void; onSend: () => void; onStop: () => void; sending: boolean; settings: Settings; onSave: (patch: Partial<Settings>) => Promise<void> }): ReactNode {
  const parsed = useMemo(() => parseEvents(events), [events])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [projectFiles, setProjectFiles] = useState<FileEntry[]>([])
  useEffect(() => { if (mentionOpen) void api.listFiles('').then(setProjectFiles).catch(() => setProjectFiles([])) }, [mentionOpen])
  const bottom = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [unread, setUnread] = useState(false)
  useEffect(() => {
    if (following.current) bottom.current?.scrollIntoView({ block: 'end', behavior: 'instant' })
    else setUnread(true)
  }, [events])
  return <div className="chat-panel"><div className="chat-scroll" onScroll={(event) => {
    const element = event.currentTarget
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
    if (following.current) setUnread(false)
  }}>
    {parsed.length === 0 ? <div className="empty-chat"><div className="empty-orbit"><WandSparkles size={30}/></div><h2>Start with a task</h2><p>Ask UnrealCode to inspect, change, or explain something in this workspace. Tool activity appears here as it runs.</p></div> : parsed.map((entry) => <div key={entry.id} data-event-seq={entry.seq || Number(entry.id.split(':')[0])}><EventCard entry={entry} onAnswer={setPrompt}/></div>)}
    <div ref={bottom}/></div>
    {unread && <button className="jump-latest" onClick={() => { following.current = true; setUnread(false); bottom.current?.scrollIntoView({ block: 'end', behavior: 'instant' }) }}>Jump to latest</button>}
    <ExecutionControls sessionId={session?.id} settings={settings} onSave={onSave}/>
    <div className="composer"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend() } }} placeholder="Message UnrealCode…" rows={3} aria-label="Message UnrealCode"/>
      <div className="composer-bottom"><div className="composer-actions"><button className="secondary-button" onClick={() => { setMentionOpen(!mentionOpen); setToolsOpen(false) }} aria-expanded={mentionOpen}>@ Files</button><button className="secondary-button" onClick={() => { setToolsOpen(!toolsOpen); setMentionOpen(false) }} aria-expanded={toolsOpen}>Tools <ChevronDown size={14}/></button><span>Enter to send · Shift+Enter for a new line</span></div><div><button className="secondary-button" onClick={onStop} disabled={!session || sending}><Square size={13}/> Stop</button><button className="primary-button" onClick={onSend} disabled={sending || !prompt.trim()}><Send size={15}/> {sending ? 'Sending' : 'Send'}</button></div></div>
      {attachmentError && <p role="alert" className="error-text">{attachmentError}</p>}{mentionOpen && <div className="composer-popover"><strong>Reference a project file</strong>{projectFiles.filter((file) => !file.directory).slice(0, 20).map((file) => <button key={file.path} onClick={() => { void api.contextView(session?.id || 'draft').then((view) => api.updateContext(session?.id || 'draft', { attached: [...new Set([...view.selection.attached, file.path])] })).then(() => setAttachmentError('')).catch((error) => setAttachmentError(String(error))); setPrompt(`${prompt}${prompt && !prompt.endsWith(' ') ? ' ' : ''}@${file.path} `); setMentionOpen(false) }}><FileText size={14}/>{file.path}</button>)}</div>}
      {toolsOpen && <div className="composer-popover"><strong>Tools for new sessions</strong>{['Bash','ViewImage','DecisionBatch','EntityExtract','SkillUse'].map((tool) => <label className="check-row" key={tool}><input type="checkbox" checked={!settings.disallowedTools.includes(tool)} onChange={(event) => void onSave({ disallowedTools: event.target.checked ? settings.disallowedTools.filter((value) => value !== tool) : [...settings.disallowedTools, tool] })}/>{tool}</label>)}</div>}
    </div>
  </div>
}

function ContextPanel({ changes, events, projectPath, status, decisionEngine, sessionId }: { changes: string[]; events: AgentEvent[]; projectPath: string; status: DockerStatus; decisionEngine: Settings['decisionEngine']; sessionId?: string }): ReactNode {
  const activity = useMemo(() => parseEvents(events).filter((item) => item.kind !== 'user').slice(-6).reverse(), [events])
  const [diffPath, setDiffPath] = useState('')
  const [diff, setDiff] = useState('')
  const showDiff = async (path: string): Promise<void> => { setDiffPath(path); try { setDiff(await api.gitDiff(path)) } catch (reason) { setDiff(String(reason)) } }
  return <aside className="context-panel"><div className="context-status"><span className={`status-dot ${status.ready ? 'on' : ''}`}/><div><strong>{status.ready ? 'Container Running' : 'Container Offline'}</strong><small>UnrealCode · local workspace</small></div><ChevronDown size={16}/></div>
    <section className="context-card"><div className="section-heading"><h3>Workspace changes</h3><span className="count-pill">{changes.length}</span></div>{changes.length ? changes.slice(0, 7).map((line) => <button className="change-row" key={line} onClick={() => void showDiff(line.slice(3))}><FileText size={15}/><span>{line.slice(3)}</span><small>{line.slice(0, 2)}</small></button>) : <p className="muted-copy">No Git changes found.</p>}</section>
    <ExecutionInspector sessionId={sessionId} eventSequence={events.at(-1)?.seq || 0}/>
    <section className="context-card timeline-card"><div className="section-heading"><h3>Activity timeline</h3></div>{activity.length ? activity.map((entry) => <div className="timeline-row" key={entry.id}><span className="timeline-dot"/><div><strong>{entry.kind === 'assistant' ? 'Agent response' : entry.title}</strong><small>{entry.text.slice(0, 68)}</small></div><time>{entry.timestamp}</time></div>) : <p className="muted-copy">Agent activity will appear here.</p>}</section>
    <section className="context-card context-bottom"><div className="section-heading"><h3>Current context</h3></div><div className="context-fact"><Folder size={15}/> <span>Project</span><strong>{projectPath.split(/[\\/]/).at(-1)}</strong></div><div className="context-fact"><GitBranch size={15}/> <span>Workspace</span><strong>Local</strong></div><div className="context-fact"><ShieldCheck size={15}/> <span>Container</span><strong>{status.ready ? 'Running' : 'Offline'}</strong></div><div className="context-fact"><WandSparkles size={15}/> <span>Decision engine</span><strong>{decisionEngine === 'off' ? 'Off' : decisionEngine === 'jev' ? 'Jev' : 'Laya'}</strong></div></section>
    {diffPath && <div className="diff-overlay"><div><strong>{diffPath}</strong><button className="icon-button" onClick={() => setDiffPath('')} aria-label="Close diff"><X size={17}/></button></div><pre>{diff || 'No text diff available.'}</pre></div>}
  </aside>
}

function FileBrowser(): ReactNode {
  const [mode, setMode] = useState<'explorer' | 'changes'>('explorer')
  const [folder, setFolder] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [changes, setChanges] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { void api.listFiles(folder).then(setEntries).catch((reason) => setError(String(reason))) }, [folder])
  useEffect(() => { void api.gitChanges().then(setChanges).catch((reason) => setError(String(reason))) }, [])
  const open = async (entry: FileEntry): Promise<void> => {
    if (entry.directory) { setFolder(entry.path); setSelected(''); setContent(''); return }
    setSelected(entry.path)
    try { setContent(await api.readFile(entry.path)); setError('') } catch (reason) { setContent(''); setError(String(reason)) }
  }
  const openChange = async (line: string): Promise<void> => {
    const path = line.slice(3)
    setSelected(path)
    try { setContent(await api.gitDiff(path)); setError('') } catch (reason) { setContent(''); setError(String(reason)) }
  }
  return <div className="page-content files-page">
    <div className="page-heading"><div><h1>Files</h1><p>Browse project files and inspect Git changes.</p></div><div className="segmented"><button className={mode === 'explorer' ? 'selected' : ''} onClick={() => { setMode('explorer'); setSelected(''); setContent('') }}>Explorer</button><button className={mode === 'changes' ? 'selected' : ''} onClick={() => { setMode('changes'); setSelected(''); setContent('') }}>Changes <span>{changes.length}</span></button></div></div>
    <div className="file-layout"><div className="file-list">
      {mode === 'explorer' ? <><div className="file-breadcrumb"><button onClick={() => setFolder('')}><Folder size={15}/> Project</button>{folder && <><ChevronRight size={14}/><span>{folder}</span></>}</div>{folder && <button className="file-row" onClick={() => setFolder(folder.split('/').slice(0,-1).join('/'))}><ArrowLeft size={16}/> ..</button>}{entries.map((entry) => <button className={`file-row ${selected === entry.path ? 'selected' : ''}`} key={entry.path} onClick={() => void open(entry)}>{entry.directory ? <Folder size={17}/> : <FileText size={17}/>}<span>{entry.name}</span>{entry.directory && <ChevronRight size={15}/>}</button>)}</> : <>{changes.map((line) => <button className={`file-row ${selected === line.slice(3) ? 'selected' : ''}`} key={line} onClick={() => void openChange(line)}><GitBranch size={17}/><span>{line.slice(3)}</span><small>{line.slice(0,2)}</small></button>)}{changes.length === 0 && <p className="muted-copy pad">No Git changes found.</p>}</>}
    </div><div className="file-preview"><div className="preview-title">{selected || (mode === 'changes' ? 'Select a changed path' : 'Select a file')}</div>{error ? <p className="error-inline">{error}</p> : <pre>{content || (mode === 'changes' ? 'Select a path to inspect its Git diff.' : 'Choose a text file to preview its contents.')}</pre>}</div></div>
  </div>
}

function SkillsPage(): ReactNode {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const reload = useCallback(() => { void api.listSkills().then(setSkills).catch((reason) => setError(String(reason))) }, [])
  useEffect(reload, [reload])
  const create = (): void => { setName('new-skill'); setContent('---\nname: new-skill\ndescription: Describe what this skill does.\n---\n\n# New skill\n\nWrite instructions here.\n'); setNotice('') }
  const save = async (): Promise<void> => { try { await api.saveSkill(name, content); setError(''); setNotice('Saved. Start or resume a session to load the updated skill.'); reload() } catch (reason) { setError(String(reason)) } }
  const remove = async (): Promise<void> => { if (!window.confirm(`Disable skill ${name}? Its supporting files will remain.`)) return; try { await api.deleteSkill(name); setName(''); setContent(''); reload() } catch (reason) { setError(String(reason)) } }
  return <div className="page-content skills-page"><div className="page-heading"><div><h1>Skills</h1><p>Manage reusable UnrealCode instructions from .harness/skills.</p></div><button className="primary-button" onClick={create}><Plus size={16}/> New skill</button></div><div className="skill-layout"><div className="skill-list">{skills.map((skill) => <button key={skill.name} className={`skill-row ${name === skill.name ? 'selected' : ''}`} onClick={() => { setName(skill.name); setContent(skill.content); setNotice('') }}><Zap size={17}/><span><strong>{skill.name}</strong><small>{skill.description}</small></span></button>)}{skills.length === 0 && <p className="muted-copy pad">No project skills yet.</p>}</div><div className="skill-editor">{name ? <><div className="editor-toolbar"><strong>{name}/SKILL.md</strong><div><button className="icon-button" title="Disable skill" onClick={() => void remove()}><Trash2 size={16}/></button><button className="primary-button" onClick={() => void save()}><Check size={15}/> Save</button></div></div><textarea spellCheck={false} value={content} onChange={(event) => setContent(event.target.value)} aria-label="Skill content"/>{notice && <p className="success-text">{notice}</p>}</> : <div className="editor-empty">Select a skill or create one.</div>}{error && <p className="error-inline">{error}</p>}</div></div></div>
}

function SettingsPage({ settings, onSave, projectPath }: { settings: Settings; onSave: (value: Partial<Settings>) => Promise<void>; projectPath?: string }): ReactNode {
  const [draft, setDraft] = useState(settings)
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [codex, setCodex] = useState<{ available: boolean; message: string } | null>(null)
  const [keySaved, setKeySaved] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [decisionStatus, setDecisionStatus] = useState<Awaited<ReturnType<typeof api.decisionStatus>> | null>(null)
  const [installing, setInstalling] = useState(false)
  const [sample, setSample] = useState('')
  const [sampleResult, setSampleResult] = useState('')
  useEffect(() => { setDraft(settings); void api.codexStatus().then(setCodex); void api.hasKey(settings.provider).then(setKeySaved); if (projectPath) void api.decisionStatus().then(setDecisionStatus).catch((reason) => setError(String(reason))) }, [settings, projectPath])
  const save = async (): Promise<void> => { try { await onSave({ ...draft, decisionSetupSeen: true }); if (key && ['openai','anthropic','openrouter','fireworks','openai-compatible'].includes(draft.provider)) { await api.saveKey(draft.provider, key); setKey(''); setKeySaved(true) } setSaved(true); setError(''); if (projectPath) setDecisionStatus(await api.decisionStatus()) } catch (reason) { setError(String(reason)) } }
  const isKeyProvider = ['openai','anthropic','openrouter','fireworks','openai-compatible'].includes(draft.provider)
  const discover = async (): Promise<void> => { try { setModels(await api.discoverModels(draft.provider, draft.baseUrl)); setError('') } catch (reason) { setError(String(reason)) } }
  const install = async (engine: 'laya' | 'gliner'): Promise<void> => { setInstalling(true); try { await api.decisionInstall(engine); setDecisionStatus(await api.decisionStatus()); setError('') } catch (reason) { setError(String(reason)) } finally { setInstalling(false) } }
  const evaluate = async (): Promise<void> => { try { const result = await api.evaluateDecision({ state: { text: sample }, sourceRefs: ['settings-sample'], questions: { task: { type: 'choice', instructions: 'Which task type best fits text?', criteria: { implementation: 'write or change code', investigation: 'find or diagnose a problem', explanation: 'answer a question', other: 'none of these' } }, sensitive: { type: 'noul', instructions: 'Does text discuss a secret or authentication?' } } }); setSampleResult(JSON.stringify(result, null, 2)); setError('') } catch (reason) { setError(String(reason)) } }
  const instructions = projectPath ? draft.projectInstructions?.[projectPath] || '' : draft.systemPrompt
  return <div className="page-content settings-page"><div className="page-heading"><div><h1>Settings</h1><p>Configure the next agent session. Credentials stay in the desktop process.</p></div><button className="primary-button" onClick={() => void save()}><Check size={16}/> Save settings</button></div>
    <div className="settings-grid"><section className="settings-section"><h2>Model provider</h2><label>Provider<select value={draft.provider} onChange={(event) => { setDraft({ ...draft, provider: event.target.value as Provider, model: '' }); setModels([]); setSaved(false); void api.hasKey(event.target.value).then(setKeySaved) }}><option value="openai-codex">Codex subscription</option><option value="openai">OpenAI API</option><option value="anthropic">Claude API</option><option value="openrouter">OpenRouter</option><option value="fireworks">Fireworks</option><option value="ollama">Local Ollama</option><option value="openai-compatible">Local OpenAI compatible</option></select></label>
      <label>Model ID<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder={draft.provider === 'anthropic' ? 'claude-sonnet-5' : 'Provider model ID'} list="available-models"/><datalist id="available-models">{models.map((model) => <option key={model} value={model}/>)}</datalist></label><label>Reasoning level<select value={draft.thinkingLevel} onChange={(event) => setDraft({ ...draft, thinkingLevel: event.target.value as Settings['thinkingLevel'] })}>{['low','medium','high','xhigh','max'].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
      {(draft.provider === 'ollama' || draft.provider === 'openai-compatible') && <><label>Local server URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="http://localhost:11434/v1"/></label><button className="secondary-button" onClick={() => void discover()}>Discover models</button>{models.length > 0 && <p>{models.length} model{models.length === 1 ? '' : 's'} available</p>}</>}
    </section><section className="settings-section"><h2>Credentials</h2>{isKeyProvider ? <><p>Enter a {draft.provider} key. It is encrypted by Windows when available, and sent to the container only in memory.</p><label>API key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={keySaved ? 'Saved key available' : draft.provider === 'openai-compatible' ? 'Optional for local server' : 'No key saved'} autoComplete="off"/></label></> : draft.provider === 'openai-codex' ? <p className={codex?.available ? 'success-text' : 'muted-copy'}><KeyRound size={16}/> {codex?.message || 'Checking existing Codex login…'}</p> : <p>Ollama runs locally. No API key is needed.</p>}</section>
      <AdminKeySettings/>
      <section className="settings-section wide-section decision-settings"><h2>Decision model</h2><p>One engine for all projects and chats. A selected engine receives bounded Choice, Noul, and Score questions. UnrealCode keeps planning, coding, permissions, and Git actions.</p><label>Global engine<select value={draft.decisionEngine} onChange={(event) => setDraft({ ...draft, decisionEngine: event.target.value as Settings['decisionEngine'] })}><option value="off">Disabled</option><option value="jev">Jev · TypeSafe cloud</option><option value="laya">Laya · local worker</option></select></label>{draft.decisionEngine === 'jev' && <><label>Jev model<input value={draft.decisionModel} onChange={(event) => setDraft({ ...draft, decisionModel: event.target.value })} placeholder="jev-latest"/></label><p>Reads TYPESAFE_API_KEY from Windows. Project text is sent only after you grant that project's cloud consent.</p>{projectPath && !settings.decisionCloudProjects.includes(projectPath) && <button className="secondary-button" onClick={() => void api.decisionConsent().then(async () => { setDecisionStatus(await api.decisionStatus()); setDraft(await api.getSettings()) })}>Allow TypeSafe for this project</button>}</>}{draft.decisionEngine === 'laya' && <button className="secondary-button" disabled={installing} onClick={() => void install('laya')}>{installing ? 'Installing…' : 'Install local Laya worker'}</button>}{decisionStatus && <p className={decisionStatus.available ? 'success-text' : 'muted-copy'}>{decisionStatus.message}</p>}<label className="check-row"><input type="checkbox" checked={draft.glinerEnabled} onChange={(event) => setDraft({ ...draft, glinerEnabled: event.target.checked })}/><span>Enable GLiNER entity extraction separately</span></label>{draft.glinerEnabled && <button className="secondary-button" disabled={installing} onClick={() => void install('gliner')}>{installing ? 'Installing…' : decisionStatus?.glinerAvailable ? 'Reinstall GLiNER' : 'Install GLiNER'}</button>}{projectPath && draft.decisionEngine !== 'off' && <div className="decision-sample"><label>Try a bounded decision<input value={sample} onChange={(event) => setSample(event.target.value)} placeholder="Short sample text"/></label><button className="secondary-button" disabled={!sample.trim()} onClick={() => void evaluate()}>Evaluate</button>{sampleResult && <pre>{sampleResult}</pre>}</div>}</section>
      <section className="settings-section wide-section"><h2>{projectPath ? 'Project instructions' : 'Default agent instructions'}</h2><p>Applied as the system prompt when a new session starts.</p><textarea value={instructions} onChange={(event) => setDraft(projectPath ? { ...draft, projectInstructions: { ...draft.projectInstructions, [projectPath]: event.target.value } } : { ...draft, systemPrompt: event.target.value })} placeholder="Optional instructions for this workspace" rows={6}/></section>
      <section className="settings-section"><h2>Tools</h2>{['Bash','ViewImage','SkillUse','DecisionBatch','EntityExtract'].map((tool) => <label className="check-row" key={tool}><input type="checkbox" checked={!draft.disallowedTools.includes(tool)} onChange={(event) => setDraft({ ...draft, disallowedTools: event.target.checked ? draft.disallowedTools.filter((value) => value !== tool) : [...draft.disallowedTools, tool] })}/><span>{tool}</span></label>)}</section>
      <section className="settings-section"><h2>Appearance</h2><label className="check-row"><input type="checkbox" checked={draft.notifications} onChange={(event) => setDraft({ ...draft, notifications: event.target.checked })}/> Windows notifications for completion, failures, and required input</label><label>Theme<select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Settings['theme'] })}><option value="system">Follow Windows</option><option value="dark">Dark</option><option value="light">Light</option></select></label><p>Animations follow your system’s reduced-motion preference.</p></section>
    </div>{saved && <p className="success-text notice"><Check size={16}/> Settings saved</p>}{error && <p className="error-inline notice">{error}</p>}</div>
}

function AdminKeySettings(): ReactNode {
  const [keys, setKeys] = useState({ openai: '', anthropic: '' })
  const [available, setAvailable] = useState({ openai: false, anthropic: false })
  const [notice, setNotice] = useState('')
  useEffect(() => { void Promise.all([api.hasAdminKey('openai'), api.hasAdminKey('anthropic')]).then(([openai, anthropic]) => setAvailable({ openai, anthropic })) }, [])
  const save = async (provider: 'openai' | 'anthropic'): Promise<void> => {
    try { await api.saveAdminKey(provider, keys[provider]); setKeys((current) => ({ ...current, [provider]: '' })); setAvailable((current) => ({ ...current, [provider]: true })); setNotice(`${provider} admin key saved. Open Usage to verify access.`) }
    catch (reason) { setNotice(String(reason)) }
  }
  const remove = async (provider: 'openai' | 'anthropic'): Promise<void> => {
    try { await api.clearAdminKey(provider); setAvailable((current) => ({ ...current, [provider]: false })); setNotice(`${provider} admin key removed`) }
    catch (reason) { setNotice(String(reason)) }
  }
  return <section className="settings-section wide-section"><h2>Account usage reports</h2><p>Optional organization admin keys read account-wide token usage. They stay in the desktop process and are never sent to the agent container. Model API keys cannot replace admin keys.</p>
    {(['openai', 'anthropic'] as const).map((provider) => <div className="admin-key-row" key={provider}><label>{provider === 'openai' ? 'OpenAI' : 'Anthropic'} admin key<input type="password" autoComplete="off" value={keys[provider]} placeholder={available[provider] ? 'Connected' : 'Optional admin key'} onChange={(event) => setKeys((current) => ({ ...current, [provider]: event.target.value }))}/></label><button className="secondary-button" disabled={!keys[provider].trim()} onClick={() => void save(provider)}>Connect</button>{available[provider] && <button className="text-button" onClick={() => void remove(provider)}>Disconnect</button>}</div>)}
    {notice && <p className="muted-copy">{notice}</p>}
  </section>
}

function TerminalView(): ReactNode {
  const node = useRef<HTMLDivElement>(null)
  const terminalId = useRef<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    let terminal: import('@xterm/xterm').Terminal | undefined
    let removeData = () => {}
    let removeExit = () => {}
    let observer: ResizeObserver | undefined
    let themeObserver: MutationObserver | undefined
    void (async () => {
      const { Terminal } = await import('@xterm/xterm')
      if (disposed || !node.current) return
      terminal = new Terminal({ cursorBlink: true, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13, theme: { background: '#121a20', foreground: '#dce7ec' } })
      terminal.open(node.current)
      const updateTheme = (): void => {
        if (terminal) terminal.options.theme = document.documentElement.dataset.theme === 'light'
          ? { background: '#ffffff', foreground: '#101a30', cursor: '#0027cc', selectionBackground: '#cbd6ff' }
          : { background: '#172032', foreground: '#f7f9ff', cursor: '#819bff', selectionBackground: '#354359' }
      }
      updateTheme()
      themeObserver = new MutationObserver(updateTheme)
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      try {
        const id = await api.terminalStart()
        if (disposed) { await api.terminalStop(id); return }
        terminalId.current = id
        terminal.onData((data) => { void api.terminalWrite(id, data) })
        removeData = api.onTerminalData((value) => { if (value.id === id) terminal?.write(value.data) })
        removeExit = api.onTerminalExit((value) => { if (value.id === id) terminal?.writeln(`\r\n[Shell exited: ${value.code}]`) })
        observer = new ResizeObserver(() => {
          if (!terminal || !node.current) return
          const cols = Math.max(40, Math.floor(node.current.clientWidth / 8))
          const rows = Math.max(15, Math.floor(node.current.clientHeight / 17))
          terminal.resize(cols, rows)
          void api.terminalResize(id, cols, rows)
        })
        observer.observe(node.current)
      } catch (reason) { setError(String(reason)) }
    })()
    return () => { disposed = true; observer?.disconnect(); themeObserver?.disconnect(); removeData(); removeExit(); terminal?.dispose(); if (terminalId.current) void api.terminalStop(terminalId.current) }
  }, [])
  return <div className="page-content terminal-page"><div className="page-heading"><div><h1>Terminal</h1><p>A shell in the same container and workspace as UnrealCode.</p></div></div>{error && <p className="error-inline">{error}</p>}<div className="terminal-frame" ref={node}/></div>
}

export default function App(): ReactNode {
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (hasDirtyEditors()) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard) }, [])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => { void api.appVersion().then(setAppVersion) }, [])
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [status, setStatus] = useState<DockerStatus>({ ready: false, message: 'Docker backend is not started' })
  const [view, setView] = useState<View>('chat')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingWorkspace, setEditingWorkspace] = useState('')
  useEffect(() => { let live = true; if (projectPath) void api.activeWorkspace().then(value => { if (live) setEditingWorkspace(value.path) }); return () => { live = false } }, [projectPath, activeId])
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [changes, setChanges] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showSettingsBeforeProject, setShowSettingsBeforeProject] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const [highlight, setHighlight] = useState<number | null>(null)
  const highlightedEvent = useRef<string>('')
  const [sessionStates, setSessionStates] = useState<Record<string, string>>({})
  const [palette, setPalette] = useState(false)
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<AgentEvent[]>([])
  const pendingMessage = useRef<{ sessionId: string; text: string; id: string } | null>(null)
  const frame = useRef<number | null>(null)
  const activeRef = useRef<string | null>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => { void api.getSettings().then(setSettings); void api.dockerStatus().then(setStatus); void api.projectPath().then(setProjectPath); return api.onDockerStatus(setStatus) }, [])
  useEffect(() => {
    const unsubscribe = api.onEvent((event) => {
      if (event.event === 'desktop.state') {
        setSessionStates((current) => ({ ...current, [event.sessionId]: string(field(event.payload, 'state')) }))
        return
      }
      if (event.event === 'session.needs_input') setSessionStates((current) => ({ ...current, [event.sessionId]: 'waiting for input' }))
      if (event.event === 'session.activity') setSessionStates((current) => ({ ...current, [event.sessionId]: field(event.payload, 'busy') ? 'running' : 'idle' }))
      if (event.event === 'session.status' && ['stopped', 'error'].includes(string(field(event.payload, 'status')))) setSessionStates((current) => ({ ...current, [event.sessionId]: field(event.payload, 'status') === 'error' ? 'failed' : 'stopped' }))
      if (event.sessionId !== activeRef.current) return
      pending.current.push(event)
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        const batch = pending.current.splice(0)
        frame.current = null
        setEvents((current) => mergeEvents(current, batch))
      })
    })
    return () => { unsubscribe(); if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [])
  const refreshSessions = useCallback(async () => { try { setSessions(await api.listSessions()) } catch (reason) { setError(String(reason)) } }, [])
  useEffect(() => { if (projectPath) { void refreshSessions(); void api.gitChanges().then(setChanges) } }, [projectPath, refreshSessions])
  useEffect(() => { if (!projectPath) return; const timer = setInterval(() => { void api.gitChanges().then(setChanges); void refreshSessions() }, 10000); return () => clearInterval(timer) }, [projectPath, refreshSessions])
  useTheme(settings?.theme)

  const resetConversation = (id: string | null): void => {
    activeRef.current = id
    pending.current = []
    pendingMessage.current = null
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    highlightedEvent.current = ''
    setHighlight(null)
    setActiveId(id)
    setEvents([])
  }

  const openProject = async (path?: string): Promise<void> => {
    setBusy(true); setError('')
    try {
      const selected = path || await api.pickProject()
      if (!selected) return
      await api.openProject(selected, true)
      setProjectPath(await api.projectPath()); resetConversation(null); setView('chat'); setShowSettingsBeforeProject(false)
      setSettings(await api.getSettings())
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const selectSession = async (id: string, sequence?: number, resume = false): Promise<void> => {
    resetConversation(id)
    setHighlight(sequence || null)
    setError(''); setView('chat')
    try { await api.selectSession(id); const workspace = await api.activeWorkspace(); if (activeRef.current === id) setEditingWorkspace(workspace.path); const history = sequence ? await api.getEventWindow(id, sequence) : await loadEvents(id); if (activeRef.current === id) setEvents((current) => mergeEvents(current, history)); if (resume && !sequence) await api.openSession(id); await refreshSessions() } catch (reason) { setError(String(reason)) }
  }
  const newSession = async (): Promise<string | null> => {
    if (!settings) return null
    try {
      const config: BridgeSessionConfig = { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, thinkingLevel: settings.thinkingLevel, systemPrompt: settings.systemPrompt, disallowedTools: settings.disallowedTools }
      const created = await api.createSession(config)
      resetConversation(created.sessionId); await refreshSessions(); return created.sessionId
    } catch (reason) { setError(String(reason)); return null }
  }
  const send = async (): Promise<void> => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true); setError('')
    try {
      const id = activeId || await newSession()
      if (!id) return
      const retry = pendingMessage.current
      const messageId = retry?.sessionId === id && retry.text === text ? retry.id : crypto.randomUUID()
      pendingMessage.current = { sessionId: id, text, id: messageId }
      await api.sendMessage(id, text, messageId)
      pendingMessage.current = null
      setPrompt(''); setTimeout(() => { void refreshSessions() }, 400)
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const fork = async (id: string): Promise<void> => { try { const result = await api.forkSession(id); await refreshSessions(); await selectSession(result.sessionId) } catch (reason) { setError(String(reason)) } }
  const stop = async (): Promise<void> => {
    if (!activeId) return
    setBusy(true); setSessionStates((current) => ({ ...current, [activeId]: 'cancelling' }))
    try { await api.stopSession(activeId); await refreshSessions() }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const saveSettings = async (patch: Partial<Settings>): Promise<void> => {
    const next = await api.updateSettings(patch)
    setSettings((current) => ({ ...next, layout: current?.layout || next.layout }))
  }
  const changeLayout = (patch: Partial<Settings['layout']>): void => {
    if (!settings) return
    const layout = { ...settings.layout, ...patch }
    setSettings({ ...settings, layout })
    if (layoutTimer.current) clearTimeout(layoutTimer.current)
    layoutTimer.current = setTimeout(() => { void api.updateSettings({ layout }).catch((reason) => setError(String(reason))) }, 250)
  }
  useEffect(() => {
    const keyboard = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette((value) => !value) }
      if (event.key.toLowerCase() === 'n' && projectPath) { event.preventDefault(); void newSession(); setView('chat') }
      if (event.key === '`' && projectPath) { event.preventDefault(); setView('terminal') }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })
  useEffect(() => api.onNavigate((target) => { setProjectPath(target.project); void api.dockerStatus().then(setStatus); void selectSession(target.sessionId, target.seq, false) }))
  useEffect(() => api.onWorkflowChanged((path) => { if (path === projectPath) void refreshSessions() }), [projectPath, refreshSessions])
  useEffect(() => {
    const key = `${activeId}:${highlight}`
    if (!highlight || view !== 'chat' || !events.length || highlightedEvent.current === key) return
    const timer = setTimeout(() => {
      const candidates = [...document.querySelectorAll<HTMLElement>('[data-event-seq]')].filter((element) => Number.isFinite(Number(element.dataset.eventSeq)))
      candidates.sort((a, b) => Math.abs(Number(a.dataset.eventSeq) - highlight) - Math.abs(Number(b.dataset.eventSeq) - highlight))
      candidates[0]?.scrollIntoView({ block: 'center', behavior: 'instant' })
      if (candidates.length) highlightedEvent.current = key
    }, 120)
    return () => clearTimeout(timer)
  }, [highlight, events, view, activeId])
  const active = sessions.find((item) => item.id === activeId)
  if (!settings) return <div className="boot-screen"><Brand/><span>Loading desktop…</span></div>
  if (!settings.decisionSetupSeen) return <DecisionWelcome onChoose={async (engine) => { try { await saveSettings({ decisionEngine: engine, decisionSetupSeen: true }) } catch (reason) { setError(String(reason)) } }}/>
  if (!projectPath) return <><Welcome settings={settings} busy={busy} status={status} onOpen={(path) => void openProject(path)} onSettings={() => setShowSettingsBeforeProject(true)}/><AnimatePresence>{showSettingsBeforeProject && <motion.div className="setup-overlay" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: .98 }} transition={spatial.slow}><button className="close-overlay" onClick={() => setShowSettingsBeforeProject(false)}><X size={20}/></button><SettingsPage settings={settings} onSave={saveSettings}/></motion.div>}</AnimatePresence>{error && <div className="global-error"><CircleAlert size={18}/>{error}<button onClick={() => setError('')}><X size={16}/></button></div>}</>
  return <div className={`app-shell ${settings.layout.focus ? 'focus-layout' : ''}`} style={{ '--session-width': `${settings.layout.sessionWidth}px`, '--activity-width': `${settings.layout.activityWidth}px` } as CSSProperties}>
    {palette && <CommandPalette onClose={() => setPalette(false)} commands={[
      ...navigation.map((item) => ({ id: item.id, label: `Go to ${item.label}`, run: () => setView(item.id) })),
      { id: 'new', label: 'New session', shortcut: 'Ctrl+N', run: () => { void newSession(); setView('chat') } },
      { id: 'search-sessions', label: 'Search sessions', run: () => { changeLayout({ sessions: true, focus: false }); setView('chat'); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Search sessions"]')?.focus(), 100) } },
      { id: 'sessions-toggle', label: 'Toggle session pane', run: () => changeLayout({ sessions: !settings.layout.sessions }) },
      { id: 'activity-toggle', label: 'Toggle activity rail', run: () => changeLayout({ activity: !settings.layout.activity }) },
      { id: 'focus', label: 'Toggle focus layout', run: () => changeLayout({ focus: !settings.layout.focus }) },
      ...(['dark', 'light', 'system'] as const).map((theme) => ({ id: theme, label: `Theme: ${theme === 'system' ? 'Follow Windows' : theme}`, run: () => { void saveSettings({ theme }) } }))
    ]}/>}
    <aside className="nav-rail"><Brand/><nav>{navigation.map(({ id, label, icon: Icon }) => <motion.button className={`nav-item ${view === id ? 'active' : ''}`} key={id} aria-label={label} onClick={() => setView(id)} animate={reduceMotion ? undefined : { borderRadius: view === id ? 13 : 9 }} transition={spatial.fast}>{view === id && !reduceMotion && <motion.span layoutId="active-nav" className="active-nav-bg" transition={spatial.default}/>}<Icon size={19}/><span>{label}</span></motion.button>)}</nav><div className="rail-bottom"><div className="agent-ready"><span className="status-dot on"/><div><strong>Agent Ready</strong><small>{status.ready ? 'Container connected' : 'Container offline'}</small></div></div><small>{projectPath}</small><small>v{appVersion}</small></div></aside>
    <AnimatePresence initial={false}>{view === 'chat' && settings.layout.sessions && !settings.layout.focus && <motion.aside className="session-pane" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }} transition={spatial.default}><div className="workspace-picker"><span>Workspace</span><button onClick={() => setView('projects')}>{projectPath.split(/[\\/]/).at(-1)}<ChevronDown size={16}/></button></div><div className="session-search"><Search size={16}/><input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="Search sessions…" aria-label="Search sessions"/><button className="icon-button" title="New session" onClick={() => void newSession()}><Plus size={17}/></button></div><div className="session-list">{sessions.filter((session) => session.title.toLowerCase().includes(sessionSearch.toLowerCase())).map((session, index, filtered) => { const day = new Date(session.lastUpdatedAt).toDateString(); const previous = index ? new Date(filtered[index-1].lastUpdatedAt).toDateString() : ''; const label = day === new Date().toDateString() ? 'Today' : day === new Date(Date.now() - 86400000).toDateString() ? 'Yesterday' : new Date(session.lastUpdatedAt).toLocaleDateString(); return <div key={session.id}>{day !== previous && <div className="session-group-label">{label}</div>}<button className={`session-row ${activeId === session.id ? 'selected' : ''}`} onClick={() => void selectSession(session.id)}><strong>{session.title}</strong><small>{formatTime(session.lastUpdatedAt)} · {sessionStates[session.id] || session.state || (session.active ? 'Idle' : 'Saved')}</small></button></div> })}{sessions.length === 0 && <p className="muted-copy pad">No sessions yet. Send a message to begin.</p>}</div></motion.aside>}</AnimatePresence>
    {view === 'chat' && settings.layout.sessions && !settings.layout.focus && <ResizeHandle label="Session pane width" value={settings.layout.sessionWidth} min={190} max={420} onChange={(sessionWidth) => changeLayout({ sessionWidth })}/>}
    <main className={`main-area ${view === 'chat' ? 'with-chat' : ''}`}><header className="app-topbar"><div className="topbar-project"><strong>{projectPath.split(/[\\/]/).at(-1)}</strong><ChevronDown size={15}/>{view === 'chat' && active && <span className="topbar-session">{active.title} · {sessionStates[active.id] || active.state || 'idle'}</span>}</div><div className="topbar-controls"><button className="icon-button" title="Commands (Ctrl+K)" onClick={() => setPalette(true)}><Search size={16}/></button><button className="secondary-button" onClick={() => changeLayout({ focus: !settings.layout.focus })}>{settings.layout.focus ? 'Exit focus' : 'Focus'}</button><button className="icon-button" title="Toggle session pane" onClick={() => changeLayout({ sessions: !settings.layout.sessions })}><MessageCircle size={16}/></button><button className="icon-button" title="Toggle activity rail" onClick={() => changeLayout({ activity: !settings.layout.activity })}><Activity size={16}/></button><label><small>Provider · next session</small><select value={settings.provider} onChange={(event) => void saveSettings({ provider: event.target.value as Provider, model: '' })}><option value="openai-codex">Codex subscription</option><option value="openai">OpenAI API</option><option value="anthropic">Claude API</option><option value="ollama">Ollama</option><option value="openai-compatible">Local compatible</option><option value="openrouter">OpenRouter</option><option value="fireworks">Fireworks</option></select></label><label><small>Model · next session</small><input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} onBlur={() => void saveSettings({ model: settings.model })} placeholder="Model ID"/></label><span className={`topbar-dot ${status.ready ? 'on' : ''}`}/></div></header>
      {error && <div className="banner-error"><CircleAlert size={17}/><span>{error}</span>{/(401|unauthorized|credential|token|api key)/i.test(error) && <button onClick={() => setView('settings')}>Reconnect in Settings</button>}<button onClick={() => setError('')}><X size={15}/></button></div>}
      {highlight && view === 'chat' && <div className="search-location">Showing recorded context around event {highlight}. <button onClick={() => { if (activeId) void selectSession(activeId, undefined, false) }}>Open full history</button></div>}
      <AnimatePresence mode="wait" initial={false}><motion.div key={view} className="view-frame" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }} transition={spatial.fast}>
        {view === 'chat' && <div className={`chat-layout ${settings.layout.activity && !settings.layout.focus ? '' : 'without-activity'}`}><AnimatePresence mode="wait" initial={false}><motion.div key={activeId || 'new'} className="chat-motion" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }} transition={spatial.fast}><ChatPanel events={events} session={active} prompt={prompt} setPrompt={setPrompt} onSend={() => void send()} onStop={() => void stop()} sending={busy} settings={settings} onSave={saveSettings}/></motion.div></AnimatePresence><div className="activity-wrapper"><ResizeHandle label="Activity rail width" value={settings.layout.activityWidth} min={260} max={520} reverse onChange={(activityWidth) => changeLayout({ activityWidth })}/><ContextPanel changes={changes} events={events} projectPath={projectPath} status={status} decisionEngine={settings.decisionEngine} sessionId={activeId || undefined}/></div></div>}
        {view === 'projects' && <div className="page-content projects-page"><div className="page-heading"><div><h1>Projects</h1><p>Switch between trusted local workspaces.</p></div><button className="primary-button" onClick={() => void openProject()}><Plus size={16}/> Open folder</button></div><div className="project-list">{settings.recentProjects.map((path) => <button key={path} className="project-row" onClick={() => void openProject(path)}><FolderOpen size={21}/><span><strong>{path.split(/[\\/]/).at(-1)}</strong><small>{path}</small></span><ArrowRight size={17}/></button>)}</div></div>}
        {view === 'sessions' && <div className="page-content sessions-page"><div className="page-heading"><div><h1>Sessions</h1><p>Resume your work or fork a completed turn.</p></div><button className="primary-button" onClick={() => void newSession()}><Plus size={16}/> New session</button></div><div className="session-table">{sessions.map((session) => <div className="session-table-row" key={session.id}><div><strong>{session.title}</strong><small>{new Date(session.lastUpdatedAt).toLocaleString()}</small></div><span className="session-id">{session.id.slice(0, 8)}{session.parentSessionId && <button title="Open original session" onClick={() => void selectSession(session.parentSessionId!, undefined, false)}>From {session.parentSessionId.slice(0, 8)}</button>}</span><button className="secondary-button" onClick={() => void selectSession(session.id)}>Open</button><button className="icon-button" title="Fork session" onClick={() => void fork(session.id)}><GitBranch size={17}/></button></div>)}{sessions.length === 0 && <p className="muted-copy pad">No saved sessions yet.</p>}</div></div>}
        {view === 'workflow' && <WorkflowPage project={projectPath} sessionId={activeId} sessions={sessions} onOpen={async (root, id, seq) => { if (root !== projectPath) await openProject(root); await selectSession(id, seq, false) }}/>}
        {view === 'diagnostics' && <DiagnosticsPage settings={settings} sessions={sessions} sessionId={activeId}/>}
        {view === 'review' && <div className="review-page-stack"><TaskWorkspaceReview onSource={() => { void openProject(projectPath).then(() => setView('review')) }}/><ReviewWorkspace key={editingWorkspace} onSteer={async (sessionId, feedback) => { await api.sendMessage(sessionId, feedback, crypto.randomUUID()); await selectSession(sessionId) }}/></div>}
        {view === 'files' && <EditorWorkspace key={editingWorkspace || projectPath} project={editingWorkspace || projectPath} onAttach={text => { setPrompt(value => value ? `${value}\n\n${text}` : text); setView('chat') }}/>}
        {view === 'skills' && <SkillsPage/>}
        {view === 'usage' && <UsageDashboard onSettings={() => setView('settings')}/>}
        {view === 'github' && <GitHubPage onOpenProject={async (path) => openProject(path)}/>}
        {view === 'settings' && <SettingsPage settings={settings} onSave={saveSettings} projectPath={projectPath}/>}
        {view === 'terminal' && <TerminalView/>}
      </motion.div></AnimatePresence>
    </main></div>
}
