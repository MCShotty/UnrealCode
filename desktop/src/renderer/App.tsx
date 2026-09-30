import {ComputerCompanion,openComputerCompanion} from './ComputerCompanion'
import { ComputerPage } from './ComputerPage'
import { FieldnotesPage } from './FieldnotesPage'
import { FieldnoteComposer,FieldnoteReceipts,SaveSelectionAsFieldnote } from './FieldnoteContext'
import { fieldnoteSelection,saveFieldnoteSelection } from './fieldnote-selections'
import { SkillsPage } from './SkillsPage'
import { ComposerActionButton } from './ComposerActionButton'
import { composerAction, isWorkRunning, sendsOnEnter, type PendingComposerAction } from './composer-action'
import { ProgressIndicator } from './ProgressIndicator'
import { HistoryNavigation } from './HistoryNavigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import ReactMarkdown from 'react-markdown'
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Check, ChevronDown, ChevronRight,
  CircleAlert, CircleCheck, Clock3, Code2, File, FileText, Folder, FolderOpen,
  GitBranch, GitPullRequest, KeyRound, MessageCircle, MoreHorizontal, Plus, Radio, Search,
  Send, Settings2, ShieldCheck, Square, TerminalSquare, Trash2, Unplug, WandSparkles,
  X, Zap
} from 'lucide-react'
import type { AgentEvent, BridgeSessionConfig, DockerStatus, FileEntry, Provider, SessionInfo, Settings, SkillEntry } from '../shared/api'
import { commands, parseCommand, type CommandName } from '../shared/commands'
import {evidenceImages,evidenceText} from './evidence-images'
import { ImageAttachments,imageAttachments,clearImageAttachments,clearProjectImages,useImageAttachments } from './ImageAttachments'
import { HooksPage } from './HooksPage'
import { SharedBrowserPage } from './SharedBrowserPage'
import {DocumentPage} from './DocumentPage'
import { MemoryPage } from './MemoryPage'
import { TaskControlPage } from './TaskControlPage'
import { SlashCommands } from './SlashCommands'
import { RecoveryPanel } from './RecoveryPanel'
import { MemorySettingsPanel } from './MemorySettingsPanel'
import { SettingsNavigation, isSettingsTab, settingsTabs, type SettingsTab } from './SettingsNavigation'
import { SettingsOverlay } from './SettingsOverlay'
import { SetupGuide } from './SetupGuide'
import { GitHubPage } from './GitHubPage'
import { WorkflowPage } from './WorkflowPage'
import { DiagnosticsPage } from './DiagnosticsPage'
import { ReviewWorkspace } from './ReviewWorkspace'
import { UsageDashboard } from './UsageDashboard'
import { ExecutionInspector } from './ExecutionInspector'
import { ExecutionControls } from './ExecutionControls'
import { EditorWorkspace } from './EditorWorkspace'
import { hasDirtyEditors,changeEditor } from './editor-buffers'
import { TaskWorkspaceReview } from './TaskWorkspaceReview'
import { ConnectionsPage } from './ConnectionsPage'
import { ComposerContext } from './ComposerContext'
import { ContextInspector } from './ContextInspector'
import { TaskTeamControls, TaskTeamRail } from './TaskTeams'
import { defaultTeamOptions, type TeamOptions } from '../shared/teams'
import { CommandPalette, ResizeHandle, useTheme } from './DesktopControls'
import { effects, expressive, instant, spatial } from './motion'
import { ExpressiveButton } from './ExpressiveButton'
import { parseEvents,type ParsedEntry } from './chat-events'
import { themeColors } from './theme-colors'
import { BrandMark } from './BrandMark'
import { WorkspaceNavigation, navigation, type View } from './WorkspaceNavigation'
import { PaneDialog } from './PaneDialog'
import {ActivityTimeline} from './ActivityTimeline'
import {ModelSelector} from './ModelSelector'
import { ModelPicker } from './ModelPicker'
import { WorkConversation, useWorkView } from './WorkConversation'
import { ToolActivityHost, openToolActivity } from './ToolActivity'

declare global { interface Window { unreal: import('../shared/api').DesktopAPI } }
const api = window.unreal
const appearanceThemes: { value: Settings['theme']; label: string }[] = [
  { value: 'system', label: 'Follow Windows' },
  { value: 'dark', label: 'Cinder Dark' },
  { value: 'ice-dark', label: 'Ice Dark' },
  { value: 'light', label: 'Flashbang' }
]

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function field(value: unknown, ...names: string[]): unknown { const target = record(value); for (const name of names) if (name in target) return target[name]; return undefined }
function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function formatTime(value: unknown): string {
  const date = new Date(string(value))
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  const known = new Set(current.map((item) => item.seq))
  return [...current, ...incoming.filter((item) => !known.has(item.seq))].sort((a, b) => a.seq - b.seq).slice(-3000)
}
async function loadEvents(sessionId: string): Promise<AgentEvent[]> { return api.latestEvents(sessionId) }


function Brand(): ReactNode {
  return <div className="brand"><BrandMark/><div><strong>UnrealCode</strong><small>DESKTOP</small></div></div>
}

function DecisionWelcome({ onChoose }: { onChoose: (engine: Settings['decisionEngine']) => Promise<void> }): ReactNode {
  return <div className="decision-onboarding"><div className="decision-onboarding-card"><Brand/><div className="eyebrow">FIRST-RUN SETUP</div><h1>Choose a decision engine</h1><p>UnrealCode can send small, typed questions to one engine across every project and chat. The main agent still handles planning, coding, and actions.</p><div className="engine-options"><button onClick={() => void onChoose('jev')}><WandSparkles size={21}/><strong>Jev</strong><small>TypeSafe cloud · requires a key and project consent</small></button><button onClick={() => void onChoose('laya')}><Zap size={21}/><strong>Laya</strong><small>Local worker · install on demand</small></button></div><button className="text-button" onClick={() => void onChoose('off')}>Set up later</button></div></div>
}

function EventCard({ entry, live = false }: { entry: ParsedEntry; live?:boolean }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const reduceMotion = useReducedMotion()
  if (entry.kind === 'question') return null
  if (entry.kind === 'user') return <div className="chat-entry user-entry"><div className="avatar user-avatar">U</div><div className="entry-body"><div className="entry-heading"><strong>You</strong><time>{entry.timestamp}</time></div><div className="user-bubble">{entry.text}{evidenceImages(entry.raw).map((image,index)=><img className="evidence-image" key={index} src={image} alt={`Attached image ${index+1}`}/>)}</div></div></div>
  if (entry.kind === 'assistant') return <motion.div className="chat-entry" initial={live&&!reduceMotion?{opacity:0,y:5}:false} animate={{opacity:1,y:0}} transition={reduceMotion?instant:effects.fast}><div className="avatar agent-avatar"><BrandMark/></div><div className="entry-body"><div className="entry-heading"><strong>UnrealCode</strong>{entry.status==='incomplete'&&<small>Incomplete response</small>}<time>{entry.timestamp}</time></div><div className="markdown"><ReactMarkdown>{entry.text}</ReactMarkdown></div></div></motion.div>
  if (entry.kind === 'status') return <div className="error-inline"><CircleAlert size={17}/><span>{entry.text}</span></div>
  return <motion.div className={`tool-card ${entry.kind === 'decision' ? 'decision-card' : ''}`} initial={false} animate={{ borderRadius: expanded ? 20 : 14 }} transition={reduceMotion ? instant : spatial.fast}>
    <button className="tool-summary" onClick={() => {if(entry.kind==='tool')openToolActivity(entry.activityId||entry.id.replace(/^call:/,''));else setExpanded((value) => !value)}} aria-expanded={entry.kind==='tool'?undefined:expanded}>
      <span className="tool-symbol">{entry.status === 'executing' || entry.status === 'running' ? <ProgressIndicator animate={false}/> : entry.status?.startsWith('waiting') ? <ProgressIndicator state="waiting" animate={false}/> : entry.kind === 'decision' ? <WandSparkles size={17}/> : <Code2 size={17}/>}</span><span className="tool-copy"><strong>{entry.title}</strong><small>{entry.text || 'Agent operation'}</small></span>
      <span className={`tool-status ${entry.status || ''}`}>{entry.status === 'completed' || entry.status === 'complete' ? <CircleCheck size={16}/> : <Radio size={16}/>} {entry.status || 'event'}</span>
      <motion.span className="disclosure-chevron" initial={false} animate={{ rotate: expanded ? 90 : 0 }} transition={reduceMotion ? instant : spatial.fast}><ChevronRight size={16}/></motion.span>
    </button>
    <AnimatePresence initial={false}>{expanded && <motion.div className="tool-reveal" initial={reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={reduceMotion ? instant : expressive.panel}><pre className="tool-detail">{evidenceImages(entry.raw).map((image,index)=><img className="evidence-image" key={index} src={image} alt={`${entry.title} visual evidence ${index+1}`}/>)}{evidenceText(entry.raw ?? entry.text)}</pre></motion.div>}</AnimatePresence>
  </motion.div>
}

function Welcome({ settings, busy, status, onOpen, onSettings, onFieldnotes, onComputer }: { settings: Settings; busy: boolean; status: DockerStatus; onOpen: (path?: string) => void; onSettings: () => void; onFieldnotes: () => void; onComputer: () => void }): ReactNode {
  const reduced = useReducedMotion()
  return <div className="welcome"><header className="welcome-top"><Brand/><span className="welcome-caption"><ShieldCheck size={15}/> Local first. More control.</span></header>
    <main className="welcome-main"><div className="welcome-grid">
      <motion.section className="welcome-hero" initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? instant : expressive.panel}><div className="eyebrow">YOUR NEXT IDEA STARTS HERE</div><div className="welcome-symbol"><BrandMark/></div><h1>Open a workspace</h1><p>Build, explore, and ship with an agent that works alongside you. Your project. Your tools. Your call.</p>
        <div className="welcome-actions"><ExpressiveButton className="primary-button large-button" onClick={() => onOpen()} disabled={busy} aria-busy={busy}><FolderOpen size={19}/>{busy ? 'Preparing backend…' : 'Open project folder'}</ExpressiveButton><button className="secondary-button" onClick={onSettings}><Settings2 size={17}/> Provider settings</button><button className="text-button" onClick={onFieldnotes}>Open Fieldnotes</button><button className="secondary-button" onClick={onComputer}>Open Computer</button></div>
        <p className="welcome-trust"><ShieldCheck size={16}/> You’ll review project trust before any files are mounted.</p>
        <div className={`backend-note ${status.ready ? 'ready' : ''}`} role="status"><span className="status-dot"/><span>{status.message}</span></div>
        <div className="recent-projects"><h2>Pick up where you left off</h2>{settings.recentProjects.length ? settings.recentProjects.map(path => <button key={path} onClick={() => onOpen(path)} disabled={busy}><span className="project-folder-icon"><Folder size={20}/></span><span><strong>{path.split(/[\\/]/).at(-1)}</strong><small>{path}</small></span><ArrowRight size={18}/></button>) : <div className="recent-empty"><Folder size={20}/><div><strong>A fresh workspace</strong><p>Your recent projects will appear here after you open a folder.</p></div></div>}</div>
      </motion.section>
      <motion.aside className="welcome-guide" initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? instant : expressive.dialog}><div className="eyebrow">GETTING STARTED</div><h2>Make yourself at home.</h2><p>A few checks, then you’re ready to build.</p><SetupGuide settings={settings} onSettings={onSettings}/></motion.aside>
    </div></main>
  </div>
}

