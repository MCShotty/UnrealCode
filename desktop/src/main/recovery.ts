import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname,join,resolve } from 'node:path'
import type { BackupPreview } from '../shared/recovery'
import { atomicMetadata } from './atomic-metadata'
import { copyTree,durableRoots,exists,fileInventory,hashFile,metadataRoots,noLinks,safeRelative,within,type FileRecord } from './recovery-files'
import { defaultVolume,volumeRecords,type VolumeRecord } from './state-volumes'
import type { RecoveryVolumes } from './recovery-volumes'
type Manifest={format:1;id:string;createdAt:string;version:string;profile:string;files:FileRecord[];volumes:VolumeRecord[]}
const warning=['Contains conversation history, instructions, checkpoints and owned worktree files. Keep this backup private.','Saved API keys, Codex login, connection secrets and model caches are excluded.','Restoration requires this Windows profile and original project paths. Project files outside app data are not restored.','Restore resets project/cloud/MCP trust, execution modes and local provider endpoints. Tasks require explicit resumption.']
export class Recovery {
 constructor(readonly data:string,readonly version:string,private volumes:RecoveryVolumes){}
 private manifestPath(path:string){return join(path,'manifest.json')}
 async knownVolumes(fallback?:VolumeRecord[]):Promise<VolumeRecord[]>{
  let records:VolumeRecord[],settings:{recentProjects?:string[];trustedProjects?:string[]}={}
  try{records=volumeRecords(this.data)}catch(error){if(!fallback)throw error;records=[]}
  for(const item of fallback||[])if(!records.some(record=>record.project===item.project&&record.isolated===item.isolated))records.push(item)
  try{if(await exists(join(this.data,'settings.json')))settings=JSON.parse(await fs.readFile(join(this.data,'settings.json'),'utf8'))}catch(error){if(!fallback)throw error}
  for(const project of [...settings.recentProjects||[],...settings.trustedProjects||[]])if(typeof project==='string'&&!records.some(item=>item.project===project&&!item.isolated))records.push({project,isolated:false,volume:defaultVolume(project,false)})
  // Pre-1.0 installations did not have a registry. Recover owned task paths from their metadata.
  for(const root of ['workspaces','specialists','evaluations'])if(await exists(join(this.data,root))){
   const visit=async(path:string):Promise<void>=>{for(const item of await fs.readdir(path,{withFileTypes:true})){
    if(item.isSymbolicLink())throw new Error('App metadata contains a link')
    if(item.isDirectory()){if(!['worktrees','objects','search'].includes(item.name))await visit(join(path,item.name))}
    else if(item.name.endsWith('.json')){let value;try{value=JSON.parse(await fs.readFile(join(path,item.name),'utf8'))}catch(error){if(!fallback)throw error;continue}const paths=[value.path,...(Array.isArray(value.arms)?value.arms.map((arm:{worktree?:string})=>arm.worktree):[])];for(const project of paths)if(typeof project==='string'&&within(this.data,project)&&!records.some(item=>item.project===project&&item.isolated))records.push({project,isolated:true,volume:defaultVolume(project,true)})}
   }};await visit(join(this.data,root))
  }
  const present=new Set(await this.volumes.existing(records.map(item=>item.volume)));return records.filter(item=>present.has(item.volume))
 }
 async export(destination:string,fallback?:VolumeRecord[]):Promise<BackupPreview>{
  if(await exists(destination))throw new Error('Choose a new, empty backup directory name')
  if(within(this.data,destination)&&!within(join(this.data,'recovery'),destination))throw new Error('Backups cannot be written inside live app storage')
  const staging=`${destination}.partial-${randomUUID()}`;await fs.mkdir(join(staging,'metadata'),{recursive:true})
  try{
   const volumes=await this.knownVolumes(fallback)
   for(const root of metadataRoots)if(await exists(join(this.data,root)))await copyTree(join(this.data,root),join(staging,'metadata',root))
   for(const record of volumes)await this.volumes.export(record.volume,join(staging,'volumes',record.volume))
   const files=await fileInventory(staging),manifest:Manifest={format:1,id:randomUUID(),createdAt:new Date().toISOString(),version:this.version,profile:resolve(this.data),files,volumes}
   await fs.writeFile(this.manifestPath(staging),JSON.stringify(manifest),{mode:0o600,flag:'wx'});await fs.rename(staging,destination);return this.summary(manifest)
  }catch(error){throw new Error(`Backup failed. Original data is unchanged; partial copy retained at ${staging}. ${String(error)}`)}
 }
 private summary(manifest:Manifest):BackupPreview{return {id:manifest.id,createdAt:manifest.createdAt,version:manifest.version,profile:manifest.profile,files:manifest.files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),volumes:manifest.volumes.length,warnings:warning}}
 private async verify(path:string):Promise<Manifest>{
  const stat=await fs.lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Select a backup directory without links')
  const manifestFile=await noLinks(path,'manifest.json');if((await fs.stat(manifestFile)).size>50*1024**2)throw new Error('Backup manifest too large')
  const value=JSON.parse(await fs.readFile(manifestFile,'utf8')) as Manifest
  if(value.format!==1||!Array.isArray(value.files)||!Array.isArray(value.volumes)||value.files.length>250000||typeof value.profile!=='string'||typeof value.id!=='string')throw new Error('Unsupported backup format')
  if(resolve(value.profile).toLowerCase()!==resolve(this.data).toLowerCase())throw new Error('This recovery backup belongs to a different Windows profile or app-data location. Restore it to its original location.')
  const seen=new Set<string>();let bytes=0
  for(const item of value.volumes)if(!/^unrealcode-(?:eval-|restore-)?[a-f0-9-]{20,36}$/.test(item.volume)||typeof item.project!=='string'||typeof item.isolated!=='boolean')throw new Error('Invalid backup volume')
  for(const file of value.files){safeRelative(file.path);const key=file.path.toLowerCase(),parts=file.path.split('/');if(seen.has(key))throw new Error('Duplicate backup path');seen.add(key)
   if(parts[0]==='metadata'?!metadataRoots.includes(parts[1]):parts[0]!=='volumes'||!value.volumes.some(item=>item.volume===parts[1])||!durableRoots.includes(parts[2]))throw new Error('Backup contains an unsupported data path')
   if(!Number.isSafeInteger(file.bytes)||file.bytes<0||!(/^[a-f0-9]{64}$/).test(file.sha256)||(bytes+=file.bytes)>50*1024**3)throw new Error('Invalid backup size or checksum')
   const source=await noLinks(path,file.path),info=await fs.lstat(source);if(!info.isFile()||info.size!==file.bytes||await hashFile(source)!==file.sha256)throw new Error(`Backup integrity check failed: ${file.path}`)
  }
  const actual=await fileInventory(path);if(actual.some(file=>file.path!=='manifest.json'&&!seen.has(file.path.toLowerCase())))throw new Error('Backup contains unlisted files')
  return value
 }
 async preview(path:string):Promise<BackupPreview>{return this.summary(await this.verify(path))}
 async restore(path:string):Promise<string>{
  const manifest=await this.verify(path),id=randomUUID(),area=join(this.data,'recovery',id),stage=join(area,'staged')
  await this.export(join(area,'before-restore'),manifest.volumes)
  await fs.mkdir(stage,{recursive:true})
  // Hash the private staged copy as well: a source changed during copying must
  // never become the live profile even if it changes back before revalidation.
  const volumeStage=join(area,'volumes')
  for(const file of manifest.files){const parts=file.path.split('/');if(file.path==='metadata/state-volumes.json')continue;const target=parts[0]==='metadata'?join(stage,...parts.slice(1)):join(volumeStage,...parts.slice(1));await fs.mkdir(dirname(target),{recursive:true});await fs.copyFile(await noLinks(path,file.path),target);if(await hashFile(target)!==file.sha256)throw new Error('Backup changed while restoring')}
  const settingsPath=join(stage,'settings.json');if(await exists(settingsPath)){const settings=JSON.parse(await fs.readFile(settingsPath,'utf8'));Object.assign(settings,{trustedProjects:[],decisionCloudProjects:[],decisionCloudDeclinedProjects:[],decisionEngine:'off',executionMode:'ask',baseUrl:'',autoCompaction:false});await fs.writeFile(settingsPath,JSON.stringify(settings))}
  const connectionPath=join(stage,'connections.json');if(await exists(connectionPath)){const connections=JSON.parse(await fs.readFile(connectionPath,'utf8'));connections.grants=[];connections.catalog=[];for(const connection of connections.connections||[])connection.id=randomUUID();await fs.writeFile(connectionPath,JSON.stringify(connections))}
  const sanitize=async(path:string):Promise<void>=>{for(const item of await fs.readdir(path,{withFileTypes:true})){const target=join(path,item.name);if(item.isDirectory()&&!['worktrees','objects','search'].includes(item.name))await sanitize(target);else if(item.isFile()&&['queue.json','teams.json'].includes(item.name)){const value=JSON.parse(await fs.readFile(target,'utf8'));value.paused=true;for(const task of value.tasks||[]){task.paused=true;if(task.config)Object.assign(task.config,{mode:'ask',baseUrl:'',teamEnabled:false,teamManaged:false});if(task.teamOptions)task.teamOptions.allowSpecialists=false;if(task.options)task.options.allowSpecialists=false;}await fs.writeFile(target,JSON.stringify(value))}}};await sanitize(stage)
  const records:VolumeRecord[]=[];for(const item of manifest.volumes){const source=join(volumeStage,item.volume);await fs.mkdir(source,{recursive:true});records.push({...item,volume:await this.volumes.import(source)})}
  await fs.writeFile(join(stage,'state-volumes.json'),JSON.stringify(records))
  await fs.writeFile(join(stage,'data-version.json'),JSON.stringify({schema:1,version:this.version,backup:join(area,'before-restore')}))
  const journal={id,roots:metadataRoots.map(root=>({root,hadOld:false}))}
  for(const item of journal.roots)item.hadOld=await exists(join(this.data,item.root))
  await atomicMetadata(join(this.data,'recovery-transaction.json'),JSON.stringify(journal))
  try{for(const {root,hadOld} of journal.roots){if(hadOld){await fs.mkdir(join(area,'prior'),{recursive:true});await fs.rename(join(this.data,root),join(area,'prior',root))}if(await exists(join(stage,root)))await fs.rename(join(stage,root),join(this.data,root))}await fs.unlink(join(this.data,'recovery-transaction.json'))}
  catch(error){await this.rollback();throw error}
  await fs.writeFile(join(area,'complete.json'),JSON.stringify({restored:manifest.id,at:new Date().toISOString()})).catch(()=>{})
  return join(area,'before-restore')
 }
 async rollback():Promise<void>{const file=join(this.data,'recovery-transaction.json');if(!await exists(file))return;const journal=JSON.parse(await fs.readFile(file,'utf8')) as {id:string;roots:{root:string;hadOld:boolean}[]};if(!/^[a-f0-9-]{36}$/.test(journal.id)||journal.roots.some(item=>!metadataRoots.includes(item.root)))throw new Error('Recovery journal needs manual inspection')
  const area=join(this.data,'recovery',journal.id);for(const {root,hadOld} of journal.roots){const old=join(area,'prior',root),current=join(this.data,root);if(await exists(old)){if(await exists(current)){await fs.mkdir(join(area,'failed'),{recursive:true});await fs.rename(current,join(area,'failed',root))}await fs.rename(old,current)}else if(!hadOld&&await exists(current)){await fs.mkdir(join(area,'failed'),{recursive:true});await fs.rename(current,join(area,'failed',root))}}await fs.unlink(file)
 }
 async migrate():Promise<string|undefined>{await this.rollback();const path=join(this.data,'data-version.json');if(await exists(path)){const state=JSON.parse(await fs.readFile(path,'utf8'));if(state.schema===1)return;if(state.schema>1)throw new Error('This app is older than the saved data. Install the newer version or restore a backup.')}
  let backup:string|undefined;if((await Promise.all(metadataRoots.map(root=>exists(join(this.data,root))))).some(Boolean)){backup=join(this.data,'recovery',`before-1.0-${randomUUID()}`);await this.export(backup)}
  await atomicMetadata(path,JSON.stringify({schema:1,version:this.version,backup}));return backup
 }
}
