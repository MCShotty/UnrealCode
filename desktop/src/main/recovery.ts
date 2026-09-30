import { createTimestampDirectory,lookupStorage, timestampPath } from './storage-locations'
import { migrateStorage, recoverStorageMigration } from './storage-migration'
import { promises as fs } from 'node:fs'
import { createHash,randomUUID } from 'node:crypto'
import { dirname,isAbsolute,join,relative,resolve } from 'node:path'
import type { BackupPreview,RetainedVolume,RetainedVolumeReport } from '../shared/recovery'
import { atomicMetadata } from './atomic-metadata'
import { copyTree,durableRoots,exists,fileInventory,hashFile,metadataRoots,noLinks,safeRelative,within,type FileRecord } from './recovery-files'
import { defaultVolume,registerRecoveredVolume,undoRecoveredVolume,volumeRecords,type VolumeRecord } from './state-volumes'
import type { RecoveryVolumes } from './recovery-volumes'
import { readBoundedJSON,readBoundedRegularFile } from './bounded-file-read'
import { knownSettings } from '../shared/api'
import { readRestoreVolumeJournal,type RestoreVolumeEntry,type RestoreVolumeJournal } from './restore-volume-journal'
import {storageCopy,storageHash} from './project-fs'
type Manifest={format:1;id:string;createdAt:string;version:string;profile:string;files:FileRecord[];volumes:VolumeRecord[]}
const warning=['Contains conversation history, instructions, checkpoints and owned worktree files. Keep this backup private.','Saved API keys, Codex login, connection secrets and model caches are excluded.','Restoration requires this Windows profile and original project paths. Project files outside app data are not restored.','Restore resets project/cloud/MCP trust, execution modes and local provider endpoints. Tasks require explicit resumption.']

async function sanitizeBackupSettings(path:string,preserveOriginal=false):Promise<void>{
 // A before-restore copy is the exact recovery image of the current profile.
 if(preserveOriginal)return
 let value:unknown
 value=await readBoundedJSON<unknown>(path,64*1024*1024)
 if(!value||typeof value!=='object'||Array.isArray(value)){
  throw Error('Saved settings have an invalid structure; the original profile is preserved')
 }
 const source=value as Record<string,unknown>
 const recognized=knownSettings(source)
 await fs.writeFile(path,JSON.stringify(recognized),{mode:0o600})
}

async function sanitizeMemoryRuntime(target:string):Promise<void>{
 const value=await readBoundedJSON<Record<string,any>>(target,1024*1024)
 if(!value||typeof value!=='object'||Array.isArray(value)||!value.image||!value.postgres||!value.volume)throw Error('Invalid memory runtime recovery metadata')
 const dump=join(dirname(target),'database.dump'),present=await exists(dump),backup=value.backup
 const empty=backup?.empty===true&&backup.sha256===undefined&&!present
 const verified=backup?.empty!==true&&/^[a-f0-9]{64}$/.test(String(backup?.sha256||''))&&present&&await hashFile(dirname(target),'database.dump')===backup.sha256
 if(!empty&&!verified)throw Error('Memory recovery backup lacks a verified database dump. Original app data is unchanged.')
 value.generation=randomUUID();value.restoreRequired=true
 await fs.writeFile(target,JSON.stringify(value))
}

