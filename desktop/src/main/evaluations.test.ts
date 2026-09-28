import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const state = vi.hoisted(() => ({ calls: [] as Array<{ method: string; params: any }>, docker: [] as string[][], finish: true, binary: false }))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const realExec = promisify(actual.execFile)
  // Unit fixtures have no Docker volumes. Real cleanup is checked by packaged QA.
  const execFile = Object.assign(() => {}, { [promisify.custom]: async (file: string, args: string[], options: object) => { if(/(?:^|[\\/])docker(?:\.exe)?$/i.test(file)){state.docker.push(args);return {stdout:'',stderr:''}}return realExec(file,args,options) } })
  return { ...actual, execFile }
})
vi.mock('./settings', () => ({ credentialFor: () => ({ apiKey: 'fixture-credential' }) }))
vi.mock('./session-usage', () => ({ consumeUsage: () => {}, SessionUsageService: class { async summaries() { return [{ sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', totals: { input: 20, output: 5, cached: 0, decisionInput: 0, decisionOutput: 0 } }] } } }))
vi.mock('./docker', () => ({ DockerBridge: class {
  containerName = 'fake-container'; onEvent = (_: any): void => {}
  directory = ''
  async start(directory: string) { this.directory = directory } async stop() {}
  async request(method: string, params: any) {
    state.calls.push({ method, params })
    if (method === 'decision.configure') return { available: params.engine !== 'off' }
    if (method === 'session.create') return { sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }
    if (method === 'session.send' && state.binary) await import('node:fs/promises').then(fs => fs.writeFile(join(this.directory, 'asset.bin'), Buffer.from([0, 9, 2])))
    if (method === 'session.send' && state.finish) this.onEvent({ v: 1, seq: 1, sessionId: params.sessionId, event: 'session.idle', payload: {} })
    if (method === 'decision.idle') return true
    return {}
  }
} }))
import { Evaluations, validateEvaluation } from './evaluations'
import { defaultVolume } from './state-volumes'
let root: string, project: string
const config = { provider: 'openai-compatible' as const, model: 'fixture', baseUrl: 'http://localhost:1/v1', thinkingLevel: 'low', systemPrompt: 'instructions', disallowedTools: [] }
const request = { tasks: [{ prompt: 'Implement the selected change', criteria: 'The behavior matches the task', testCommand: '' }], runLimit: 2, timeoutMinutes: 1 }
beforeEach(async () => {
  state.calls = []; state.docker = []; state.finish = true; state.binary = false
  root = await mkdtemp(join(tmpdir(), 'unrealcode-eval-test-')); project = join(root, 'project'); await mkdir(project)
  execFileSync('git', ['init', project], { windowsHide: true, stdio: 'ignore' })
  await writeFile(join(project, 'sample.txt'), 'original')
  execFileSync('git', ['-C', project, 'add', '.'], { windowsHide: true })
  execFileSync('git', ['-C', project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'baseline'], { windowsHide: true, stdio: 'ignore' })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
it('runs paired immutable inputs, preserves usage, cleans worktrees, and never persists credentials', async () => {
  const service = new Evaluations(join(root, 'reports'))
  const extendedConfig = { ...config, apiKey: 'unrecognized-provider-credential' }
  const id = await service.start(project, extendedConfig, request, { engine: 'jev', model: 'jev-latest', apiKey: 'private-evaluation-fixture', glinerEnabled: false }, ['excluded'])
  await vi.waitFor(async () => { const report=(await service.list(project))[0]; expect(report.state,JSON.stringify(report)).toBe('completed') }, { timeout: 10000 })
  const report = (await service.list(project))[0]
  expect(report.arms.map(arm => arm.decisions)).toEqual([false, true])
  expect(report.arms.every(arm => !arm.worktree && arm.usage?.input === 20)).toBe(true)
  expect(state.calls.filter(call => call.method === 'session.send').map(call => call.params.prompt)).toEqual([expect.any(String), expect.any(String)])
  const sent = state.calls.filter(call => call.method === 'session.send'); expect(sent[0].params.prompt).toBe(sent[1].params.prompt)
  expect(state.calls.filter(call => call.method === 'decision.configure').map(call => call.params.engine)).toEqual(['off', 'jev'])
  expect(await readFile(join(root, 'reports', `${id}.json`), 'utf8')).not.toContain('private-evaluation-fixture')
  expect(await readFile(join(root, 'reports', `${id}.json`), 'utf8')).not.toContain('fixture-credential')
  expect(await readFile(join(root, 'reports', `${id}.json`), 'utf8')).not.toContain('unrecognized-provider-credential')
  expect(await readFile(join(project, 'sample.txt'), 'utf8')).toBe('original')
  expect(execFileSync('git', ['-C', project, 'status', '--porcelain']).toString()).toBe('')
})
it('cancels a running arm without starting its pair', async () => {
  state.finish = false
  const service = new Evaluations(join(root, 'reports'))
  const id = await service.start(project, config, request, { engine: 'jev', model: 'jev-latest', apiKey: 'fixture', glinerEnabled: false }, [])
  await vi.waitFor(() => expect(state.calls.some(call => call.method === 'session.send')).toBe(true), { timeout: 10000 })
  await service.cancel(id)
  await vi.waitFor(async () => expect((await service.list(project))[0].state).toBe('cancelled'), { timeout: 10000 })
  expect(state.calls.filter(call => call.method === 'session.create')).toHaveLength(1)
})
it('rejects missing consent, dirty inputs, and insufficient run limits before execution', async () => {
  expect(() => validateEvaluation({ ...request, runLimit: 1 })).toThrow('both arms')
  const service = new Evaluations(join(root, 'reports'))
  await expect(service.start(project, config, request, { engine: 'jev', model: '', apiKey: '', glinerEnabled: false }, [])).rejects.toThrow('consent')
  await writeFile(join(project, 'dirty.txt'), 'uncommitted')
  await expect(service.start(project, config, request, { engine: 'jev', model: '', apiKey: 'fixture', glinerEnabled: false }, [])).rejects.toThrow('Commit or stash')
  expect(state.calls).toEqual([])
})

it('shows interrupted persisted runs after restart without launching a model', async () => {
  const directory = join(root, 'reports'); await mkdir(directory)
  const canonical = await import('node:fs/promises').then(fs => fs.realpath(project))
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, project: canonical, createdAt: new Date().toISOString(), revision: 'fixture', config, engine: 'jev', model: 'jev-latest', request, state: 'running', arms: [{ task: 0, decisions: false, state: 'running' }] }))
  const reports = await new Evaluations(directory).list(project)
  expect(reports[0].state).toBe('interrupted')
  expect(reports[0].error).toContain('not resume automatically')
  expect(state.calls).toEqual([])
})

it('retains modified tracked binary files that textual diff cannot recover', async () => {
  await writeFile(join(project, 'asset.bin'), Buffer.from([0, 1, 2]))
  execFileSync('git', ['-C', project, 'add', '.'], { windowsHide: true })
  execFileSync('git', ['-C', project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'binary fixture'], { windowsHide: true, stdio: 'ignore' })
  state.binary = true
  const service = new Evaluations(join(root, 'reports'))
  await service.start(project, config, request, { engine: 'jev', model: 'jev-latest', apiKey: 'fixture', glinerEnabled: false }, [])
  await vi.waitFor(async () => { const report=(await service.list(project))[0]; expect(report.state,JSON.stringify(report)).toBe('completed') }, { timeout: 10000 })
  for (const arm of (await service.list(project))[0].arms) {
    expect(arm.worktree).toBeTruthy()
    expect(await readFile(join(arm.worktree!, 'asset.bin'))).toEqual(Buffer.from([0, 9, 2]))
  }
})

it('cleans only registered restored evaluation storage and rejects stale volume identities',async()=>{
 const directory=join(root,'reports');await mkdir(directory)
 const canonical=await import('node:fs/promises').then(fs=>fs.realpath(project)),id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',workspace=join(directory,'worktrees',id,'0')
 const original=defaultVolume(workspace,true),restored='unrealcode-restore-cccccccc-cccc-cccc-cccc-cccccccccccc'
 const report={id,project:canonical,createdAt:new Date().toISOString(),revision:'fixture',config,engine:'jev',model:'jev-latest',request,state:'completed',arms:[{task:0,decisions:false,state:'completed',retainedVolume:original}]}
 await writeFile(join(root,'state-volumes.json'),JSON.stringify([{project:workspace,isolated:true,volume:restored}]))
 await writeFile(join(directory,`${id}.json`),JSON.stringify(report))
 const service=new Evaluations(directory)
 await expect(service.cleanup(project,id)).rejects.toThrow('identity');expect(state.docker).toEqual([])
 report.arms[0].retainedVolume=restored;await writeFile(join(directory,`${id}.json`),JSON.stringify(report))
 await service.cleanup(project,id)
 expect(state.docker).toEqual([['volume','rm',restored]])
 expect((await service.list(project))[0].arms[0].retainedVolume).toBeUndefined()
})
