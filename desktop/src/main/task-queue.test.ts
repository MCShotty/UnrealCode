import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm,writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskQueue, type QueueRunner } from './task-queue'
import type { BridgeSessionConfig } from '../shared/api'

let root: string
const config: BridgeSessionConfig = { provider: 'ollama', model: 'test', baseUrl: '', thinkingLevel: 'low', systemPrompt: '', disallowedTools: [] }

it('requires explicit queue resume for retrying a failed linked conversation',async()=>{
 const queue=new TaskQueue(join(root,'continuation.json'),runner());queue.add('First',config);queue.resume();await vi.waitFor(()=>expect(queue.snapshot().tasks[0].state).toBe('running'));queue.settled('session-1','failed')
 expect(()=>queue.continueExisting('session-1')).toThrow(/Resume the project queue/)
 queue.continueExisting('session-1',true);expect(queue.snapshot().paused).toBe(true);expect(queue.snapshot().tasks[0].state).toBe('running');queue.settled('session-1','idle');expect(queue.snapshot().tasks[0].state).toBe('completed');expect(queue.snapshot().paused).toBe(true)
})

it('keeps a committed queued task when its renderer notification fails',async()=>{
 const path=join(root,'notify-queue.json'),run=runner(),queue=new TaskQueue(path,run)
 queue.onChange=()=>{throw Error('renderer closed')}
 queue.add('queued task',config)
 expect(new TaskQueue(path,runner()).snapshot().tasks[0].prompt).toBe('queued task')
 queue.resume()
 await vi.waitFor(()=>expect(run.send).toHaveBeenCalledOnce())
})

it('persists explicit task specialist options and waits for their review',async()=>{
 const path=join(root,'team-queue.json'),run=runner(),queue=new TaskQueue(path,run)
 const options={allowSpecialists:true,concurrency:2,workerLimit:4,modelRequestLimit:20,elapsedMinutes:10,tokenLimit:5000}
 queue.add('Delegate a focused task',config,undefined,options);queue.add('Next task',config);queue.resume()
 await vi.waitFor(()=>expect(run.send).toHaveBeenCalledOnce())
 expect(vi.mocked(run.create).mock.calls[0][0].teamOptions).toEqual(options)
 queue.needsReview('session-1');queue.settled('session-1','idle');queue.resume();await queue.kick();expect(run.send).toHaveBeenCalledOnce()
 const restarted=new TaskQueue(path,runner());expect(restarted.snapshot().tasks[0].teamOptions).toEqual(options);expect(restarted.snapshot().paused).toBe(true)
})

it('does not launch a removed task while its project idle check is pending', async () => {
  const run = runner(); let release!: (value: boolean) => void
  vi.mocked(run.canStart).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const queue = new TaskQueue(join(root, 'queue.json'), run)
  const first = queue.add('remove me', config).tasks[0].id
  queue.resume(); await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  queue.remove(first); release(true)
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(run.create).not.toHaveBeenCalled()
  expect(queue.snapshot().paused).toBe(false)
})

