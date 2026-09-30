import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { atomicMetadata } from './atomic-metadata'
import { readBoundedJSON, readBoundedRegularFile } from './bounded-file-read'
import { createTimestampDirectory } from './storage-locations'

/** Additive metadata upgrade; canonical sessions and Docker volumes are untouched. */
export async function ensureGuidanceDataVersion(profile:string):Promise<void>{
 const path=join(profile,'data-version.json')
 let state:{schema:number;version?:string;backup?:string}={schema:1}
 try{state=await readBoundedJSON(path,1024*1024)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 if(state.schema===2)return
 if(state.schema!==1)throw Error('This profile uses an unsupported data version. Original data is preserved.')
 const backup=await createTimestampDirectory(join(profile,'recovery'))
 for(const name of ['data-version.json','storage-locations.json']){
  try{const bytes=await readBoundedRegularFile(join(profile,name),16*1024*1024);await fs.writeFile(join(backup,name),bytes,{flag:'wx',mode:0o600});if(!bytes.equals(await fs.readFile(join(backup,name))))throw Error('Guidance metadata backup verification failed')}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 }
 await atomicMetadata(join(backup,'manifest.json'),JSON.stringify({format:'additive-metadata',feature:'fieldnotes-and-computer',createdAt:new Date().toISOString()}))
 await atomicMetadata(path,JSON.stringify({...state,schema:2,backup}))
}
