import { it, expect } from 'vitest'
import { mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TaskWorkspaces } from './task-workspaces'
import { CheckpointStore } from './checkpoints'

it('snapshots dirty inputs and integrates binary creations/deletions without overwriting later edits', async () => {
  const project = await mkdtemp(join(tmpdir(), 'unrealcode-task-fixture-')), data = await mkdtemp(join(tmpdir(), 'unrealcode-task-data-'))
  const git = (args: string[]) => execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'ignore' })
  git(['init']); await writeFile(join(project, 'a.txt'), 'committed'); await writeFile(join(project, 'gone.txt'), 'remove'); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Base'])
  await writeFile(join(project, 'a.txt'), 'local dirty'); await unlink(join(project, 'gone.txt')); await writeFile(join(project, 'binary.dat'), Buffer.from([0,1,2]))
  const recoveryStore = new CheckpointStore(project, join(data, 'recoveries'))
  const service = new TaskWorkspaces(project, data, recoveryStore), prepared = await service.prepare(), task = await service.materialize(prepared.id)
  expect(await readFile(join(task.path, 'a.txt'), 'utf8')).toBe('local dirty')
  await expect(readFile(join(task.path, 'gone.txt'))).rejects.toThrow()
  expect(await readFile(join(task.path, 'binary.dat'))).toEqual(Buffer.from([0,1,2]))
  await writeFile(join(task.path, 'a.txt'), 'agent edit'); await writeFile(join(task.path, 'binary.dat'), Buffer.from([0,3,4])); await writeFile(join(task.path, 'new.txt'), 'created')
  await writeFile(join(project, 'a.txt'), 'external edit')
  expect((await service.preview(task.id)).changes.find(item => item.path === 'a.txt')?.conflict).toBe(true)
  await expect(service.integrate(task.id, ['a.txt'])).rejects.toThrow('conflict')
  const recovery = await service.integrate(task.id, ['binary.dat', 'new.txt'])
  expect(await readFile(join(project, 'a.txt'), 'utf8')).toBe('external edit')
  expect(await readFile(join(project, 'binary.dat'))).toEqual(Buffer.from([0,3,4]))
  expect(await readFile(join(project, 'new.txt'), 'utf8')).toBe('created')
  expect((await service.preview(task.id)).changes.map(item => item.path)).toEqual(['a.txt'])
  await recoveryStore.restore(recovery, ['binary.dat', 'new.txt'])
  expect(await readFile(join(project, 'binary.dat'))).toEqual(Buffer.from([0,1,2]))
  await expect(readFile(join(project, 'new.txt'))).rejects.toThrow()
  await writeFile(join(project, 'a.txt'), 'local dirty')
  await writeFile(join(task.path, 'large.bin'), Buffer.alloc(8 * 1024 * 1024 + 1))
  await service.integrate(task.id, ['a.txt'])
  expect((await service.preview(task.id)).workspace.state).toBe('review')
  expect((await service.preview(task.id)).omitted['large.bin']).toBeTruthy()
}, 30000)
