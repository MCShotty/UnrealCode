import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { deleteSkill, gitDiff, listFiles, listSkills, readFile, saveSkill } from './files'

const created: string[] = []
async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'unreal-gui-files-'))
  created.push(root)
  return root
}
afterEach(async () => { for (const path of created.splice(0)) await fs.rm(path, { recursive: true, force: true }) })

describe('trusted project file access', () => {
  it('returns relative paths when the project is reached through an alias', async () => {
    const root = await workspace(), aliases = await workspace(), alias = join(aliases, 'project')
    await fs.writeFile(join(root, 'hello.txt'), 'hello')
    await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect((await listFiles(alias))[0].path).toBe('hello.txt')
  })
  it('allows text preview but rejects parent traversal and binary files', async () => {
    const root = await workspace()
    await fs.writeFile(join(root, 'hello.txt'), 'hello')
    await fs.writeFile(join(root, 'binary.dat'), Buffer.from([0, 1, 2]))
    const outside = `${root}-outside.txt`
    created.push(outside)
    await fs.writeFile(outside, 'private')
    expect(await readFile(root, 'hello.txt')).toBe('hello')
    await expect(readFile(root, `../${basename(outside)}`)).rejects.toThrow(/outside the trusted project/)
    await expect(gitDiff(root, `../${basename(outside)}`)).rejects.toThrow(/outside the trusted project/)
    await expect(readFile(root, 'binary.dat')).rejects.toThrow(/Binary/)
    expect((await listFiles(root)).map((entry) => entry.name)).toEqual(['binary.dat', 'hello.txt'])
  })

  it('creates and disables a skill without deleting its directory', async () => {
    const root = await workspace()
    const content = '---\nname: sample\ndescription: A useful skill\n---\n\n# Sample\n'
    await saveSkill(root, 'sample', content)
    expect((await listSkills(root))[0]).toMatchObject({ name: 'sample', description: 'A useful skill' })
    await expect(saveSkill(root, '../bad', content)).rejects.toThrow(/Skill name/)
    await deleteSkill(root, 'sample')
    expect(await listSkills(root)).toEqual([])
    expect((await fs.stat(join(root, '.harness', 'skills', 'sample'))).isDirectory()).toBe(true)
  })
  it('bounds reads even when a path size check was stale', async () => {
    const root = await workspace(), file = join(root, 'growth.txt')
    await fs.writeFile(file, 'x'.repeat(1024 * 1024 + 100))
    const actual = await fs.stat(file)
    const stale = vi.spyOn(fs, 'stat').mockResolvedValue({ ...actual, size: 1 } as never)
    try { await expect(readFile(root, 'growth.txt')).rejects.toThrow(/size limit/) }
    finally { stale.mockRestore() }
  })
  it('uses UTF-8 byte limits and bounded enumeration for project skills', async () => {
    const root = await workspace()
    const frontmatter = '---\nname: sample\ndescription: Test\n---\n'
    await expect(saveSkill(root, 'sample', frontmatter + '💡'.repeat(140000))).rejects.toThrow('too large')
    const skills = join(root, '.harness', 'skills')
    await fs.mkdir(join(skills, 'sample'), { recursive: true })
    await fs.writeFile(join(skills, 'sample', 'SKILL.md'), frontmatter + 'x'.repeat(512 * 1024))
    expect(await listSkills(root)).toEqual([])
    for (let i = 0; i < 128; i++) await fs.writeFile(join(skills, `extra-${i}`), '')
    await expect(listSkills(root)).rejects.toThrow('more than 128')
  })
  it('uses independent temporary files during concurrent skill saves', async () => {
    const root = await workspace(), frontmatter = '---\nname: sample\ndescription: Test\n---\n'
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => saveSkill(root, 'sample', `${frontmatter}\n# Version ${i}\n`)))
    expect(results.filter(result => result.status === 'rejected').map(result => String(result.reason))).toEqual([])
    expect((await fs.readdir(join(root, '.harness', 'skills', 'sample')))).toEqual(['SKILL.md'])
  })
  it('reports an aggregate skill set that exceeds the index budget', async () => {
    const root = await workspace(), base = join(root, '.harness', 'skills')
    for (let i = 0; i < 9; i++) {
      const directory = join(base, `skill-${i}`)
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(join(directory, 'SKILL.md'), 'x'.repeat(480 * 1024))
    }
    await expect(listSkills(root)).rejects.toThrow('aggregate limit')
  })
})
