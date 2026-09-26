import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { FileEntry, SkillEntry } from '../shared/api'

const execFileAsync = promisify(execFile)

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
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result: FileEntry[] = []
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    try {
      const safe = await inside(canonicalRoot, relative(canonicalRoot, full))
      const stat = await fs.stat(safe)
      result.push({ name: entry.name, path: relative(canonicalRoot, safe).replaceAll('\\', '/'), directory: stat.isDirectory(), size: stat.size })
    } catch { /* Skip links leaving the project. */ }
  }
  return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}

export async function readFile(root: string, requested: string): Promise<string> {
  const path = await inside(root, requested)
  const stat = await fs.stat(path)
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Only text files up to 1 MB can be previewed')
  const bytes = await fs.readFile(path)
  if (bytes.includes(0)) throw new Error('Binary file preview is unavailable')
  return bytes.toString('utf8')
}

export async function gitChanges(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short', '--untracked-files=normal'], { cwd: root, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 })
    return stdout.split(/\r?\n/).filter(Boolean).slice(0, 200)
  } catch { return [] }
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
  const base = join(root, '.harness', 'skills')
  let folders: string[]
  try { folders = await fs.readdir(base) } catch { return [] }
  const result: SkillEntry[] = []
  for (const name of folders) {
    if (!skillName.test(name)) continue
    try {
      const path = await inside(root, relative(root, join(skillDir(root, name), 'SKILL.md')))
      const content = await fs.readFile(path, 'utf8')
      const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
      result.push({ name, description, content })
    } catch { /* Invalid or inaccessible skill. */ }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveSkill(root: string, name: string, content: string): Promise<void> {
  if (content.length > 512 * 1024) throw new Error('Skill file is too large')
  if (!/^---\s*\r?\n[\s\S]*?\r?\n---/.test(content) || !/^name:\s*\S+/m.test(content) || !/^description:\s*\S+/m.test(content)) {
    throw new Error('SKILL.md needs YAML frontmatter with name and description')
  }
  const dir = skillDir(root, name)
  const parent = join(root, '.harness')
  const skills = join(parent, 'skills')
  for (const segment of [parent, skills, dir]) {
    try { await inside(root, relative(root, segment)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await fs.mkdir(segment)
      await inside(root, relative(root, segment))
    }
  }
  const safe = await inside(root, relative(root, dir))
  const target = join(safe, 'SKILL.md')
  try { await inside(root, relative(root, target)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = join(safe, `SKILL.md.${Date.now()}.tmp`)
  await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
  await fs.rename(temporary, target)
}

export async function deleteSkill(root: string, name: string): Promise<void> {
  const target = await inside(root, relative(root, join(skillDir(root, name), 'SKILL.md')))
  await fs.unlink(target)
  // Supporting files are intentionally retained; removing SKILL.md disables it.
}