function ChatPanel({ events, session, preview, liveMessage, prompt, setPrompt, onSend, onStop, pendingAction, runtimeState, unavailable, settings, onSave, teamDraft, onTeamDraft, online, onFollowingChange, followSignal }: { onFollowingChange(value:boolean):void; followSignal:number; online:boolean; events: AgentEvent[]; session: SessionInfo | undefined; preview?:{text:string}; liveMessage?:{sessionId:string;seq:number}; prompt: string; setPrompt: (value: string) => void; onSend: () => void; onStop: () => void; pendingAction?: PendingComposerAction; runtimeState?: string; unavailable: boolean; settings: Settings; onSave: (patch: Partial<Settings>) => Promise<void>; teamDraft: TeamOptions; onTeamDraft(value: TeamOptions): void }): ReactNode {
  const parsed = useMemo(() => parseEvents(events), [events])
  const work=useWorkView(session?.id,events)
  const images = useImageAttachments(session?.id || null)
  const running = isWorkRunning(runtimeState || work.view?.works.at(-1)?.state || session?.state)
  const action = composerAction({ draft: !!prompt.trim() || !!images.length, running, online, localCommand: prompt.startsWith('/'), pending: pendingAction, unavailable })
  const canStop = online && running && !pendingAction && !unavailable
  useEffect(() => { const stopKey = (event: KeyboardEvent) => { if (event.ctrlKey && event.shiftKey && event.code === 'Period' && !event.isComposing && !event.repeat && canStop) { event.preventDefault(); onStop() } }; window.addEventListener('keydown', stopKey); return () => window.removeEventListener('keydown', stopKey) }, [canStop, onStop])
  const pendingQuestions=work.view?.questions.filter(q=>q.state==='pending'||q.state==='interrupted')||[]
  const [toolsOpen, setToolsOpen] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [unread, setUnread] = useState(false)
  useEffect(()=>{following.current=true;setUnread(false);bottom.current?.scrollIntoView({block:'end',behavior:'instant'})},[followSignal])
  useEffect(() => {
    if (following.current) bottom.current?.scrollIntoView({ block: 'end', behavior: 'instant' })
    else setUnread(true)
  }, [events])
  return <div className="chat-panel"><div className="chat-scroll" onScroll={(event) => {
    const element = event.currentTarget
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
    onFollowingChange(following.current)
    if (following.current) setUnread(false)
  }}>
    {parsed.length === 0 ? <div className="empty-chat"><div className="empty-orbit"><BrandMark/></div><div className="eyebrow">LET’S MAKE SOMETHING</div><h2>{online ? 'What are we building?' : 'Your workspace, offline'}</h2><p>{online ? 'Start with an idea, a question, or that bug you’ve been meaning to fix.' : 'Browse a cached conversation from Sessions. Connect Docker when you’re ready to run a task.'}</p>{online && <div className="task-suggestions">{[{icon: Code2, title: 'Explore this project', prompt: 'Explore this project and explain its architecture, main entry points, and how to run it. Do not change any files.'}, {icon: CircleCheck, title: 'Find something to improve', prompt: 'Review this project for a concrete bug. Show the evidence and propose a focused fix before editing.'}, {icon: WandSparkles, title: 'Plan a new feature', prompt: '/plan Help me plan a new feature for this project. Start by asking what I want to build.'}].map(({icon: Icon, title, prompt: value}) => <ExpressiveButton key={title} onClick={() => { setPrompt(value); document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus() }}><Icon size={20}/><span>{title}</span><ArrowRight size={16}/></ExpressiveButton>)}</div>}</div> : <WorkConversation entries={parsed} controller={work} session={session} online={online} onStop={onStop} renderEntry={entry=><EventCard entry={entry} live={liveMessage?.sessionId===session?.id&&liveMessage?.seq===entry.seq}/>}/>}
    {preview&&<div className="chat-entry response-preview" role="status"><div className="avatar agent-avatar"><BrandMark/></div><div className="entry-body"><div className="entry-heading"><strong>UnrealCode</strong><small>Responding…</small></div><div className="preview-text">{preview.text}</div></div></div>}
    <div ref={bottom}/></div>
    {unread && <button className="jump-latest" onClick={() => { following.current = true; setUnread(false); bottom.current?.scrollIntoView({ block: 'end', behavior: 'instant' }) }}>Jump to latest</button>}
    {online?<ExecutionControls sessionId={session?.id} state={work.view?.works.at(-1)?.state||session?.state} settings={settings} onSave={onSave}/>:<p className="offline-compose-note">Viewing saved history. Connect Docker to resume this session.</p>}
    <FieldnoteReceipts sessionId={session?.id}/><div className="composer">{pendingQuestions.length>0&&<button className="question-reminder" onClick={()=>{const card=document.getElementById(`question-${pendingQuestions[0].id}`);card?.scrollIntoView({block:"center",behavior:"instant"});card?.focus()}}>{pendingQuestions.length} unanswered question request{pendingQuestions.length===1?"":"s"} · Review answers</button>}<div className="composer-accessories"><FieldnoteComposer sessionId={session?.id} prompt={prompt}/><SaveSelectionAsFieldnote/>{online&&<><ImageAttachments sessionId={session?.id||null}/><ComposerContext sessionId={session?.id} prompt={prompt} onPrompt={setPrompt}/><TaskTeamControls key={session?.id || 'new'} sessionId={session?.id} draft={teamDraft} onDraft={onTeamDraft} canStop={canStop} stopping={pendingAction==='stop'} onStop={onStop}/></>}</div><SlashCommands value={prompt} onChoose={setPrompt}/><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (sendsOnEnter({key:event.key,shiftKey:event.shiftKey,isComposing:event.nativeEvent.isComposing,keyCode:event.nativeEvent.keyCode}, action)) onSend() } }} placeholder="Message UnrealCode…" rows={2} aria-label="Message UnrealCode"/>
      <div className="composer-bottom"><div className="composer-actions"><button className="secondary-button" onClick={() => { setToolsOpen(!toolsOpen) }} aria-expanded={toolsOpen}>Tools <ChevronDown size={14}/></button><span>Enter to send · Shift+Enter for a new line</span></div><div><ComposerActionButton action={action} onSend={onSend} onStop={onStop}/></div></div>
      {toolsOpen && <div className="composer-popover"><strong>Tools for new sessions</strong>{['ListFiles','ReadFile','ApplyPatch','Bash','ViewImage','RepositorySearch','ProjectSearch','FindTools','DecisionBatch','EntityExtract','SkillUse'].map((tool) => <label className="check-row" key={tool}><input type="checkbox" checked={!settings.disallowedTools.includes(tool)} onChange={(event) => void onSave({ disallowedTools: event.target.checked ? settings.disallowedTools.filter((value) => value !== tool) : [...settings.disallowedTools, tool] })}/>{tool}</label>)}</div>}
    </div>
  </div>
}

