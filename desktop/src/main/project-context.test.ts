import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectContext } from './project-context'

let root: string, project: string, context: ProjectContext
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'unrealcode-context-')); project = join(root, 'project'); await mkdir(project)
  context = new ProjectContext(project, join(root, 'context.json'))
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
it('includes selected files and excludes folders without silently truncating content', async () => {
  await writeFile(join(project, 'readme.md'), 'Useful context')
  await mkdir(join(project, 'private')); await writeFile(join(project, 'private/data.txt'), 'Excluded content')
  context.update('draft', { pinned: ['readme.md'], attached: ['private/data.txt'], excluded: ['private'], summary: 'Current task summary' })
  const result = await context.prepare()
  expect(result.text).toContain('Useful context'); expect(result.text).not.toContain('Excluded content')
  expect(result.files[1]).toMatchObject({ included: false, reason: 'Excluded from automatic context' })
  expect(result.estimatedTokens).toBeGreaterThan(0)
})
it('rejects traversal and links outside the trusted project', async () => {
  expect(() => context.update('draft', { pinned: ['../outside'] })).toThrow()
  const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'data.txt'), 'secret')
  await symlink(outside, join(project, 'link'), 'junction')
  context.update('draft', { attached: ['link/data.txt'] })
  const result = await context.prepare(); expect(result.files[0].included).toBe(false); expect(result.text).not.toContain('secret')
})
it('preserves project pins while moving draft attachments into a new session', async () => {
  context.update('draft', { pinned: ['readme.md'], attached: ['sample.txt'], summary: 'Draft' })
  const id = '00000000-0000-0000-0000-000000000001'
  context.inheritDraft(id)
  expect(context.get(id).attached).toEqual(['sample.txt']); expect(context.get('draft').attached).toEqual([])
  expect(context.get('draft').pinned).toEqual(['readme.md'])
  expect(new ProjectContext(project, join(root, 'context.json')).get(id).summary).toBe('Draft')
})
