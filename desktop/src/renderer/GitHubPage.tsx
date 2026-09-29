import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, GitBranch, GitCommitHorizontal, GitPullRequest, Plus, RefreshCw } from 'lucide-react'
import type { GitAvailability, GitHubPullRequest, GitHubRepository, GitHubStatus, GitHubWorktree } from '../shared/api'
import { GitHubIntake } from './GitHubIntake'

const api = window.unreal

export function GitHubPage({ project, onOpenProject }: { project:string; onOpenProject: (path: string) => Promise<void> }): ReactNode {
  const loadId=useRef(0)
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [readiness,setReadiness]=useState<GitAvailability|null>(null)
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [worktrees, setWorktrees] = useState<GitHubWorktree[] | null>(null)
  const [requests, setRequests] = useState<GitHubPullRequest[] | null>(null)
  const [branch, setBranch] = useState('')
  const [changes, setChanges] = useState<string[] | null>(null)
  const [sectionErrors, setSectionErrors] = useState<Record<string,string>>({})
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
    const request=++loadId.current
    const [auth,checked]=await Promise.allSettled([api.githubStatus(),api.gitAvailability()])
    if(request!==loadId.current)return
    setStatus(auth.status === 'fulfilled' ? auth.value : { installed: false, authenticated: false, message: 'GitHub status is unavailable. Check the GitHub CLI installation and retry.' })
    const availability:GitAvailability=checked.status==='fulfilled'?checked.value:{available:false,code:'GIT_INACCESSIBLE',message:'Git repository status could not be checked. Refresh after reviewing folder access.'}
    setReadiness(availability)
    setError('');setRepositories([]);setSelected(null);setSectionErrors({})
    if(auth.status==='fulfilled'&&auth.value.authenticated){void api.githubRepositories().then(value=>{if(request===loadId.current)setRepositories(value)}).catch(reason=>{if(request===loadId.current)setSectionErrors(current=>({...current,'repository browser':String(reason)}))})}
    if(!availability.available&&availability.code!=='GIT_COMMIT_REQUIRED'){
      setBranch('');setWorktrees(null);setChanges(null);setRequests(null);return
    }
    if(!availability.available){
      const [files]=await Promise.allSettled([api.gitChanges()]);if(request!==loadId.current)return
      setBranch('');setWorktrees(null);setRequests(null);setChanges(files.status==='fulfilled'?files.value:null)
      if(files.status==='rejected')setSectionErrors(current=>({...current,changes:String(files.reason)}))
      return
    }
    const [current,trees,files,prs]=await Promise.allSettled([api.githubBranch(),api.githubWorktrees(),api.gitChanges(),api.githubPullRequests()])
    if(request!==loadId.current)return
    setBranch(current.status === 'fulfilled' ? current.value : '')
    setWorktrees(trees.status === 'fulfilled' ? trees.value : null)
    setChanges(files.status === 'fulfilled' ? files.value : null)
    setRequests(prs.status === 'fulfilled' ? prs.value : null)
    const errors=Object.fromEntries(([['repository',current],['worktrees',trees],['changes',files],['pull requests',prs]] as const).filter(([,result])=>result.status==='rejected').map(([name,result])=>[name,String((result as PromiseRejectedResult).reason)]))
    setSectionErrors(current=>({...current,...errors}))
  }, [project])
  useEffect(() => { void refresh().catch((reason) => setError(String(reason)));return()=>{loadId.current++} }, [refresh])
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
  const repositoryReady=readiness?.available===true
  const repositoryMessage=readiness&&!readiness.available?(readiness.code==='GIT_REPOSITORY_REQUIRED'?'This folder is not a Git repository. Chat and Files still work; open or clone a Git project to use repository actions.':readiness.code==='GIT_COMMIT_REQUIRED'?'Make an initial commit before using worktrees and pull requests. Local changes remain available below.':readiness.message):''
  return <div className="page-content github-page">
    <div className="page-heading"><div><h1>GitHub</h1><p>Use your existing GitHub CLI login for repository work and pull requests.</p></div><button className="secondary-button" disabled={busy} onClick={() => void run('GitHub state refreshed.', async () => {})}><RefreshCw size={16}/> Refresh</button></div>
    {status && <div className={`github-connection ${status.authenticated ? 'connected' : ''}`}><span className={'status-dot '+(status.authenticated?'on':'')}/><strong>{status.message}</strong>{!status.authenticated && <code>gh auth login</code>}<small>GitHub CLI login is separate from the local repository.</small></div>}
    {repositoryMessage&&<div className="github-repository-state" role="status"><GitBranch size={18}/><p>{repositoryMessage}</p></div>}
    {error && <p className="error-inline notice">{error}</p>}{notice && <p className="success-text notice"><Check size={15}/>{notice}</p>}
    {repositoryReady&&<GitHubIntake pullRequest={selected}/>}
    <div className="github-grid">
      <section className="settings-section"><h2>Repository</h2>{sectionErrors.repository&&<p role="alert" className="error-inline">Repository unavailable: {sectionErrors.repository}</p>}<p>Current branch: <strong>{branch || (repositoryReady?'Unavailable':'No active repository')}</strong></p><div className="button-row"><button className="secondary-button" disabled={busy||!repositoryReady||!!sectionErrors.repository} onClick={() => void run('Fetched origin.', () => api.githubFetch())}><ArrowDownToLine size={15}/> Fetch</button><button className="secondary-button" disabled={busy||!repositoryReady||!!sectionErrors.repository} onClick={() => void run('Pulled current branch.', () => api.githubPull())}>Pull</button><button className="secondary-button" disabled={busy || !repositoryReady || !branch} onClick={() => void run('Pushed current branch.', () => api.githubPush(branch))}><ArrowUpFromLine size={15}/> Push</button></div><h3>Worktrees</h3>{worktrees===null?<p role="status">{repositoryMessage||`Worktrees unavailable: ${sectionErrors.worktrees||'Refresh to retry.'}`}</p>:worktrees.map((tree) => <div className="github-list-row" key={tree.path}><GitBranch size={15}/><span><strong>{tree.branch}</strong><small>{tree.path}</small></span>{!tree.current && <button className="text-button" onClick={() => void onOpenProject(tree.path)}>Open</button>}</div>)}<div className="inline-form"><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="New branch" aria-label="New branch"/><input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} placeholder="Base ref" aria-label="Base ref"/><button className="secondary-button" disabled={busy || !repositoryReady || !newBranch||!!sectionErrors.repository} onClick={() => void run('Worktree created.', async () => { const path = await api.githubCreateWorktree(newBranch, baseRef); await onOpenProject(path) })}><Plus size={15}/> Create</button></div></section>
      <section className="settings-section"><h2>Changes {changes!==null&&<span className="count-pill">{changes.length}</span>}</h2><div className="github-change-list">{changes===null?<p role="status">{repositoryMessage||`Changes unavailable: ${sectionErrors.changes||'Refresh to retry.'}`}</p>:<>{changes.map((line) => <div className="github-list-row" key={line}><span className="change-code">{line.slice(0,2)}</span><span title={line.slice(3)}>{line.slice(3)}</span><button className="text-button" disabled={busy} onClick={() => stage(line, line[0] === ' ' || line[0] === '?')}>{line[0] !== ' ' && line[0] !== '?' ? 'Unstage' : 'Stage'}</button></div>)}{changes.length === 0 && <p className="muted-copy">Working tree is clean.</p>}</>}</div><div className="inline-form"><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Commit message" aria-label="Commit message"/><button className="secondary-button" disabled={busy || !message.trim()||changes===null} onClick={() => void run('Changes committed.', async () => { await api.githubCommit(message); setMessage('') })}><GitCommitHorizontal size={15}/> Commit</button></div></section>
      <section className="settings-section"><h2>Pull requests</h2><div className="github-change-list">{requests===null?<p role="status">{repositoryMessage||`Pull requests unavailable: ${sectionErrors['pull requests']||'Refresh to retry.'}`}</p>:<>{requests.map((request) => <button className={`github-list-row github-pr ${selected === request.number ? 'selected' : ''}`} key={request.number} onClick={() => setSelected(request.number)}><GitPullRequest size={16}/><span><strong>#{request.number} {request.title}</strong><small>{request.headRefName} → {request.baseRefName} · {request.state}</small></span></button>)}{requests.length === 0 && <p className="muted-copy">No pull requests yet.</p>}</>}</div><h3>Create a pull request</h3><input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder="Title" aria-label="Pull request title"/><textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} placeholder="Description" aria-label="Pull request description" rows={4}/><button className="primary-button" disabled={busy || !repositoryReady || !prTitle.trim()||requests===null} onClick={() => void run('Pull request created.', async () => { await api.githubCreatePullRequest(prTitle, prBody, baseRef, true); setPrTitle(''); setPrBody('') })}><Plus size={15}/> Create draft PR</button></section>
      <section className="settings-section"><h2>{detail ? `Review #${detail.number}` : 'Repository browser'}</h2>{detail ? <><p><strong>{detail.title}</strong> · {detail.reviewDecision || 'Review pending'}</p><p>{detail.body}</p><pre className="github-diff">{detail.diff || 'No diff available.'}</pre><label>Review note<textarea value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} rows={3}/></label><div className="button-row">{(['approve','comment','request-changes'] as const).map((action) => <button className="secondary-button" key={action} disabled={busy || (action !== 'approve' && !reviewBody.trim())} onClick={() => void run('Review submitted.', () => api.githubReviewPullRequest(detail.number, action, reviewBody))}>{action}</button>)}</div>{detail.checks && <pre className="github-diff">{detail.checks}</pre>}</> : <><p>Clone a repository into a folder you choose, then open it as a trusted workspace.</p>{sectionErrors['repository browser']&&<p role="alert" className="error-inline">Repository list unavailable: {sectionErrors['repository browser']}</p>}{repositories.slice(0,15).map((repo) => <div className="github-list-row" key={repo.nameWithOwner}><GitBranch size={15}/><span><strong>{repo.nameWithOwner}</strong><small>{repo.description}</small></span><button className="text-button" disabled={busy} onClick={() => void run('Repository cloned.', async () => { const path = await api.githubClone(repo.nameWithOwner); await onOpenProject(path) })}>Clone</button></div>)}</>}</section>
    </div>
  </div>
}
