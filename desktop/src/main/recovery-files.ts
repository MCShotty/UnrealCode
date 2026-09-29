import { promises as fs } from 'node:fs'
import { basename,dirname,join,relative,resolve,isAbsolute } from 'node:path'
import {storageEntries,storageHash,storageCopy,storageMkdir} from './project-fs'

export type FileRecord={path:string;bytes:number;sha256:string}
export const metadataRoots=['storage-locations.json','storage-layout.json','settings.json','connections.json','state-volumes.json','data-version.json','host-operations.json','workspaces','checkpoints','specialists','evaluations','editor-recovery','memory','memory-banks','timeline-records','shared-browser-grants']
export const durableRoots=['sessions','desktop-config','desktop-events','desktop-questions','context-summaries','operations','file-recovery','verification-journal','evaluation-git','.unrealcode-migrated']
export function safeRelative(name:string):void {
 if(typeof name!=='string'||!name||name.length>1000||name.includes('\\')||isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)))throw new Error('Unsafe backup path')
}
export function within(root:string,path:string):boolean {const rel=relative(resolve(root),resolve(path));return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel)}
export async function noLinks(root:string,name:string):Promise<string>{safeRelative(name);let at=root;for(const part of name.split('/')){at=join(at,part);const info=await fs.lstat(at);if(info.isSymbolicLink())throw new Error('Backup contains a link');}return at}
export async function hashFile(root:string,path:string):Promise<string>{return storageHash(root,path)}
export async function fileInventory(root:string):Promise<FileRecord[]> {
 const result:FileRecord[]=[];let bytes=0
 async function visit(prefix:string):Promise<void>{for(const item of await storageEntries(root,prefix)){
  const name=prefix?`${prefix}/${item.name}`:item.name;safeRelative(name)
  if(item.link||(!item.directory&&!item.regular))throw new Error(`Unsupported backup entry: ${name}`)
  if(item.directory)await visit(name)
  else{bytes+=item.size;if(result.length>=250000||bytes>50*1024**3)throw new Error('Backup exceeds 250,000 files or 50 GiB');result.push({path:name,bytes:item.size,sha256:await storageHash(root,name)})}
 }}await visit('');return result.sort((a,b)=>a.path.localeCompare(b.path))
}
export async function copyTree(source:string,target:string):Promise<void>{
 const sourceRoot=dirname(source),destinationRoot=dirname(target);await fs.mkdir(destinationRoot,{recursive:true})
 async function copy(from:string,to:string,info:{link:boolean;directory:boolean;regular:boolean}){if(info.link)throw Error('Recovery cannot follow links');if(info.directory){await storageMkdir(destinationRoot,to,true);for(const item of await storageEntries(sourceRoot,from))await copy(`${from}/${item.name}`,`${to}/${item.name}`,item)}else if(info.regular)await storageCopy(sourceRoot,from,destinationRoot,to);else throw Error('Unsupported recovery file')}
 const info=(await storageEntries(sourceRoot)).find(item=>item.name===basename(source));if(!info)throw Object.assign(Error('Recovery source disappeared'),{code:'ENOENT'});await copy(basename(source),basename(target),info)
}
export async function exists(path:string):Promise<boolean>{try{await fs.lstat(path);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}}
