import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskQueue, type QueueRunner } from './task-queue'
import type { BridgeSessionConfig } from '../shared/api'

let root: string
const config: BridgeSessionConfig = { provider: 'ollama', model: 'test', baseUrl: '', thinkingLevel: 'low', systemPrompt: '', disallowedTools: [] }

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
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
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

it('does not spin while manual project work holds the execution slot', async () => {
  const run = runner(); vi.mocked(run.canStart).mockResolvedValue(false)
  const queue = new TaskQueue(join(root, 'queue.json'), run)
  queue.add('waiting', config); queue.resume()
  await vi.waitFor(() => expect(run.canStart).toHaveBeenCalledOnce())
  expect(run.create).not.toHaveBeenCalled()
  vi.mocked(run.canStart).mockResolvedValue(true); await queue.kick()
  expect(run.send).toHaveBeenCalledOnce()
})
