import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createTimestampDirectory, storageLocation, timestampName, timestampPath } from './storage-locations'
import { migrateStorage, recoverStorageMigration } from './storage-migration'
import { copyTree, exists } from './recovery-files'
import { TaskWorkspaces } from './task-workspaces'
const exec=promisify(execFile),roots:string[]=[]
afterEach(async()=>{for(const path of roots.splice(0))await fs.rm(path,{recursive:true,force:true})})
async function fixture(){const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-relocation-'));roots.push(root);const data=join(root,'data');await fs.mkdir(data);return {root,data}}
it('allocates stable timestamp paths with numeric collision suffixes and tolerates clock reversal',async()=>{
  const {data}=await fixture(),time=new Date('2026-09-27T18:42:10.123Z')
  expect(timestampName(time)).toBe('2026-09-27_18-42-10.123Z')
  const first=timestampPath(data,'',time);await fs.mkdir(first)
  expect(timestampPath(data,'',time)).toBe(first+'-2')
  const location=storageLocation(data,'workspaces','PROJECT')
  expect(storageLocation(data,'workspaces','project')).toBe(location)
  expect(timestampPath(data,'',new Date('2020-01-01'))).toContain('2020-01-01')
})
it('renames existing storage and registered worktrees without changing titles, IDs, volumes or dirty files',async()=>{
  const {root,data}=await fixture(),project=join(root,'project');await fs.mkdir(project)
  const git=async(args:string[],cwd=project)=>(await exec('git',args,{cwd,windowsHide:true})).stdout
  await git(['init']);await fs.writeFile(join(project,'tracked.txt'),'original');await fs.writeFile(join(project,'.gitignore'),'ignored.txt\n');await git(['add','.']);await git(['-c','user.name=QA','-c','user.email=qa@example.test','commit','-m','fixture'])
  const hash=createHash('sha256').update(project.toLowerCase()).digest('hex'),old=join(data,'workspaces',hash),id=randomUUID(),task=join(old,'tasks'),worktree=join(task,'worktrees',id)
  await fs.mkdir(join(task,'worktrees'),{recursive:true});await git(['worktree','add','--detach',worktree])
  await fs.writeFile(join(worktree,'tracked.txt'),'dirty');await fs.writeFile(join(worktree,'untracked.txt'),'new');await fs.writeFile(join(worktree,'ignored.txt'),'must remain')
  const metadata={id,path:worktree,branch:'unused',revision:'test',createdAt:new Date().toISOString(),state:'interrupted',title:'Keep the chat title',omitted:{},baseline:{files:{},skipped:{}}}
  await fs.writeFile(join(task,`${id}.json`),JSON.stringify(metadata));await fs.writeFile(join(data,'state-volumes.json'),JSON.stringify([{project:worktree,isolated:true,volume:'unrealcode-eval-aaaaaaaaaaaaaaaaaaaa'}]))
  const backup=join(root,'backup');await migrateStorage(data,async()=>{await copyTree(data,backup);return backup})
  const location=storageLocation(data,'workspaces',project,old);expect(location).not.toBe(old)
  const moved=JSON.parse(await fs.readFile(join(location,'tasks',`${id}.json`),'utf8'))
  expect(moved.id).toBe(id);expect(moved.title).toBe(metadata.title)
  for(const [file,contents] of [['tracked.txt','dirty'],['untracked.txt','new'],['ignored.txt','must remain']])expect(await fs.readFile(join(moved.path,file),'utf8')).toBe(contents)
  expect(await git(['status','--porcelain'],moved.path)).toContain('tracked.txt')
  expect((await new TaskWorkspaces(project,join(location,'tasks')).list())[0].path).toBe(moved.path)
  const volumes=JSON.parse(await fs.readFile(join(data,'state-volumes.json'),'utf8'));expect(volumes[0].project).toBe(moved.path);expect(volumes[0].volume).toBe('unrealcode-eval-aaaaaaaaaaaaaaaaaaaa')
  expect(await exists(join(backup,'workspaces',hash,'tasks',`${id}.json`))).toBe(true)
},20000) // Real Windows Git processes can exceed 5 seconds under concurrent builds.
it('does not move anything if backup fails and reverses an interrupted relocation',async()=>{
  const {data}=await fixture(),from=join(data,'workspaces','a'.repeat(64)),to=join(data,'workspaces','2026-09-27_00-00-00.000Z')
  await fs.mkdir(from,{recursive:true});await fs.writeFile(join(from,'queue.json'),'{}')
  await expect(migrateStorage(data,async()=>{throw new Error('Docker daemon unavailable')})).rejects.toThrow('Docker daemon')
  expect(await exists(from)).toBe(true)
  await fs.rename(from,to);await fs.writeFile(join(data,'storage-migration.json'),JSON.stringify({version:1,backup:'retained',moves:[{from,to}],patches:[]}))
  await recoverStorageMigration(data);expect(await exists(from)).toBe(true);expect(await exists(to)).toBe(false)
})
it('preserves absent archived workspaces and inferred pre-registry session volumes',async()=>{
  const {root,data}=await fixture(),old=join(data,'workspaces','b'.repeat(64)),tasks=join(old,'tasks'),id=randomUUID(),path=join(tasks,'worktrees',id)
  await fs.mkdir(tasks,{recursive:true})
  await fs.writeFile(join(tasks,`${id}.json`),JSON.stringify({id,path,branch:'retained',revision:'commit',createdAt:new Date().toISOString(),state:'archived',title:'Original archived task',omitted:{},baseline:{files:{},skipped:{}}}))
  await migrateStorage(data,async()=>{const backup=join(root,'backup');await copyTree(data,backup);await fs.writeFile(join(backup,'manifest.json'),JSON.stringify({volumes:[{project:path,isolated:true,volume:'unrealcode-eval-aaaaaaaaaaaaaaaaaaaa'}]}));return backup})
  const moved=storageLocation(data,'workspaces','unused-project',old),records=await new TaskWorkspaces('unused-project',join(moved,'tasks')).list()
  expect(records[0].id).toBe(id);expect(records[0].state).toBe('archived');expect(records[0].title).toBe('Original archived task')
  expect(await exists(records[0].path)).toBe(false);expect(records[0].path).not.toContain(id)
  const volumes=JSON.parse(await fs.readFile(join(data,'state-volumes.json'),'utf8'));expect(volumes[0].project).toBe(records[0].path);expect(volumes[0].volume).toBe('unrealcode-eval-aaaaaaaaaaaaaaaaaaaa')
})
it('does not roll metadata back through a junction introduced after an interruption',async()=>{
  const {root,data}=await fixture(),outside=join(root,'outside'),link=join(data,'linked')
  await fs.mkdir(outside);await fs.writeFile(join(outside,'queue.json'),'after');await fs.symlink(outside,link,'junction')
  await fs.writeFile(join(data,'storage-migration.json'),JSON.stringify({version:1,backup:'retained',moves:[],patches:[{file:join(link,'queue.json'),before:'before',after:'after'}]}))
  await expect(recoverStorageMigration(data)).rejects.toThrow('link')
  expect(await fs.readFile(join(outside,'queue.json'),'utf8')).toBe('after')
})

it('keeps child-project context and checkpoints reachable after its task path changes',async()=>{
  const {root,data}=await fixture(),parent=join(data,'workspaces','c'.repeat(64)),tasks=join(parent,'tasks'),id=randomUUID(),oldPath=join(tasks,'worktrees',id)
  const hash=(value:string)=>createHash('sha256').update(value.toLowerCase()).digest('hex')
  const childData=join(data,'workspaces',hash(oldPath)),childCheckpoints=join(data,'checkpoints',hash(oldPath))
  await fs.mkdir(tasks,{recursive:true});await fs.mkdir(childData,{recursive:true});await fs.mkdir(childCheckpoints,{recursive:true})
  await fs.writeFile(join(tasks,`${id}.json`),JSON.stringify({id,path:oldPath,revision:'commit',baseline:{files:{},skipped:{}},state:'archived',title:'Keep this title'}))
  await fs.writeFile(join(childData,'context.json'),JSON.stringify({instructions:'retained context'}))
  await fs.writeFile(join(childCheckpoints,'sentinel.json'),JSON.stringify({title:'retained checkpoint'}))
  await migrateStorage(data,async()=>{const backup=join(root,'backup');await copyTree(data,backup);return backup})
  const parentNow=storageLocation(data,'workspaces','parent',parent),record=JSON.parse(await fs.readFile(join(parentNow,'tasks',`${id}.json`),'utf8'))
  const childNow=storageLocation(data,'workspaces',record.path,join(data,'workspaces',hash(record.path)))
  const checkpointsNow=storageLocation(data,'checkpoints',record.path,join(data,'checkpoints',hash(record.path)))
  expect(JSON.parse(await fs.readFile(join(childNow,'context.json'),'utf8')).instructions).toBe('retained context')
  expect(JSON.parse(await fs.readFile(join(checkpointsNow,'sentinel.json'),'utf8')).title).toBe('retained checkpoint')
})
it('retains a relocation journal when both original and destination exist',async()=>{
  const {data}=await fixture(),from=join(data,'workspaces','old'),to=join(data,'workspaces','new')
  await fs.mkdir(from,{recursive:true});await fs.mkdir(to,{recursive:true})
  await fs.writeFile(join(data,'storage-migration.json'),JSON.stringify({version:1,backup:'retained',moves:[{from,to}],patches:[]}))
  await expect(recoverStorageMigration(data)).rejects.toThrow(/both|conflict|ambiguous/i)
  expect(await exists(join(data,'storage-migration.json'))).toBe(true)
})
it('allocates separate recovery directories during same-millisecond concurrent saves',async()=>{
  const {data}=await fixture(),at=new Date('2026-09-27T18:42:10.123Z')
  const paths=await Promise.all(Array.from({length:12},()=>createTimestampDirectory(join(data,'editor-recovery'),at)))
  expect(new Set(paths).size).toBe(12)
  expect(await fs.readdir(join(data,'editor-recovery'))).toHaveLength(12)
})
it('migrates legacy editor recovery directories with a verified prior copy',async()=>{
  const {root,data}=await fixture(),legacy=join(data,'editor-recovery',randomUUID()),before={project:'external-project',content:'unsaved prior text',path:'file.txt'}
  await fs.mkdir(legacy,{recursive:true});await fs.writeFile(join(legacy,'before.json'),JSON.stringify(before))
  const backup=join(root,'backup');await migrateStorage(data,async()=>{await copyTree(data,backup);return backup})
  const names=await fs.readdir(join(data,'editor-recovery'))
  expect(names).toHaveLength(1);expect(names[0]).toMatch(/^\d{4}-\d{2}-\d{2}_/)
  expect(JSON.parse(await fs.readFile(join(data,'editor-recovery',names[0],'before.json'),'utf8'))).toEqual(before)
  expect(await exists(join(backup,'editor-recovery',legacy.split(/[\\/]/).at(-1)!,'before.json'))).toBe(true)
})
