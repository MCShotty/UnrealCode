import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { atomicMetadata } from './atomic-metadata'
import { readBoundedJSONSync } from './bounded-file-read'
export type VolumeRecord={project:string;isolated:boolean;volume:string}
export function defaultVolume(project:string,isolated:boolean):string{return `unrealcode-${isolated?'eval-':''}${createHash('sha256').update(project.toLowerCase()).digest('hex').slice(0,20)}`}
export function volumeRecords(data:string):VolumeRecord[]{
 const path=join(data,'state-volumes.json');if(!existsSync(path))return []
 const records=readBoundedJSONSync<unknown>(path,16*1024*1024)
 if(!Array.isArray(records)||records.length>100000)throw new Error('Invalid saved state volume registry')
 const projects=new Set<string>(),volumes=new Set<string>()
 for(const item of records){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid saved state volume registry')
  const record=item as VolumeRecord
  if(typeof record.project!=='string'||!record.project||record.project.length>4096||!isAbsolute(record.project)||/[\x00-\x1f]/.test(record.project)||typeof record.isolated!=='boolean'||typeof record.volume!=='string'||!/^unrealcode-(?:eval-|restore-)?[a-f0-9-]{20,36}$/.test(record.volume))throw new Error('Invalid saved state volume registry')
  const key=`${record.isolated}:${record.project.toLowerCase()}`
  if(projects.has(key)||volumes.has(record.volume))throw new Error('Conflicting saved state volume registry; original data is preserved')
  projects.add(key);volumes.add(record.volume)
 }
 return records as VolumeRecord[]
}
let tail:Promise<unknown>=Promise.resolve()
export function resolveVolume(data:string,project:string,isolated:boolean):Promise<string>{const run=tail.then(async()=>{const records=volumeRecords(data),known=records.find(item=>item.project.toLowerCase()===project.toLowerCase()&&item.isolated===isolated);if(known)return known.volume;const volume=defaultVolume(project,isolated);if(records.some(item=>item.volume===volume))throw Error('Session volume identity collides with another project; original registry is preserved');await atomicMetadata(join(data,'state-volumes.json'),JSON.stringify([...records,{project,isolated,volume}]));return volume});tail=run.catch(()=>{});return run}
export function registerRecoveredVolume(data:string,record:VolumeRecord):Promise<void>{
 const run=tail.then(async()=>{
  if(typeof record.project!=='string'||!record.project||record.project.length>4096||!isAbsolute(record.project)||/[\x00-\x1f]/.test(record.project)||record.isolated!==false||typeof record.volume!=='string'||!/^unrealcode-restore-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.volume))throw Error('Invalid retained session mapping')
  const records=volumeRecords(data)
  if(records.some(item=>(item.project.toLowerCase()===record.project.toLowerCase()&&item.isolated===record.isolated)||item.volume===record.volume))throw Error('The project or volume already has a session mapping. Existing history is unchanged.')
  await atomicMetadata(join(data,'state-volumes.json'),JSON.stringify([...records,record]))
 })
 tail=run.catch(()=>{})
 return run
}
export function undoRecoveredVolume(data:string,record:VolumeRecord):Promise<void>{
 const run=tail.then(async()=>{
  const records=volumeRecords(data),matching=records.filter(item=>item.project.toLowerCase()===record.project.toLowerCase()&&item.isolated===record.isolated)
  if(matching.length!==1||matching[0].volume!==record.volume)throw Error('Retained volume mapping changed; its recovery record was preserved for review')
  await atomicMetadata(join(data,'state-volumes.json'),JSON.stringify(records.filter(item=>item!==matching[0])))
 })
 tail=run.catch(()=>{})
 return run
}
