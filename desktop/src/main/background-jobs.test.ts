import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess, spawn } from 'node:child_process'
vi.mock('./terminal-command', () => ({ terminalDockerExecutable: () => 'fixture-docker' }))
import { BackgroundJobs } from './background-jobs'

const roots: string[] = []
const instances: BackgroundJobs[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const jobs of instances.splice(0)) await jobs.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture(onStart = () => {}, launch?: typeof spawn) {
  const root = await mkdtemp(join(tmpdir(), 'unrealcode-background-jobs-'))
  roots.push(root)
  const path = join(root, 'jobs.json')
  const jobs = new BackgroundJobs(path, root, () => 'fixture-container', onStart, launch)
  instances.push(jobs)
  return { path, jobs }
}

it('waits for an in-flight debounced save before workspace close returns', async () => {
  const { jobs, path } = await fixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  ;(jobs as any).saveTail = gate
  ;(jobs as any).changed()
  try {
    await vi.waitFor(() => expect((jobs as any).saveTail).not.toBe(gate))
    let closed = false
    const closing = jobs.close().then(() => { closed = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(closed).toBe(false)
    release()
    await closing
    expect(JSON.parse(await readFile(path, 'utf8')).jobs).toEqual([])
  } finally { release() }
})

function fakeProcess() {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() })
  child.kill = vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true })
  return child
}

it('does not retain a job whose initial metadata write failed', async () => {
  const { jobs, path } = await fixture()
  const session = randomUUID(), request = randomUUID()
  const originalSave = (jobs as any).save.bind(jobs)
  vi.spyOn(jobs as any, 'save').mockRejectedValueOnce(new Error('disk full')).mockImplementation(originalSave)
  await expect(jobs.start(session, 'echo test', 1000, request)).rejects.toThrow('disk full')
  expect(await jobs.list(session)).toEqual([])
  const retried = await (jobs as any).reserve(session, 'echo test', 1000, request)
  expect(retried.reused).toBe(false)
  expect(JSON.parse(await readFile(path, 'utf8')).jobs).toHaveLength(1)
})

it('serializes admission so another save cannot persist a rejected ghost job', async () => {
  const { jobs, path } = await fixture()
  const session = randomUUID()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const originalSave = (jobs as any).save.bind(jobs)
  const save = vi.spyOn(jobs as any, 'save').mockImplementationOnce(async () => { await gate; throw new Error('disk full') }).mockImplementation(originalSave)
  const first = (jobs as any).reserve(session, 'echo first', 1000, randomUUID())
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  const second = (jobs as any).reserve(session, 'echo second', 1000, randomUUID())
  release()
  await expect(first).rejects.toThrow('disk full')
  expect((await second).reused).toBe(false)
  expect((await jobs.list(session)).map(job => job.command)).toEqual(['echo second'])
  expect(JSON.parse(await readFile(path, 'utf8')).jobs.map((job: { command: string }) => job.command)).toEqual(['echo second'])
})

it('does not treat a renderer notification error as a failed job save', async () => {
  const { jobs, path } = await fixture()
  jobs.onChanged = () => { throw new Error('renderer closed') }
  const result = await (jobs as any).reserve(randomUUID(), 'echo test', 1000, randomUUID())
  expect(result.reused).toBe(false)
  expect(JSON.parse(await readFile(path, 'utf8')).jobs).toHaveLength(1)
})

it('shows a durable-status warning when a completed job cannot be saved', async () => {
  const child = fakeProcess(), { jobs } = await fixture(() => {}, (() => child) as unknown as typeof spawn)
  const started = await jobs.start(randomUUID(), 'echo test', 1000)
  vi.spyOn(jobs as any, 'save').mockRejectedValueOnce(new Error('disk full'))
  child.stdout!.emit('data',Buffer.from(`__unrealcode_job_${started.id}:12345\n`))
  child.emit('close', 0)
  await vi.waitFor(async () => expect((await jobs.read(started.sessionId, started.id)).persistenceWarning).toMatch(/could not be saved/i))
  expect((await jobs.read(started.sessionId, started.id)).state).toBe('completed')
  ;(jobs as any).changed()
  await vi.waitFor(async () => expect((await jobs.read(started.sessionId, started.id)).persistenceWarning).toBeUndefined())
})

it('records a launch failure before returning it to the caller', async () => {
  const launch = vi.fn(() => fakeProcess())
  const { jobs, path } = await fixture(() => { throw new Error('checkpoint unavailable') }, launch as unknown as typeof spawn)
  const session = randomUUID()
  await expect(jobs.start(session, 'echo test', 1000)).rejects.toThrow('checkpoint unavailable')
  expect(launch).not.toHaveBeenCalled()
  expect((await jobs.list(session)).map(job => job.state)).toEqual(['failed'])
  expect(JSON.parse(await readFile(path, 'utf8')).jobs[0].state).toBe('failed')
})

it('does not launch a reserved job after workspace shutdown begins', async () => {
  const { jobs, path } = await fixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const originalSave = (jobs as any).save.bind(jobs)
  const save = vi.spyOn(jobs as any, 'save').mockImplementationOnce(async () => { await gate; return originalSave() }).mockImplementation(originalSave)
  const start = jobs.start(randomUUID(), 'echo test', 1000)
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  const closing = jobs.close()
  release()
  await expect(start).rejects.toThrow('Workspace closed before the background job started')
  await closing
  expect((await jobs.list()).map(job => job.state)).toEqual(['cancelled'])
  expect(JSON.parse(await readFile(path, 'utf8')).jobs[0].state).toBe('cancelled')
})

it('reports an uncertain timed-out job when stopping its container process fails', async () => {
  const child = fakeProcess(), { jobs } = await fixture(() => {}, (() => child) as unknown as typeof spawn)
  const session = randomUUID(), started = await jobs.start(session, 'sleep 20', 1000)
  const waiting=jobs.wait(session,started.id,5000)
  vi.spyOn(jobs, 'stop').mockRejectedValueOnce(new Error('Docker connection lost'))
  await vi.waitFor(async()=>expect((await jobs.read(session,started.id)).state).toBe('interrupted'),{timeout:2500})
  expect((await waiting).state).toBe('interrupted')
  const status=await jobs.read(session,started.id)
  expect(status.state).toBe('interrupted')
  expect(status.output).toMatch(/could not stop.*timed.out/i)
  expect(child.kill).toHaveBeenCalled()
})

it('does not report success when Docker exits before confirming the owned process',async()=>{
  const child=fakeProcess(),{jobs}=await fixture(()=>{},(()=>child) as unknown as typeof spawn)
  const session=randomUUID(),started=await jobs.start(session,'echo test',1000)
  child.emit('close',0)
  const result=await jobs.read(session,started.id)
  expect(result.state).toBe('interrupted')
  expect(result.output).toMatch(/did not confirm process ownership/i)
})

it.each([
  ['oversized', 'x'.repeat(4097), 'exceeded the safety limit'],
  ['invalid', 'not-a-process-id\n', 'did not confirm process ownership']
])('marks an %s ownership preamble interrupted without an unhandled stop', async (_name, preamble, message) => {
  const child = fakeProcess()
  const { jobs } = await fixture(() => {}, (() => child) as unknown as typeof spawn)
  const session = randomUUID()
  const started = await jobs.start(session, 'echo test', 1000)
  child.stdout!.emit('data', Buffer.from(preamble))
  await vi.waitFor(async () => expect((await jobs.read(session, started.id)).state).toBe('interrupted'))
  expect((await jobs.read(session, started.id)).output).toContain(message)
  expect(child.kill).toHaveBeenCalledTimes(1)
})
