import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AccountUsage, UsageSnapshot, UsageTotals } from '../shared/api'

const api = window.unreal
const number = (value: number): string => value.toLocaleString()
const when = (value?: string): string => value ? new Date(value).toLocaleString() : 'Never'

function AccountCard({ account, onSettings }: { account: AccountUsage; onSettings: () => void }): ReactNode {
  const title = account.source === 'codex' ? 'Codex subscription' : account.source === 'openai' ? 'OpenAI API' : 'Anthropic API'
  return <section className="usage-account-card">
    <div className="usage-account-heading"><div><h2>{title}</h2><small>{account.scope}</small></div><span className={`usage-state ${account.status}`}>{account.status}</span></div>
    {account.windows?.length ? account.windows.map((window) => <div className="usage-window" key={window.id}>
      <div><strong>{window.label}</strong><strong>{Math.round(window.usedPercent)}% used</strong></div>
      <div className="usage-meter" role="meter" aria-label={`${window.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.usedPercent}><span style={{ width: `${window.usedPercent}%` }}/></div>
      <small>{window.windowDurationMins ? `${window.windowDurationMins} minute window` : 'Window'}{window.resetsAt ? ` · Resets ${new Date(window.resetsAt * 1000).toLocaleString()}` : ''}</small>
    </div>) : null}
    {account.totals && <div className="account-totals"><span><strong>{number(account.totals.input)}</strong><small>Input tokens</small></span><span><strong>{number(account.totals.output)}</strong><small>Output tokens</small></span><span><strong>{number(account.totals.cached)}</strong><small>Cached input</small></span></div>}
    {account.message && <p className={account.status === 'unavailable' ? 'muted-copy' : 'warning-copy'}>{account.message}</p>}
    {account.source !== 'codex' && account.status === 'unavailable' && <button className="text-button" onClick={onSettings}>Connect in Settings</button>}
    {account.source === 'codex' && account.status === 'unavailable' && <a href="https://learn.chatgpt.com/docs/app-server">Codex setup</a>}
    <small className="usage-checked">{account.observedAt ? `Checked ${when(account.observedAt)}${account.source !== 'codex' ? ' · Reports may lag recent requests' : ''}` : 'No account report fetched'}</small>
  </section>
}

function total(sessions: UsageSnapshot['sessions']): UsageTotals {
  return sessions.reduce((sum, session) => {
    for (const key of Object.keys(sum) as Array<keyof UsageTotals>) sum[key] += session.totals[key]
    return sum
  }, { input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0, calls: 0, decisionInput: 0, decisionOutput: 0, decisionCalls: 0, latestInput: 0 })
}

export function UsageDashboard({ onSettings }: { onSettings: () => void }): ReactNode {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const refresh = async (force = false): Promise<void> => {
    try { setLoading(true); setSnapshot(await api.usageSnapshot(force)); setError('') }
    catch (reason) { setError(String(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), 60000)
    return () => clearInterval(interval)
  }, [])
  const sessions = snapshot?.sessions || []
  const totals = total(sessions)
  return <div className="page-content usage-page">
    <div className="page-heading"><div><h1>Usage</h1><p>Provider reports and measured UnrealCode activity, shown separately.</p></div><button className="secondary-button" onClick={() => void refresh(true)} disabled={loading}><RefreshCw size={15}/>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {error && <p className="error-inline">{error}</p>}
    <div className="usage-account-grid">{snapshot?.accounts.map((account) => <AccountCard key={account.source} account={account} onSettings={onSettings}/>)}</div>
    <div className="section-heading usage-section-heading"><h2>UnrealCode sessions</h2><small>Only this workspace · cached tokens are included in input</small></div>
    <div className="stats-grid">{[
      ['Input', totals.input], ['Output', totals.output], ['Cached', totals.cached], ['Cache writes', totals.cacheWrite],
      ['Reasoning', totals.reasoning], ['Model responses', totals.calls], ['Decision input', totals.decisionInput], ['Decision output', totals.decisionOutput]
    ].map(([label, value]) => <div className="stat-box" key={label}><small>{label}</small><strong>{number(Number(value))}</strong></div>)}</div>
    <div className="usage-table"><div className="usage-head"><span>Session · provider</span><span>Input</span><span>Output</span><span>Cached</span><span>Latest context</span></div>
      {sessions.map((row) => <div className="usage-row" key={row.sessionId}><span title={row.title}>{row.title}<small>{row.provider} · {row.model}</small></span><span>{number(row.totals.input)}</span><span>{number(row.totals.output)}</span><span>{number(row.totals.cached)}<small>{row.totals.input ? `${Math.round(row.totals.cached / row.totals.input * 100)}% of input` : 'No input measured'}</small></span><span>{number(row.totals.latestInput)}<small className={row.contextLimit && row.totals.latestInput / row.contextLimit >= .8 ? 'warning-copy' : ''}>{row.contextLimit ? `${Math.round(row.totals.latestInput / row.contextLimit * 100)}% of ${number(row.contextLimit)} · ${row.contextSource}` : 'Limit unknown'}</small></span></div>)}
      {!sessions.length && <p className="muted-copy pad">No recorded model usage yet.</p>}
    </div>
    <div className="section-heading usage-section-heading"><h2>API rate-limit headroom</h2><small>Latest response headers · short windows, separate from account usage</small></div>
    <div className="rate-headroom-list">{sessions.filter((row) => row.rateLimits && Object.keys(row.rateLimits).length).slice(0, 8).map((row) => {
      const headers = row.rateLimits || {}
      const anthropic = row.provider === 'anthropic'
      const groups = anthropic
        ? [['Requests', 'anthropic-ratelimit-requests-limit', 'anthropic-ratelimit-requests-remaining'], ['Input tokens', 'anthropic-ratelimit-input-tokens-limit', 'anthropic-ratelimit-input-tokens-remaining'], ['Output tokens', 'anthropic-ratelimit-output-tokens-limit', 'anthropic-ratelimit-output-tokens-remaining']]
        : [['Requests', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests'], ['Tokens', 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens']]
      return <div className="rate-headroom-row" key={row.sessionId}><strong>{row.provider} · {row.model}</strong>{groups.map(([label, limitKey, remainingKey]) => {
        const limit = headers[limitKey]
        const remaining = headers[remainingKey]
        return limit && remaining ? <span key={label}><small>{label}</small>{remaining} / {limit} remaining</span> : null
      })}</div>
    })}{!sessions.some((row) => row.rateLimits && Object.keys(row.rateLimits).length) && <p className="muted-copy pad">No rate-limit headers recorded for this workspace.</p>}</div>
  </div>
}
