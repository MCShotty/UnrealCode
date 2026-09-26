import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AgentEvent, Checkpoint, CheckpointPreview } from '../shared/api'

const api = window.unreal
function text(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function field(value: unknown, key: string): unknown { const row = object(value); return row[key] ?? row[key[0].toLowerCase() + key.slice(1)] }
function changedLines(diff: string): { before: Set<number>; after: Set<number> } {
  const result = { before: new Set<number>(), after: new Set<number>() }
  let oldLine = 0, newLine = 0
  for (const line of diff.split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); continue }
    if (!oldLine && !newLine || line.startsWith('---') || line.startsWith('+++')) continue
    if (line.startsWith('-')) result.before.add(oldLine++)
    else if (line.startsWith('+')) result.after.add(newLine++)
    else if (line.startsWith(' ')) { oldLine++; newLine++ }
  }
  return result
}
export function ReviewWorkspace({ onSteer }: { onSteer: (sessionId: string, text: string) => Promise<void> }): ReactNode {
  const [items, setItems] = useState<Checkpoint[]>([])
  const [selected, setSelected] = useState<Checkpoint | null>(null)
  const [preview, setPreview] = useState<CheckpointPreview | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [mode, setMode] = useState('unified')
  const [comment, setComment] = useState('')
  const [line, setLine] = useState('')
  const [comments, setComments] = useState<string[]>([])
  const [evidence, setEvidence] = useState<AgentEvent[]>([])
  const [storage, setStorage] = useState({ bytes: 0, count: 0 })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const selection = useRef('')
  const changed = useMemo(() => changedLines(preview?.diff || ''), [preview?.diff])
  const evidenceRows = useMemo(() => {
    const rows: Array<{ id: string; title: string; content: string }> = []
    const operations = new Map<string, { id: string; title: string; content: string }>()
    for (const event of evidence) {
      const value = event.payload
      if (event.event === 'session.item' && field(value, 'Kind') === 'model_response') {
        const output = field(field(field(value, 'Data'), 'Response'), 'Output')
        if (Array.isArray(output)) for (const [index, item] of output.entries()) if (field(item, 'Type') === 'message') {
          const message = field(field(item, 'Data'), 'Text')
          if (typeof message === 'string' && message) rows.push({ id: `${event.seq}:${index}`, title: 'Agent explanation', content: message })
        }
      }
      if (event.event === 'operation.update') {
        const state = field(value, 'State'), result = field(state, 'Result')
        const command = field(field(state, 'Input'), 'Command')
        const status = field(value, 'Status')
        if (typeof command === 'string' && ['completed', 'failed', 'canceled'].includes(String(status))) {
          const id = String(field(value, 'ID'))
          operations.set(id, { id, title: `${status}: ${command}`, content: text(result ?? { stdout: field(state, 'InlineOut'), stderr: field(state, 'InlineErr'), error: field(state, 'TerminalError') }) })
        }
      }
    }
    return [...rows, ...operations.values()]
  }, [evidence])
  const refresh = useCallback(async (): Promise<void> => {
    const [values, usage] = await Promise.all([api.checkpoints(), api.checkpointStorage()])
    setItems(values); setStorage(usage)
  }, [])
  useEffect(() => { void refresh().catch((reason) => setError(String(reason))) }, [refresh])
  const choose = async (item: Checkpoint): Promise<void> => {
    selection.current = item.id
    setSelected(item); setPreview(null); setChecked([]); setComments([]); setConfirm(false); setEvidence([])
    try {
      const history = await api.getEvents(item.sessionId, 0)
      const end = items.filter((other) => other.sessionId === item.sessionId && other.createdAt > item.createdAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.createdAt
      if (selection.current === item.id) setEvidence(history.filter((event) => (!event.recordedAt || event.recordedAt >= item.createdAt) && (!end || !event.recordedAt || event.recordedAt < end)))
    } catch (reason) { setError(String(reason)) }
  }
  const open = async (path: string): Promise<void> => {
    if (!selected) return
    const id = selected.id
    try { const value = await api.checkpointPreview(id, path); if (selection.current === id) { setPreview(value); setLine(''); setConfirm(false) } } catch (reason) { setError(String(reason)) }
  }
  const restore = async (): Promise<void> => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const checks = await Promise.all(checked.map((path) => api.checkpointPreview(selected.id, path)))
      const conflict = checks.find((item) => item.conflict)
      if (conflict) throw new Error(`Cannot restore ${conflict.path}: ${conflict.reason || 'later edits conflict'}`)
      if (!confirm) { setConfirm(true); return }
      await api.checkpointRestore(selected.id, checked)
      setConfirm(false); setChecked([]); setPreview(null); await refresh()
    } catch (reason) { setError(String(reason)); setConfirm(false) } finally { setBusy(false) }
  }
  return <div className="page-content review-page"><div className="page-heading"><div><h1>Review</h1><p>Per-turn file changes and recovery. {storage.count} checkpoints · {(storage.bytes / 1048576).toFixed(1)} MB of 512 MB · newest 30 retained.</p></div><button className="secondary-button" onClick={() => void refresh().catch((reason) => setError(String(reason)))}>Refresh</button></div>
    {error && <p className="error-inline" role="alert">{error}</p>}
    <div className="review-grid"><aside className="review-list">{items.map((item) => <button className={selected?.id === item.id ? 'selected' : ''} key={item.id} onClick={() => void choose(item)}><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.state}</small><small>{item.files.length} files · capture {Math.round(item.durationMs)} ms</small></button>)}{!items.length && <p>Checkpoints appear after you send a task. Existing sessions remain available in Sessions.</p>}</aside>
    <section className="review-detail">{selected && <><h2>{selected.title}</h2>{selected.reason && <p className="error-inline">{selected.reason}</p>}<div className="review-actions"><button className="secondary-button" disabled={busy || !checked.length || selected.state !== 'complete'} onClick={() => void restore()}>{confirm ? `Confirm restore of ${checked.length} files` : 'Preview restore selection'}</button><button className="text-button" disabled={busy || ['running', 'capturing'].includes(selected.state)} onClick={async () => { try { await api.checkpointRemove(selected.id); setSelected(null); setPreview(null); await refresh() } catch (reason) { setError(String(reason)) } }}>Delete checkpoint</button></div>{confirm && <p>These {checked.length} files will return to their state before this turn. A recovery checkpoint will be saved first. Later edits block restoration.</p>}
    {selected.files.map((file) => <div className="review-file" key={file.path}><input type="checkbox" aria-label={`Select ${file.path}`} disabled={file.change === 'uncaptured' || selected.state !== 'complete'} checked={checked.includes(file.path)} onChange={(event) => { setChecked(event.target.checked ? [...checked, file.path] : checked.filter((path) => path !== file.path)); setConfirm(false) }}/><button onClick={() => void open(file.path)}>{file.path}</button><small>{file.change}{file.reason ? ` · ${file.reason}` : ''}</small></div>)}
    {preview && <><div className="review-actions"><strong>{preview.path}</strong><select aria-label="Diff layout" value={mode} onChange={(event) => setMode(event.target.value)}><option value="unified">Unified diff</option><option value="split">Side by side</option></select></div>{preview.conflict && <p className="error-inline">{preview.reason || 'The file has later edits. Restore is blocked.'}</p>}{preview.binary ? <p>Binary file: {preview.beforeSize} → {preview.afterSize} bytes. Content preview is unavailable.</p> : mode === 'split' ? <div className="split-diff"><section><h3>Before</h3><pre>{preview.before.split('\n').slice(0, 2000).map((text, index) => <span className={changed.before.has(index + 1) ? 'deleted' : ''} key={index}><span className="diff-number">{index + 1}</span>{text}{'\n'}</span>)}</pre></section><section><h3>After</h3><pre>{preview.after.split('\n').slice(0, 2000).map((text, index) => <span className={changed.after.has(index + 1) ? 'added' : ''} key={index}><button title="Comment on this line" className="diff-number" onClick={() => setLine(String(index + 1))}>{index + 1}</button>{text}{'\n'}</span>)}</pre></section></div> : <pre className="unified-diff">{preview.diff.split('\n').slice(0, 4000).map((value, index) => <span className={value.startsWith('+') ? 'added' : value.startsWith('-') ? 'deleted' : ''} key={index}>{value}{'\n'}</span>)}</pre>}
    <p className="muted-copy">Previews show up to 2,000 lines per file or 4,000 diff lines. Restore always uses the full captured file.</p><div className="review-comment"><label>After-file line (optional)<input type="number" min={1} value={line} onChange={(event) => setLine(event.target.value)}/></label><textarea aria-label="Review comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Describe what should change…"/><button className="secondary-button" disabled={!comment.trim()} onClick={() => { setComments([...comments, `${preview.path}${line ? `:${line}` : ''}: ${comment.trim()}`]); setComment('') }}>Add comment</button></div></>}
    {!!comments.length && <div><pre>{comments.join('\n\n')}</pre><button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await onSteer(selected.sessionId, `Review feedback:\n\n${comments.join('\n\n')}`); setComments([]) } catch (reason) { setError(String(reason)) } finally { setBusy(false) } }}>Send comments as steering</button></div>}
    <section className="review-evidence"><h3>Explanations and command results</h3>{evidenceRows.map((row) => <details key={row.id} open><summary>{row.title}</summary><pre>{row.content}</pre></details>)}{!evidenceRows.length && <p>No recorded explanations or completed commands for this checkpoint.</p>}</section>
    <details><summary>Raw recorded events</summary>{evidence.filter((event) => ['session.item', 'operation.update'].includes(event.event)).map((event) => <details key={event.seq}><summary>{event.event} · {event.recordedAt}</summary><pre>{text(event.payload)}</pre></details>)}</details></>}</section></div></div>
}
