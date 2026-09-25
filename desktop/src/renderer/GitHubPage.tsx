import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, GitBranch, GitCommitHorizontal, GitPullRequest, Plus, RefreshCw } from 'lucide-react'
import type { GitHubPullRequest, GitHubRepository, GitHubStatus, GitHubWorktree } from '../shared/api'

const api = window.unreal

export function GitHubPage({ onOpenProject }: { onOpenProject: (path: string) => Promise<void> }): ReactNode {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [worktrees, setWorktrees] = useState<GitHubWorktree[]>([])
  const [requests, setRequests] = useState<GitHubPullRequest[]>([])
  const [branch, setBranch] = useState('')
  const [changes, setChanges] = useState<string[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.githubPullRequest>> | null>(null)
  const [message, setMessage] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [baseRef, setBaseRef] = useState('main')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [reviewBody, setReviewBody] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const [auth, current, trees, files, prs] = await Promise.all([
      api.githubStatus(), api.githubBranch(), api.githubWorktrees(), api.gitChanges(), api.githubPullRequests()
    ])
    setStatus(auth); setBranch(current); setWorktrees(trees); setChanges(files); setRequests(prs)
    if (auth.authenticated) setRepositories(await api.githubRepositories())
  }, [])
  useEffect(() => { void refresh().catch((reason) => setError(String(reason))) }, [refresh])
  useEffect(() => {
    if (selected === null) { setDetail(null); return }
    void api.githubPullRequest(selected).then(setDetail).catch((reason) => setError(String(reason)))
  }, [selected])
  const run = async (label: string, operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try { await operation(); setNotice(label); await refresh() }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const stage = (line: string, staged: boolean): void => { void run(staged ? 'File staged.' : 'File unstaged.', () => staged ? api.githubStage([line.slice(3)]) : api.githubUnstage([line.slice(3)])) }
  return <div className="page-content github-page">
    <div className="page-heading"><div><h1>GitHub</h1><p>Use your existing GitHub CLI login for repository work and pull requests.</p></div><button className="secondary-button" disabled={busy} onClick={() => void run('GitHub state refreshed.', async () => {})}><RefreshCw size={16}/> Refresh</button></div>
    {status && <div className={`github-connection ${status.authenticated ? 'connected' : ''}`}><span className="status-dot on"/><strong>{status.message}</strong>{!status.authenticated && <code>gh auth login</code>}</div>}
    {error && <p className="error-inline notice">{error}</p>}{notice && <p className="success-text notice"><Check size={15}/>{notice}</p>}
    <div className="github-grid">
      <section className="settings-section"><h2>Repository</h2><p>Current branch: <strong>{branch || 'Unavailable'}</strong></p><div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => void run('Fetched origin.', () => api.githubFetch())}><ArrowDownToLine size={15}/> Fetch</button><button className="secondary-button" disabled={busy} onClick={() => void run('Pulled current branch.', () => api.githubPull())}>Pull</button><button className="secondary-button" disabled={busy || !branch} onClick={() => void run('Pushed current branch.', () => api.githubPush(branch))}><ArrowUpFromLine size={15}/> Push</button></div><h3>Worktrees</h3>{worktrees.map((tree) => <div className="github-list-row" key={tree.path}><GitBranch size={15}/><span><strong>{tree.branch}</strong><small>{tree.path}</small></span>{!tree.current && <button className="text-button" onClick={() => void onOpenProject(tree.path)}>Open</button>}</div>)}<div className="inline-form"><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="New branch" aria-label="New branch"/><input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} placeholder="Base ref" aria-label="Base ref"/><button className="secondary-button" disabled={busy || !newBranch} onClick={() => void run('Worktree created.', async () => { const path = await api.githubCreateWorktree(newBranch, baseRef); await onOpenProject(path) })}><Plus size={15}/> Create</button></div></section>
      <section className="settings-section"><h2>Changes <span className="count-pill">{changes.length}</span></h2><div className="github-change-list">{changes.map((line) => <div className="github-list-row" key={line}><span className="change-code">{line.slice(0,2)}</span><span title={line.slice(3)}>{line.slice(3)}</span><button className="text-button" disabled={busy} onClick={() => stage(line, line[0] === ' ' || line[0] === '?')}>{line[0] !== ' ' && line[0] !== '?' ? 'Unstage' : 'Stage'}</button></div>)}{changes.length === 0 && <p className="muted-copy">Working tree is clean.</p>}</div><div className="inline-form"><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Commit message" aria-label="Commit message"/><button className="secondary-button" disabled={busy || !message.trim()} onClick={() => void run('Changes committed.', async () => { await api.githubCommit(message); setMessage('') })}><GitCommitHorizontal size={15}/> Commit</button></div></section>
      <section className="settings-section"><h2>Pull requests</h2><div className="github-change-list">{requests.map((request) => <button className={`github-list-row github-pr ${selected === request.number ? 'selected' : ''}`} key={request.number} onClick={() => setSelected(request.number)}><GitPullRequest size={16}/><span><strong>#{request.number} {request.title}</strong><small>{request.headRefName} → {request.baseRefName} · {request.state}</small></span></button>)}{requests.length === 0 && <p className="muted-copy">No pull requests yet.</p>}</div><h3>Create a pull request</h3><input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder="Title" aria-label="Pull request title"/><textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} placeholder="Description" aria-label="Pull request description" rows={4}/><button className="primary-button" disabled={busy || !prTitle.trim()} onClick={() => void run('Pull request created.', async () => { await api.githubCreatePullRequest(prTitle, prBody, baseRef, true); setPrTitle(''); setPrBody('') })}><Plus size={15}/> Create draft PR</button></section>
      <section className="settings-section"><h2>{detail ? `Review #${detail.number}` : 'Repository browser'}</h2>{detail ? <><p><strong>{detail.title}</strong> · {detail.reviewDecision || 'Review pending'}</p><p>{detail.body}</p><pre className="github-diff">{detail.diff || 'No diff available.'}</pre><label>Review note<textarea value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} rows={3}/></label><div className="button-row">{(['approve','comment','request-changes'] as const).map((action) => <button className="secondary-button" key={action} disabled={busy || (action !== 'approve' && !reviewBody.trim())} onClick={() => void run('Review submitted.', () => api.githubReviewPullRequest(detail.number, action, reviewBody))}>{action}</button>)}</div>{detail.checks && <pre className="github-diff">{detail.checks}</pre>}</> : <><p>Clone a repository into a folder you choose, then open it as a trusted workspace.</p>{repositories.slice(0,15).map((repo) => <div className="github-list-row" key={repo.nameWithOwner}><GitBranch size={15}/><span><strong>{repo.nameWithOwner}</strong><small>{repo.description}</small></span><button className="text-button" disabled={busy} onClick={() => void run('Repository cloned.', async () => { const path = await api.githubClone(repo.nameWithOwner); await onOpenProject(path) })}>Clone</button></div>)}</>}</section>
    </div>
  </div>
}
