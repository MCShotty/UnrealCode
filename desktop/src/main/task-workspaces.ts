import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { CheckpointStore, type Snapshot } from './checkpoints'
import { editorPath } from './editor-files'
import type { TaskWorkspace, WorkspacePreview } from '../shared/task-workspaces'

const exec = promisify(execFile)
type StoredWorkspace = TaskWorkspace & { baseline: Snapshot }
export class TaskWorkspaces {
  private source: CheckpointStore
  private serial = Promise.resolve()
  private metadataTail = Promise.resolve()
  constructor(readonly project: string, private directory: string, private recoveryStore = new CheckpointStore(project, join(directory, 'integration-recovery'))) { this.source = new CheckpointStore(project, join(directory, 'snapshot-data')) }
  private async git(args: string[], cwd = this.project): Promise<string> { const { stdout } = await exec('git', args, { cwd, windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }); return stdout.trim() }
  private metadata(id: string): string { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid task workspace'); return join(this.directory, `${id}.json`) }
  private async read(id: string): Promise<StoredWorkspace> { const value: StoredWorkspace = JSON.parse(await fs.readFile(this.metadata(id), 'utf8')); if (value.id !== id || value.path !== join(this.directory, 'worktrees', id)) throw new Error('Invalid owned workspace metadata'); Object.setPrototypeOf(value.baseline.files, null); Object.setPrototypeOf(value.baseline.skipped, null); return value }
  private async save(value: StoredWorkspace): Promise<void> { await fs.mkdir(this.directory, { recursive: true }); const path = this.metadata(value.id), temporary = `${path}.${randomUUID()}.tmp`; await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temporary, path) }
  private view({ baseline: _, ...value }: StoredWorkspace): TaskWorkspace { return value }
  async available(): Promise<boolean> { try { await this.git(['rev-parse', '--verify', 'HEAD']); const root = await fs.realpath(await this.git(['rev-parse', '--show-toplevel'])); return root.toLowerCase() === (await fs.realpath(this.project)).toLowerCase() } catch { return false } }
  async list(): Promise<TaskWorkspace[]> {
    let names: string[]; try { names = await fs.readdir(this.directory) } catch { return [] }
    return Promise.all(names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(async name => this.view(await this.read(name.slice(0,-5)))))
  }
  async recover(): Promise<void> { for (const item of await this.list()) if (item.state === 'running') await this.update(item.id, { state: 'interrupted' }) }
  private mutate<T>(work: () => Promise<T>): Promise<T> { const run = this.metadataTail.then(work); this.metadataTail = run.then(() => {}, () => {}); return run }
  update(id: string, patch: Partial<Pick<TaskWorkspace, 'sessionId' | 'state' | 'title' | 'usage' | 'usageRecords'>>): Promise<TaskWorkspace> { return this.mutate(async () => { const value = await this.read(id); Object.assign(value, patch); await this.save(value); return this.view(value) }) }
  link(id: string, sessionId: string): Promise<void> { return this.mutate(async () => { const value = await this.read(id); value.linkedSessions = [...new Set([...(value.linkedSessions || []), sessionId])]; await this.save(value) }) }
  async prepare(): Promise<TaskWorkspace> {
    if (!await this.available()) throw new Error('Isolated tasks need a committed Git repository opened at its root')
    const revision = await this.git(['rev-parse', 'HEAD']), id = randomUUID(), branch = `unrealcode/task-${id.slice(0,8)}`
    const baseline = await this.source.captureSnapshot()
    const path = join(this.directory, 'worktrees', id)
    const value: StoredWorkspace = { id, path, branch, revision, createdAt: new Date().toISOString(), capturedFiles: Object.keys(baseline.files).length, state: 'prepared', title: 'New isolated task', omitted: baseline.skipped, baseline }
    await this.save(value)
    return this.view(value)
  }
  async materialize(id: string): Promise<TaskWorkspace> {
    const value = await this.read(id)
    if (value.state !== 'prepared') throw new Error('Task snapshot has already been used')
    await fs.mkdir(dirname(value.path), { recursive: true })
    await this.git(['worktree', 'add', '-b', value.branch, value.path, value.revision])
    try {
      const tracked = (await this.git(['ls-files', '-z'], value.path)).split('\0').filter(Boolean)
      for (const name of tracked) if (!value.baseline.files[name] && !value.baseline.skipped[name]) await fs.unlink(await editorPath(value.path, name)).catch(error => { if (error.code !== 'ENOENT') throw error })
      for (const [name, entry] of Object.entries(value.baseline.files)) {
        const target = await editorPath(value.path, name); await fs.mkdir(dirname(target), { recursive: true })
        await fs.writeFile(target, (await this.source.snapshotBytes(value.baseline, name))!, { mode: entry.mode })
      }
      value.state = 'interrupted'; await this.save(value); return this.view(value)
    } catch (error) { value.state = 'interrupted'; await this.save(value); throw new Error(`Workspace preparation failed; retained at ${value.path}: ${String(error)}`) }
  }
  async preview(id: string): Promise<WorkspacePreview> {
    const value = await this.read(id), task = new CheckpointStore(value.path, join(this.directory, 'snapshot-data'))
    const [after, current] = await Promise.all([task.captureSnapshot(), this.source.captureSnapshot()])
    const omitted = { ...value.omitted, ...after.skipped, ...current.skipped }
    const changes: WorkspacePreview['changes'] = []
    for (const path of new Set([...Object.keys(value.baseline.files), ...Object.keys(after.files)])) {
      const before = value.baseline.files[path], next = after.files[path]
      if (before?.hash === next?.hash && before?.mode === next?.mode) continue
      const [a, b] = await Promise.all([this.source.snapshotBytes(value.baseline, path), task.snapshotBytes(after, path)])
      const binary = !!a?.includes(0) || !!b?.includes(0)
      changes.push({ path, change: !before ? 'added' : !next ? 'deleted' : 'modified', binary, conflict: !!omitted[path] || current.files[path]?.hash !== before?.hash || current.files[path]?.mode !== before?.mode, reason: omitted[path], before: binary ? undefined : a?.toString('utf8'), after: binary ? undefined : b?.toString('utf8') })
    }
    return { workspace: this.view(value), changes, omitted }
  }
  integrate(id: string, paths: string[]): Promise<string> {
    const run = this.serial.then(() => this.apply(id, paths)); this.serial = run.then(() => {}, () => {}); return run
  }
  private async apply(id: string, paths: string[]): Promise<string> {
    if (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length) throw new Error('Select distinct files to integrate')
    const preview = await this.preview(id), value = await this.read(id)
    if (value.state === 'running') throw new Error('Stop active task work before integrating')
    for (const path of paths) { const change = preview.changes.find(item => item.path === path); if (!change || change.conflict) throw new Error(`Later edits conflict with integration: ${path}`) }
    const task = new CheckpointStore(value.path, join(this.directory, 'snapshot-data')), after = await task.captureSnapshot()
    const recoveryStore = this.recoveryStore
    const recovery = await recoveryStore.begin(value.sessionId || id, randomUUID(), 'Recovery before task integration')
    try {
      for (const path of paths) {
        const fresh = await this.source.captureSnapshot([path])
        if (fresh.skipped[path] || fresh.files[path]?.hash !== value.baseline.files[path]?.hash || fresh.files[path]?.mode !== value.baseline.files[path]?.mode) throw new Error(`File changed during integration: ${path}`)
        const target = await editorPath(this.project, path), bytes = await task.snapshotBytes(after, path)
        if (bytes === undefined) await fs.unlink(target)
        else { await fs.mkdir(dirname(target), { recursive: true }); const temporary = `${target}.${randomUUID()}.tmp`; try { await fs.writeFile(temporary, bytes, { flag: 'wx', mode: after.files[path].mode }); await editorPath(this.project, path); await fs.rename(temporary, target) } finally { await fs.unlink(temporary).catch(() => {}) } }
        // Advance only successfully applied paths. Future edits in this task can
        // be reviewed again without discarding unrelated source conflicts.
        const captured = await this.source.captureSnapshot([path])
        if (captured.files[path]) value.baseline.files[path] = captured.files[path]; else delete value.baseline.files[path]
        await this.save(value)
      }
      await recoveryStore.finish(recovery)
      const remaining = await this.preview(id)
      value.state = remaining.changes.length || Object.keys(remaining.omitted).length ? 'review' : 'integrated'; await this.save(value)
      return recovery
    } catch (error) { await recoveryStore.finish(recovery, `Integration interrupted: ${String(error)}`); throw error }
  }
}