function ContextPanel({ changes, events, projectPath, status, decisionEngine, sessionId, onOpen }: { changes: string[]|null; events: AgentEvent[]; projectPath: string; status: DockerStatus; decisionEngine: Settings['decisionEngine']; sessionId?: string; onOpen(id:string,sequence?:number):void }): ReactNode {
  const activity = useMemo(() => parseEvents(events).filter((item) => item.kind !== 'user').slice(-6).reverse(), [events])
  const [diffPath, setDiffPath] = useState('')
  const [diff, setDiff] = useState('')
  const showDiff = async (path: string): Promise<void> => { setDiffPath(path); try { setDiff(await api.gitDiff(path)) } catch (reason) { setDiff(String(reason)) } }
  return <aside className="context-panel"><div className="context-status"><span className={`status-dot ${status.ready ? 'on' : ''}`}/><div><strong>{status.ready ? 'Container Running' : 'Container Offline'}</strong><small>UnrealCode · local workspace</small></div><ChevronDown size={16}/></div>
    <section className="context-card"><div className="section-heading"><h3>Workspace changes</h3>{changes&&<span className="count-pill">{changes.length}</span>}</div>{changes===null?<p className="muted-copy">Git changes are unavailable. Check the repository or Git installation.</p>:changes.length ? changes.slice(0, 7).map((line) => <button className="change-row" key={line} onClick={() => void showDiff(line.slice(3))}><FileText size={15}/><span>{line.slice(3)}</span><small>{line.slice(0, 2)}</small></button>) : <p className="muted-copy">Working tree is clean.</p>}</section>
    {status.ready&&<TaskTeamRail sessionId={sessionId} onOpen={onOpen}/>}<ExecutionInspector sessionId={sessionId} eventSequence={events.at(-1)?.seq || 0}/>
    <ActivityTimeline sessionId={sessionId} sequence={events.at(-1)?.seq||0} onEvidence={seq=>{if(sessionId)onOpen(sessionId,seq)}}/>
    <section className="context-card context-bottom"><div className="section-heading"><h3>Current context</h3></div><div className="context-fact"><Folder size={15}/> <span>Project</span><strong>{projectPath.split(/[\\/]/).at(-1)}</strong></div><div className="context-fact"><GitBranch size={15}/> <span>Workspace</span><strong>Local</strong></div><div className="context-fact"><ShieldCheck size={15}/> <span>Container</span><strong>{status.ready ? 'Running' : 'Offline'}</strong></div><div className="context-fact"><WandSparkles size={15}/> <span>Decision engine</span><strong>{decisionEngine === 'off' ? 'Off' : decisionEngine === 'jev' ? 'Jev' : 'Laya'}</strong></div></section>
    {diffPath && <div className="diff-overlay"><div><strong>{diffPath}</strong><button className="icon-button" onClick={() => setDiffPath('')} aria-label="Close diff"><X size={17}/></button></div><pre>{diff || 'No text diff available.'}</pre></div>}
  </aside>
}

function FileBrowser(): ReactNode {
  const [mode, setMode] = useState<'explorer' | 'changes'>('explorer')
  const [folder, setFolder] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [changes, setChanges] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { void api.listFiles(folder).then(setEntries).catch((reason) => setError(String(reason))) }, [folder])
  useEffect(() => { void api.gitChanges().then(setChanges).catch((reason) => {setChanges(null);setError(String(reason))}) }, [])
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
    <div className="page-heading"><div><h1>Files</h1><p>Browse project files and inspect Git changes.</p></div><div className="segmented"><button className={mode === 'explorer' ? 'selected' : ''} onClick={() => { setMode('explorer'); setSelected(''); setContent('') }}>Explorer</button><button className={mode === 'changes' ? 'selected' : ''} onClick={() => { setMode('changes'); setSelected(''); setContent('') }}>Changes {changes!==null&&<span>{changes.length}</span>}</button></div></div>
    <div className="file-layout"><div className="file-list">
      {mode === 'explorer' ? <><div className="file-breadcrumb"><button onClick={() => setFolder('')}><Folder size={15}/> Project</button>{folder && <><ChevronRight size={14}/><span>{folder}</span></>}</div>{folder && <button className="file-row" onClick={() => setFolder(folder.split('/').slice(0,-1).join('/'))}><ArrowLeft size={16}/> ..</button>}{entries.map((entry) => <button className={`file-row ${selected === entry.path ? 'selected' : ''}`} key={entry.path} onClick={() => void open(entry)}>{entry.directory ? <Folder size={17}/> : <FileText size={17}/>}<span>{entry.name}</span>{entry.directory && <ChevronRight size={15}/>}</button>)}</> : changes===null?<p className="muted-copy pad">Git changes are unavailable for this folder. Files remain available in Explorer.</p>:<>{changes.map((line) => <button className={`file-row ${selected === line.slice(3) ? 'selected' : ''}`} key={line} onClick={() => void openChange(line)}><GitBranch size={17}/><span>{line.slice(3)}</span><small>{line.slice(0,2)}</small></button>)}{changes.length === 0 && <p className="muted-copy pad">Working tree is clean.</p>}</>}
    </div><div className="file-preview"><div className="preview-title">{selected || (mode === 'changes' ? 'Select a changed path' : 'Select a file')}</div>{error ? <p className="error-inline">{error}</p> : <pre>{content || (mode === 'changes' ? 'Select a path to inspect its Git diff.' : 'Choose a text file to preview its contents.')}</pre>}</div></div>
  </div>
}

function AbilitiesPage({ section, onSection, onAttach }: { section: 'skills' | 'connections'; onSection(section: 'skills' | 'connections'): void; onAttach(text: string): void }): ReactNode {
  const tabs = [
    { id: 'skills' as const, label: 'Skills', description: 'Instructions the agent can use', icon: Code2 },
    { id: 'connections' as const, label: 'MCPs', description: 'External tools and resources', icon: Unplug }
  ]
  const selectByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const index = tabs.findIndex(tab => tab.id === section)
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    onSection(tabs[next].id)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return <div className="page-content abilities-page">
    <div className="page-heading"><div><h1>Abilities</h1><p>Manage the instructions and connected tools available to your agent.</p></div></div>
    <button className="text-button" onClick={()=>window.dispatchEvent(new CustomEvent('unrealcode:navigate-view',{detail:'computer'}))}>Manage Computer access →</button>
    <div className="abilities-tabs" role="tablist" aria-label="Ability sections" onKeyDown={selectByKeyboard}>
      {tabs.map(({ id, label, description, icon: Icon }) => <button key={id} id={`abilities-tab-${id}`} type="button" role="tab" aria-selected={section === id} aria-controls={`abilities-panel-${id}`} tabIndex={section === id ? 0 : -1} onClick={() => onSection(id)}><Icon size={19} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small></span></button>)}
    </div>
    <div id="abilities-panel-skills" className="abilities-panel" role="tabpanel" aria-labelledby="abilities-tab-skills" hidden={section !== 'skills'}><SkillsPage/></div>
    <div id="abilities-panel-connections" className="abilities-panel" role="tabpanel" aria-labelledby="abilities-tab-connections" hidden={section !== 'connections'}><ConnectionsPage onAttach={onAttach}/></div>
  </div>
}

