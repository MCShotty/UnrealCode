import { app } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { GitHubPullRequest, GitHubRepository, GitHubStatus, GitHubWorktree } from '../shared/api'
import type { GitHubIssue,GitHubReviewComment,GitHubCheck,GitHubRemoteState } from '../shared/github-workflow'

const exec = promisify(execFile)
const githubName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const refName = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,180}$/

async function run(file: 'git' | 'gh', args: string[], cwd?: string, timeout = 30000): Promise<string> {
  const { stdout } = await exec(file, args, { cwd, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 })
  return stdout.trim()
}

export async function githubStatus(): Promise<GitHubStatus> {
  try { await run('gh', ['--version'], undefined, 5000) }
  catch { return { installed: false, authenticated: false, message: 'Install GitHub CLI to connect repositories.' } }
  try {
    const account = await run('gh', ['api', 'user', '--jq', '.login'], undefined, 15000)
    return { installed: true, authenticated: true, account, message: `Connected as ${account}` }
  } catch { return { installed: true, authenticated: false, message: 'Run gh auth login to connect GitHub.' } }
}

export async function githubRepositories(): Promise<GitHubRepository[]> {
  const output = await run('gh', ['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,description,isPrivate,url'])
  return JSON.parse(output) as GitHubRepository[]
}

export async function githubClone(repository: string, parentDirectory: string): Promise<string> {
  if (!githubName.test(repository)) throw new Error('Use an OWNER/REPO GitHub name')
  const parent = await fs.realpath(parentDirectory)
  if (!(await fs.stat(parent)).isDirectory()) throw new Error('Choose a destination folder')
  const destination = join(parent, repository.split('/')[1])
  if (existsSync(destination)) throw new Error('The destination folder already exists')
  await run('gh', ['repo', 'clone', repository, destination], parent, 5 * 60 * 1000)
  return fs.realpath(destination)
}

async function repo(root: string): Promise<string> {
  const canonical = await fs.realpath(root)
  const gitRoot = await fs.realpath(await run('git', ['rev-parse', '--show-toplevel'], canonical))
  if (gitRoot.toLocaleLowerCase() !== canonical.toLocaleLowerCase()) {
    throw new Error('Open the repository root as the trusted project for GitHub operations')
  }
  return canonical
}

function checkRef(value: string, label = 'Branch'): string {
  if (!refName.test(value) || value.includes('..') || value.includes('//') || value.endsWith('/') || value.endsWith('.lock')) {
    throw new Error(`${label} name is invalid`)
  }
  return value
}

async function pathSpec(root: string, input: string): Promise<string> {
  if (!input || isAbsolute(input) || input.startsWith('-')) throw new Error('Invalid repository path')
  const full = resolve(root, input)
  const rel = relative(root, full)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Path is outside the trusted repository')
  let nearest = full
  while (!existsSync(nearest)) nearest = resolve(nearest, '..')
  const actual = await fs.realpath(nearest)
  const displacement = relative(root, actual)
  if (displacement === '..' || displacement.startsWith(`..${sep}`)) throw new Error('Symlink leaves the trusted repository')
  return rel.replaceAll('\\', '/')
}

export async function githubWorktrees(root: string): Promise<GitHubWorktree[]> {
  const project = await repo(root)
  const lines = (await run('git', ['worktree', 'list', '--porcelain'], project)).split(/\r?\n/)
  const result: GitHubWorktree[] = []
  let current: Partial<GitHubWorktree> = {}
  for (const line of [...lines, '']) {
    if (!line) {
      if (current.path) {
        const worktreePath = await fs.realpath(current.path)
        result.push({ path: worktreePath, head: current.head || '', branch: current.branch || 'detached', current: worktreePath.toLocaleLowerCase() === project.toLocaleLowerCase() })
      }
      current = {}
    } else if (line.startsWith('worktree ')) current.path = line.slice(9)
    else if (line.startsWith('HEAD ')) current.head = line.slice(5)
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '')
  }
  return result
}

export async function githubCreateWorktree(root: string, branch: string, baseRef: string): Promise<string> {
  const project = await repo(root)
  checkRef(branch)
  checkRef(baseRef, 'Base ref')
  await run('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], project)
  const digest = createHash('sha256').update(project.toLocaleLowerCase()).digest('hex').slice(0, 16)
  const folder = join(app.getPath('userData'), 'worktrees', digest)
  await fs.mkdir(folder, { recursive: true })
  const destination = join(folder, branch.replaceAll('/', '-'))
  if (existsSync(destination)) throw new Error('A worktree with this name already exists')
  await run('git', ['worktree', 'add', '-b', branch, destination, baseRef], project)
  return destination
}

export async function githubBranch(root: string): Promise<string> {
  return run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], await repo(root))
}

