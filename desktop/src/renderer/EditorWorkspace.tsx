import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FileEntry } from '../shared/api'
import { changeEditor, editorState, editorSubscribe } from './editor-buffers'
const CodeEditor = lazy(() => import('./CodeEditor'))
const api = window.unreal

export function EditorWorkspace({ project, onAttach }: { project: string; onAttach(text: string): void }) {
  const state = useSyncExternalStore(editorSubscribe, () => editorState(project))
  const tab = state.tabs.find(item => item.path === state.active)
  const [folder, setFolder] = useState(''), [entries, setEntries] = useState<FileEntry[]>([]), [changes, setChanges] = useState<string[] | null>(null)
  const [changed, setChanged] = useState(false), [diff, setDiff] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false), [newPath, setNewPath] = useState('')
  const savingRef = useRef(false)
  const [selection, setSelection] = useState({ path: '', text: '', line: 1 })
  useEffect(() => { let live = true; void api.listFiles(folder).then(value => { if (live) setEntries(value) }).catch(reason => { if (live) setError(String(reason)) }); return () => { live = false } }, [folder, project])
  useEffect(() => { let live = true; void api.gitChanges().then(value => { if (live) setChanges(value) }).catch(reason=>{if(live){setChanges(null);setError(String(reason))}}); return () => { live = false } }, [project, saving])
  const open = async (path: string) => {
    setError('')
    if (state.tabs.some(item => item.path === path)) { changeEditor(project, value => ({ ...value, active: path })); return }
    try { const [file, base] = await Promise.all([api.editorRead(path), api.editorBase(path)]); changeEditor(file.workspace, value => ({ tabs: value.tabs.some(item => item.path === path) ? value.tabs : [...value.tabs, { ...file, saved: file.content, base }], active: path })) }
    catch (reason) { setError(String(reason)) }
  }
  const save = async () => {
    if (!tab || savingRef.current) return
    savingRef.current = true; setSaving(true); setError(''); const snapshot = tab
    try { const file = await api.editorSave(snapshot.path, snapshot.revision, snapshot.content, snapshot.workspace); changeEditor(project, value => ({ ...value, tabs: value.tabs.map(item => item.path === snapshot.path ? { ...item, revision: file.revision, saved: snapshot.content } : item) })) }
    catch (reason) { setError(String(reason)) } finally { savingRef.current = false; setSaving(false) }
  }
  const reload = async () => {
    if (!tab || (tab.content !== tab.saved && !confirm('Discard this unsaved buffer and reload the file from disk?'))) return
    try { const file = await api.editorRead(tab.path); changeEditor(project, value => ({ ...value, tabs: value.tabs.map(item => item.path === tab.path ? { ...item, ...file, saved: file.content } : item) })); setError('') }
    catch (reason) { setError(String(reason)) }
  }
  return <div className="page-content files-page" data-workspace={project}><div className="page-heading"><div><h1>Files</h1><p>Edit project files, inspect changes, and attach a selection to chat.</p></div><div className="segmented"><button className={!changed ? 'selected' : ''} onClick={() => setChanged(false)}>Explorer</button><button className={changed ? 'selected' : ''} onClick={() => setChanged(true)}>Changes {changes?.length??'—'}</button></div></div>
    <div className="file-layout"><div className="file-list"><div className="file-breadcrumb"><button onClick={() => setFolder('')}>Project</button><span>{folder}</span></div>{folder && <button className="file-row" onClick={() => setFolder(folder.split('/').slice(0,-1).join('/'))}>..</button>}
      {changed ? changes===null?<p className="muted-copy">Git changes are unavailable. You can still edit files in Explorer.</p>:changes.map(line => <button className="file-row" key={line} onClick={() => { setDiff(true); void open(line.slice(3)) }}>{line.slice(0,2)} {line.slice(3)}</button>) : entries.map(entry => <button className="file-row" key={entry.path} onClick={() => entry.directory ? setFolder(entry.path) : void open(entry.path)}>{entry.directory ? '▸ ' : ''}{entry.name}</button>)}
      <form className="editor-new-file" onSubmit={event => { event.preventDefault(); if (newPath) { void open(newPath); setNewPath('') } }}><input aria-label="New file path" placeholder="New file path" value={newPath} onChange={event => setNewPath(event.target.value)}/><button className="secondary-button" type="submit">Open / create</button></form>
    </div><section className="file-preview editor-preview"><div className="editor-tabs" role="tablist" aria-label="Open files">{state.tabs.map(item => <div key={item.path}><button role="tab" aria-selected={item.path === state.active} onClick={() => changeEditor(project, value => ({ ...value, active: item.path }))}>{item.content !== item.saved ? '● ' : ''}{item.path}</button><button aria-label={`Close ${item.path}`} onClick={() => { if (item.content !== item.saved && !confirm(`Discard unsaved changes to ${item.path}?`)) return; changeEditor(project, value => { const tabs = value.tabs.filter(other => other.path !== item.path); return { tabs, active: value.active === item.path ? tabs.at(-1)?.path || '' : value.active } }) }}>×</button></div>)}</div>
      {error && <p className="error-inline" role="alert">{error}</p>}
      {tab ? <><div className="editor-toolbar"><strong>{tab.path}</strong><div><button className="secondary-button" disabled={!selection.text || selection.path !== tab.path} title="Ctrl+Alt+Enter" onClick={() => onAttach(`Reference: ${selection.path}:${selection.line}\n\n${selection.text}`)}>Attach selection</button><button className="secondary-button" disabled={changes===null} title={changes===null?'Open a Git repository to compare with HEAD':undefined} onClick={() => setDiff(!diff)}>{diff ? 'Editor' : 'Compare with HEAD'}</button><button className="secondary-button" onClick={() => void reload()}>Reload</button><button className="secondary-button" onClick={() => void api.editorExternal(tab.path).catch(reason => setError(String(reason)))}>Open in VS Code</button><button className="primary-button" disabled={saving || (tab.content === tab.saved && tab.revision !== 'missing')} onClick={() => void save()}>Save</button></div></div><Suspense fallback={<p>Loading editor…</p>}><CodeEditor key={tab.path} path={tab.path} content={tab.content} base={tab.base} diff={diff} onChange={content => changeEditor(project, value => ({ ...value, tabs: value.tabs.map(item => item.path === tab.path ? { ...item, content } : item) }))} onSave={() => void save()} onSelection={(text, line) => setSelection({ path: tab.path, text, line })} onSelect={(text, line) => onAttach(`Reference: ${tab.path}:${line}\n\n${text}`)}/></Suspense></> : <div className="editor-empty">Open a file to edit or compare.</div>}
    </section></div></div>
}
