import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const captured = vi.hoisted(() => [] as string[][])
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util'), real = promisify(actual.execFile)
  return { ...actual, execFile: Object.assign(() => {}, { [promisify.custom]: async (file: string, args: string[], options: object) => {
    if (file !== 'gh') return real(file, args, options)
    captured.push(args)
    const stdout = args[1] === 'list' ? '[]' : args[1] === 'view' ? '{"number":17,"comments":[]}' : ''
    return { stdout, stderr: '' }
  } }) }
})
import { githubPullRequests, githubPullRequest, githubCreatePullRequest, githubReviewPullRequest } from './github'
let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); captured.length = 0 })
it.each(['https://github.com/acme/private-fork.git', 'git@github.com:acme/private-fork.git'])('pins PR requests to origin %s instead of gh inherited defaults', async origin => {
  root = await mkdtemp(join(tmpdir(), 'unrealcode-gh-target-'))
  execFileSync('git', ['init', root], { windowsHide: true, stdio: 'ignore' })
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', origin], { windowsHide: true })
  execFileSync('git', ['-C', root, 'remote', 'add', 'upstream', 'https://github.com/acme/public-upstream.git'], { windowsHide: true })
  await githubPullRequests(root)
  await githubPullRequest(root, 17)
  execFileSync('git', ['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/feature'], { windowsHide: true })
  await githubCreatePullRequest(root, 'Fixture', 'Body', 'main', true)
  await githubReviewPullRequest(root, 17, 'comment', 'Fixture review')
  expect(captured).toHaveLength(5)
  for (const args of captured) {
    const index = args.indexOf('--repo')
    expect(index).toBeGreaterThan(-1)
    expect(args[index + 1]).toBe('github.com/acme/private-fork')
  }
})
