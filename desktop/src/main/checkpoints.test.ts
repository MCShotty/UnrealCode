import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
  it('skips a file that grew past the capture limit without reading its full contents',async()=>{
    const path=join(project,'growth.bin');await writeFile(path,Buffer.alloc(8*1024*1024+100))
    const originalLstat=fs.lstat.bind(fs),originalRead=fs.readFile.bind(fs)
    const stale=vi.spyOn(fs,'lstat').mockImplementation(async (...args)=>{const value=await originalLstat(...args);return String(args[0]).endsWith('growth.bin')?Object.assign(value,{size:1}):value})
    let unbounded=false
    const read=vi.spyOn(fs,'readFile').mockImplementation(async (...args)=>{if(String(args[0])===path){unbounded=true;throw new Error('unbounded project read')}return originalRead(...args)})
    try{const snapshot=await store.captureSnapshot(['growth.bin']);expect(snapshot.skipped['growth.bin']).toMatch(/size limit/);expect(unbounded).toBe(false)}
    finally{stale.mockRestore();read.mockRestore()}
  })
  it('rejects an oversized checkpoint blob before loading it into memory',async()=>{
    await writeFile(join(project,'small.txt'),'small')
    const id=await store.begin('session','message','Small file');await writeFile(join(project,'small.txt'),'changed');await store.finish(id)
    const folder=join(data,'checkpoints',(await readdir(join(data,'checkpoints')))[0])
    const record=JSON.parse(await readFile(join(folder,`${id}.json`),'utf8'))
    const blob=join(folder,'objects',record.before.files['small.txt'].hash)
    await writeFile(blob,Buffer.alloc(8*1024*1024+100))
    const original=fs.readFile.bind(fs),read=vi.spyOn(fs,'readFile').mockImplementation(async (...args)=>{if(String(args[0])===blob)throw new Error('unbounded blob read');return original(...args)})
    try{await expect(store.preview(id,'small.txt')).rejects.toThrow(/size limit/)}
    finally{read.mockRestore()}
  })
  it('finalizes the original checkpoint after a transient metadata sharing failure',async()=>{
    await writeFile(join(project,'file.txt'),'before');const id=await store.begin('session','message','Original turn')
    await writeFile(join(project,'file.txt'),'after')
    const rename=fs.rename;let denied=false
    const spy=vi.spyOn(fs,'rename').mockImplementation(async(source,target)=>{
      if(!denied&&String(target).endsWith(`${id}.json`)){denied=true;throw Object.assign(new Error('Fixture sharing violation'),{code:'EPERM'})}
      return rename(source,target)
    })
    try{await store.finish(id);expect(denied).toBe(true);expect((await store.list()).find(item=>item.id===id)).toMatchObject({state:'complete',title:'Original turn'})}finally{spy.mockRestore()}
  })
  it('restores file-directory replacements in either selection order and saves a reversible recovery',async()=>{
    await mkdir(join(project,'folder'));await writeFile(join(project,'folder','child'),'before child');await writeFile(join(project,'file'),'before file')
    const id=await store.begin('session','message','Replace topology')
    await unlink(join(project,'folder','child'));await rmdir(join(project,'folder'));await writeFile(join(project,'folder'),'after file')
    await unlink(join(project,'file'));await mkdir(join(project,'file'));await writeFile(join(project,'file','child'),'after child')
    await store.finish(id)
    const paths=['folder/child','file','folder','file/child']
    const recovery=await store.restore(id,paths)
    expect(await readFile(join(project,'folder','child'),'utf8')).toBe('before child');expect(await readFile(join(project,'file'),'utf8')).toBe('before file')
    await store.restore(recovery,paths)
    expect(await readFile(join(project,'folder'),'utf8')).toBe('after file');expect(await readFile(join(project,'file','child'),'utf8')).toBe('after child')
  })
  it('retains incomplete captures beyond the completed-checkpoint count limit',async()=>{const interrupted=await store.begin('session','interrupted','Interrupted work');await store.finish(interrupted,'Stopped before completion');const folder=join(data,'checkpoints',(await readdir(join(data,'checkpoints')))[0]);const fixture=JSON.parse(await readFile(join(folder,`${interrupted}.json`),'utf8'));fixture.createdAt='2000-01-01T00:00:00.000Z';await writeFile(join(folder,`${interrupted}.json`),JSON.stringify(fixture));for(let index=0;index<31;index++){const id=randomUUID();await writeFile(join(folder,`${id}.json`),JSON.stringify({...fixture,id,state:'complete',createdAt:new Date(Date.now()+index).toISOString()}))}const latest=await store.begin('session','latest','Complete');await store.finish(latest);expect((await store.list()).find(item=>item.id===interrupted)?.state).toBe('incomplete')})
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
