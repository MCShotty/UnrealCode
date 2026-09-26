import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckpointStore } from './checkpoints'
import { CheckpointService } from './checkpoint-service'

let root: string, project: string, data: string, store: CheckpointStore
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'unrealcode-checkpoint-'))
  project = join(root, 'project'); data = join(root, 'data')
  await mkdir(project); store = new CheckpointStore(project, data)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('checkpoint recovery', () => {
  it('restores selected modified, created, deleted and binary files and retains recovery', async () => {
    await writeFile(join(project, 'edit.txt'), 'before\n')
    await writeFile(join(project, 'delete.txt'), 'retained')
    await writeFile(join(project, 'binary.bin'), Buffer.from([0, 1, 2]))
    const id = await store.begin('session', 'message', 'Update files')
    await writeFile(join(project, 'edit.txt'), 'after\n')
    await unlink(join(project, 'delete.txt'))
    await writeFile(join(project, 'new.txt'), 'created')
    await writeFile(join(project, 'binary.bin'), Buffer.from([0, 8, 9]))
    await store.finish(id)
    expect((await store.list())[0].files).toHaveLength(4)
    expect((await store.preview(id, 'binary.bin')).binary).toBe(true)
    const recovery = await store.restore(id, ['edit.txt', 'delete.txt', 'new.txt', 'binary.bin'])
    expect(await readFile(join(project, 'edit.txt'), 'utf8')).toBe('before\n')
    expect(await readFile(join(project, 'delete.txt'), 'utf8')).toBe('retained')
    await expect(readFile(join(project, 'new.txt'))).rejects.toThrow()
    expect(await readFile(join(project, 'binary.bin'))).toEqual(Buffer.from([0, 1, 2]))
    await store.restore(recovery, ['edit.txt'])
    expect(await readFile(join(project, 'edit.txt'), 'utf8')).toBe('after\n')
    expect(await readFile(join(project, 'delete.txt'), 'utf8')).toBe('retained')
  })
  it('blocks later edits without writing any selected file', async () => {
    await writeFile(join(project, 'a'), 'one'); await writeFile(join(project, 'b'), 'one')
    const id = await store.begin('session', 'message', 'Edit')
    await writeFile(join(project, 'a'), 'two'); await writeFile(join(project, 'b'), 'two')
    await store.finish(id)
    await writeFile(join(project, 'b'), 'user edit')
    await expect(store.restore(id, ['a', 'b'])).rejects.toThrow(/conflict/)
    expect(await readFile(join(project, 'a'), 'utf8')).toBe('two')
    expect(await readFile(join(project, 'b'), 'utf8')).toBe('user edit')
  })
  it('marks unfinished work incomplete after restart and rejects traversal', async () => {
    await writeFile(join(project, 'a'), 'one')
    const id = await store.begin('session', 'message', 'Interrupted')
    await new CheckpointStore(project, data).recover()
    expect((await store.list())[0].state).toBe('incomplete')
    await expect(store.restore(id, ['a'])).rejects.toThrow(/Incomplete/)
    await expect(store.preview('../outside', 'a')).rejects.toThrow(/Invalid/)
  })
  it('marks files above the capture limit unavailable instead of offering a partial restore', async () => {
    await writeFile(join(project, 'large.bin'), Buffer.alloc(8 * 1024 * 1024 + 1))
    const id = await store.begin('session', 'message', 'Large file')
    await store.finish(id)
    expect((await store.list())[0].files[0]).toMatchObject({ path: 'large.bin', change: 'uncaptured' })
    expect((await store.preview(id, 'large.bin')).conflict).toBe(true)
    await expect(store.restore(id, ['large.bin'])).rejects.toThrow(/conflict/)
  })
  it('rejects a junction substituted after capture', async () => {
    await mkdir(join(project, 'folder')); await writeFile(join(project, 'folder/a'), 'before')
    const id = await store.begin('session', 'message', 'Edit')
    await writeFile(join(project, 'folder/a'), 'after'); await store.finish(id)
    await rm(join(project, 'folder'), { recursive: true })
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'a'), 'private')
    await symlink(outside, join(project, 'folder'), 'junction')
    await expect(store.restore(id, ['folder/a'])).rejects.toThrow(/links|junctions/)
    expect(await readFile(join(outside, 'a'), 'utf8')).toBe('private')
  })
  it('waits for all steering inputs and marks overlapping sessions unsafe to restore', async () => {
    const service = new CheckpointService(project, data)
    await service.send('a', 'm1', 'first', async () => {})
    await service.send('a', 'm2', 'steer', async () => {})
    await service.send('b', 'm3', 'parallel', async () => {})
    await service.event({ v: 1, sessionId: 'a', seq: 1, event: 'session.idle', payload: { messageIds: ['m1'] } })
    expect(service.busy).toBe(true)
    expect((await service.store.list()).every((item) => item.state === 'running')).toBe(true)
    await service.event({ v: 1, sessionId: 'a', seq: 2, event: 'session.idle', payload: { messageIds: ['m2'] } })
    expect((await service.store.list()).find((item) => item.sessionId === 'a')?.state).toBe('incomplete')
    await service.event({ v: 1, sessionId: 'b', seq: 3, event: 'session.status', payload: { status: 'stopped' } })
    expect(service.busy).toBe(false)
  })
})