export async function githubFetch(root: string): Promise<void> { const project=await repo(root),origin=await validatedOrigin(project);await run('git', ['fetch', '--prune', origin.remote, '+refs/heads/*:refs/remotes/origin/*'], project, 120000) }
export async function githubPull(root: string): Promise<void> { const project=await repo(root),origin=await validatedOrigin(project),branch=checkRef(await githubBranch(project));await run('git', ['pull', '--ff-only', origin.remote, branch], project, 120000) }

export async function githubStage(root: string, paths: string[], staged: boolean): Promise<void> {
  const project = await repo(root)
  if (!paths.length || paths.length > 100) throw new Error('Select 1 to 100 files')
  const safe = await Promise.all(paths.map((path) => pathSpec(project, path)))
  const args = staged ? ['add', '--', ...safe] : ['restore', '--staged', '--', ...safe]
  await run('git', args, project)
}

export async function githubCommit(root: string, message: string): Promise<string> {
  const project = await repo(root)
  const title = message.trim()
  if (!title || title.length > 2000 || /[\x00-\x08\x0e-\x1f]/.test(title)) throw new Error('Enter a valid commit message')
  let name = '', email = ''
  try { name = await run('git', ['config', '--get', 'user.name'], project); email = await run('git', ['config', '--get', 'user.email'], project) } catch { /* Use the authenticated GitHub identity below. */ }
  if (!name || !email) {
    let identity: { id?: number; login?: string }
    try { identity = JSON.parse(await run('gh', ['api', 'user', '--jq', '{id,login}'])) as { id?: number; login?: string } }
    catch { throw new Error('Configure a Git author or run gh auth login before committing.') }
    if (!Number.isSafeInteger(identity.id) || !identity.login || !/^[A-Za-z0-9-]+$/.test(identity.login)) throw new Error('GitHub did not return a valid commit identity')
    await run('git', ['config', '--local', 'user.name', identity.login], project)
    await run('git', ['config', '--local', 'user.email', `${identity.id}+${identity.login}@users.noreply.github.com`], project)
  }
  await run('git', ['commit', '-m', title], project, 120000)
  return run('git', ['rev-parse', 'HEAD'], project)
}

export async function githubPush(root: string, branch: string, expected?:GitHubRemoteState): Promise<void> {
  const project = await repo(root)
  if(!expected)throw new Error('Preview the exact GitHub remote and commit before pushing')
  const current = await githubBranch(project)
  if (current !== checkRef(branch)) throw new Error('Push only the checked-out branch')
  const currentState=await githubRemoteState(project);if(JSON.stringify(currentState)!==JSON.stringify(expected))throw new Error('Repository changed after the push preview. Preview again.');await run('git',['push',expected.remote,`${expected.head}:refs/heads/${branch}`],project,120000)
}

function parsePR(value: unknown): GitHubPullRequest {
  const item = value as Record<string, unknown>
  const checks = Array.isArray(item.statusCheckRollup) ? item.statusCheckRollup.map((entry) => {
    const check = entry as Record<string, unknown>
    return `${String(check.name || check.context || 'Check')}: ${String(check.conclusion || check.state || check.status || 'PENDING')}`
  }).join('\n') : ''
  return { number: Number(item.number), title: String(item.title || ''), state: String(item.state || ''), isDraft: Boolean(item.isDraft),
    url: String(item.url || ''), headRefName: String(item.headRefName || ''), baseRefName: String(item.baseRefName || ''),
    reviewDecision: String(item.reviewDecision || ''), checks }
}

const prFields = 'number,title,state,isDraft,url,headRefName,baseRefName,reviewDecision,statusCheckRollup'

async function requireAuthenticatedGithubHost(host: string): Promise<void> {
  if (host === 'github.com') return
  let known: unknown
  try { known = JSON.parse(await run('gh', ['auth', 'status', '--active', '--json', 'hosts'], undefined, 15000)) }
  catch { throw new Error('Sign in to this GitHub Enterprise host with gh before using its repository') }
  const hosts = (known as {hosts?: Record<string, Array<{active?:boolean;state?:string}>>})?.hosts
  const accounts = Object.entries(hosts || {}).find(([name]) => name.toLowerCase() === host)?.[1]
  if (!Array.isArray(accounts) || !accounts.some(account => account.active === true && account.state === 'success')) {
    throw new Error('Origin host is not an authenticated GitHub host. Review the remote URL and connect that host with gh.')
  }
}

