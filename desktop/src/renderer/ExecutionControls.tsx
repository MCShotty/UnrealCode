import { useEffect, useState } from 'react'
import type { ApprovalRequest, ExecutionMode, Settings } from '../shared/api'
import type { HostApproval } from '../shared/connections'

export function ExecutionControls({ sessionId, settings, onSave }: { sessionId?: string; settings: Settings; onSave(patch: Partial<Settings>): Promise<void> }) {
  const [mode, setMode] = useState<ExecutionMode>(settings.executionMode)
  const [pending, setPending] = useState<ApprovalRequest[]>([])
  const [hostPending,setHostPending]=useState<HostApproval[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [workspace, setWorkspace] = useState<{ path: string; isolated: boolean } | null>(null)
  useEffect(() => {
    let live = true
    setPending([]); setHostPending([]); setError(''); setMode(settings.executionMode)
    void window.unreal.activeWorkspace().then(value => { if (live) setWorkspace(value) }).catch(() => {})
    if (!sessionId) return
    const refresh = () => { void Promise.all([window.unreal.approvals(sessionId),window.unreal.hostApprovals(sessionId)]).then(([items,hosts]) => { if (live) {setPending(items);setHostPending(hosts)} }).catch(reason => { if (live) setError(String(reason)) }) }
    void window.unreal.sessionConfig(sessionId).then(config => { if (live) setMode(config.mode || 'agent') }).catch(reason => { if (live) setError(String(reason)) })
    refresh()
    const dispose = window.unreal.onEvent(event => { if (event.sessionId === sessionId && (event.event.startsWith('permission.') || event.event === 'session.status')) refresh() })
    const timer = setInterval(refresh, 15000)
    const changed=window.unreal.onWorkflowChanged(refresh)
    return () => { live = false; dispose(); changed(); clearInterval(timer) }
  }, [sessionId, settings.executionMode])
  const change = async (value: ExecutionMode) => {
    setBusy(true); setError('')
    try { if (sessionId) await window.unreal.sessionMode(sessionId, value); else await onSave({ executionMode: value }); setMode(value) }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const answer = async (request: ApprovalRequest, allow: boolean) => {
    setBusy(true); setError('')
    try { await window.unreal.respondApproval(request.sessionId, request.id, request.digest, allow); setPending(items => items.filter(item => item.id !== request.id)) }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <section className="execution-controls" aria-label="Execution controls">
    {workspace && <div className="execution-workspace" title={workspace.path}>{workspace.isolated ? 'Isolated task' : 'Project folder'} · {workspace.path}</div>}
    {sessionId && <button className="text-button execution-resume" disabled={busy} onClick={() => { setBusy(true); setError(''); void window.unreal.openSession(sessionId).catch(reason => setError(String(reason))).finally(() => setBusy(false)) }}>Resume session</button>}
    {!sessionId && <label className="execution-isolation"><input type="checkbox" checked={settings.taskIsolation} onChange={event => void onSave({ taskIsolation: event.target.checked })}/> Use a reviewed isolated workspace for new Git tasks</label>}
    <div className="execution-mode"><label>{sessionId ? 'Session mode' : 'New session mode'} <select aria-label="Execution mode" value={mode} disabled={busy} onChange={event => void change(event.target.value as ExecutionMode)}><option value="plan">Plan · read only</option><option value="ask">Ask · approve actions</option><option value="agent">Agent · trusted project</option></select></label><span>{pending.length ? `${pending.length} awaiting approval` : mode === 'plan' ? 'Dedicated reading and search tools only' : mode === 'ask' ? 'Commands and edits need approval' : 'Granted project tools may run'}</span></div>
    {error && <p className="error-inline" role="alert">{error}</p>}
    {hostPending.map(request=><article className="approval-card" key={request.id}><strong>External tool needs approval · {request.tool}</strong><small>{request.target} · workspace {request.workspaceId}</small><details open><summary>Exact arguments</summary><pre>{JSON.stringify(request.arguments,null,2)}</pre></details><div className="button-row">{[true,false].map(allow=><button key={String(allow)} className={allow?'primary-button':'secondary-button'} disabled={busy} onClick={()=>{setBusy(true);void window.unreal.hostRespond(request.sessionId,request.id,request.digest,allow).catch(reason=>setError(String(reason))).finally(()=>setBusy(false))}}>{allow?'Allow external call once':'Deny'}</button>)}</div></article>)}
    {pending.map(request => <article className="approval-card" key={request.id}><strong>{request.tool} needs approval</strong><small>Workspace: {request.workspaceId || 'Current project'} · operation {request.operationId}</small><details><summary>Inspect exact arguments</summary><pre>{JSON.stringify(request.arguments, null, 2)}</pre></details><div className="button-row"><button disabled={busy} className="primary-button" onClick={() => void answer(request, true)}>Allow once</button><button disabled={busy} className="secondary-button" onClick={() => void answer(request, false)}>Deny</button><small>Expires {new Date(request.expiresAt).toLocaleTimeString()}</small></div></article>)}
  </section>
}
