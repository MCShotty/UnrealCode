import { useEffect, useRef, useState } from 'react'
import { Database, Settings2 } from 'lucide-react'
import type { MemoryRecord, MemoryStatus } from '../shared/memory'

export function mergeRecent(current: MemoryRecord[], recent: MemoryRecord[]): MemoryRecord[] {
  if (!current.length) return recent
  if (!recent.length) return current
  const known = new Set(current.map(row => row.id))
  // If more than a page arrived between polls, restart at the latest page.
  // Its stable first-record cursor can page backward through the gap.
  if (!recent.some(row => known.has(row.id))) return recent
  const updates = new Map(recent.map(row => [row.id, row]))
  return [...current.map(row => updates.get(row.id) || row), ...recent.filter(row => !known.has(row.id))]
}

export function MemoryPage({ projectPath, onSettings }: { projectPath: string; onSettings(): void }) {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [query, setQuery] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [olderBusy, setOlderBusy] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const selection = useRef(0)

  const refresh = async (generation = selection.current) => {
    const next = await window.unreal.memoryStatus()
    if (generation !== selection.current) return
    setStatus(next)
    setRecords(current => next.totalRecords < current.length ? next.records : mergeRecent(current, next.records))
  }
  useEffect(() => {
    const generation = ++selection.current
    setStatus(null); setRecords([]); setEdits({}); setResult(''); setError(''); setBusy(false); setOlderBusy(false)
    void refresh(generation).catch(reason => { if (generation === selection.current) setError(String(reason)) })
    const timer = setInterval(() => { void refresh(generation).catch(() => {}) }, 5000)
    return () => { selection.current++; clearInterval(timer) }
  }, [projectPath])

  const run = async (work: () => Promise<unknown>, changedId?: string) => {
    const generation = selection.current
    setBusy(true); setError('')
    try {
      const value = await work()
      if (generation !== selection.current) return
      if (value !== undefined) setResult(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
      if (changedId) {
        const updated = await window.unreal.memoryRecord(changedId)
        if (generation !== selection.current) return
        setRecords(current => current.map(row => row.id === changedId ? updated : row))
        setEdits(current => { const next = { ...current }; delete next[changedId]; return next })
      }
      await refresh(generation)
    } catch (reason) { if (generation === selection.current) setError(String(reason)) }
    finally { if (generation === selection.current) setBusy(false) }
  }
  const loadOlder = async () => {
    const before = records[0]?.id, generation = selection.current
    if (!before || olderBusy) return
    setOlderBusy(true); setError('')
    try {
      const page = await window.unreal.memoryRecords(before, 50)
      if (generation !== selection.current) return
      setRecords(current => { const known = new Set(current.map(row => row.id)); return [...page.records.filter(row => !known.has(row.id)), ...current] })
      setStatus(current => current ? { ...current, totalRecords: Math.max(current.totalRecords, page.total) } : current)
    } catch (reason) { if (generation === selection.current) setError(String(reason)) }
    finally { if (generation === selection.current) setOlderBusy(false) }
  }

  return <div className="page-content memory-page">
    <div className="page-heading"><div><h1>Project memory</h1><p>Inspect retained knowledge for this project. Current files and session history remain authoritative.</p></div><button className="secondary-button" onClick={onSettings}><Settings2 size={16}/> Memory settings</button></div>
    <section className="memory-status-card" aria-label="Project memory status"><span className="memory-icon"><Database size={19}/></span><div><strong>{!status?.settings.projects.includes(projectPath) ? 'Automatic memory is off for this project' : status?.state === 'ready' ? 'Memory ready' : status?.state === 'disabled' ? 'Memory paused' : status?.state === 'unconfigured' ? 'Memory needs setup' : status?.state === 'starting' ? 'Starting memory' : status?.state === 'unavailable' ? 'Memory unavailable' : 'Checking memory…'}</strong><small>{status?.message || 'Checking local memory service…'}</small></div><span className="memory-status-count">{status?.pending || 0} awaiting retention</span>{status?.state === 'unavailable' && status.settings.projects.includes(projectPath) && <button className="secondary-button" disabled={busy} aria-busy={busy} onClick={() => void run(() => window.unreal.memoryRetry())}>{busy ? 'Retrying…' : 'Retry memory service'}</button>}</section>
    {error && <p role="alert" className="error-inline">{error}</p>}
    <div className="memory-metrics"><section className="settings-section"><span>Model requests</span><strong>{status?.requests || 0}</strong></section><section className="settings-section"><span>Input tokens</span><strong>{status?.inputTokens.toLocaleString() || 0}</strong></section><section className="settings-section"><span>Output tokens</span><strong>{status?.outputTokens.toLocaleString() || 0}</strong></section></div>
    <section className="settings-section memory-storage"><div><h2>Local memory storage</h2><p>Inspect Hindsight storage or review removal of its downloaded model cache. Retained records are kept when the cache is removed.</p></div><div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => void run(() => window.unreal.memoryStorage())}>Inspect storage</button><button className="secondary-button" disabled={busy} onClick={() => void run(() => window.unreal.memoryClearCache())}>Review model-cache cleanup</button></div></section>
    <section className="settings-section memory-recall"><h2>Recall and inspect</h2><p>Search retained notes or ask for a bounded reflection.</p><label>Search project memory<input aria-label="Memory search" value={query} onChange={event => setQuery(event.target.value)} placeholder="What decisions or fixes were recorded?"/></label><div className="button-row"><button className="primary-button" disabled={busy || !query.trim() || status?.state !== 'ready'} onClick={() => void run(() => window.unreal.memoryRecall(query))}>Search memory</button><button className="secondary-button" disabled={busy || !query.trim() || status?.state !== 'ready'} onClick={() => void run(() => window.unreal.memoryReflect(query))}>Reflect</button><button className="secondary-button" disabled={busy} onClick={() => void run(() => window.unreal.memoryRebuild())}>Rebuild from retained records</button><button className="secondary-button" disabled={busy} onClick={() => void run(() => window.unreal.memoryExport())}>Export private memory</button></div>{result && <pre className="memory-result">{result}</pre>}</section>
    <section className="settings-section memory-records"><div className="section-heading"><div><h2>Retained records</h2><p>Review, correct, or forget individual items. Forgotten records are tombstoned against reingestion.</p></div><span className="count-pill">{status?.totalRecords || 0}</span></div>
      {records.map(row => <details className="memory-record" key={row.id}><summary><span className={'memory-record-state ' + row.state}>{row.deletionPending ? 'Deletion pending' : row.state}</span><strong>{row.sourceRefs[0] || 'Recorded task outcome'}</strong><time>{new Date(row.createdAt).toLocaleString()}</time></summary><p>{row.workspace}</p><p>{row.sourceRefs.join(' · ')}</p><textarea aria-label={'Memory record ' + row.id} rows={5} disabled={row.state === 'forgotten'} value={row.state === 'forgotten' ? '' : edits[row.id] ?? row.content} onChange={event => setEdits(current => ({ ...current, [row.id]: event.target.value }))}/><div className="button-row"><button className="secondary-button" disabled={busy || row.state === 'forgotten' || !(edits[row.id] ?? row.content).trim()} onClick={() => void run(() => window.unreal.memoryCorrect(row.id, edits[row.id] ?? row.content), row.id)}>Save correction</button><button className="secondary-button" disabled={busy || row.state === 'forgotten'} onClick={() => void run(() => window.unreal.memoryForget(row.id), row.id)}>Forget this record</button>{row.deletionPending && <button className="secondary-button" disabled={busy || status?.state !== 'ready'} onClick={() => void run(() => window.unreal.memoryRetry())}>Retry deletion</button>}</div>{row.error && <p role="alert" className="error-inline">{row.error}</p>}</details>)}
      {!records.length && <p className="memory-empty">No memory records have been retained for this project yet.</p>}
      {status && status.totalRecords > records.length && <button className="secondary-button memory-load-older" disabled={olderBusy} aria-busy={olderBusy} onClick={() => void loadOlder()}>{olderBusy ? 'Loading…' : `Load older records · ${records.length} of ${status.totalRecords} shown`}</button>}
    </section>
  </div>
}