async function validatedOrigin(project: string): Promise<{repository:string;remote:string}> {
  const remote = await run('git', ['remote', 'get-url', 'origin'], project)
  const scp = /^(?:git@)?([A-Za-z0-9.-]+):([^/].*)$/.exec(remote)
  let host: string, path: string
  if (scp && !remote.includes('://')) { host = scp[1]; path = scp[2] }
  else {
    let url: URL
    try { url = new URL(remote) } catch { throw new Error('Origin must be a GitHub HTTPS or SSH remote') }
    if (!['https:', 'ssh:'].includes(url.protocol)) throw new Error('Origin must be a GitHub HTTPS or SSH remote')
    if (url.password || url.search || url.hash || url.port || (url.protocol === 'https:' && url.username) || (url.protocol === 'ssh:' && url.username && url.username !== 'git')) throw new Error('Origin remote must not include credentials, ports, or URL parameters')
    host = url.hostname; path = url.pathname.replace(/^\//, '')
  }
  host = host.toLowerCase()
  path = path.replace(/\/$/, '').replace(/\.git$/, '')
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !githubName.test(path)) throw new Error('Origin does not identify a GitHub repository')
  await requireAuthenticatedGithubHost(host)
  return {repository:`${host}/${path}`,remote}
}
async function originRepository(project: string): Promise<string> { return (await validatedOrigin(project)).repository }

export async function githubRemoteState(root:string):Promise<GitHubRemoteState>{const project=await repo(root),origin=await validatedOrigin(project);return{repository:origin.repository,remote:origin.remote,branch:await githubBranch(project),head:await run('git',['rev-parse','HEAD'],project)}}
const numberID=(number:number):void=>{if(!Number.isSafeInteger(number)||number<1)throw new Error('Invalid GitHub item number')}
async function apiRepository(root:string):Promise<{project:string;repository:string;host:string;path:string}>{const project=await repo(root),repository=await originRepository(project),[host,...parts]=repository.split('/');return{project,repository,host,path:parts.join('/')}}
export async function githubIssues(root:string):Promise<GitHubIssue[]>{const info=await apiRepository(root);return JSON.parse(await run('gh',['issue','list','--repo',info.repository,'--state','open','--limit','100','--json','number,title,body,url,state'],info.project))}
export async function githubIssue(root:string,number:number):Promise<GitHubIssue>{numberID(number);const info=await apiRepository(root);return JSON.parse(await run('gh',['issue','view',String(number),'--repo',info.repository,'--json','number,title,body,url,state'],info.project))}
export async function githubReviewComments(root:string,number:number):Promise<GitHubReviewComment[]>{
 numberID(number);const info=await apiRepository(root);const output=await run('gh',['api','--hostname',info.host,`repos/${info.path}/pulls/${number}/comments?per_page=100`,'--paginate','--slurp'],info.project)
 return (JSON.parse(output) as Array<Array<Record<string,any>>>).flat().map(item=>({id:Number(item.id),body:String(item.body||''),path:String(item.path||''),line:typeof item.line==='number'?item.line:null,url:String(item.html_url||''),author:String(item.user?.login||'')}))
}
export async function githubChecks(root:string,number:number):Promise<GitHubCheck[]>{numberID(number);const info=await apiRepository(root),value=JSON.parse(await run('gh',['pr','view',String(number),'--repo',info.repository,'--json','statusCheckRollup'],info.project));return(value.statusCheckRollup||[]).map((item:Record<string,unknown>)=>({name:String(item.name||item.context||'Check'),state:String(item.conclusion||item.state||item.status||''),url:String(item.detailsUrl||item.targetUrl||'')}))}
export async function githubFailureLogs(root:string,number:number,url:string):Promise<string>{
 numberID(number);const info=await apiRepository(root),check=(await githubChecks(root,number)).find(item=>item.url===url)
 if(!check||!['FAILURE','FAILED','TIMED_OUT','CANCELLED'].includes(check.state))throw new Error('Select a failed check on the current pull request')
 const parsed=new URL(url),match=new RegExp(`^/${info.path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}/actions/runs/([0-9]+)/job/([0-9]+)$`).exec(parsed.pathname)
 if(parsed.protocol!=='https:'||parsed.hostname!==info.host||!match)throw new Error('This check has no supported GitHub Actions job log; open its check page')
 const output=await run('gh',['run','view',match[1],'--repo',info.repository,'--job',match[2],'--log-failed'],info.project)
 return output.slice(0,120000).replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[REDACTED]').replace(/(Authorization:\s*(?:Bearer|Basic)\s+)\S+/gi,'$1[REDACTED]')
}
export async function githubPullHead(root:string,number:number):Promise<string>{numberID(number);const info=await apiRepository(root);return run('gh',['pr','view',String(number),'--repo',info.repository,'--json','headRefOid','--jq','.headRefOid'],info.project)}