async function sanitizeMemoryRecords(target:string):Promise<void>{
 const value=JSON.parse(await fs.readFile(target,'utf8'))
 if(!value||![1,2].includes(value.version)||!value.settings||typeof value.settings!=='object'||Array.isArray(value.settings)||!value.records||typeof value.records!=='object'||Array.isArray(value.records))throw Error('Invalid memory recovery metadata; original app data is unchanged')
 value.settings.enabled=false;value.settings.globalConsent=false;value.settings.projects=[];value.settings.verifiedProfile=undefined
 const restoredDump=await exists(join(dirname(target),'database.dump'))
 for(const rows of Object.values(value.records) as any[][]){
  if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('Invalid memory recovery records')
  for(const row of rows){
   if(row.state==='forgotten'){if(restoredDump){row.deletionPending=true;row.attempts=0}}
   else{row.state='pending';row.attempts=0}
  }
 }
 await fs.writeFile(target,JSON.stringify(value))
}
export class Recovery {
 constructor(readonly data:string,readonly version:string,private volumes:RecoveryVolumes){}
 private manifestPath(path:string){return join(path,'manifest.json')}
 async knownVolumes(fallback?:VolumeRecord[]):Promise<VolumeRecord[]>{
  let records:VolumeRecord[],settings:{recentProjects?:string[];trustedProjects?:string[]}={}
  try{records=volumeRecords(this.data)}catch(error){if(!fallback)throw error;records=[]}
  for(const item of fallback||[])if(!records.some(record=>record.project===item.project&&record.isolated===item.isolated))records.push(item)
  try{if(await exists(join(this.data,'settings.json')))settings=await readBoundedJSON(join(this.data,'settings.json'),64*1024*1024)}catch(error){if(!fallback)throw error}
  for(const project of [...Array.isArray(settings?.recentProjects)?settings.recentProjects:[],...Array.isArray(settings?.trustedProjects)?settings.trustedProjects:[]])if(typeof project==='string'&&!records.some(item=>item.project===project&&!item.isolated))records.push({project,isolated:false,volume:defaultVolume(project,false)})
  // Pre-1.0 installations did not have a registry. Recover owned task paths from their metadata.
  for(const root of ['workspaces','specialists','evaluations'])if(await exists(join(this.data,root))){
   const visit=async(path:string):Promise<void>=>{for(const item of await fs.readdir(path,{withFileTypes:true})){
    if(item.isSymbolicLink())throw new Error('App metadata contains a link')
    if(item.isDirectory()){if(!['worktrees','objects','search'].includes(item.name))await visit(join(path,item.name))}
    else if(item.name.endsWith('.json')){let value;try{value=JSON.parse(await fs.readFile(join(path,item.name),'utf8'))}catch(error){if(!fallback)throw error;continue}
     const paths=[value.path,...(Array.isArray(value.arms)?value.arms.map((arm:{worktree?:string;retainedVolume?:string},index:number)=>{
      if(arm.worktree)return arm.worktree
      // Old evaluations can retain session storage after removing the checkout.
      if(root==='evaluations'&&/^[a-f0-9-]{36}$/.test(value.id)){const directory=join(this.data,'evaluations'),legacy=join(directory,'worktrees',value.id,String(index)),owned=lookupStorage(directory,'worktrees',`${value.id}:${index}`,legacy)||legacy;if(arm.retainedVolume===defaultVolume(owned,true))return owned}
      return undefined
     }):[])];for(const project of paths)if(typeof project==='string'&&within(this.data,project)&&!records.some(item=>item.project.toLowerCase()===project.toLowerCase()&&item.isolated))records.push({project,isolated:true,volume:defaultVolume(project,true)})}
   }};await visit(join(this.data,root))
  }
  const present=new Set(await this.volumes.existing(records.map(item=>item.volume)));return records.filter(item=>present.has(item.volume))
 }
 private async retainedEntries():Promise<{entries:Array<RestoreVolumeEntry & {id:string;backupId:string;journalPath:string}>;additional:number}>{
  const directory=join(this.data,'recovery')
  if(!await exists(directory))return {entries:[],additional:0}
  const registered=new Set(volumeRecords(this.data).map(item=>item.volume))
  const entries:Array<RestoreVolumeEntry & {id:string;backupId:string;journalPath:string}>=[]
  const seen=new Set<string>()
  let additional=0
  const areas=await fs.readdir(directory,{withFileTypes:true})
  if(areas.length>10000)throw Error('Recovery has too many retained folders to inspect safely; keep the data and request manual review')
  for(const area of areas){
   if(area.isSymbolicLink())throw Error('Recovery contains a linked folder; retained volumes need manual inspection')
   if(!area.isDirectory())continue
   const journalPath=join(directory,area.name,'volume-imports.json')
   if(!await exists(journalPath))continue
   await noLinks(this.data,relative(this.data,journalPath).replaceAll('\\','/'))
   const journal=await readRestoreVolumeJournal(journalPath)
   for(const item of journal.volumes){
    if(seen.has(item.restored))throw Error('Two restore journals claim the same volume; preserve both for manual review')
    seen.add(item.restored)
    if(seen.size>10000)throw Error('Too many retained volume identities for automatic recovery; preserve the journals for manual review')
    if(registered.has(item.restored))continue
    if(entries.length<100)entries.push({...item,id:createHash('sha256').update(journalPath+'\0'+item.restored).digest('hex'),backupId:journal.backupId,journalPath})
    else additional++
   }
  }
  return {entries,additional}
 }
 async retainedVolumes():Promise<RetainedVolumeReport>{
  const {entries,additional}=await this.retainedEntries(),items:RetainedVolume[]=[]
  let present:Set<string>|undefined
  try{present=new Set(await this.volumes.existing(entries.map(item=>item.restored)))}catch{/* Docker may be stopped; preserve the local journal view. */}
  const registered=volumeRecords(this.data)
  for(const entry of entries){
   const base={id:entry.id,volume:entry.restored,source:entry.source,project:entry.project,isolated:entry.isolated,backupId:entry.backupId}
   if(!present){items.push({...base,status:'unavailable',exportable:false,attachable:false,reason:'Docker is unavailable. Start its Linux engine and inspect this retained copy again.'});continue}
   if(!present.has(entry.restored)){items.push({...base,status:'planned',exportable:false,attachable:false,reason:'The restore planned this volume but Docker does not currently contain it. The journal is retained.'});continue}
   let inspected:{owner?:string;inUse:boolean}
   try{inspected=await this.volumes.inspect(entry.restored)}catch{items.push({...base,status:'unavailable',exportable:false,attachable:false,reason:'Docker could not inspect this volume. Retry checks before taking action.'});continue}
   if(!entry.owner||inspected.owner!==entry.owner){items.push({...base,status:'owner-mismatch',exportable:false,attachable:false,reason:entry.owner?'The Docker ownership label differs from the journal. Preserve the volume for manual inspection.':'This older journal lacks a verifiable ownership token. Preserve the volume for manual inspection.'});continue}
   if(inspected.inUse){items.push({...base,status:'in-use',exportable:false,attachable:false,reason:'A container is using this volume. Close that work before recovery.'});continue}
   const canonical=entry.project?await fs.realpath(entry.project).catch(()=>undefined):undefined
   const attachable=!!canonical&&!entry.isolated&&!registered.some(item=>!item.isolated&&(item.project.toLowerCase()===entry.project!.toLowerCase()||item.project.toLowerCase()===canonical.toLowerCase()))
   items.push({...base,resolvedProject:canonical,status:'present',exportable:true,attachable,reason:attachable?'Verified retained sessions. Export a private copy or reattach them to the resolved project folder.':'Verified retained sessions. Export a private copy; reattachment requires an unmapped, accessible source project.'})
  }
  return {items,additional}
 }
 private async verifiedRetained(id:string):Promise<RestoreVolumeEntry & {id:string;backupId:string;journalPath:string}>{
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid retained volume selection')
  const entry=(await this.retainedEntries()).entries.find(item=>item.id===id)
  if(!entry)throw Error('Retained volume changed. Inspect it again.')
  const view=(await this.retainedVolumes()).items.find(item=>item.id===id)
  if(!view?.exportable)throw Error(view?.reason||'Retained volume is unavailable or its ownership is unverified')
  return entry
 }
 async exportRetainedVolume(id:string,destination:string):Promise<string>{
  const entry=await this.verifiedRetained(id)
  if(await exists(destination))throw Error('Choose a new, empty recovery export folder')
  if(within(this.data,destination)&&!within(join(this.data,'recovery'),destination))throw Error('Retained volume exports cannot be written inside live app storage')
  await fs.mkdir(dirname(destination),{recursive:true})
  let staging:string
  for(;;){staging=timestampPath(dirname(destination),'.partial');try{await fs.mkdir(staging,{mode:0o700});break}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}}
  let retained=staging
  try{
   await this.volumes.export(entry.restored,join(staging,'volume'))
   const fresh=await this.verifiedRetained(id)
   if(fresh.owner!==entry.owner)throw Error('Retained volume ownership changed during export')
   const files=await fileInventory(staging)
   const manifest={format:1,kind:'unrealcode-retained-volume',createdAt:new Date().toISOString(),backupId:entry.backupId,source:entry.source,volume:entry.restored,project:entry.project,isolated:entry.isolated,files}
   await fs.writeFile(join(staging,'retained-volume.json'),JSON.stringify(manifest),{mode:0o600,flag:'wx'})
   await fs.rename(staging,destination);retained=destination
   const committed=(await fileInventory(destination)).filter(file=>file.path!=='retained-volume.json')
   if(committed.length!==files.length||files.some(file=>!committed.some(other=>other.path===file.path&&other.bytes===file.bytes&&other.sha256===file.sha256)))throw Error('Retained volume export changed after finalization')
   return destination
  }catch(error){throw Error(`Retained session export failed; incomplete copy kept at ${retained}. ${String(error)}`)}
 }
 async attachRetainedVolume(id:string,expected:{volume:string;project:string;resolvedProject:string}):Promise<string>{
  if(await exists(join(this.data,'recovery-transaction.json'))||await exists(join(this.data,'storage-migration.json')))throw Error('Finish the pending recovery or storage migration before reattaching sessions')
  const entry=await this.verifiedRetained(id)
  const view=(await this.retainedVolumes()).items.find(item=>item.id===id)
  if(!expected||entry.restored!==expected.volume||entry.project!==expected.project||view?.resolvedProject?.toLowerCase()!==expected.resolvedProject?.toLowerCase())throw Error('Retained session preview changed. Inspect and approve the current folder again.')
  if(!view?.attachable||entry.isolated!==false||!entry.project)throw Error(view?.reason||'This retained copy cannot be safely reattached to the current project')
  const canonical=await fs.realpath(entry.project)
  if(view.resolvedProject?.toLowerCase()!==canonical.toLowerCase())throw Error('The resolved project path changed. Inspect the retained copy again.')
  const registry=join(this.data,'state-volumes.json'),previous=await exists(registry)?await readBoundedRegularFile(registry,16*1024*1024):undefined
  const area=await createTimestampDirectory(join(this.data,'recovery'))
  await fs.writeFile(join(area,'reattach.json'),JSON.stringify({volume:entry.restored,project:entry.project,resolvedProject:canonical,backupId:entry.backupId,at:new Date().toISOString(),previousRegistry:previous!==undefined}),{mode:0o600,flag:'wx'})
  if(previous!==undefined)await fs.writeFile(join(area,'state-volumes.before.json'),previous,{mode:0o600,flag:'wx'})
  await this.verifiedRetained(id)
  const record={project:canonical,isolated:false,volume:entry.restored},mapped=await registerRecoveredVolume(this.data,record).then(()=>true)
  if(mapped)try{
   const present=await this.volumes.existing([entry.restored]),inspected=present.length?await this.volumes.inspect(entry.restored):undefined
   if(!inspected||inspected.owner!==entry.owner||inspected.inUse)throw Error('Retained volume changed during reattachment')
  }catch(error){
   try{await undoRecoveredVolume(this.data,record)}catch(rollback){throw Error(`Reattachment needs manual review: ${String(error)}; registry rollback also failed: ${String(rollback)}`)}
   throw error
  }
  return entry.restored
 }
 async export(destination:string,fallback?:VolumeRecord[],preserveOriginalSettings=false):Promise<BackupPreview>{
  if(await exists(destination))throw new Error('Choose a new, empty backup directory name')
  if(within(this.data,destination)&&!within(join(this.data,'recovery'),destination))throw new Error('Backups cannot be written inside live app storage')
  await fs.mkdir(dirname(destination),{recursive:true})
  let staging:string
  for(;;){staging=timestampPath(dirname(destination),'.partial');try{await fs.mkdir(staging,{mode:0o700});break}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}}
  let retained=staging
  await fs.mkdir(join(staging,'metadata'),{mode:0o700})
  try{
   const volumes=await this.knownVolumes(fallback)
   for(const root of metadataRoots)if(await exists(join(this.data,root)))await copyTree(join(this.data,root),join(staging,'metadata',root))
   const settingsCopy=join(staging,'metadata','settings.json');if(await exists(settingsCopy))await sanitizeBackupSettings(settingsCopy,preserveOriginalSettings)
   for(const record of volumes)await this.volumes.export(record.volume,join(staging,'volumes',record.volume))
   const files=await fileInventory(staging),manifest:Manifest={format:1,id:randomUUID(),createdAt:new Date().toISOString(),version:this.version,profile:resolve(this.data),files,volumes}
   await fs.writeFile(this.manifestPath(staging),JSON.stringify(manifest),{mode:0o600,flag:'wx'});await fs.rename(staging,destination);retained=destination
   // A staging inventory is insufficient when host filesystem views differ.
   // Verify the committed location before any migration or restore relies on it.
   return await this.preview(destination)
  }catch(error){throw new Error(`Backup failed. Original data is unchanged; incomplete copy retained at ${retained}. Partial copies may contain unfiltered settings; keep them private. ${String(error)}`)}
 }
 private summary(manifest:Manifest):BackupPreview{return {id:manifest.id,createdAt:manifest.createdAt,version:manifest.version,profile:manifest.profile,files:manifest.files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),volumes:manifest.volumes.length,warnings:warning}}
 private async verify(path:string):Promise<Manifest>{
  const stat=await fs.lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Select a backup directory without links')
  const manifestFile=await noLinks(path,'manifest.json')
  const value=await readBoundedJSON<Manifest>(manifestFile,50*1024**2)
  if(!value||value.format!==1||!Array.isArray(value.files)||!Array.isArray(value.volumes)||value.files.length>250000||value.volumes.length>250000||typeof value.profile!=='string'||typeof value.id!=='string')throw new Error('Unsupported backup format')
  let sameProfile=false;try{sameProfile=(await fs.realpath(value.profile)).toLowerCase()===(await fs.realpath(this.data)).toLowerCase()}catch{/* A missing original profile cannot be inferred from its display path. */}
  if(!sameProfile)throw new Error('This recovery backup belongs to a different Windows profile or app-data location. Restore it to its original location.')
  const seen=new Set<string>(),volumes=new Set<string>(),projects=new Set<string>();let bytes=0
  for(const item of value.volumes){if(!item||typeof item.volume!=='string'||!/^unrealcode-(?:eval-|restore-)?[a-f0-9-]{20,36}$/.test(item.volume)||typeof item.project!=='string'||!item.project||item.project.length>4096||!isAbsolute(item.project)||/[\x00-\x1f]/.test(item.project)||typeof item.isolated!=='boolean')throw new Error('Invalid or duplicate backup volume');const key=`${item.isolated}:${item.project.toLowerCase()}`;if(volumes.has(item.volume)||projects.has(key))throw new Error('Invalid or duplicate backup volume');volumes.add(item.volume);projects.add(key)}
  for(const file of value.files){if(!file||typeof file.path!=='string')throw new Error('Invalid backup file record');safeRelative(file.path);const key=file.path.toLowerCase(),parts=file.path.split('/');if(seen.has(key))throw new Error('Duplicate backup path');seen.add(key)
   if(parts[0]==='metadata'?!metadataRoots.includes(parts[1]):parts[0]!=='volumes'||!volumes.has(parts[1])||!durableRoots.includes(parts[2]))throw new Error('Backup contains an unsupported data path')
   if(!Number.isSafeInteger(file.bytes)||file.bytes<0||!(/^[a-f0-9]{64}$/).test(file.sha256)||(bytes+=file.bytes)>50*1024**3)throw new Error('Invalid backup size or checksum')
   const source=await noLinks(path,file.path),info=await fs.lstat(source);if(!info.isFile()||info.size!==file.bytes||await hashFile(path,file.path)!==file.sha256)throw new Error(`Backup integrity check failed: ${file.path}`)
  }
  const actual=await fileInventory(path);if(actual.some(file=>file.path!=='manifest.json'&&!seen.has(file.path.toLowerCase())))throw new Error('Backup contains unlisted files')
  return value
 }
 async preview(path:string):Promise<BackupPreview>{return this.summary(await this.verify(path))}
 async restore(path:string):Promise<string>{
  const manifest=await this.verify(path),id=randomUUID(),area=timestampPath(join(this.data,'recovery')),stage=join(area,'staged')
  await this.export(join(area,'before-restore'),manifest.volumes,true)
  await fs.mkdir(stage,{recursive:true})
  // Hash the private staged copy as well: a source changed during copying must
  // never become the live profile even if it changes back before revalidation.
  const volumeStage=join(area,'volumes')
  await fs.mkdir(volumeStage,{recursive:true})
  for(const file of manifest.files){const parts=file.path.split('/');if(file.path==='metadata/state-volumes.json')continue;const targetRoot=parts[0]==='metadata'?stage:volumeStage,targetPath=parts.slice(1).join('/');await storageCopy(path,file.path,targetRoot,targetPath);if(await storageHash(targetRoot,targetPath)!==file.sha256)throw new Error('Backup changed while restoring')}
  const settingsPath=join(stage,'settings.json');if(await exists(settingsPath)){const settings=JSON.parse(await fs.readFile(settingsPath,'utf8'));Object.assign(settings,{trustedProjects:[],decisionCloudProjects:[],decisionCloudDeclinedProjects:[],decisionEngine:'off',executionMode:'ask',baseUrl:'',autoCompaction:false});await fs.writeFile(settingsPath,JSON.stringify(settings))}
  const connectionPath=join(stage,'connections.json');if(await exists(connectionPath)){const connections=JSON.parse(await fs.readFile(connectionPath,'utf8'));connections.grants=[];connections.catalog=[];for(const connection of connections.connections||[])connection.id=randomUUID();await fs.writeFile(connectionPath,JSON.stringify(connections))}
  const sanitize=async(path:string):Promise<void>=>{for(const item of await fs.readdir(path,{withFileTypes:true})){const target=join(path,item.name);if(item.isDirectory()&&!['worktrees','objects','search'].includes(item.name))await sanitize(target);else if(item.isFile()&&item.name==='runtime.json'&&within(join(stage,'memory'),target)){await sanitizeMemoryRuntime(target)}else if(item.isFile()&&(item.name==='browser-grants.json'||within(join(stage,'metadata','shared-browser-grants'),target))){const value=JSON.parse(await fs.readFile(target,'utf8'));value.enabled=false;value.origins=[];value.interactOrigins=[];value.cloudOrigins=[];value.ports=[];await fs.writeFile(target,JSON.stringify(value))}else if(item.isFile()&&item.name==='hooks.json'){const value=JSON.parse(await fs.readFile(target,'utf8'));value.trustedDigest=undefined;for(const hook of value.hooks||[])hook.enabled=false;await fs.writeFile(target,JSON.stringify(value))}else if(item.isFile()&&item.name==='memory.json'){await sanitizeMemoryRecords(target)}else if(item.isFile()&&item.name==='team-preferences.json'){const value=JSON.parse(await fs.readFile(target,'utf8'));value.options={...value.options,policy:'off',allowSpecialists:false};await fs.writeFile(target,JSON.stringify(value))}else if(item.isFile()&&['queue.json','teams.json'].includes(item.name)){const value=JSON.parse(await fs.readFile(target,'utf8'));value.paused=true;for(const task of value.tasks||[]){task.paused=true;if(task.config)Object.assign(task.config,{mode:'ask',baseUrl:'',teamEnabled:false,teamManaged:false});if(task.teamOptions)task.teamOptions.allowSpecialists=false;if(task.options)task.options.allowSpecialists=false;}await fs.writeFile(target,JSON.stringify(value))}}};await sanitize(stage)
  // Record every intended identity before Docker creates one. A crash or later
  // metadata failure leaves exact owned volume names for recovery inspection.
  const importJournal:RestoreVolumeJournal={format:1,backupId:manifest.id,volumes:manifest.volumes.map(item=>({source:item.volume,restored:`unrealcode-restore-${randomUUID()}`,owner:randomUUID(),project:item.project,isolated:item.isolated}))}
  await atomicMetadata(join(area,'volume-imports.json'),JSON.stringify(importJournal))
  const records:VolumeRecord[]=[]
  for(const [index,item] of manifest.volumes.entries()){
   const source=join(volumeStage,item.volume),planned=importJournal.volumes[index].restored,owner=importJournal.volumes[index].owner
   await fs.mkdir(source,{recursive:true})
   const imported=await this.volumes.import(source,planned,owner)
   if(imported!==planned)throw Error('Recovery volume identity changed during import; retained data needs inspection')
   records.push({...item,volume:imported})
  }
  const evaluationPath=join(stage,'evaluations')
  if(await exists(evaluationPath))for(const name of await fs.readdir(evaluationPath)){
   if(!/^[a-f0-9-]{36}\.json$/.test(name))continue
   const file=join(evaluationPath,name),report=JSON.parse(await fs.readFile(file,'utf8'))
   if(report.id!==name.slice(0,-5)||!Array.isArray(report.arms))throw new Error('Invalid evaluation recovery metadata')
   for(const [index,arm] of report.arms.entries()){
    if(!arm.retainedVolume)continue
    const legacy=join(evaluationPath,'worktrees',report.id,String(index))
    const stagedOwned=lookupStorage(evaluationPath,'worktrees',`${report.id}:${index}`,legacy)||legacy
    const owned=resolve(this.data,relative(stage,stagedOwned))
    const previous=manifest.volumes.find(item=>item.isolated&&item.project.toLowerCase()===owned.toLowerCase())
    const restored=records.find(item=>item.isolated&&item.project.toLowerCase()===owned.toLowerCase())
    if(previous&&restored&&arm.retainedVolume===previous.volume)arm.retainedVolume=restored.volume
   }
   await fs.writeFile(file,JSON.stringify(report))
  }
  await fs.writeFile(join(stage,'state-volumes.json'),JSON.stringify(records))
  await fs.writeFile(join(stage,'data-version.json'),JSON.stringify({schema:2,version:this.version,backup:join(area,'before-restore')}))
  const journal={id,area,roots:metadataRoots.map(root=>({root,hadOld:false}))}
  for(const item of journal.roots)item.hadOld=await exists(join(this.data,item.root))
  await atomicMetadata(join(this.data,'recovery-transaction.json'),JSON.stringify(journal))
  try{for(const {root,hadOld} of journal.roots){if(hadOld){await fs.mkdir(join(area,'prior'),{recursive:true});await fs.rename(join(this.data,root),join(area,'prior',root))}if(await exists(join(stage,root)))await fs.rename(join(stage,root),join(this.data,root))}await fs.unlink(join(this.data,'recovery-transaction.json'))}
  catch(error){await this.rollback();throw error}
  await fs.writeFile(join(area,'complete.json'),JSON.stringify({restored:manifest.id,at:new Date().toISOString()})).catch(()=>{})
  return join(area,'before-restore')
 }
 private async noStorageLinks(path:string):Promise<void>{if(!within(this.data,path))throw Error('Recovery path leaves app storage');let at=this.data;for(const part of relative(this.data,path).split(/[\\/]/)){at=join(at,part);try{if((await fs.lstat(at)).isSymbolicLink())throw Error('Recovery path contains a link; retained data needs manual inspection')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}}}
 async rollback():Promise<void>{const file=join(this.data,'recovery-transaction.json');if(!await exists(file))return;const journal=await readBoundedJSON<{id:string;area?:string;roots:{root:string;hadOld:boolean}[]}>(file,1024*1024);if(!journal||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/).test(journal.id)||!Array.isArray(journal.roots)||!journal.roots.length||journal.roots.length>metadataRoots.length||journal.roots.some(item=>!item||!metadataRoots.includes(item.root)||typeof item.hadOld!=='boolean')||new Set(journal.roots.map(item=>item.root)).size!==journal.roots.length||journal.area!==undefined&&typeof journal.area!=='string')throw new Error('Recovery journal needs manual inspection')
  const area=journal.area||join(this.data,'recovery',journal.id);if(!within(join(this.data,'recovery'),area))throw new Error('Invalid recovery location');for(const path of [area,join(area,'prior'),join(area,'failed'),...journal.roots.flatMap(({root})=>[join(area,'prior',root),join(area,'failed',root),join(this.data,root)])])await this.noStorageLinks(path)
  for(const {root,hadOld} of journal.roots){const old=join(area,'prior',root),current=join(this.data,root);if(await exists(old)){if(await exists(current)){await fs.mkdir(join(area,'failed'),{recursive:true});await fs.rename(current,join(area,'failed',root))}await fs.rename(old,current)}else if(!hadOld&&await exists(current)){await fs.mkdir(join(area,'failed'),{recursive:true});await fs.rename(current,join(area,'failed',root))}}await fs.unlink(file)
 }
 async migrate():Promise<string|undefined>{await recoverStorageMigration(this.data);await this.rollback();const path=join(this.data,'data-version.json');if(await exists(path)){const state=await readBoundedJSON<{schema:number}>(path,1024*1024);if(state.schema===1||state.schema===2)return this.migrateLocations();if(state.schema>2)throw new Error('This app is older than the saved data. Install the newer version or restore a backup.')}
  let backup:string|undefined;if((await Promise.all(metadataRoots.map(root=>exists(join(this.data,root))))).some(Boolean)){backup=timestampPath(join(this.data,'recovery'));await this.export(backup,undefined,true)}
  await atomicMetadata(path,JSON.stringify({schema:1,version:this.version,backup}));return await this.migrateLocations()||backup
 }
 private migrateLocations():Promise<string|undefined>{return migrateStorage(this.data,async()=>{const target=timestampPath(join(this.data,'recovery'));await this.export(target,undefined,true);return target})}

}
