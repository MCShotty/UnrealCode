import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { atomicMetadata } from './atomic-metadata'
import { exists, within, fileInventory } from './recovery-files'
import { readLocations, timestampPath, type LocationRegistry } from './storage-locations'

const exec = promisify(execFile)
type Move = { from:string; to:string; git?:string }
type Patch = { file:string; before:string|null; after:string }
type Journal = { version:1; backup:string; moves:Move[]; patches:Patch[]; committed?:boolean }
const journalPath=(data:string)=>join(data,'storage-migration.json')
async function ownedPath(data:string,path:string):Promise<void>{
  if(!within(data,path))throw new Error('Storage relocation leaves the app profile')
  let at=data
  for(const part of relative(data,path).split(/[\\/]/)){
    at=join(at,part)
    try{if((await fs.lstat(at)).isSymbolicLink())throw new Error('App storage contains a link; inspect the retained recovery data')}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  }
}
async function git(common:string,args:string[]):Promise<string>{return (await exec('git',['--git-dir',common,...args],{windowsHide:true,timeout:60000,maxBuffer:4*1024*1024})).stdout.trim()}
async function applyMove(move:Move,reverse=false):Promise<void>{
  const from=reverse?move.to:move.from,to=reverse?move.from:move.to
  if(!await exists(from)){if(await exists(to))return;throw new Error('Storage relocation lost both recorded paths; inspect the recovery backup')}
  if(await exists(to))throw new Error('Storage relocation destination already exists; original data retained')
  await fs.mkdir(dirname(to),{recursive:true})
  if(move.git)await git(move.git,['worktree','move',from,to]);else await fs.rename(from,to)
}
export async function recoverStorageMigration(data:string):Promise<void>{
  const path=journalPath(data);if(!await exists(path))return
  const journal=JSON.parse(await fs.readFile(path,'utf8')) as Journal
  if(journal.version!==1||!Array.isArray(journal.moves)||!Array.isArray(journal.patches)||journal.moves.some(move=>![move.from,move.to].every(path=>within(data,path)))||journal.patches.some(patch=>!within(data,patch.file)))throw new Error('Invalid storage migration journal; manual recovery required')
  if(journal.committed){await fs.unlink(path);return}
  for(const move of journal.moves){await ownedPath(data,move.from);await ownedPath(data,move.to)}
  for(const patch of journal.patches)await ownedPath(data,patch.file)
  // Patches are written only after all moves. Undo only files whose staged
  // contents are present; never silently overwrite unrelated later changes.
  for(const patch of [...journal.patches].reverse())if(await exists(patch.file)){
    const current=await fs.readFile(patch.file,'utf8')
    if(current===patch.after){if(patch.before===null)await fs.unlink(patch.file);else await atomicMetadata(patch.file,patch.before)}
    else if(current!==patch.before)throw new Error('Metadata changed after interrupted relocation; preserve it before recovering')
  }
  for(const move of [...journal.moves].reverse()){
    const destination=await exists(move.to),source=await exists(move.from)
    if(destination&&source)throw new Error('Both relocation paths exist; resolve the conflict before recovering. The migration journal is retained.')
    if(destination&&!source)await applyMove(move,true)
  }
  await fs.unlink(path)
}
/** Profile-local moves only. Docker volumes and logical record IDs never move. */
export async function migrateStorage(data:string,backup:()=>Promise<string>):Promise<string|undefined>{
  await recoverStorageMigration(data)
  if(await exists(join(data,'storage-layout.json'))){if(JSON.parse(await fs.readFile(join(data,'storage-layout.json'),'utf8')).version!==1)throw new Error('Invalid or newer storage layout metadata');return}
  const changes:Array<{from:string;leaf:string;worktree?:string;virtual?:boolean}>=[],jsonFiles:string[]=[],reserved:string[]=[]
  const roots=['workspaces','checkpoints','specialists','evaluations','editor-recovery']
  async function visit(path:string):Promise<void>{
    for(const item of await fs.readdir(path,{withFileTypes:true})){
      const target=join(path,item.name)
      if(item.isSymbolicLink())throw new Error('Storage relocation cannot follow links; preserve or relocate the linked data first')
      if(item.isFile()){if(item.name.endsWith('.json'))jsonFiles.push(target);continue}
      if(!item.isDirectory()||item.name==='objects'||item.name==='.git')continue
      const isWorktree=await exists(join(target,'.git'))
      if(isWorktree){
        const marker=await fs.lstat(join(target,'.git'));if(!marker.isFile())throw new Error('An embedded Git repository blocks storage relocation')
        const common=resolve(target,(await exec('git',['rev-parse','--git-common-dir'],{cwd:target,windowsHide:true})).stdout.trim())
        const listed=await git(common,['worktree','list','--porcelain']),canonical=(await fs.realpath(target)).replaceAll('\\','/').toLowerCase()
        if(!listed.replaceAll('\\','/').toLowerCase().includes(`worktree ${canonical}\n`))throw new Error('Git worktree registration needs repair before relocation')
        if((await exec('git',['submodule','status'],{cwd:target,windowsHide:true})).stdout.trim()||listed.includes(`worktree ${target.replaceAll('\\','/')}\n`)&&listed.split(`worktree ${target.replaceAll('\\','/')}\n`)[1]?.split('\n\n')[0].includes('\nlocked'))throw new Error('Unlock worktrees and resolve submodules before storage relocation')
        const dest=timestampPath(dirname(target),'',new Date(),reserved);reserved.push(dest.toLowerCase());changes.push({from:target,leaf:dest,worktree:common});continue
      }
      if(/^[a-f0-9]{12,64}$/.test(item.name)||path===join(data,'editor-recovery')&&/^[a-f0-9-]{36}$/.test(item.name)){
        const dest=timestampPath(dirname(target),'',new Date(),reserved);reserved.push(dest.toLowerCase());changes.push({from:target,leaf:dest})
      }
      await visit(target)
    }
  }
  for(const root of roots)if(await exists(join(data,root)))await visit(join(data,root))
  // Prepared and archived tasks may have no checkout. Their recorded location
  // still needs a stable mapping, otherwise a later restore would allocate a
  // different path and fail the task ownership check.
  for(const file of jsonFiles){
    const value=JSON.parse(await fs.readFile(file,'utf8'))
    if(typeof value.id!=='string'||typeof value.path!=='string'||!value.baseline||!value.revision||value.path!==join(dirname(file),'worktrees',value.id)||changes.some(change=>change.from===value.path))continue
    const dest=timestampPath(dirname(value.path),'',new Date(),reserved);reserved.push(dest.toLowerCase());changes.push({from:value.path,leaf:dest,virtual:!await exists(value.path)})
  }
  if(await exists(join(data,'recovery')))for(const entry of await fs.readdir(join(data,'recovery'),{withFileTypes:true})){
    const path=join(data,'recovery',entry.name)
    if(entry.isDirectory()&&!entry.isSymbolicLink()&&!/^\d{4}-\d{2}-\d{2}_/.test(entry.name)&&(await exists(join(path,'manifest.json'))||await exists(join(path,'complete.json')))){
      const dest=timestampPath(dirname(path),'',new Date(),reserved);reserved.push(dest.toLowerCase());changes.push({from:path,leaf:dest})
    }
  }
  for(const name of ['settings.json','state-volumes.json','connections.json','host-operations.json','storage-locations.json','data-version.json'])if(await exists(join(data,name)))jsonFiles.push(join(data,name))
  changes.sort((a,b)=>b.from.length-a.from.length)
  const remap=(input:string):string=>{let path=input;for(const change of changes)if(path.toLowerCase()===change.from.toLowerCase()||within(change.from,path))path=change.leaf+path.slice(change.from.length);return path}
  if(changes.some(change=>change.worktree&&changes.some(parent=>within(parent.from,change.worktree!))))throw new Error('A worktree Git directory is inside relocating storage; manual relocation is required')
  if(!changes.length){await atomicMetadata(join(data,'storage-layout.json'),JSON.stringify({version:1}));return}
  const retained=await backup(),moves:Move[]=[],staged=new Map<string,string>()
  for(const change of changes.filter(item=>item.worktree)){
    const target=timestampPath(join(data,'relocation-staging'),'',new Date(),reserved);reserved.push(target.toLowerCase());staged.set(change.from,target);moves.push({from:change.from,to:target,git:change.worktree})
  }
  for(const change of changes.filter(item=>!item.worktree&&!item.virtual))moves.push({from:change.from,to:change.leaf})
  for(const change of changes.filter(item=>item.worktree))moves.push({from:staged.get(change.from)!,to:remap(change.from),git:change.worktree})
  const pathKeys=new Set(['path','project','worktree','workspace','profile','directory','source','destination','backup','lastBackup','parentPath'])
  const listKeys=new Set(['recentProjects','trustedProjects','decisionCloudProjects','decisionCloudDeclinedProjects'])
  function rewrite(value:unknown,key=''):unknown{
    if(typeof value==='string')return pathKeys.has(key)||listKeys.has(key)?remap(value):value
    if(Array.isArray(value))return value.map(item=>rewrite(item,key))
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[key==='projectInstructions'?remap(name):name,rewrite(item,name)]))
    return value
  }
  const patches:Patch[]=[]
  for(const file of jsonFiles){const before=await fs.readFile(file,'utf8');const value=JSON.parse(before);const after=JSON.stringify(rewrite(value));if(after!==before)patches.push({file:remap(file),before,after})}
  // The verified backup also records inferred pre-registry volume identities.
  // Materialize those mappings before changing any path-derived volume keys.
  const manifestPath=join(retained,'manifest.json')
  if(await exists(manifestPath)){
    const volumes=JSON.parse(await fs.readFile(manifestPath,'utf8')).volumes
    if(Array.isArray(volumes)&&volumes.length){
      const file=join(data,'state-volumes.json'),before=await exists(file)?await fs.readFile(file,'utf8'):null,records=before?JSON.parse(before):[]
      for(const record of volumes){if(typeof record.project!=='string'||typeof record.isolated!=='boolean'||!/^unrealcode-(?:eval-|restore-)?[a-f0-9-]{20,36}$/.test(record.volume))throw new Error('Invalid migration backup volume registry');if(!records.some((item:{project:string;isolated:boolean})=>item.project.toLowerCase()===record.project.toLowerCase()&&item.isolated===record.isolated))records.push(record)}
      const prior=patches.findIndex(patch=>patch.file===file);if(prior>=0)patches.splice(prior,1)
      patches.push({file,before,after:JSON.stringify(rewrite(records))})
    }
  }
  const registries=new Map<string,{originalRoot:string;value:LocationRegistry}>()
  const projectKinds=new Set(['workspaces','checkpoints','specialists'])
  for(const change of changes)for(let root=dirname(dirname(change.from));root===data||within(data,root);root=dirname(root)){const finalRoot=remap(root);let record=registries.get(finalRoot);if(!record){record={originalRoot:root,value:{version:1,locations:readLocations(root).locations.map(item=>({...item,key:projectKinds.has(item.kind)?remap(item.key).toLowerCase():item.key,path:relative(finalRoot,remap(resolve(root,item.path))).replaceAll('\\','/')}))}};registries.set(finalRoot,record)}
    const key=relative(root,change.from).replaceAll('\\','/').toLowerCase(),path=relative(finalRoot,remap(change.from)).replaceAll('\\','/')
    const alias=record.value.locations.find(item=>item.kind==='legacy-path'&&item.key===key)
    if(alias)alias.path=path;else record.value.locations.push({kind:'legacy-path',key,path,createdAt:new Date().toISOString()})
    if(root===data)break
  }
  // A moved task is itself a project. Its old path hash no longer matches the
  // hash computed on reopen, so bind its retained desktop data to the new path.
  const profileRegistry=registries.get(data)
  if(profileRegistry)for(const change of changes.filter(item=>item.worktree||item.virtual)){
    const key=remap(change.from).toLowerCase(),digest=createHash('sha256').update(change.from.toLowerCase()).digest('hex')
    for(const kind of projectKinds){
      if(profileRegistry.value.locations.some(item=>item.kind===kind&&item.key===key))continue
      const legacy=`${kind}/${kind==='specialists'?digest.slice(0,12):digest}`
      const source=profileRegistry.value.locations.find(item=>item.kind==='legacy-path'&&item.key===legacy)
      if(source)profileRegistry.value.locations.push({kind,key,path:source.path,createdAt:new Date().toISOString()})
    }
  }
  for(const [root,record] of registries){const file=join(root,'storage-locations.json'),source=join(record.originalRoot,'storage-locations.json'),before=await exists(source)?await fs.readFile(source,'utf8'):null;const prior=patches.findIndex(patch=>patch.file===file);if(prior>=0)patches.splice(prior,1);patches.push({file,before,after:JSON.stringify(record.value)})}
  patches.push({file:join(data,'storage-layout.json'),before:null,after:JSON.stringify({version:1,backup:retained,migratedAt:new Date().toISOString()})})
  const journal:Journal={version:1,backup:retained,moves,patches}
  await atomicMetadata(journalPath(data),JSON.stringify(journal))
  try{
    // Fingerprint each entire owned worktree, including untracked and ignored files.
    const inventories=new Map<string,Awaited<ReturnType<typeof fileInventory>>>()
    for(const change of changes.filter(item=>item.worktree))inventories.set(change.from,(await fileInventory(change.from)).filter(file=>file.path!=='.git'))
    for(const move of moves){await ownedPath(data,move.from);await ownedPath(data,move.to);await applyMove(move)}
    for(const [path,before] of inventories){const after=(await fileInventory(remap(path))).filter(file=>file.path!=='.git');if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Worktree contents changed during relocation; recovery is required')}
    for(const patch of patches){await ownedPath(data,patch.file);await atomicMetadata(patch.file,patch.after)}
    for(const change of changes.filter(item=>item.worktree))await exec('git',['status','--porcelain'],{cwd:remap(change.from),windowsHide:true,timeout:30000})
    journal.committed=true;await atomicMetadata(journalPath(data),JSON.stringify(journal));await fs.unlink(journalPath(data));return retained
  }catch(error){await recoverStorageMigration(data);throw error}
}