export async function githubPullRequests(root: string): Promise<GitHubPullRequest[]> {
  const project = await repo(root)
  const output = await run('gh', ['pr', 'list', '--repo', await originRepository(project), '--state', 'all', '--limit', '100', '--json', prFields], project)
  return (JSON.parse(output) as unknown[]).map(parsePR)
}

export async function githubPullRequest(root: string, number: number): Promise<GitHubPullRequest & { body: string; diff: string; comments: string[] }> {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid pull request number')
  const project = await repo(root)
  const repository = await originRepository(project)
  const output = await run('gh', ['pr', 'view', String(number), '--repo', repository, '--json', `${prFields},body,comments`], project)
  const item = JSON.parse(output) as Record<string, unknown>
  const diff = await run('gh', ['pr', 'diff', String(number), '--repo', repository, '--color', 'never'], project)
  const comments = Array.isArray(item.comments) ? item.comments.map((value) => String((value as Record<string, unknown>).body || '')) : []
  return { ...parsePR(item), body: String(item.body || ''), diff, comments }
}

function withBody<T>(body: string, callback: (path: string) => Promise<T>): Promise<T> {
  const folder = mkdtempSync(join(tmpdir(), 'unrealcode-gh-'))
  const path = join(folder, 'body.md')
  writeFileSync(path, body, { encoding: 'utf8', mode: 0o600 })
  return callback(path).finally(() => {
    if (resolve(folder).startsWith(resolve(tmpdir()) + sep)) rmSync(folder, { recursive: true, force: true })
  })
}

export async function githubCreatePullRequest(root: string, title: string, body: string, base: string, draft: boolean,expected?:GitHubRemoteState): Promise<string> {
  const project = await repo(root)
  const current = await githubBranch(project)
  if (!title.trim() || title.length > 500) throw new Error('Enter a pull request title')
  checkRef(base, 'Base branch')
  if (current === base) throw new Error('Create a feature branch before opening a pull request')
  const repository = await originRepository(project)
  if(body.length>64000)throw new Error('Pull request description exceeds the preview limit')
  if(expected){if(JSON.stringify(await githubRemoteState(project))!==JSON.stringify(expected))throw new Error('Repository changed after the preview');const remoteHead=(await run('git',['ls-remote',expected.remote,`refs/heads/${current}`],project)).split(/\s/)[0];if(remoteHead!==expected.head)throw new Error('Push the reviewed branch commit before creating this pull request')}
  return withBody(body, (file) => run('gh', ['pr', 'create', '--repo', repository, '--title', title.trim(), '--body-file', file, '--base', base, '--head', current, ...(draft ? ['--draft'] : [])], project, 120000))
}

export async function githubReviewPullRequest(root: string, number: number, action: 'approve' | 'comment' | 'request-changes', body: string,expectedHead?:string,expectedRepository?:string): Promise<void> {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid pull request number')
  if (!['approve', 'comment', 'request-changes'].includes(action)) throw new Error('Invalid review action')
  if (action !== 'approve' && !body.trim()) throw new Error('Review comment is required')
  const project = await repo(root)
  const flag = action === 'approve' ? '--approve' : action === 'comment' ? '--comment' : '--request-changes'
  const repository = await originRepository(project)
  if(body.length>64000)throw new Error('Review exceeds the preview limit')
  if(expectedHead){if(await githubPullHead(project,number)!==expectedHead)throw new Error('Pull request changed after the preview');const info=await apiRepository(project);if(expectedRepository&&info.repository!==expectedRepository)throw new Error('Repository changed after the review preview');await withBody(JSON.stringify({commit_id:expectedHead,body,event:action==='approve'?'APPROVE':action==='comment'?'COMMENT':'REQUEST_CHANGES'}),file=>run('gh',['api','--hostname',info.host,`repos/${info.path}/pulls/${number}/reviews`,'--method','POST','--input',file],project));return}
  await withBody(body, (file) => run('gh', ['pr', 'review', String(number), '--repo', repository, flag, '--body-file', file], project, 120000))
}
