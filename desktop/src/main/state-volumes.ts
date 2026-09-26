import { createHash } from 'node:crypto'
import { readFileSync,existsSync } from 'node:fs'
import { join } from 'node:path'
import { atomicMetadata } from './atomic-metadata'
export type VolumeRecord={project:string;isolated:boolean;volume:string}
export function defaultVolume(project:string,isolated:boolean):string{return `unrealcode-${isolated?'eval-':''}${createHash('sha256').update(project.toLowerCase()).digest('hex').slice(0,20)}`}
export function volumeRecords(data:string):VolumeRecord[]{const path=join(data,'state-volumes.json');if(!existsSync(path))return [];const records=JSON.parse(readFileSync(path,'utf8')) as VolumeRecord[];if(!Array.isArray(records)||records.some(item=>typeof item.project!=='string'||typeof item.isolated!=='boolean'||!/^unrealcode-(?:eval-|restore-)?[a-f0-9-]{20,36}$/.test(item.volume)))throw new Error('Invalid saved state volume registry');return records}
let tail:Promise<unknown>=Promise.resolve()
export function resolveVolume(data:string,project:string,isolated:boolean):Promise<string>{const run=tail.then(async()=>{const records=volumeRecords(data),known=records.find(item=>item.project.toLowerCase()===project.toLowerCase()&&item.isolated===isolated);if(known)return known.volume;const volume=defaultVolume(project,isolated);await atomicMetadata(join(data,'state-volumes.json'),JSON.stringify([...records,{project,isolated,volume}]));return volume});tail=run.catch(()=>{});return run}
