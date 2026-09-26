import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { EditableFile } from '../shared/api'

const exec = promisify(execFile)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const locks = new Map<string, Promise<void>>()
export async function editorPath(root: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes(':') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) || part.toLowerCase() === '.git')) throw new Error('Invalid project file path')
  let current = await fs.realpath(root)
  for (const part of path.split('/')) {
    current = join(current, part)
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Editor does not follow symbolic links or junctions') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return current
}
export async function readEditableFile(root: string, path: string): Promise<EditableFile> {
  const workspace = await fs.realpath(root)
  const target = await editorPath(root, path)
  try {
    const info = await fs.stat(target)
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('The editor supports regular UTF-8 text files up to 1 MiB')
    const bytes = await fs.readFile(target)
    if (bytes.length > 1024 * 1024 || bytes.includes(0)) throw new Error('Binary or oversized file: use an external editor')
    return { path, workspace, revision: hash(bytes), content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, workspace, revision: 'missing', content: '' }; throw error }
}
export async function saveEditableFile(root: string, path: string, expectedRevision: string, content: string, data: string): Promise<EditableFile> {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024 || content.includes('\0')) throw new Error('Replacement must be text below 1 MiB')
  const target = await editorPath(root, path)
  const key = target.toLowerCase(), previous = locks.get(key) || Promise.resolve()
  let unlock!: () => void
  const current = new Promise<void>(resolve => { unlock = resolve })
  locks.set(key, current)
  await previous
  try {
    const before = await readEditableFile(root, path)
    if (before.revision !== expectedRevision) throw new Error('File changed on disk. Reload or compare before saving; your unsaved buffer has been retained.')
    const recovery = join(data, 'editor-recovery', randomUUID())
    await fs.mkdir(recovery, { recursive: true })
    await fs.writeFile(join(recovery, 'before.json'), JSON.stringify({ project: root, ...before, savedAt: new Date().toISOString() }), { mode: 0o600 })
    await fs.mkdir(dirname(target), { recursive: true })
    await editorPath(root, path)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      const mode = before.revision === 'missing' ? 0o644 : (await fs.stat(target)).mode
      await fs.writeFile(temporary, content, { flag: 'wx', mode })
      if ((await readEditableFile(root, path)).revision !== before.revision) throw new Error('File changed while saving. Your buffer is retained.')
      await fs.rename(temporary, target)
    } finally { await fs.unlink(temporary).catch(() => {}) }
    return readEditableFile(root, path)
  } finally { unlock(); if (locks.get(key) === current) locks.delete(key) }
}
export async function editorBase(root: string, path: string): Promise<string> {
  await editorPath(root, path)
  try { const { stdout } = await exec('git', ['show', `HEAD:${path}`], { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 10000 }); return stdout }
  catch { return '' }
}
