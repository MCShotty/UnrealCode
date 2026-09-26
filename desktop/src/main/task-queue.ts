import type { QueueTask, QueueSnapshot } from '../shared/workflow'
export type { QueueTask, QueueSnapshot } from '../shared/workflow'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BridgeSessionConfig } from '../shared/api'

export type QueueRunner = { canStart(): Promise<boolean>; create(task: QueueTask): Promise<string>; send(task: QueueTask): Promise<void>; stop(sessionId: string): Promise<void> }

export class TaskQueue {
  private value: QueueSnapshot = { version: 1, paused: true, tasks: [] }
  private launching = false
  private launchingId = ''
  onChange: (snapshot: QueueSnapshot) => void = () => {}
  onError: (error: unknown) => void = () => {}
  private schedule(): void { void this.kick().catch((error) => this.onError(error)) }
  constructor(private path: string, private runner: QueueRunner) {
    if (existsSync(path)) {
      const stored = JSON.parse(readFileSync(path, 'utf8')) as QueueSnapshot
      if (stored.version !== 1 || !Array.isArray(stored.tasks)) throw new Error('Unsupported task queue data')
      this.value = stored
      this.value.paused = true
      for (const task of this.value.tasks) if (['starting', 'running', 'waiting_input'].includes(task.state)) {
        task.state = 'interrupted'; task.message = 'Application restarted. Inspect the linked session before retrying.'
      }
      this.save()
    }
  }
  snapshot(): QueueSnapshot { return structuredClone(this.value) }
  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(this.value), { mode: 0o600 })
    renameSync(temporary, this.path)
    this.onChange(this.snapshot())
  }
  private task(id: string): QueueTask {
    const task = this.value.tasks.find((item) => item.id === id)
    if (!task) throw new Error('Task not found in this project')
    return task
  }
  add(prompt: string, config: BridgeSessionConfig): QueueSnapshot {
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 256 * 1024) throw new Error('Task must contain text below 256 KB')
    if (this.value.tasks.length >= 200) throw new Error('Remove finished tasks before adding more; the queue holds 200 tasks')
    this.value.tasks.push({ id: randomUUID(), prompt: prompt.trim(), config: structuredClone(config), createdAt: new Date().toISOString(), state: 'pending' })
    this.save(); this.schedule(); return this.snapshot()
  }
  edit(id: string, prompt: string): QueueSnapshot {
    const task = this.task(id)
    if (task.state !== 'pending') throw new Error('Only pending tasks can be edited')
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 256 * 1024) throw new Error('Task must contain text below 256 KB')
    task.prompt = prompt.trim(); this.save(); return this.snapshot()
  }
  reorder(ids: string[]): QueueSnapshot {
    const pending = this.value.tasks.filter((task) => task.state === 'pending')
    if (ids.length !== pending.length || new Set(ids).size !== ids.length || ids.some((id) => !pending.some((task) => task.id === id))) throw new Error('Provide each pending task exactly once')
    let position = 0
    this.value.tasks = this.value.tasks.map((task) => task.state === 'pending' ? this.task(ids[position++]) : task)
    this.save(); return this.snapshot()
  }
  pause(): QueueSnapshot { this.value.paused = true; this.save(); return this.snapshot() }
  resume(): QueueSnapshot { this.value.paused = false; this.save(); this.schedule(); return this.snapshot() }
  retry(id: string): QueueSnapshot {
    if (this.launching) throw new Error('Wait for the current task launch to finish before retrying')
    const task = this.task(id)
    if (!['failed', 'cancelled', 'interrupted'].includes(task.state)) throw new Error('Only stopped or failed tasks can be retried')
    task.state = 'pending'; task.sessionId = undefined; task.message = undefined; this.save(); return this.snapshot()
  }
  remove(id: string): QueueSnapshot {
    if (this.launchingId === id) throw new Error('Wait for the task launch to finish before removing it')
    if (['starting', 'running', 'waiting_input'].includes(this.task(id).state)) throw new Error('Cancel the active task first')
    this.value.tasks = this.value.tasks.filter((task) => task.id !== id); this.save(); return this.snapshot()
  }
  async cancel(id: string): Promise<QueueSnapshot> {
    const task = this.task(id)
    this.value.paused = true
    if (task.state === 'starting') { task.state = 'cancelled'; this.save(); return this.snapshot() }
    if (task.sessionId && ['running', 'waiting_input'].includes(task.state)) await this.runner.stop(task.sessionId)
    task.state = 'cancelled'; task.message = 'Cancelled by user'; this.save(); return this.snapshot()
  }
  needsInput(sessionId: string, question: string): void {
    const task = this.value.tasks.find((task) => task.sessionId === sessionId && task.state === 'running')
    if (!task) return
    task.state = 'waiting_input'; task.message = question; this.value.paused = true; this.save()
  }
  settled(sessionId: string, state: 'idle' | 'failed' | 'stopped', message?: string): void {
    const task = this.value.tasks.find((task) => task.sessionId === sessionId && ['running', 'waiting_input'].includes(task.state))
    if (task) {
      task.state = state === 'idle' ? 'completed' : state === 'failed' ? 'failed' : 'cancelled'
      task.message = message
      if (state !== 'idle') this.value.paused = true
      this.save()
    }
    this.schedule()
  }
  async kick(): Promise<void> {
    if (this.launching || this.value.paused || this.value.tasks.some((task) => ['starting', 'running', 'waiting_input'].includes(task.state))) return
    const task = this.value.tasks.find((task) => task.state === 'pending')
    if (!task) return
    this.launching = true
    let attempted = false
    try {
      if (!await this.runner.canStart() || this.value.paused || task.state !== 'pending') return
      attempted = true; this.launchingId = task.id; task.state = 'starting'; this.save()
      const sessionId = await this.runner.create(structuredClone(task))
      task.sessionId = sessionId
      if (this.task(task.id).state === 'cancelled') { await this.runner.stop(sessionId); this.save(); return }
      task.state = 'running'; this.save()
      await this.runner.send(structuredClone(task))
    } catch (error) {
      task.state = 'failed'; task.message = (error as Error).message; this.value.paused = true; this.save()
    } finally {
      this.launching = false
      this.launchingId = ''
      if (attempted && !this.value.paused && !this.value.tasks.some((task) => ['starting', 'running', 'waiting_input'].includes(task.state))) queueMicrotask(() => this.schedule())
    }
  }
}