function SettingsPage({ settings, onSave, projectPath, initialTab, onTabChange }: { settings: Settings; onSave: (value: Partial<Settings>) => Promise<void>; projectPath?: string; initialTab: SettingsTab; onTabChange(tab: SettingsTab): void }): ReactNode {
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
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [visitedTabs, setVisitedTabs] = useState<Set<SettingsTab>>(() => new Set([initialTab]))
  useEffect(() => { setDraft(settings); void api.codexStatus().then(setCodex); void api.hasKey(settings.provider).then(setKeySaved); if (projectPath) void api.decisionStatus().then(setDecisionStatus).catch((reason) => setError(String(reason))) }, [settings, projectPath])
  useEffect(() => { setActiveTab(initialTab); setVisitedTabs(current => new Set([...current, initialTab])) }, [initialTab])
  const selectTab = (tab: SettingsTab) => { setActiveTab(tab); onTabChange(tab); setVisitedTabs(current => current.has(tab) ? current : new Set([...current, tab])) }
  const save = async (): Promise<void> => { try { const patch={...draft,decisionSetupSeen:true};delete patch.automaticUpdateChecks;delete patch.updateChannel;await onSave(patch); if (key && ['openai','anthropic','openrouter','fireworks','openai-compatible'].includes(draft.provider)) { await api.saveKey(draft.provider, key); setKey(''); setKeySaved(true) } setSaved(true); setError(''); if (projectPath) setDecisionStatus(await api.decisionStatus()) } catch (reason) { setError(String(reason)) } }
  const isKeyProvider = ['openai','anthropic','openrouter','fireworks','openai-compatible'].includes(draft.provider)
  const discover = async (): Promise<void> => { try { setModels(await api.discoverModels(draft.provider, draft.baseUrl)); setError('') } catch (reason) { setError(String(reason)) } }
  const install = async (engine: 'laya' | 'gliner'): Promise<void> => { setInstalling(true); try { await api.decisionInstall(engine); setDecisionStatus(await api.decisionStatus()); setError('') } catch (reason) { setError(String(reason)) } finally { setInstalling(false) } }
  const evaluate = async (): Promise<void> => { try { const result = await api.evaluateDecision({ state: { text: sample }, sourceRefs: ['settings-sample'], questions: { task: { type: 'choice', instructions: 'Which task type best fits text?', criteria: { implementation: 'write or change code', investigation: 'find or diagnose a problem', explanation: 'answer a question', other: 'none of these' } }, sensitive: { type: 'noul', instructions: 'Does text discuss a secret or authentication?' } } }); setSampleResult(JSON.stringify(result, null, 2)); setError('') } catch (reason) { setError(String(reason)) } }
  const instructions = projectPath ? draft.projectInstructions?.[projectPath] || '' : draft.systemPrompt
  const contents = (tab: SettingsTab): ReactNode => {
    if (tab === 'provider') return <div className="settings-grid">
      <section className="settings-section"><h2>Model provider</h2><label>Provider<select value={draft.provider} onChange={(event) => { setDraft({ ...draft, provider: event.target.value as Provider, model: '' }); setModels([]); setSaved(false); void api.hasKey(event.target.value).then(setKeySaved) }}><option value="openai-codex">Codex subscription</option><option value="openai">OpenAI API</option><option value="anthropic">Claude API</option><option value="openrouter">OpenRouter</option><option value="fireworks">Fireworks</option><option value="ollama">Local Ollama</option><option value="openai-compatible">Local OpenAI compatible</option></select></label>
        <ModelSelector provider={draft.provider} model={draft.model} baseUrl={draft.baseUrl} onChange={model=>{setDraft({...draft,model});setSaved(false)}}/><label>Reasoning level<select value={draft.thinkingLevel} onChange={(event) => setDraft({ ...draft, thinkingLevel: event.target.value as Settings['thinkingLevel'] })}>{['low','medium','high','xhigh','max'].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
        {(draft.provider === 'ollama' || draft.provider === 'openai-compatible') && <><label>Local server URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="http://localhost:1234/v1"/></label><button className="secondary-button" onClick={() => void discover()}>Discover models</button>{models.length > 0 && <p>{models.length} model{models.length === 1 ? '' : 's'} available</p>}</>}
      </section><section className="settings-section"><h2>Credentials</h2>{isKeyProvider ? <><p>Enter a {draft.provider} key. It is encrypted by Windows when available, and sent to the container only in memory.</p><label>API key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={keySaved ? 'Saved key available' : draft.provider === 'openai-compatible' ? 'Optional for local server' : 'No key saved'} autoComplete="off"/></label></> : draft.provider === 'openai-codex' ? <p className={codex?.available ? 'success-text' : 'muted-copy'}><KeyRound size={16}/> {codex?.message || 'Checking existing Codex login…'}</p> : <p>Ollama runs locally. No API key is needed.</p>}</section>
    </div>
    if (tab === 'memory') return <MemorySettingsPanel settings={settings} projectPath={projectPath} active={activeTab === 'memory'}/>
    if (tab === 'decisions') return <div className="settings-grid"><section className="settings-section wide-section decision-settings"><h2>Decision model</h2><p>One engine for all projects and chats. A selected engine receives bounded Choice, Noul, and Score questions. UnrealCode keeps planning, coding, permissions, and Git actions.</p><label>Global engine<select value={draft.decisionEngine} onChange={(event) => setDraft({ ...draft, decisionEngine: event.target.value as Settings['decisionEngine'] })}><option value="off">Disabled</option><option value="jev">Jev · TypeSafe cloud</option><option value="laya">Laya · local worker</option></select></label>{draft.decisionEngine === 'jev' && <><label>Jev model<input value={draft.decisionModel} onChange={(event) => setDraft({ ...draft, decisionModel: event.target.value })} placeholder="jev-latest"/></label><p>Reads TYPESAFE_API_KEY from Windows. Project text is sent only after you grant that project's cloud consent.</p>{projectPath && !settings.decisionCloudProjects.includes(projectPath) && <button className="secondary-button" onClick={() => void api.decisionConsent().then(async () => { setDecisionStatus(await api.decisionStatus()); setDraft(await api.getSettings()) })}>Allow TypeSafe for this project</button>}</>}{draft.decisionEngine === 'laya' && <button className="secondary-button" disabled={installing} onClick={() => void install('laya')}>{installing ? 'Installing…' : 'Install local Laya worker'}</button>}{decisionStatus && <p className={decisionStatus.available ? 'success-text' : 'muted-copy'}>{decisionStatus.message}</p>}<label className="check-row"><input type="checkbox" checked={draft.glinerEnabled} onChange={(event) => setDraft({ ...draft, glinerEnabled: event.target.checked })}/><span>Enable GLiNER entity extraction separately</span></label>{draft.glinerEnabled && <button className="secondary-button" disabled={installing} onClick={() => void install('gliner')}>{installing ? 'Installing…' : decisionStatus?.glinerAvailable ? 'Reinstall GLiNER' : 'Install GLiNER'}</button>}{projectPath && draft.decisionEngine !== 'off' && <div className="decision-sample"><label>Try a bounded decision<input value={sample} onChange={(event) => setSample(event.target.value)} placeholder="Short sample text"/></label><button className="secondary-button" disabled={!sample.trim()} onClick={() => void evaluate()}>Evaluate</button>{sampleResult && <pre>{sampleResult}</pre>}</div>}</section></div>
    if (tab === 'agent') return <div className="settings-grid"><section className="settings-section wide-section"><h2>{projectPath ? 'Project instructions' : 'Default agent instructions'}</h2><p>Applied as the system prompt when a new session starts.</p><textarea value={instructions} onChange={(event) => setDraft(projectPath ? { ...draft, projectInstructions: { ...draft.projectInstructions, [projectPath]: event.target.value } } : { ...draft, systemPrompt: event.target.value })} aria-label="Agent instructions" placeholder="Optional instructions for this workspace" rows={6}/></section><section className="settings-section"><h2>Tools</h2>{['Bash','ViewImage','SkillUse','DecisionBatch','EntityExtract'].map((tool) => <label className="check-row" key={tool}><input type="checkbox" checked={!draft.disallowedTools.includes(tool)} onChange={(event) => setDraft({ ...draft, disallowedTools: event.target.checked ? draft.disallowedTools.filter((value) => value !== tool) : [...draft.disallowedTools, tool] })}/><span>{tool}</span></label>)}</section></div>
    if (tab === 'appearance') return <div className="settings-grid"><section className="settings-section"><h2>Appearance</h2><label className="check-row"><input type="checkbox" checked={draft.notifications} onChange={(event) => setDraft({ ...draft, notifications: event.target.checked })}/> Windows notifications for completion, failures, and required input</label><label className="check-row"><input type="checkbox" checked={draft.warningNotifications!==false} onChange={(event) => setDraft({ ...draft, warningNotifications: event.target.checked })}/> Show warning popups</label><p>Turn off optional and background warning popups. Errors, approvals and required answers remain visible; feature status and diagnostics are retained.</p><label>Theme<select aria-label="Theme" value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Settings['theme'] })}>{appearanceThemes.map(({value,label})=><option key={value} value={value}>{label}</option>)}</select></label><p>Follow Windows uses Cinder Dark in dark mode and Flashbang in light mode. Animations follow your system’s reduced-motion preference.</p></section></div>
    if (tab === 'usage') return <div className="settings-grid"><AdminKeySettings/></div>
    return <div className="settings-grid"><RecoveryPanel active={activeTab === 'recovery'}/></div>
  }
  const hasDraftSettings = ['provider','decisions','agent','appearance'].includes(activeTab)
  return <div className="page-content settings-page"><div className="page-heading"><div><h1>Settings</h1><p>Configure providers, memory, and how UnrealCode works.</p></div>{hasDraftSettings && <button className="primary-button" onClick={() => void save()}><Check size={16}/> Save settings</button>}</div>
    <SettingsNavigation value={activeTab} onChange={selectTab}/><div className="settings-tab-panels">{settingsTabs.map(tab => <section key={tab.id} id={'settings-panel-' + tab.id} role="tabpanel" aria-labelledby={'settings-tab-' + tab.id} tabIndex={0} hidden={activeTab !== tab.id}>{visitedTabs.has(tab.id) ? contents(tab.id) : null}</section>)}</div>
    {hasDraftSettings && saved && <p className="success-text notice"><Check size={16}/> Settings saved</p>}{error && <p className="error-inline notice">{error}</p>}</div>
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
  return <section className="settings-section wide-section"><h2 id="settings-reports" tabIndex={-1}>Account usage reports</h2><p>Optional organization admin keys read account-wide token usage. They stay in the desktop process and are never sent to the agent container. Model API keys cannot replace admin keys.</p>
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
      const initialColors = themeColors()
      terminal = new Terminal({ cursorBlink: true, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13, theme: { background: initialColors.background, foreground: initialColors.foreground } })
      terminal.open(node.current)
      const updateTheme = (): void => {
        const colors = themeColors()
        if (terminal) terminal.options.theme = { ...colors.terminal, brightBlack: colors.terminal.black, brightRed: colors.terminal.red, brightGreen: colors.terminal.green, brightYellow: colors.terminal.yellow, brightBlue: colors.terminal.blue, brightMagenta: colors.terminal.magenta, brightCyan: colors.terminal.cyan, brightWhite: colors.terminal.white, background: colors.background, foreground: colors.foreground, cursor: colors.accent, selectionBackground: colors.selection, scrollbarSliderBackground: colors.scrollbar, scrollbarSliderHoverBackground: colors.accent, scrollbarSliderActiveBackground: colors.accent }
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
  const [recoveryError,setRecoveryError]=useState('')
  useEffect(()=>{const refresh=()=>void api.recoveryStatus().then(value=>setRecoveryError(value.migrationError||''));refresh();return api.onMaintenance(()=>{setProjectPath(null);setSessionLists({});setActiveId('');setEvents([]);setShowSettingsBeforeProject(true);void api.getSettings().then(setSettings);refresh()})},[])

  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (hasDirtyEditors()) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard) }, [])
  useEffect(()=>{const navigate=(event:Event)=>{const view=(event as CustomEvent).detail;if(view==='connections'||navigation.some(item=>item.id===view))setView(view)};window.addEventListener('unrealcode:navigate-view',navigate);return()=>window.removeEventListener('unrealcode:navigate-view',navigate)},[])
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(()=>api.onSettingsChanged(setSettings),[])
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => { void api.appVersion().then(setAppVersion) }, [])
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [status, setStatus] = useState<DockerStatus>({ ready: false, message: 'Docker backend is not started' })
  const [view, setView] = useState<View>('chat')
  const [sessionLists, setSessionLists] = useState<Record<string, { rows: SessionInfo[]; ready: boolean; error?: string }>>({})
  const sessionList = projectPath ? sessionLists[projectPath] : undefined
  const sessions = sessionList?.rows || []
  const sessionsReadyFor = sessionList?.ready ? projectPath : null
  const sessionsOwner = useRef({ project: projectPath, generation: 0, request: 0 })
  if (sessionsOwner.current.project !== projectPath) sessionsOwner.current = { project: projectPath, generation: sessionsOwner.current.generation + 1, request: 0 }
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingWorkspace, setEditingWorkspace] = useState('')
  const [selectingWorkspace,setSelectingWorkspace]=useState(false)
  useEffect(() => { let live = true;const selection=activeRef.current; if (projectPath) void api.activeWorkspace().then(value => { if (live&&activeRef.current===selection) setEditingWorkspace(value.path) }).catch(()=>{}); return () => { live = false } }, [projectPath])
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [responsePreviews,setResponsePreviews]=useState<Record<string,{id:string;attempt:number;text:string}>>({})
  const [liveMessage,setLiveMessage]=useState<{sessionId:string;seq:number}>()
  useEffect(()=>{if(!liveMessage)return;const timer=setTimeout(()=>setLiveMessage(current=>current?.sessionId===liveMessage.sessionId&&current.seq===liveMessage.seq?undefined:current),700);return()=>clearTimeout(timer)},[liveMessage])
  const [olderHistory,setOlderHistory]=useState(false)
  const olderHistoryRef=useRef(false)
  const followingLatest=useRef(true)
  const [historyUpdateAvailable,setHistoryUpdateAvailable]=useState(false)
  const [followSignal,setFollowSignal]=useState(0)
  const [changes, setChanges] = useState<string[]|null>(null)
  const [prompt, setPrompt] = useState('')
  const [teamDraft, setTeamDraft] = useState<TeamOptions>({ ...defaultTeamOptions })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldnoteOpen,setFieldnoteOpen]=useState<{id?:string;text?:string}>({})
  useEffect(()=>{const open=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail&&typeof detail==='object'){setFieldnoteOpen({id:typeof detail.id==='string'?detail.id:undefined,text:typeof detail.text==='string'?detail.text:undefined});setView('fieldnotes')}};window.addEventListener('unrealcode:fieldnote',open);return()=>window.removeEventListener('unrealcode:fieldnote',open)},[])
  const [showSettingsBeforeProject, setShowSettingsBeforeProject] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('provider')
  useEffect(()=>{const open=(event:Event)=>{const requested=(event as CustomEvent<unknown>).detail;if(isSettingsTab(requested))setSettingsTab(requested);if(projectPath)setView('settings');else setShowSettingsBeforeProject(true)};window.addEventListener('unrealcode:settings',open);return()=>window.removeEventListener('unrealcode:settings',open)},[projectPath])
  const [sessionSearch, setSessionSearch] = useState('')
  const [highlight, setHighlight] = useState<number | null>(null)
  const highlightedEvent = useRef<string>('')
  const [sessionStates, setSessionStates] = useState<Record<string, string>>({})
  const [palette, setPalette] = useState(false)
  const [paneDialog, setPaneDialog] = useState<'sessions' | 'activity' | null>(null)
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<AgentEvent[]>([])
  const sessionEventVersions = useRef(new Map<string, number>())
  const pendingMessages = useRef(new Map<string, { text: string; id: string }>())
  const actionLocks = useRef(new Map<string, PendingComposerAction>())
  const [composerRequests, setComposerRequests] = useState<Record<string, PendingComposerAction>>({})
  const actionKey = (id: string | null) => `${projectPath}\0${id || 'draft'}`
  const publishActions = () => setComposerRequests(Object.fromEntries(actionLocks.current))
  const frame = useRef<number | null>(null)
  const activeRef = useRef<string | null>(null)
  const conversationVersion = useRef(0)
  const reduceMotion = useReducedMotion()

  useEffect(() => { void api.getSettings().then(setSettings); void api.dockerStatus().then(setStatus); void api.projectPath().then(setProjectPath); return api.onDockerStatus(setStatus) }, [])
  useEffect(() => {
    const unsubscribe = api.onEvent((event) => {
      if(event.event==='model.response.preview'){
        const id=string(field(event.payload,'id')),attempt=Number(field(event.payload,'attempt')),text=string(field(event.payload,'text')),reset=field(event.payload,'reset')===true
        if(id&&Number.isSafeInteger(attempt)&&(text||reset))setResponsePreviews(current=>{const previous=current[event.sessionId],body=!reset&&previous?.id===id&&previous.attempt===attempt?previous.text:'';return {...current,[event.sessionId]:{id,attempt,text:(body+text).slice(0,16384)}}})
        return
      }
      if(event.event==='session.item'&&field(event.payload,'Kind','kind')==='model_response'){
        setResponsePreviews(current=>{if(!current[event.sessionId])return current;const next={...current};delete next[event.sessionId];return next})
        if(event.seq>0)setLiveMessage({sessionId:event.sessionId,seq:event.seq})
      }
      if (['desktop.state','session.needs_input','session.activity','session.status','session.idle','verification.result'].includes(event.event)) sessionEventVersions.current.set(event.sessionId, (sessionEventVersions.current.get(event.sessionId)||0)+1)
      if(event.event==='desktop.history'){
        if(event.sessionId===activeRef.current&&!olderHistoryRef.current){
          if(!followingLatest.current){setHistoryUpdateAvailable(true);return}
          const version=conversationVersion.current
          void api.latestEvents(event.sessionId).then(history=>{
            if(version!==conversationVersion.current||event.sessionId!==activeRef.current||olderHistoryRef.current)return
            if(!followingLatest.current){setHistoryUpdateAvailable(true);return}
            const last=history.at(-1)?.seq||0
            setEvents(current=>mergeEvents(history,current.filter(item=>item.seq>last)))
          }).catch(()=>{})
        }
        return
      }
      if (event.event === 'desktop.state') {
        setSessionStates((current) => ({ ...current, [event.sessionId]: string(field(event.payload, 'state')) }))
        return
      }
      if (event.event === 'session.needs_input') setSessionStates((current) => ({ ...current, [event.sessionId]: 'waiting for input' }))
      if (event.event === 'session.activity' && field(event.payload, 'busy')) setSessionStates((current) => ({ ...current, [event.sessionId]: 'running' }))
      if ((event.event === 'session.status' && ['stopped', 'error'].includes(string(field(event.payload, 'status')))) || event.event==='session.idle'||event.event==='verification.result') setSessionStates((current) => ({ ...current, [event.sessionId]: string(field(field(event.payload,'outcome'),'state')) || (field(event.payload, 'status') === 'error' ? 'failed' : event.event==='session.idle'?'completed':'stopped') }))
      if (event.sessionId !== activeRef.current || olderHistoryRef.current) return
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
  const refreshSessions = useCallback(async () => {
    if (!projectPath) return
    const owner = sessionsOwner.current, request = ++owner.request
    const current = () => sessionsOwner.current === owner && owner.request === request && owner.project === projectPath
    try {
      const result = await api.listSessions()
      if (current()) setSessionLists(value => ({ ...value, [projectPath]: { rows: result, ready: true } }))
    } catch (reason) {
      if (current()) setSessionLists(value => ({ ...value, [projectPath]: { rows: value[projectPath]?.rows || [], ready: true, error: String(reason) } }))
    }
  }, [projectPath])
  useEffect(() => { if (projectPath) { void refreshSessions(); if(status.ready)void api.gitChanges().then(setChanges).catch(()=>setChanges(null)) } }, [projectPath, refreshSessions, status.ready])
  useEffect(() => { if (!projectPath) return; const timer = setInterval(() => { if(status.ready)void api.gitChanges().then(setChanges).catch(()=>setChanges(null)); void refreshSessions() }, 10000); return () => clearInterval(timer) }, [projectPath, refreshSessions,status.ready])
  const navigationKey=`${projectPath}\0${view}\0${activeId}`
  const previousNavigation=useRef(navigationKey)
  useEffect(()=>{if(previousNavigation.current!==navigationKey){previousNavigation.current=navigationKey;window.dispatchEvent(new Event('unrealcode:navigation'))}},[navigationKey])
  useTheme(settings?.theme)

  const resetConversation = (id: string | null): void => {
    conversationVersion.current++
    if(id===null)setSelectingWorkspace(false)
    activeRef.current = id
    olderHistoryRef.current=false;setOlderHistory(false);followingLatest.current=true;setHistoryUpdateAvailable(false)
    pending.current = []
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
      setProjectPath(await api.projectPath()); setEditingWorkspace((await api.activeWorkspace()).path); resetConversation(null); setView('chat'); setShowSettingsBeforeProject(false)
      setSettings(await api.getSettings())
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const selectSession = async (id: string, sequence?: number, resume = false): Promise<void> => {
    setSelectingWorkspace(true)
    resetConversation(id)
    const version=conversationVersion.current
    olderHistoryRef.current=!!sequence;setOlderHistory(!!sequence)
    setHighlight(sequence || null)
    setError(''); setView('chat')
    try {
      await api.selectSession(id)
      if(version!==conversationVersion.current)return
      const workspace = await api.activeWorkspace()
      if(version!==conversationVersion.current)return
      setEditingWorkspace(workspace.path)
      const history = sequence ? await api.getEventWindow(id, sequence) : await loadEvents(id)
      if(version!==conversationVersion.current)return
      setEvents((current) => mergeEvents(current, history))
      if (resume && !sequence) await api.openSession(id)
      await refreshSessions()
    } catch (reason) { if(version===conversationVersion.current&&!String(reason).includes('cancelled'))setError(String(reason)) }
    finally {if(version===conversationVersion.current)setSelectingWorkspace(false)}
  }
  const newSession = async (): Promise<string | null> => {
    if (!settings || recoveryError) return null
    try {
      const config: BridgeSessionConfig = { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, thinkingLevel: settings.thinkingLevel, systemPrompt: settings.systemPrompt, disallowedTools: settings.disallowedTools }
      const selection = conversationVersion.current
      const created = await api.createSession(config, teamDraft)
      if (selection !== conversationVersion.current) { await refreshSessions(); return created.sessionId }
      setEditingWorkspace((await api.activeWorkspace()).path); setTeamDraft((await api.teamPreferences()).options); resetConversation(created.sessionId); await refreshSessions(); return created.sessionId
    } catch (reason) { setError(String(reason)); return null }
  }
  const [commandNotice,setCommandNotice]=useState('')
  const executeCommand=async(name:CommandName,args='')=>{
    if(name==='help'){setPalette(true);return}
    if(name==='new'){await newSession();setView('chat');return}
    const result=await api.command({name,args,sessionId:activeId||undefined})
    if(result.sessionId)await selectSession(result.sessionId)
    if(result.view&&(result.view==='connections'||navigation.some(item=>item.id===result.view)))setView(result.view as View)
    if(result.prompt){if(name==='plan'&&args){setSettings(await api.getSettings());const id=activeId||await newSession();if(id)await api.sendMessage(id,result.prompt,crypto.randomUUID())}else setPrompt(result.prompt)}
    if(result.message)setCommandNotice(result.message)
    await refreshSessions()
  }
  useEffect(()=>api.onCommand(name=>{void executeCommand(name).catch(reason=>setError(String(reason)))}))
  const send = async (): Promise<void> => {
    const submittedDraft = prompt, sourceSession = activeId, initialKey = actionKey(activeId), selection = conversationVersion.current
    const images = imageAttachments(sourceSession).map(item => item.id)
    let text = submittedDraft.trim(), requestKey = initialKey, targetSession = sourceSession
    if ((!text && !images.length) || busy || actionLocks.current.has(initialKey)) return
    actionLocks.current.set(initialKey, 'send'); publishActions(); setError('')
    if (!text && images.length) text = 'Inspect the attached images.'
    try {
      const parsed = parseCommand(text)
      if (parsed.kind === 'command') { await executeCommand(parsed.name, parsed.args); if (selection === conversationVersion.current) setPrompt(current => current === submittedDraft ? '' : current); return }
      text = parsed.text
      const id = sourceSession || await newSession()
      if (!id) return
      targetSession = id
      requestKey = actionKey(id); actionLocks.current.set(requestKey, 'send'); publishActions()
      const version = conversationVersion.current, stillSelected = activeRef.current === id
      const retry = pendingMessages.current.get(id)
      const messageId = retry?.text === text ? retry.id : crypto.randomUUID()
      pendingMessages.current.set(id, { text, id: messageId })
      const eventVersion = sessionEventVersions.current.get(id) || 0
      const guidance=fieldnoteSelection(projectPath||'',sourceSession||undefined)
      if(!sourceSession)saveFieldnoteSelection(projectPath||'',id,guidance)
      await api.sendMessage(id, text, messageId, images,guidance)
      clearImageAttachments(sourceSession, images); pendingMessages.current.delete(id)
      if (stillSelected && version === conversationVersion.current) setPrompt(current => current === submittedDraft ? '' : current)
      if ((sessionEventVersions.current.get(id) || 0) === eventVersion) setSessionStates(current => ({ ...current, [id]: 'running' }))
      setTimeout(() => { void refreshSessions() }, 400)
    } catch (reason) { if (targetSession === activeRef.current) setError(String(reason)) }
    finally { actionLocks.current.delete(initialKey); actionLocks.current.delete(requestKey); publishActions() }
  }
  const fork = async (id: string): Promise<void> => { try { const result = await api.forkSession(id); await refreshSessions(); await selectSession(result.sessionId) } catch (reason) { setError(String(reason)) } }
  const stop = async (): Promise<void> => {
    const id = activeId, key = actionKey(id)
    if (!id || actionLocks.current.has(key)) return
    const previous = sessionStates[id] || sessions.find(item => item.id === id)?.state || 'running'
    actionLocks.current.set(key, 'stop'); publishActions()
    setSessionStates(current => ({ ...current, [id]: 'cancelling' }))
    try { await api.stopSession(id); setSessionStates(current => current[id] === 'cancelling' ? ({ ...current, [id]: 'stopped' }) : current); await refreshSessions() }
    catch (reason) { setSessionStates(current => current[id] === 'cancelling' ? ({ ...current, [id]: previous }) : current); if (activeRef.current === id) setError(String(reason)) }
    finally { actionLocks.current.delete(key); publishActions() }
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
  useEffect(() => api.onNavigate((target) => { setProjectPath(target.project); void api.dockerStatus().then(setStatus); if(target.sessionId)void selectSession(target.sessionId, target.seq, false);else{resetConversation(null);setView('chat')} }))
  useEffect(()=>{clearProjectImages();let live=true;if(projectPath)void api.teamPreferences().then(value=>{if(live)setTeamDraft(value.options)}).catch(()=>{});return()=>{live=false}},[projectPath])
  useEffect(() => api.onWorkflowChanged((path) => { if (path === projectPath) void refreshSessions() }), [projectPath, refreshSessions])
  useEffect(() => {
    const key = `${activeId}:${highlight}`
    if (!highlight || view !== 'chat' || !events.length || highlightedEvent.current === key) return
    const reveal=() => {
      if(highlightedEvent.current===key||!document.querySelector('[data-work-ready="true"]'))return
      const candidates = [...document.querySelectorAll<HTMLElement>('[data-event-seq]')].filter((element) => Number.isFinite(Number(element.dataset.eventSeq)))
      candidates.sort((a, b) => Math.abs(Number(a.dataset.eventSeq) - highlight) - Math.abs(Number(b.dataset.eventSeq) - highlight))
      const target=candidates[0],disclosure=target?.closest('.work-section')?.querySelector<HTMLButtonElement>('.work-disclosure')
      if(disclosure?.getAttribute('aria-expanded')==='false')disclosure.click()
      requestAnimationFrame(()=>{if(target?.isConnected)target.scrollIntoView({ block: 'center', behavior: 'instant' })})
      if (candidates.length) highlightedEvent.current = key
    }
    const timer=setTimeout(reveal,120)
    window.addEventListener('unreal:work-ready',reveal)
    return () => {clearTimeout(timer);window.removeEventListener('unreal:work-ready',reveal)}
  }, [highlight, events, view, activeId])
  const toggleSessions = () => {
    if (window.innerWidth <= 900) setPaneDialog('sessions')
    else changeLayout({ sessions: !settings?.layout.sessions, focus: false })
  }
  const toggleActivity = () => {
    if ((document.querySelector('.main-area')?.clientWidth || 0) <= 800) setPaneDialog('activity')
    else changeLayout({ activity: !settings?.layout.activity, focus: false })
  }
  const active = sessions.find((item) => item.id === activeId)
  if(recoveryError)return <div className="recovery-screen"><Brand/><h1>Recover UnrealCode</h1><RecoveryPanel/></div>
  if (!settings) return <div className="boot-screen"><Brand/><span>Loading desktop…</span></div>
  if (!settings.decisionSetupSeen) return <DecisionWelcome onChoose={async (engine) => { try { await saveSettings({ decisionEngine: engine, decisionSetupSeen: true }) } catch (reason) { setError(String(reason)) } }}/>
  if (!projectPath && view==='computer') return <div className="standalone-knowledge"><header><Brand/><button className="secondary-button" onClick={()=>setView('chat')}>Back to workspaces</button></header><ComputerPage/></div>
  if (!projectPath && view==='fieldnotes') return <div className="standalone-knowledge"><header><Brand/><button className="secondary-button" onClick={()=>setView('chat')}>Back to workspaces</button></header><FieldnotesPage initialId={fieldnoteOpen.id} initialText={fieldnoteOpen.text} onOpened={()=>setFieldnoteOpen({})}/></div>
  if (!projectPath) return <><div className="welcome-host" inert={showSettingsBeforeProject}><Welcome settings={settings} busy={busy} status={status} onOpen={(path) => void openProject(path)} onSettings={() => setShowSettingsBeforeProject(true)} onFieldnotes={()=>setView('fieldnotes')} onComputer={()=>setView('computer')}/></div><AnimatePresence>{showSettingsBeforeProject && <SettingsOverlay onClose={() => setShowSettingsBeforeProject(false)}><SettingsPage settings={settings} onSave={saveSettings} initialTab={settingsTab} onTabChange={setSettingsTab}/></SettingsOverlay>}</AnimatePresence>{error && <div className="global-error"><CircleAlert size={18}/>{error}<button onClick={() => setError('')}><X size={16}/></button></div>}</>
  return <div className={`app-shell ${settings.layout.focus ? 'focus-layout' : ''}`} style={{ '--session-width': `${settings.layout.sessionWidth}px`, '--activity-width': `${settings.layout.activityWidth}px` } as CSSProperties}>
    {palette && <CommandPalette onClose={() => setPalette(false)} commands={[...commands.map(command=>({id:`slash-${command.name}`,label:`/${command.name} · ${command.description}`,shortcut:command.shortcut,run:()=>{void executeCommand(command.name).catch(reason=>setError(String(reason)))}})),
      ...navigation.map((item) => ({ id: item.id, label: `Go to ${item.label}`, run: () => setView(item.id) })),
      { id: 'new', label: 'New session', shortcut: 'Ctrl+N', run: () => { void newSession(); setView('chat') } },
      { id: 'search-sessions', label: 'Search sessions', run: () => { changeLayout({ sessions: true, focus: false }); if(window.innerWidth <= 900)setPaneDialog('sessions'); setView('chat'); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Search sessions"]')?.focus(), 100) } },
      { id: 'sessions-toggle', label: 'Toggle session pane', run: toggleSessions },
      { id: 'activity-toggle', label: 'Toggle activity rail', run: toggleActivity },
      { id: 'focus', label: 'Toggle focus layout', run: () => changeLayout({ focus: !settings.layout.focus }) },
      ...appearanceThemes.map(({value,label}) => ({ id: value, label: `Theme: ${label}`, run: () => { void saveSettings({ theme: value }) } }))
    ]}/>}

    {paneDialog && <PaneDialog title={paneDialog === 'sessions' ? 'Sessions' : 'Activity'} onClose={() => setPaneDialog(null)}>{paneDialog === 'activity' ? <ContextPanel changes={changes} events={events} projectPath={projectPath} status={status} decisionEngine={settings.decisionEngine} sessionId={activeId || undefined} onOpen={(id,seq) => { setPaneDialog(null); void selectSession(id,seq) }}/> : <><div className="session-search"><Search size={16}/><input aria-label="Search sessions" placeholder="Search sessions…" value={sessionSearch} onChange={event => setSessionSearch(event.target.value)}/></div><div className="session-list">{sessions.filter(session => session.title.toLowerCase().includes(sessionSearch.toLowerCase())).map(session => <button className={`session-row ${activeId === session.id ? 'selected' : ''}`} aria-current={activeId === session.id ? 'page' : undefined} key={session.id} onClick={() => { setPaneDialog(null); void selectSession(session.id) }}><strong>{session.title}</strong><small>{formatTime(session.lastUpdatedAt)} · {sessionStates[session.id] || session.state || 'Saved'}</small></button>)}{!sessions.length && <p className="muted-copy pad">No sessions yet. Send a message to begin.</p>}</div></>}</PaneDialog>}
    <WorkspaceNavigation view={view} onNavigate={setView} onNew={() => { void newSession().then(id => { if (id) setView('chat') }) }} onCommands={() => setPalette(true)} ready={status.ready} busy={busy} project={projectPath} version={appVersion}/>
    <AnimatePresence initial={false}>{view === 'chat' && settings.layout.sessions && !settings.layout.focus && <motion.aside className="session-pane" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16, transition: effects.fast }} transition={reduceMotion ? instant : expressive.panel}><div className="workspace-picker"><span>Workspace</span><button onClick={() => setView('projects')}>{projectPath.split(/[\\/]/).at(-1)}<ChevronDown size={16}/></button></div><div className="session-search"><Search size={16}/><input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="Search sessions…" aria-label="Search sessions"/><button className="icon-button" title="New session" onClick={() => void newSession()}><Plus size={17}/></button></div><div className="session-list">{sessions.filter((session) => session.title.toLowerCase().includes(sessionSearch.toLowerCase())).map((session, index, filtered) => { const day = new Date(session.lastUpdatedAt).toDateString(); const previous = index ? new Date(filtered[index-1].lastUpdatedAt).toDateString() : ''; const label = day === new Date().toDateString() ? 'Today' : day === new Date(Date.now() - 86400000).toDateString() ? 'Yesterday' : new Date(session.lastUpdatedAt).toLocaleDateString(); return <div key={session.id}>{day !== previous && <div className="session-group-label">{label}</div>}<button className={`session-row ${activeId === session.id ? 'selected' : ''}`} aria-current={activeId === session.id ? 'page' : undefined} onClick={() => void selectSession(session.id)}><strong>{session.title}</strong><small>{formatTime(session.lastUpdatedAt)} · {sessionStates[session.id] || session.state || (session.active ? 'Idle' : 'Saved')}</small></button></div> })}{sessions.length === 0 && <p className="muted-copy pad">No sessions yet. Send a message to begin.</p>}</div></motion.aside>}</AnimatePresence>
    {view === 'chat' && settings.layout.sessions && !settings.layout.focus && <ResizeHandle label="Session pane width" value={settings.layout.sessionWidth} min={190} max={420} onChange={(sessionWidth) => changeLayout({ sessionWidth })}/>}
    <main id="workspace-content" className={`main-area ${view === 'chat' ? 'with-chat' : ''}`}><header className="app-topbar"><div className="topbar-project"><button className="project-crumb" title="Projects" onClick={() => setView('projects')}><Folder size={16}/><span>{projectPath.split(/[\\/]/).at(-1)}</span><ChevronDown size={14}/></button><div className="topbar-title"><strong>{view === 'chat' ? active?.title || 'New conversation' : view === 'connections' ? 'Abilities' : navigation.find(item => item.id === view)?.label}</strong><span>{view === 'chat' && active ? sessionStates[active.id] || active.state || 'idle' : 'Workspace'}</span></div></div><div className="topbar-controls"><ModelPicker settings={settings} onSave={saveSettings} onModel={model => setSettings({ ...settings, model })}/><div className="layout-actions">{view==='chat'&&<button className="icon-button" aria-label="Open computer companion" title="Computer companion" onClick={openComputerCompanion}><Code2 size={18}/></button>}<button className="icon-button" title="Commands (Ctrl+K)" aria-label="Open command palette" onClick={() => setPalette(true)}><Search size={18}/></button><button className="icon-button" title={settings.layout.focus ? 'Exit focus' : 'Focus'} aria-label="Focus layout" aria-pressed={settings.layout.focus} onClick={() => changeLayout({ focus: !settings.layout.focus })}><Code2 size={18}/></button><button className="icon-button" title="Toggle session pane" aria-label="Toggle session pane" aria-pressed={settings.layout.sessions} onClick={toggleSessions}><MessageCircle size={18}/></button><button className="icon-button" title="Toggle activity rail" aria-label="Toggle activity rail" aria-pressed={settings.layout.activity} onClick={toggleActivity}><Activity size={18}/></button></div></div></header>
      {commandNotice&&<div className="command-notice" role="status"><span>{commandNotice}</span><button className="text-button" onClick={()=>setCommandNotice('')}>Dismiss</button></div>}
      <div className="workspace-body"><div className="workspace-page">
      {error && <div className="banner-error"><CircleAlert size={17}/><span>{error}</span>{/(401|unauthorized|credential|token|api key)/i.test(error) && <button onClick={() => setView('settings')}>Reconnect in Settings</button>}<button onClick={() => setError('')}><X size={15}/></button></div>}
      {activeId&&view==='chat'&&<HistoryNavigation key={activeId} sessionId={activeId} firstSeq={events[0]?.seq} older={olderHistory} hasNewHistory={historyUpdateAvailable} onPage={(page,old)=>{olderHistoryRef.current=old;setOlderHistory(old);setHistoryUpdateAvailable(false);setEvents(current=>old?page:mergeEvents(page,current.filter(item=>item.seq>(page.at(-1)?.seq||0))));if(!old){followingLatest.current=true;setFollowSignal(value=>value+1)}setHighlight(null)}}/>}
      {highlight && view === 'chat' && <div className="search-location">Showing recorded context around event {highlight}. <button onClick={() => { if (activeId) void selectSession(activeId, undefined, false) }}>Jump to latest</button></div>}
      <AnimatePresence initial={false} mode="wait">
      {selectingWorkspace?<motion.div key="preparing-workspace" className="workspace-loading" role="status" initial={reduceMotion ? false : {opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={reduceMotion ? instant : effects.fast}>Preparing the selected task workspace…</motion.div>:<motion.div key={`${projectPath}:${view === 'skills' || view === 'connections' ? 'abilities' : view}`} className="view-frame" initial={reduceMotion ? false : {opacity:0}} animate={{opacity:1}} exit={reduceMotion ? {opacity:1} : {opacity:0,transition:effects.fast}} transition={reduceMotion ? instant : effects.default}>
        {view === 'chat' && <div className={`chat-layout ${settings.layout.activity && !settings.layout.focus ? '' : 'without-activity'}`}><motion.div key={`${projectPath}:${activeId || 'new'}`} className="chat-motion" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={reduceMotion ? instant : effects.default}><ChatPanel followSignal={followSignal} onFollowingChange={value=>{if(activeRef.current===active?.id)followingLatest.current=value}} online={status.ready} events={events} preview={activeId?responsePreviews[activeId]:undefined} liveMessage={liveMessage} session={active} prompt={prompt} setPrompt={setPrompt} onSend={() => void send()} onStop={() => void stop()} pendingAction={composerRequests[actionKey(activeId)]} runtimeState={activeId ? sessionStates[activeId] : undefined} unavailable={busy || (!activeId && !!composerRequests[actionKey(null)])} settings={settings} onSave={saveSettings} teamDraft={teamDraft} onTeamDraft={setTeamDraft}/></motion.div><motion.div className="activity-wrapper" initial={false} animate={{ opacity: settings.layout.activity && !settings.layout.focus ? 1 : 0, x: reduceMotion || (settings.layout.activity && !settings.layout.focus) ? 0 : 18 }} transition={reduceMotion ? instant : expressive.panel}><ResizeHandle label="Activity rail width" value={settings.layout.activityWidth} min={260} max={520} reverse onChange={(activityWidth) => changeLayout({ activityWidth })}/><ContextPanel changes={changes} events={events} projectPath={projectPath} status={status} decisionEngine={settings.decisionEngine} sessionId={activeId || undefined} onOpen={(id,seq)=>void selectSession(id,seq)}/></motion.div></div>}
        {view === 'projects' && <div className="page-content projects-page"><div className="page-heading"><div><h1>Projects</h1><p>Switch between trusted local workspaces.</p></div><button className="primary-button" onClick={() => void openProject()}><Plus size={16}/> Open folder</button></div><div className="project-list">{settings.recentProjects.map((path) => <button key={path} className="project-row" onClick={() => void openProject(path)}><FolderOpen size={21}/><span><strong>{path.split(/[\\/]/).at(-1)}</strong><small>{path}</small></span><ArrowRight size={17}/></button>)}</div></div>}
        {view === 'sessions' && <div className="page-content sessions-page"><div className="page-heading"><div><h1>Sessions</h1><p>Resume your work or fork a completed turn.</p></div><button className="primary-button" onClick={() => void newSession()}><Plus size={16}/> New session</button></div><div className="session-table">{sessionList?.error && <p className="error-inline pad" role="alert">Sessions could not refresh. {sessionList.error}</p>}{sessionsReadyFor !== projectPath ? <p className="muted-copy pad" role="status">Loading sessions…</p> : <motion.div key={`${projectPath}:sessions`} initial={reduceMotion ? false : {opacity:0}} animate={{opacity:1}} transition={reduceMotion ? instant : effects.default}>{sessions.map((session) => <div className="session-table-row" key={session.id}><div><strong>{session.title}</strong><small>{new Date(session.lastUpdatedAt).toLocaleString()}</small></div><span className="session-id">{session.id.slice(0, 8)}{session.parentSessionId && <button title="Open original session" onClick={() => void selectSession(session.parentSessionId!, undefined, false)}>From {session.parentSessionId.slice(0, 8)}</button>}</span><button className="secondary-button" onClick={() => void selectSession(session.id)}>Open</button><button className="icon-button" title="Fork session" onClick={() => void fork(session.id)}><GitBranch size={17}/></button></div>)}{sessions.length === 0 && !sessionList?.error && <p className="muted-copy pad">{status.ready?'No saved sessions yet.':'No cached sessions yet. Connect Docker to load saved history.'}</p>}</motion.div>}</div></div>}
        {view === 'hooks' && <HooksPage/>}
        {view === 'browser' && <SharedBrowserPage key={projectPath} project={projectPath} sessionId={activeId}/>}
        {view === 'fieldnotes' && <FieldnotesPage initialId={fieldnoteOpen.id} initialText={fieldnoteOpen.text} onOpened={()=>setFieldnoteOpen({})}/>}
        {view === 'documents' && <DocumentPage sessionId={activeId||undefined} onAttach={reference=>{setPrompt(value=>value?`${value}\n\n${reference}`:reference);setView('chat')}}/>}
        {view === 'memory' && <MemoryPage projectPath={projectPath} onSettings={() => window.dispatchEvent(new CustomEvent('unrealcode:settings', { detail: 'memory' }))}/>}
        {view === 'control' && <TaskControlPage key={activeId} sessionId={activeId}/>}
        {view === 'workflow' && <WorkflowPage project={projectPath} sessionId={activeId} sessions={sessions} onOpen={async (root, id, seq) => { if (root !== projectPath) await openProject(root); await selectSession(id, seq, false) }}/>}
        {view === 'diagnostics' && <DiagnosticsPage settings={settings} sessions={sessions} sessionId={activeId}/>}
        {view === 'review' && <div className="review-page-stack"><TaskWorkspaceReview onSource={() => { void openProject(projectPath).then(() => setView('review')) }}/><ReviewWorkspace key={editingWorkspace} onSteer={async (sessionId, feedback) => { await api.sendMessage(sessionId, feedback, crypto.randomUUID()); await selectSession(sessionId) }}/></div>}
        {view === 'computer' && <ComputerPage sessionId={activeId||undefined}/>}
        {view === 'files' && <EditorWorkspace key={editingWorkspace || projectPath} project={editingWorkspace || projectPath} onAttach={text => { setPrompt(value => value ? `${value}\n\n${text}` : text); setView('chat') }}/>}
        {(view === 'skills' || view === 'connections') && <AbilitiesPage section={view} onSection={setView} onAttach={text => { setPrompt(value=>value?`${value}\n\n${text}`:text);setView('chat') }}/>}
        {view === 'context' && <ContextInspector onPreferences={saveSettings} sessionId={activeId||undefined} onFile={path => { void Promise.all([api.editorRead(path),api.editorBase(path)]).then(([file,base])=>{changeEditor(file.workspace,value=>({tabs:value.tabs.some(tab=>tab.path===path)?value.tabs:[...value.tabs,{...file,saved:file.content,base}],active:path}));setEditingWorkspace(file.workspace);setView('files')}).catch(reason=>setError(String(reason))) }}/> }
        {view === 'usage' && <UsageDashboard onSettings={() => setView('settings')}/>}
        {view === 'github' && <GitHubPage project={projectPath} onOpenProject={async (path) => openProject(path)}/>}
        {view === 'settings' && <SettingsPage settings={settings} onSave={saveSettings} projectPath={projectPath} initialTab={settingsTab} onTabChange={setSettingsTab}/>}
        {view === 'terminal' && <TerminalView/>}
      </motion.div>}
      </AnimatePresence>
      </div>
    {view==='chat'&&<ComputerCompanion sessionId={activeId||undefined}/>}
    <ToolActivityHost sessionId={activeId||undefined} eventSequence={events.at(-1)?.seq||0} onOpenSession={id=>void selectSession(id)}/>
      </div>
    </main></div>
}