it('honors reordering performed during the project idle check', async () => {
  const run = runner(); let release!: (value: boolean) => void
  vi.mocked(run.canStart).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const queue = new TaskQueue(join(root, 'queue.json'), run)
  queue.add('first', config); queue.add('second', config)
  queue.resume(); await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  queue.reorder(queue.snapshot().tasks.map(task => task.id).reverse()); release(true)
  await vi.waitFor(() => expect(run.send).toHaveBeenCalledOnce())
  expect(vi.mocked(run.send).mock.calls[0][0].prompt).toBe('second')
})
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'unrealcode-queue-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })
function runner(): QueueRunner {
  let next = 0
  return { canStart: vi.fn(async () => true), create: vi.fn(async () => `session-${++next}`), send: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
}

it('does not advance past an isolated task awaiting review, including after restart', async () => {
  const run = runner(), path = join(root, 'queue.json'), queue = new TaskQueue(path, run)
  queue.add('first', config); queue.add('second', config); queue.resume()
  await vi.waitFor(() => expect(run.send).toHaveBeenCalledOnce())
  queue.needsReview('session-1'); queue.resume(); await queue.kick()
  expect(run.send).toHaveBeenCalledOnce()
  const recovered = new TaskQueue(path, run); recovered.resume(); await recovered.kick()
  expect(run.send).toHaveBeenCalledOnce()
  recovered.reviewed('session-1'); recovered.resume()
  await vi.waitFor(() => expect(run.send).toHaveBeenCalledTimes(2))
})

it('runs one task per project and advances only after completion', async () => {
  const run = runner(), queue = new TaskQueue(join(root, 'queue.json'), run)
  queue.add('first', config); queue.add('second', config)
  expect(run.create).not.toHaveBeenCalled()
  queue.resume()
  await vi.waitFor(() => expect(run.send).toHaveBeenCalledTimes(1))
  expect(queue.snapshot().tasks.map((item) => item.state)).toEqual(['running', 'pending'])
  queue.settled('session-1', 'idle')
  await vi.waitFor(() => expect(run.send).toHaveBeenCalledTimes(2))
  queue.settled('session-2', 'idle')
  expect(queue.snapshot().tasks.every((item) => item.state === 'completed')).toBe(true)
})

it('allows independent projects to run concurrently', async () => {
  const a = runner(), b = runner()
  const first = new TaskQueue(join(root, 'a.json'), a), second = new TaskQueue(join(root, 'b.json'), b)
  first.add('a', config); second.add('b', config); first.resume(); second.resume()
  await vi.waitFor(() => { expect(a.send).toHaveBeenCalledOnce(); expect(b.send).toHaveBeenCalledOnce() })
})

it('pauses on credentials failure and required input', async () => {
  const run = runner(), queue = new TaskQueue(join(root, 'queue.json'), run)
  vi.mocked(run.create).mockRejectedValueOnce(new Error('Credentials unavailable'))
  queue.add('first', config); queue.add('second', config); queue.resume()
  await vi.waitFor(() => expect(queue.snapshot().tasks[0].state).toBe('failed'))
  expect(queue.snapshot().paused).toBe(true)
  queue.retry(queue.snapshot().tasks[0].id); queue.resume()
  await vi.waitFor(() => expect(run.send).toHaveBeenCalledOnce())
  queue.needsInput('session-1', 'Choose a target')
  queue.settled('session-1', 'idle')
  expect(queue.snapshot().paused).toBe(true)
  expect(queue.snapshot().tasks[1].state).toBe('pending')
})

it('retains an uncertain launch identity and workspace choice, but assigns a new attempt after a linked failure',async()=>{
 const run=runner(),queue=new TaskQueue(join(root,'queued-attempts.json'),run)
 vi.mocked(run.create).mockImplementationOnce(async task=>{queue.recordWorkspaceChoice(task.id,'isolated');throw Error('create reply lost')})
 const id=queue.add('build a project',config).tasks[0].id
 queue.resume()
 await vi.waitFor(()=>expect(queue.snapshot().tasks[0].state).toBe('failed'))
 const uncertain=queue.snapshot().tasks[0]
 expect(uncertain.workspaceChoice).toBe('isolated')
 expect(uncertain.attemptId).toBeUndefined()
 queue.retry(id);queue.resume()
 await vi.waitFor(()=>expect(run.send).toHaveBeenCalledOnce())
 expect(vi.mocked(run.create).mock.calls[1][0]).toMatchObject({id,workspaceChoice:'isolated'})
 queue.settled('session-1','failed')
 const linked=queue.snapshot().tasks[0]
 expect(linked.sessionId).toBe('session-1')
 queue.retry(id)
 const retry=queue.snapshot().tasks[0]
 expect(retry.attemptId).toMatch(/^[a-f0-9-]{36}$/)
 expect(retry.attemptId).not.toBe(id)
 expect(retry.workspaceChoice).toBeUndefined()
})

it('stops a session linked by the runner when later launch setup fails',async()=>{
 const run=runner(),queue=new TaskQueue(join(root,'late-launch-failure.json'),run)
 vi.mocked(run.create).mockImplementationOnce(async task=>{queue.recordCreatedSession(task.id,'session-created');throw Error('team setup failed')})
 queue.add('task with team setup',config);queue.resume()
 await vi.waitFor(()=>expect(queue.snapshot().tasks[0].state).toBe('interrupted'))
 expect(queue.snapshot().tasks[0].sessionId).toBe('session-created')
 expect(run.stop).toHaveBeenCalledWith('session-created')
 expect(run.send).not.toHaveBeenCalled()
})

it('restores a paused queue and marks interrupted sessions for explicit review', async () => {
  const path = join(root, 'queue.json'), run = runner(), first = new TaskQueue(path, run)
  first.add('in progress', config); first.add('later', config); first.resume()
  await vi.waitFor(() => expect(run.send).toHaveBeenCalledOnce())
  const restartedRunner = runner(), restarted = new TaskQueue(path, restartedRunner)
  expect(restarted.snapshot().paused).toBe(true)
  expect(restarted.snapshot().tasks[0]).toMatchObject({ state: 'interrupted', sessionId: 'session-1' })
  expect(restartedRunner.create).not.toHaveBeenCalled()
})

it('edits, reorders and cancels pending work without losing other tasks', async () => {
  const queue = new TaskQueue(join(root, 'queue.json'), runner())
  queue.add('first', config); queue.add('second', config)
  const [first, second] = queue.snapshot().tasks
  queue.edit(second.id, 'edited'); queue.reorder([second.id, first.id])
  expect(queue.snapshot().tasks[0].prompt).toBe('edited')
  await queue.cancel(first.id)
  expect(queue.snapshot().tasks[1].state).toBe('cancelled')
  expect(() => queue.reorder([second.id, second.id])).toThrow()
})
it('rejects oversized queue records before changing the durable queue',()=>{
 const path=join(root,'bounded-queue.json'),queue=new TaskQueue(path,runner())
 expect(()=>queue.add('task',{...config,systemPrompt:'x'.repeat(600*1024)})).toThrow('record limit')
 expect(queue.snapshot().tasks).toEqual([])
 const nearLimit={...config,systemPrompt:'x'.repeat(300*1024)}
 const id=queue.add('short',nearLimit).tasks[0].id
 expect(()=>queue.edit(id,'y'.repeat(256*1024))).toThrow('record limit')
 expect(queue.snapshot().tasks[0].prompt).toBe('short')
})

it('does not spin while manual project work holds the execution slot', async () => {
  const run = runner(); vi.mocked(run.canStart).mockResolvedValue(false)
  const queue = new TaskQueue(join(root, 'queue.json'), run)
  queue.add('waiting', config); queue.resume()
  await vi.waitFor(() => expect(run.canStart).toHaveBeenCalledOnce())
  expect(run.create).not.toHaveBeenCalled()
  vi.mocked(run.canStart).mockResolvedValue(true); await queue.kick()
  expect(run.send).toHaveBeenCalledOnce()
})
it('rejects malformed saved tasks without rewriting the original queue',async()=>{
 const path=join(root,'damaged-queue.json')
 const original=JSON.stringify({version:1,paused:false,tasks:[{id:crypto.randomUUID(),prompt:'run this',createdAt:new Date().toISOString(),state:'pending',config:{...config,provider:'unrecognized'}}]})
 await writeFile(path,original)
 expect(()=>new TaskQueue(path,runner())).toThrow('Invalid saved queue task')
 expect(await readFile(path,'utf8')).toBe(original)
})
it('rejects an invalid provider in a new queued task before saving it',()=>{
 const path=join(root,'invalid-new-task.json'),queue=new TaskQueue(path,runner())
 expect(()=>queue.add('do work',{...config,provider:'unknown' as never})).toThrow('Invalid saved queue task')
 expect(queue.snapshot().tasks).toEqual([])
})
it('does not retain a ghost task after its initial queue save fails',()=>{
 const queue=new TaskQueue(join(root,'failed-add.json'),runner())
 vi.spyOn(queue as any,'save').mockImplementationOnce(()=>{throw Error('disk full')})
 expect(()=>queue.add('not saved',config)).toThrow('disk full')
 expect(queue.snapshot().tasks).toEqual([])
})
it('does not execute queued work after Resume failed to persist',async()=>{
 const run=runner(),queue=new TaskQueue(join(root,'failed-resume.json'),run)
 queue.add('pending',config)
 vi.spyOn(queue as any,'save').mockImplementationOnce(()=>{throw Error('disk full')})
 expect(()=>queue.resume()).toThrow('disk full')
 expect(queue.snapshot().paused).toBe(true)
 await queue.kick()
 expect(run.create).not.toHaveBeenCalled()
})
it('keeps an isolated task awaiting review when recording integration fails',async()=>{
 const run=runner(),queue=new TaskQueue(join(root,'failed-review.json'),run)
 queue.add('first',config);queue.add('second',config);queue.resume()
 await vi.waitFor(()=>expect(run.send).toHaveBeenCalledOnce())
 queue.needsReview('session-1')
 vi.spyOn(queue as any,'save').mockImplementationOnce(()=>{throw Error('disk full')})
 expect(()=>queue.reviewed('session-1')).toThrow('disk full')
 expect(queue.snapshot().tasks[0].state).toBe('waiting_review')
})
it('does not advance to the next task when completion could not be saved',async()=>{
 const run=runner(),queue=new TaskQueue(join(root,'failed-settlement.json'),run)
 queue.add('first',config);queue.add('second',config);queue.resume()
 await vi.waitFor(()=>expect(run.send).toHaveBeenCalledOnce())
 vi.spyOn(queue as any,'save').mockImplementationOnce(()=>{throw Error('disk full')})
 expect(()=>queue.settled('session-1','idle')).toThrow('disk full')
 expect(queue.snapshot().tasks[0].state).toBe('running')
 await queue.kick()
 expect(run.send).toHaveBeenCalledOnce()
})
it('stops and retains a created session when saving its queue link fails',async()=>{
 const run=runner(),queue=new TaskQueue(join(root,'failed-created-link.json'),run)
 queue.add('first',config)
 const save=(queue as any).save.bind(queue)
 vi.spyOn(queue as any,'save').mockImplementation(()=>{if(queue.snapshot().tasks[0]?.state==='running'&&!queue.snapshot().tasks[0]?.message)throw Error('disk full');return save()})
 queue.resume()
 await vi.waitFor(()=>expect(queue.snapshot().tasks[0].state).toBe('interrupted'))
 expect(run.stop).toHaveBeenCalledWith('session-1')
 expect(run.send).not.toHaveBeenCalled()
 expect(queue.snapshot().tasks[0].sessionId).toBe('session-1')
 expect(queue.snapshot().paused).toBe(true)
})
it('stops an uncertain send and keeps its session linked for review',async()=>{
 const run=runner(),queue=new TaskQueue(join(root,'failed-send.json'),run)
 vi.mocked(run.send).mockRejectedValueOnce(Error('bridge disconnected after send'))
 queue.add('first',config);queue.resume()
 await vi.waitFor(()=>expect(queue.snapshot().tasks[0].state).toBe('interrupted'))
 expect(run.stop).toHaveBeenCalledWith('session-1')
 expect(queue.snapshot().tasks[0].sessionId).toBe('session-1')
 expect(queue.snapshot().tasks[0].message).toMatch(/inspect/i)
 expect(queue.snapshot().paused).toBe(true)
})
it('keeps an uncertain session visible when stopping after a failed send also fails',async()=>{
 const run=runner(),queue=new TaskQueue(join(root,'failed-send-stop.json'),run)
 vi.mocked(run.send).mockRejectedValueOnce(Error('bridge disconnected'))
 vi.mocked(run.stop).mockRejectedValueOnce(Error('Docker unavailable'))
 queue.add('first',config);queue.resume()
 await vi.waitFor(()=>expect(queue.snapshot().tasks[0].state).toBe('interrupted'))
 expect(queue.snapshot().tasks[0].sessionId).toBe('session-1')
 expect(queue.snapshot().tasks[0].message).toMatch(/stopping.*could not be confirmed/i)
 expect(queue.snapshot().paused).toBe(true)
})
it('points an unlinked interrupted task to session history after restart',async()=>{
 const path=join(root,'unlinked-start.json'),task={id:crypto.randomUUID(),prompt:'pending',config,createdAt:new Date().toISOString(),state:'starting'}
 await writeFile(path,JSON.stringify({version:1,paused:false,tasks:[task]}))
 const queue=new TaskQueue(path,runner())
 expect(queue.snapshot().tasks[0].state).toBe('interrupted')
 expect(queue.snapshot().tasks[0].message).toMatch(/session history.*unlinked/i)
 expect(queue.snapshot().paused).toBe(true)
})
