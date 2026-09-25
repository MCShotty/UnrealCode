import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { githubBranch, githubStage } from './github'

const created: string[] = []
afterEach(async () => { for (const root of created.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

async function repository(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'unrealcode-git-test-'))
  created.push(root)
  execFileSync('git', ['init', '-b', 'main', root], { windowsHide: true })
  return root
}

describe('GitHub repository boundary', () => {
  it('stages only a selected path under the trusted Git root', async () => {
    const root = await repository()
    await fs.writeFile(join(root, 'inside.txt'), 'safe')
    await githubStage(root, ['inside.txt'], true)
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root }).toString()).toContain('inside.txt')
    expect(await githubBranch(root)).toBe('main')
    const outside = `${root}-outside.txt`
    created.push(outside)
    await fs.writeFile(outside, 'private')
    await expect(githubStage(root, [`../${basename(outside)}`], true)).rejects.toThrow(/outside the trusted repository/)
    await expect(githubStage(root, [outside], true)).rejects.toThrow(/Invalid repository path/)
  })
})
