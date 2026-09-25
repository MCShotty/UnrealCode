import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Square } from 'lucide-react'
import type { ExecutionSummary } from '../shared/api'

const api = window.unreal
const seconds = (value?: number): string => value === undefined ? '—' : `${(value / 1000).toFixed(1)}s`
const active = (status: string): boolean => !['completed', 'failed', 'canceled'].includes(status)

export function ExecutionInspector({ sessionId, eventSequence }: { sessionId?: string; eventSequence: number }): ReactNode {
  const [summary, setSummary] = useState<ExecutionSummary | null>(null)
  const [error, setError] = useState('')
  const activeSession = useRef(sessionId)
  activeSession.current = sessionId
  const update = useCallback((): void => {
    if (!sessionId) return
    void api.executionSummary(sessionId).then((value) => { if (activeSession.current === sessionId) { setSummary(value); setError('') } })
      .catch((reason) => { if (activeSession.current === sessionId) setError(String(reason)) })
  }, [sessionId])
  useEffect(() => {
    if (!sessionId) { setSummary(null); return }
    update()
    const interval = setInterval(update, 5000)
    return () => clearInterval(interval)
  }, [sessionId, update])
  useEffect(() => { const timer = setTimeout(update, 250); return () => clearTimeout(timer) }, [eventSequence, update])
  const cancel = async (operationId: string): Promise<void> => {
    if (!sessionId) return
    try { await api.cancelOperation(sessionId, operationId); setError('') }
    catch (reason) { setError(String(reason)) }
  }
  const operations = summary?.operations || []
  return <section className="context-card execution-inspector"><div className="section-heading"><h3>Parallel activity</h3><span className="count-pill">{operations.filter((item) => active(item.status)).length} active</span></div>
    {summary && <div className="execution-metrics"><span><strong>{seconds(summary.modelMs)}</strong><small>Model</small></span><span><strong>{seconds(summary.toolWallMs)}</strong><small>Tool wall time</small></span><span><strong>{seconds(summary.toolOverlapMs)}</strong><small>Tool overlap</small></span></div>}
    {operations.slice(0, 10).map((item) => <div className="execution-lane" key={item.id}><div className="execution-lane-line"><strong>{item.type}</strong><small>{seconds(item.durationMs)}</small></div><div className="execution-lane-line"><span className={`execution-status ${item.status}`}>{item.status}</span>{active(item.status) && <button className="execution-cancel" aria-label={`Cancel ${item.type}`} onClick={() => void cancel(item.id)}><Square size={12}/> Cancel</button>}</div></div>)}
    {!operations.length && <p className="muted-copy">Tool calls will appear here as they run.</p>}
    {error && <p className="error-inline">{error}</p>}
  </section>
}
