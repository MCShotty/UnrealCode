import { afterEach, describe, expect, it } from 'vitest'
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
})
