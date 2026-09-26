import { it,expect } from 'vitest'
import { mkdtemp,writeFile,readFile,unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CheckpointService } from './checkpoint-service'
import { TaskWorkspaces } from './task-workspaces'

it('uses recorded before-state while parent changes files, retaining binary and deleted inputs',async()=>{
 const project=await mkdtemp(join(tmpdir(),'unrealcode-specialist-source-')),data=await mkdtemp(join(tmpdir(),'unrealcode-specialist-state-'))
 const git=(args:string[])=>execFileSync('git',['-C',project,...args],{windowsHide:true,stdio:'ignore'})
 git(['init']);await writeFile(join(project,'a.txt'),'base');await writeFile(join(project,'deleted.txt'),'remove me');git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Base'])
 await unlink(join(project,'deleted.txt'));await writeFile(join(project,'a.txt'),'before');await writeFile(join(project,'binary.dat'),Buffer.from([0,1,2]))
 const checkpoints=new CheckpointService(project,data)
 await checkpoints.send('parent','message','Task',async()=>{})
 await writeFile(join(project,'a.txt'),'parent in-flight edit');await writeFile(join(project,'binary.dat'),Buffer.from([0,8,9]))
 const source=await checkpoints.delegationSource('parent');expect(source.phase).toBe('before')
 const workspaces=new TaskWorkspaces(project,join(data,'specialists'))
 const prepared=await workspaces.prepare({store:checkpoints.store,snapshot:source.snapshot,label:source.id}),worker=await workspaces.materialize(prepared.id)
 expect(await readFile(join(worker.path,'a.txt'),'utf8')).toBe('before');expect(await readFile(join(worker.path,'binary.dat'))).toEqual(Buffer.from([0,1,2]));await expect(readFile(join(worker.path,'deleted.txt'))).rejects.toThrow()
 await checkpoints.event({v:1,event:'session.idle',sessionId:'parent',seq:1,payload:{messageIds:['message']}})
 const completed=await checkpoints.delegationSource('parent');expect(completed.phase).toBe('after');expect((await checkpoints.store.snapshotBytes(completed.snapshot,'a.txt'))?.toString()).toBe('parent in-flight edit')
},15000)
it('refuses a recorded source when overlapping sessions can mutate it',async()=>{
 const project=await mkdtemp(join(tmpdir(),'unrealcode-specialist-overlap-')),data=await mkdtemp(join(tmpdir(),'unrealcode-specialist-overlap-state-'))
 const service=new CheckpointService(project,data);await writeFile(join(project,'a.txt'),'a')
 await service.send('parent','one','First',async()=>{});await service.send('other','two','Concurrent',async()=>{})
 await expect(service.delegationSource('parent')).rejects.toThrow('Concurrent source edits')
})
