import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Checkpoint, CheckpointFile, CheckpointPreview } from '../shared/api'

const exec = promisify(execFile)
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
type Entry = { hash: string; size: number; mode: number }
export type Snapshot = { files: Record<string, Entry>; skipped: Record<string, string> }
type Stored = Checkpoint & { before: Snapshot; after?: Snapshot }
const empty = (): Snapshot => ({ files: Object.create(null), skipped: Object.create(null) })
const maxFile = 8 * 1024 * 1024
const maxSnapshot = 128 * 1024 * 1024

export class CheckpointStore {
  captureSnapshot(paths?: string[]): Promise<Snapshot> { return this.capture(paths) }
  snapshotBytes(snapshot: Snapshot, path: string): Promise<Buffer | undefined> { return this.bytes(snapshot.files[path]) }
  async recordedSnapshot(id: string, phase: 'before' | 'after'): Promise<Snapshot> {
    const record = await this.read(id)
    if (phase === 'after' ? record.state !== 'complete' : record.state !== 'running') throw new Error('The checkpoint is not a usable recorded task state')
    const snapshot = record[phase]
    if (!snapshot) throw new Error('Checkpoint content is unavailable')
    return structuredClone(snapshot)
  }
  async importSnapshot(source: CheckpointStore, snapshot: Snapshot): Promise<Snapshot> {
    const result = empty(); result.skipped = { ...snapshot.skipped }
    const names = Object.keys(snapshot.files)
    if (names.length > 10000) throw new Error('Recorded snapshot exceeds the file limit')
    let total = 0, available = Math.max(0, 512 * 1024 * 1024 - (await this.storage()).bytes)
    await fs.mkdir(join(this.directory, 'objects'), { recursive: true })
    for (const name of names) {
      await this.safe(name)
      const entry = snapshot.files[name], bytes = await source.snapshotBytes(snapshot, name)
      if (!bytes || bytes.length > maxFile || (total += bytes.length) > maxSnapshot) throw new Error('Recorded snapshot exceeds its content limits')
      const target = this.blob(entry.hash)
      try { await fs.access(target) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (bytes.length > available) throw new Error('Task snapshot storage limit reached')
        available -= bytes.length
        try { await fs.writeFile(target, bytes, { flag:'wx', mode:0o600 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      result.files[name] = { ...entry }
    }
    return result
  }
  private directory: string
  constructor(private project: string, data: string) {
    this.directory = join(data, 'checkpoints', hash(Buffer.from(resolve(project).toLowerCase())))
  }
  private metadata(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid checkpoint ID')
    return join(this.directory, `${id}.json`)
  }
  private blob(digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid checkpoint content digest')
    return join(this.directory, 'objects', digest)
  }
  private async safe(name: string): Promise<string> {
    if (!name || isAbsolute(name) || name.includes('\\') || name.includes(':') || name.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) || part.toLowerCase() === '.git')) throw new Error('Invalid checkpoint path')
    const root = await fs.realpath(this.project)
    const path = resolve(root, name)
    if (relative(root, path).startsWith(`..${sep}`)) throw new Error('Path leaves the project')
    let current = root
    for (const part of name.split('/')) {
      current = join(current, part)
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symbolic links and junctions are not restored') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return path
  }
  private async names(): Promise<string[]> {
    try {
      const { stdout } = await exec('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: this.project, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
      return [...new Set(stdout.split('\0').filter(Boolean))].sort()
    } catch {
      const result: string[] = []
      const visit = async (directory: string, prefix = ''): Promise<void> => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build'].includes(entry.name)) continue
          const name = prefix + entry.name
          if (entry.isDirectory()) await visit(join(directory, entry.name), `${name}/`)
          else result.push(name)
          if (result.length > 10000) throw new Error('Project exceeds the checkpoint file limit')
        }
      }
      await visit(this.project)
      return result.sort()
    }
  }
  private async capture(selectedPaths?: string[]): Promise<Snapshot> {
    const snapshot = empty()
    let total = 0
    let available = Math.max(0, 512 * 1024 * 1024 - (await this.storage()).bytes)
    const names = selectedPaths || await this.names()
    await fs.mkdir(join(this.directory, 'objects'), { recursive: true })
    for (let offset = 0; offset < names.length; offset += 8) {
      await Promise.all(names.slice(offset, offset + 8).map(async (name, index) => {
        try {
          if (offset + index >= 10000) throw new Error('Checkpoint file limit exceeded')
          const path = await this.safe(name)
          let stat
          try { stat = await fs.lstat(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
          if (!stat.isFile()) throw new Error('Not a regular file')
          if (stat.size > maxFile) throw new Error('File exceeds 8 MB')
          total += stat.size
          if (total > maxSnapshot) throw new Error('Checkpoint exceeds 128 MB')
          const bytes = await fs.readFile(path)
          const after = await fs.stat(path)
          if (stat.mtimeMs !== after.mtimeMs || stat.size !== bytes.length || stat.ino !== after.ino) throw new Error('File changed during capture')
          const digest = hash(bytes)
          let exists = false
          try { await fs.access(this.blob(digest)); exists = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          if (!exists) {
            if (bytes.length > available) throw new Error('Checkpoint storage limit reached; remove older checkpoints')
            available -= bytes.length
            try { await fs.writeFile(this.blob(digest), bytes, { flag: 'wx', mode: 0o600 }) }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
          }
          snapshot.files[name] = { hash: digest, size: bytes.length, mode: stat.mode }
        } catch (error) { snapshot.skipped[name] = (error as Error).message }
      }))
    }
    return snapshot
  }
  private async save(value: Stored): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    const path = this.metadata(value.id)
    const temporary = `${path}.${randomUUID()}.tmp`
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await fs.rename(temporary, path)
  }
  private async read(id: string): Promise<Stored> {
    const value = JSON.parse(await fs.readFile(this.metadata(id), 'utf8')) as Stored
    for (const snapshot of [value.before, value.after]) if (snapshot) { Object.setPrototypeOf(snapshot.files, null); Object.setPrototypeOf(snapshot.skipped, null) }
    return value
  }
  async begin(sessionId: string, messageId: string, prompt: string): Promise<string> {
    const value: Stored = { id: randomUUID(), sessionId, messageIds: [messageId], title: prompt.slice(0, 160), createdAt: new Date().toISOString(), state: 'capturing', files: [], before: empty(), durationMs: 0 }
    await this.save(value)
    const start = performance.now()
    try { value.before = await this.capture(); value.state = 'running' }
    catch (error) { value.state = 'incomplete'; value.reason = (error as Error).message }
    value.durationMs = performance.now() - start
    await this.save(value)
    return value.id
  }
  async addMessage(id: string, messageId: string): Promise<void> {
    const value = await this.read(id)
    value.messageIds = [...new Set([...value.messageIds, messageId])]
    await this.save(value)
  }
  async finish(id: string, reason?: string): Promise<void> {
    const value = await this.read(id)
    const start = performance.now()
    try {
      value.after = await this.capture()
      value.files = [...new Set([...Object.keys(value.before.files), ...Object.keys(value.after.files), ...Object.keys(value.before.skipped), ...Object.keys(value.after.skipped)])].sort().flatMap((path): CheckpointFile[] => {
        const before = value.before.files[path], after = value.after!.files[path]
        const skipped = value.before.skipped[path] || value.after!.skipped[path]
        if (!skipped && before?.hash === after?.hash) return []
        return [{ path, change: skipped ? 'uncaptured' : !before ? 'added' : !after ? 'deleted' : 'modified', reason: skipped }]
      })
      value.state = reason || value.state === 'incomplete' ? 'incomplete' : 'complete'
      value.reason = reason || value.reason
    } catch (error) { value.state = 'incomplete'; value.reason = (error as Error).message }
    value.durationMs += performance.now() - start
    await this.save(value)
    await this.prune()
  }
  async list(): Promise<Checkpoint[]> {
    let names: string[]
    try { names = await fs.readdir(this.directory) } catch { return [] }
    const result: Checkpoint[] = []
    for (const name of names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      try { const { before: _before, after: _after, ...value } = await this.read(name.slice(0, -5)); result.push(value) } catch { /* Keep damaged metadata for diagnosis. */ }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async recover(): Promise<void> {
    for (const item of await this.list()) if (item.state === 'capturing' || item.state === 'running') {
      const value = await this.read(item.id); value.state = 'incomplete'; value.reason = 'Application exited before the turn finished'; await this.save(value)
    }
  }
  private async bytes(entry?: Entry): Promise<Buffer | undefined> {
    if (!entry) return undefined
    const bytes = await fs.readFile(this.blob(entry.hash))
    if (hash(bytes) !== entry.hash) throw new Error('Checkpoint content failed integrity verification')
    return bytes
  }
  async preview(id: string, path: string): Promise<CheckpointPreview> {
    const value = await this.read(id)
    if (!value.files.some((file) => file.path === path)) throw new Error('File is not in this checkpoint')
    const before = await this.bytes(value.before.files[path]), after = await this.bytes(value.after?.files[path])
    const binary = !!before?.includes(0) || !!after?.includes(0)
    const target = await this.safe(path)
    let current: string | undefined
    try { current = hash(await fs.readFile(target)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const reason = value.state !== 'complete' ? 'Incomplete checkpoint cannot be restored' : value.files.find((file) => file.path === path)?.reason
    let diff = ''
    if (!binary) {
      const emptyHash = hash(Buffer.alloc(0))
      await fs.writeFile(this.blob(emptyHash), Buffer.alloc(0))
      const args = ['diff', '--no-index', '--no-ext-diff', '--text', '--', this.blob(value.before.files[path]?.hash || emptyHash), this.blob(value.after?.files[path]?.hash || emptyHash)]
      try { diff = (await exec('git', args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout }
      catch (error) {
        const result = error as { code?: number; stdout?: string }
        if (result.code === 1 && typeof result.stdout === 'string') diff = result.stdout
        else diff = 'Diff unavailable; use the side-by-side file preview.'
      }
      diff = diff.replace(/^diff --git.*\n|^index .*\n/gm, '').replace(/^--- .*$/m, `--- a/${path}`).replace(/^\+\+\+ .*$/m, `+++ b/${path}`)
    }
    return { path, before: binary ? '' : before?.toString('utf8') || '', after: binary ? '' : after?.toString('utf8') || '', diff, binary, conflict: !!reason || current !== value.after?.files[path]?.hash, reason, beforeSize: before?.length || 0, afterSize: after?.length || 0 }
  }
  async restore(id: string, paths: string[]): Promise<string> {
    if (!Array.isArray(paths) || !paths.length || paths.length > 1000 || paths.some((path) => typeof path !== 'string')) throw new Error('Select files to restore')
    const value = await this.read(id)
    if (value.state !== 'complete') throw new Error('Incomplete checkpoint cannot be restored')
    const unique = [...new Set(paths)]
    for (const path of unique) if ((await this.preview(id, path)).conflict) throw new Error(`Later edits conflict with restoration: ${path}`)
    // Recovery is durable before the first project write. Restore only the selected files.
    const recovery = await this.begin(value.sessionId, randomUUID(), `Recovery before restoring ${value.title}`)
    try {
      for (const name of unique) {
        if ((await this.preview(id, name)).conflict) throw new Error(`File changed during restoration: ${name}`)
        const target = await this.safe(name)
        const original = value.before.files[name]
        const bytes = await this.bytes(original)
        if (bytes === undefined) await fs.unlink(target)
        else {
          await fs.mkdir(dirname(target), { recursive: true })
          await this.safe(name)
          const temporary = join(dirname(target), `.unrealcode-restore-${randomUUID()}`)
          await fs.writeFile(temporary, bytes, { flag: 'wx', mode: original.mode })
          try {
            if ((await this.preview(id, name)).conflict) throw new Error(`File changed during restoration: ${name}`)
            await this.safe(name)
            await fs.rename(temporary, target)
          } finally { await fs.unlink(temporary).catch(() => {}) }
        }
      }
      await this.finish(recovery)
      return recovery
    } catch (error) { await this.finish(recovery, `Restore interrupted: ${(error as Error).message}`); throw error }
  }
  async storage(): Promise<{ bytes: number; count: number }> {
    const entries = await fs.readdir(join(this.directory, 'objects')).catch(() => [] as string[])
    let bytes = 0
    for (const name of entries) bytes += (await fs.stat(this.blob(name))).size
    return { bytes, count: (await this.list()).length }
  }
  async remove(id: string): Promise<void> {
    const value = await this.read(id)
    if (value.state === 'running' || value.state === 'capturing') throw new Error('Active checkpoint cannot be removed')
    await fs.unlink(this.metadata(id)); await this.collect()
  }
  private async collect(): Promise<void> {
    const used = new Set<string>()
    for (const item of await this.list()) {
      const value = await this.read(item.id)
      for (const snapshot of [value.before, value.after]) for (const entry of Object.values(snapshot?.files || {})) used.add(entry.hash)
    }
    for (const name of await fs.readdir(join(this.directory, 'objects')).catch(() => [] as string[])) if (!used.has(name)) await fs.unlink(this.blob(name))
  }
  private async prune(): Promise<void> {
    const entries = await this.list()
    for (const entry of entries.slice(30)) if (!['running', 'capturing'].includes(entry.state)) await fs.unlink(this.metadata(entry.id))
    await this.collect()
    for (const entry of entries.slice(1).reverse()) {
      if ((await this.storage()).bytes <= 512 * 1024 * 1024) break
      if (!['running', 'capturing'].includes(entry.state)) await fs.unlink(this.metadata(entry.id)).catch(() => {})
      await this.collect()
    }
  }
}
