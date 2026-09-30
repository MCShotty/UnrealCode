import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { FileEntry, SkillEntry } from '../shared/api'
import { readBoundedRegularFile } from './bounded-file-read'
import {projectBytes,projectEntries,projectWrite,projectDelete} from './project-fs'

const execFileAsync = promisify(execFile)
const previewLimit = 1024 * 1024
const skillLimit = 512 * 1024
const skillLocks = new Map<string, Promise<void>>()

async function withSkillLock<T>(root: string, name: string, work: (canonicalRoot: string) => Promise<T>): Promise<T> {
  const canonicalRoot = await fs.realpath(root)
  const path = join(canonicalRoot, '.harness', 'skills', name)
  const key = process.platform === 'win32' ? path.toLowerCase() : path
  const previous = skillLocks.get(key) || Promise.resolve()
  let unlock!: () => void
  const current = new Promise<void>(resolve => { unlock = resolve })
  skillLocks.set(key, current)
  await previous
  try { return await work(canonicalRoot) }
  finally { unlock(); if (skillLocks.get(key) === current) skillLocks.delete(key) }
}

export async function inside(root: string, requested = ''): Promise<string> {
  const canonicalRoot = await fs.realpath(root)
  const candidate = resolve(canonicalRoot, requested)
  const canonical = await fs.realpath(candidate)
  const displacement = relative(canonicalRoot, canonical)
  if (displacement === '..' || displacement.startsWith(`..${sep}`) || resolve(canonicalRoot, displacement) !== canonical) {
    throw new Error('Path is outside the trusted project')
  }
  return canonical
}

export async function listFiles(root: string, requested = ''): Promise<FileEntry[]> {
  const canonicalRoot = await fs.realpath(root)
  const dir = await inside(canonicalRoot, requested)
  const entries = await projectEntries(canonicalRoot,relative(canonicalRoot,dir).replaceAll('\\','/'))
  const result: FileEntry[] = []
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    try {
      const safe = await inside(canonicalRoot, relative(canonicalRoot, full))
      result.push({ name: entry.name, path: relative(canonicalRoot, safe).replaceAll('\\', '/'), directory: entry.directory, size: entry.size })
    } catch { /* Skip links leaving the project. */ }
  }
  return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}

export async function readFile(root: string, requested: string): Promise<string> {
  const path = await inside(root, requested)
  const bytes = (await projectBytes(root,relative(await fs.realpath(root),path).replaceAll('\\','/'),previewLimit)).bytes
  if (await inside(root, requested) !== path) throw new Error('Project path changed while reading; retry')
  if (bytes.includes(0)) throw new Error('Binary file preview is unavailable')
  return bytes.toString('utf8')
}

export async function gitChanges(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short', '--untracked-files=normal'], { cwd: root, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 })
    return stdout.split(/\r?\n/).filter(Boolean).slice(0, 200)
  } catch (error) {
    const failure=error as NodeJS.ErrnoException & {stderr?:string;path?:string}
    if (/fatal:\s*not a git repository/i.test(String(failure.stderr||failure.message)) || failure.code==='ENOENT' && failure.path==='git') return null
    throw error
  }
}

export async function gitDiff(root: string, requested: string): Promise<string> {
  if (!requested || isAbsolute(requested)) throw new Error('Invalid project path')
  const canonicalRoot = await fs.realpath(root)
  const absolute = resolve(canonicalRoot, requested)
  const displacement = relative(canonicalRoot, absolute)
  if (displacement === '..' || displacement.startsWith(`..${sep}`)) throw new Error('Path is outside the trusted project')
  const run = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('git', args, { cwd: canonicalRoot, windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 })
    return stdout
  }
  const [staged, unstaged] = await Promise.all([
    run(['diff', '--cached', '--no-ext-diff', '--', displacement]),
    run(['diff', '--no-ext-diff', '--', displacement])
  ])
  return [staged, unstaged].filter(Boolean).join('\n') || 'No tracked diff for this path. Untracked files can be previewed in Explorer.'
}

