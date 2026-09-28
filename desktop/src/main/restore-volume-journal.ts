import { isAbsolute } from 'node:path'
import { readBoundedJSON } from './bounded-file-read'

export type RestoreVolumeEntry = { source:string; restored:string; owner?:string; project?:string; isolated?:boolean }
export type RestoreVolumeJournal = { format:1; backupId:string; volumes:RestoreVolumeEntry[] }
const sourcePattern=/^unrealcode-(?:eval-|restore-)?[a-f0-9-]{20,36}$/
const restoredPattern=/^unrealcode-restore-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export async function readRestoreVolumeJournal(path:string):Promise<RestoreVolumeJournal>{
 const value=await readBoundedJSON<unknown>(path,50*1024*1024)
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid retained restore volume journal; inspect recovery data before cleanup')
 const journal=value as RestoreVolumeJournal
 if(journal.format!==1||typeof journal.backupId!=='string'||!uuidPattern.test(journal.backupId)||!Array.isArray(journal.volumes)||journal.volumes.length>250000)throw Error('Invalid retained restore volume journal; inspect recovery data before cleanup')
 const seen=new Set<string>()
 for(const item of journal.volumes){
  if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.source!=='string'||!sourcePattern.test(item.source)||typeof item.restored!=='string'||!restoredPattern.test(item.restored)||seen.has(item.restored))throw Error('Invalid retained restore volume journal; inspect recovery data before cleanup')
  seen.add(item.restored)
  const hasProvenance=item.owner!==undefined||item.project!==undefined||item.isolated!==undefined
  if(hasProvenance&&(typeof item.owner!=='string'||!uuidPattern.test(item.owner)||typeof item.project!=='string'||!item.project||item.project.length>4096||!isAbsolute(item.project)||/[\x00-\x1f]/.test(item.project)||typeof item.isolated!=='boolean'))throw Error('Invalid retained restore volume journal; inspect recovery data before cleanup')
 }
 return journal
}
