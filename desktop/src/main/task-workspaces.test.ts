import { it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, rmdir, writeFile, readFile, unlink,stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {randomUUID} from 'node:crypto'
import { TaskWorkspaces } from './task-workspaces'
import { CheckpointStore } from './checkpoints'
import { promises as fs } from 'node:fs'

async function topologyFixture() {
 const project=await mkdtemp(join(tmpdir(),'unrealcode-topology-')),data=await mkdtemp(join(tmpdir(),'unrealcode-topology-data-'))
 const git=(args:string[])=>execFileSync('git',['-C',project,...args],{windowsHide:true,stdio:'ignore'})
 git(['init']);await mkdir(join(project,'folder','nested'),{recursive:true});await writeFile(join(project,'folder','nested','child.txt'),'child');await writeFile(join(project,'file.txt'),'file');git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Base'])
 return {project,data,git}
}
async function replaceTopology(project:string) {
 await unlink(join(project,'folder','nested','child.txt'));await rmdir(join(project,'folder','nested'));await rmdir(join(project,'folder'));await writeFile(join(project,'folder'),'now a file')
 await unlink(join(project,'file.txt'));await mkdir(join(project,'file.txt'));await writeFile(join(project,'file.txt','child.txt'),'now a directory')
}
it('reuses a queued task workspace identity before and after materialization',async()=>{
 const {project,data}=await topologyFixture(),service=new TaskWorkspaces(project,data),key=randomUUID()
 const first=await service.prepare(undefined,key)
 expect(first.id).toBe(key)
 const prepared=await service.prepare(undefined,key)
 expect(prepared.id).toBe(key)
 const materialized=await service.materializeQueued(key)
 const reopened=await service.prepare(undefined,key)
 expect(reopened.id).toBe(key)
 expect(reopened.path).toBe(materialized.path)
 expect(reopened.state).toBe('interrupted')
 expect((await service.materializeQueued(key)).path).toBe(materialized.path)
 await writeFile(join(materialized.path,'file.txt'),'user edit')
 await expect(service.materializeQueued(key)).rejects.toThrow('changed')
 await service.update(key,{sessionId:randomUUID()})
 await expect(service.materializeQueued(key)).rejects.toThrow('linked')
})
it.runIf(process.platform==='win32')('accepts a canonical Windows alias without changing workspace ownership',async()=>{
 const {project,data}=await topologyFixture(),service=new TaskWorkspaces(project,data),task=await service.prepare()
 const restored=new TaskWorkspaces(project,data.toUpperCase());expect((await restored.list())[0].id).toBe(task.id)
 const record=JSON.parse(await readFile(join(data,`${task.id}.json`),'utf8'));record.path=project;await writeFile(join(data,`${task.id}.json`),JSON.stringify(record))
 await expect(restored.list()).rejects.toThrow('Invalid owned')
})
it('retains task identity and retries a transient Windows metadata sharing failure',async()=>{
 const {project,data}=await topologyFixture(),service=new TaskWorkspaces(project,data),task=await service.prepare()
 const rename=fs.rename;let denied=false
 const spy=vi.spyOn(fs,'rename').mockImplementation(async(source,target)=>{
  if(!denied&&String(target)===join(data,`${task.id}.json`)){denied=true;throw Object.assign(new Error('Fixture sharing violation'),{code:'EACCES'})}
  return rename(source,target)
 })
 try{await service.update(task.id,{title:'Updated task'});expect(denied).toBe(true);expect((await service.list())[0]).toMatchObject({id:task.id,title:'Updated task',state:'prepared'})}finally{spy.mockRestore()}
},20000)
it('materializes reviewed dirty file-directory replacements and reopens their archive',async()=>{
 const {project,data}=await topologyFixture();await replaceTopology(project)
 const service=new TaskWorkspaces(project,data),prepared=await service.prepare()
 expect(prepared.omitted).toEqual({})
 const task=await service.materialize(prepared.id)
 expect(await readFile(join(task.path,'folder'),'utf8')).toBe('now a file')
 expect(await readFile(join(task.path,'file.txt','child.txt'),'utf8')).toBe('now a directory')
 await service.update(task.id,{state:'integrated'});await service.archive(task.id)
 const restored=await service.restoreArchived(task.id)
 expect(restored.state).toBe('integrated');expect((await service.preview(task.id)).changes).toEqual([])
},30000)
it('integrates file-directory replacements independent of selection order and retains later child files',async()=>{
 const {project,data}=await topologyFixture(),service=new TaskWorkspaces(project,data),task=await service.materialize((await service.prepare()).id)
 await replaceTopology(task.path)
 const preview=await service.preview(task.id)
 expect(preview.omitted).toEqual({});expect(preview.changes).toHaveLength(4)
 await service.integrate(task.id,['folder','file.txt/child.txt','folder/nested/child.txt','file.txt'])
 expect(await readFile(join(project,'folder'),'utf8')).toBe('now a file')
 expect(await readFile(join(project,'file.txt','child.txt'),'utf8')).toBe('now a directory')
 const second=await topologyFixture(),other=new TaskWorkspaces(second.project,second.data),child=await other.materialize((await other.prepare()).id)
 await replaceTopology(child.path);await writeFile(join(second.project,'folder','later.txt'),'keep me')
 await expect(other.integrate(child.id,['folder','folder/nested/child.txt'])).rejects.toThrow()
 expect(await readFile(join(second.project,'folder','later.txt'),'utf8')).toBe('keep me')
},30000)
it('preserves session links and metadata arriving during integration',async()=>{
 const {project,data}=await topologyFixture(),recovery=new CheckpointStore(project,join(data,'recovery')),service=new TaskWorkspaces(project,data,recovery),task=await service.materialize((await service.prepare()).id)
 await writeFile(join(task.path,'file.txt'),'agent edit')
 const begin=recovery.begin.bind(recovery)
 vi.spyOn(recovery,'begin').mockImplementationOnce(async(...args)=>{
  await service.link(task.id,'new-continuation');await service.update(task.id,{title:'Updated while integrating'})
  return begin(...args)
 })
 await service.integrate(task.id,['file.txt'])
 expect((await service.list())[0]).toMatchObject({title:'Updated while integrating',linkedSessions:['new-continuation'],state:'integrated'})
},30000)

it('archives only integrated captured work and restores binary/deleted files without running a session',async()=>{
 const project=await mkdtemp(join(tmpdir(),'unrealcode-archive-project-')),data=await mkdtemp(join(tmpdir(),'unrealcode-archive-data-'))
 const git=(args:string[])=>execFileSync('git',['-C',project,...args],{windowsHide:true,stdio:'ignore'})
 git(['init']);await writeFile(join(project,'a.txt'),'base');await writeFile(join(project,'gone.txt'),'base');await writeFile(join(project,'.gitignore'),'ignored.log\n');git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Base'])
 const service=new TaskWorkspaces(project,data),prepared=await service.prepare(),task=await service.materialize(prepared.id)
 await expect(service.archive(task.id)).rejects.toThrow('fully integrated')
 await writeFile(join(task.path,'binary.dat'),Buffer.from([0,8,9]));await unlink(join(task.path,'gone.txt'));await service.integrate(task.id,['binary.dat','gone.txt'])
 await writeFile(join(task.path,'ignored.log'),'keep');await expect(service.archive(task.id)).rejects.toThrow('ignored');await unlink(join(task.path,'ignored.log'))
 await service.archive(task.id);expect((await service.list())[0].state).toBe('archived');await expect(stat(task.path)).rejects.toThrow();const restored=await service.restoreArchived(task.id);expect(restored.state).toBe('integrated');expect(await readFile(join(task.path,'binary.dat'))).toEqual(Buffer.from([0,8,9]));await expect(readFile(join(task.path,'gone.txt'))).rejects.toThrow();expect((await service.preview(task.id)).changes).toEqual([])
 await writeFile(join(task.path,'a.txt'),'later edit');await expect(service.archive(task.id)).rejects.toThrow('later');expect(await readFile(join(task.path,'a.txt'),'utf8')).toBe('later edit')
},30000)

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