const skillName = /^[a-z0-9][a-z0-9_-]{0,63}$/
function skillDir(root: string, name: string): string {
  if (!skillName.test(name)) throw new Error('Skill name must use lowercase letters, numbers, hyphens, or underscores')
  return join(root, '.harness', 'skills', name)
}

export async function listSkills(root: string): Promise<SkillEntry[]> {
  root=await fs.realpath(root)
  const base = join(root, '.harness', 'skills')
  let folders: string[]
  try {
    folders = []
    const directory = await projectEntries(root,'.harness/skills')
    for (const entry of directory) {
      if (folders.length >= 128) throw new Error('Skill directory contains more than 128 entries')
      folders.push(entry.name)
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const result: SkillEntry[] = []
  let totalBytes = 0
  for (const name of folders) {
    if (!skillName.test(name)) continue
    let bytes: Buffer | undefined
    try {
      const path = await inside(root, relative(root, join(skillDir(root, name), 'SKILL.md')))
      bytes = (await projectBytes(root,relative(root,path).replaceAll('\\','/'),skillLimit)).bytes
    } catch { /* Invalid or inaccessible skill. */ }
    if (!bytes) continue
    if (totalBytes + bytes.length > 4 * 1024 * 1024) throw new Error('Skill content exceeds the 4 MiB aggregate limit')
    totalBytes += bytes.length
    const content = bytes.toString('utf8')
    const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
    result.push({ name, description, content, source: 'project', revision: createHash('sha256').update(bytes).digest('hex'), workspace: root })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listAvailableSkills(root: string): Promise<SkillEntry[]> {
  const project = await listSkills(root)
  const candidates = [join(process.resourcesPath || '', 'builtin-skills'), join(__dirname, '..', '..', 'builtin-skills')]
  const builtins = new Map<string, SkillEntry>()
  for (const base of candidates) {
    const entries = await fs.readdir(base, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    if (!entries.length) continue
    for (const entry of entries) {
      if (!entry.isDirectory() || !skillName.test(entry.name)) continue
      const content = (await readBoundedRegularFile(join(base, entry.name, 'SKILL.md'), skillLimit)).toString('utf8')
      const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
      builtins.set(entry.name, { name: entry.name, description, content, source: 'built-in', revision: 'missing', workspace: root })
    }
    break
  }
  for (const skill of project) builtins.set(skill.name, skill)
  return [...builtins.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveSkill(root: string, name: string, content: string, expectedRevision = 'missing'): Promise<SkillEntry> {
  skillDir(root, name)
  if (Buffer.byteLength(content, 'utf8') > skillLimit) throw new Error('Skill file is too large')
  if (!/^---\s*\r?\n[\s\S]*?\r?\n---/.test(content) || !/^name:\s*\S+/m.test(content) || !/^description:\s*\S+/m.test(content)) {
    throw new Error('SKILL.md needs YAML frontmatter with name and description')
  }
  if (content.match(/^name:\s*(.+)$/m)?.[1]?.trim() !== name) throw new Error('The frontmatter name must match the skill folder name')
  if (expectedRevision !== 'missing' && !/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error('Reload the skill before updating it')
  return withSkillLock(root, name, async (root) => {
    const bytes = Buffer.from(content)
    try { await projectWrite(root,`.harness/skills/${name}/SKILL.md`,bytes,{expected:expectedRevision}) }
    catch (error) { throw new Error(expectedRevision === 'missing' ? 'The skill could not be created. Choose an unused folder name; an existing skill will not be replaced.' : 'The skill could not be saved. Reload its latest revision before retrying; your draft is retained.', {cause:error}) }
    return {name,content,description:content.match(/^description:\s*(.+)$/m)?.[1]?.trim()||'',source:'project',revision:createHash('sha256').update(bytes).digest('hex'),workspace:root}
  })
}

export async function deleteSkill(root: string, name: string): Promise<void> {
  skillDir(root, name)
  await withSkillLock(root, name, async (root) => {
    await projectDelete(root,`.harness/skills/${name}/SKILL.md`)
  })
  // Supporting files are intentionally retained; removing SKILL.md disables it.
}
