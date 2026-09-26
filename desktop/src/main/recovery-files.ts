import { promises as fs,createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname,join,relative,resolve,isAbsolute } from 'node:path'

export type FileRecord={path:string;bytes:number;sha256:string}
export const metadataRoots=['settings.json','connections.json','state-volumes.json','data-version.json','host-operations.json','workspaces','checkpoints','specialists','evaluations','editor-recovery']
export const durableRoots=['sessions','desktop-config','desktop-events','context-summaries','operations','file-recovery','verification-journal','evaluation-git','.unrealcode-migrated']
export function safeRelative(name:string):void {
 if(typeof name!=='string'||!name||name.length>1000||name.includes('\\')||isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)))throw new Error('Unsafe backup path')
}
export function within(root:string,path:string):boolean {const rel=relative(resolve(root),resolve(path));return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel)}
export async function noLinks(root:string,name:string):Promise<string>{safeRelative(name);let at=root;for(const part of name.split('/')){at=join(at,part);const info=await fs.lstat(at);if(info.isSymbolicLink())throw new Error('Backup contains a link');}return at}
export async function hashFile(path:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
export async function fileInventory(root:string):Promise<FileRecord[]> {
 const result:FileRecord[]=[];let bytes=0
 async function visit(path:string,prefix:string):Promise<void>{for(const item of await fs.readdir(path,{withFileTypes:true})){
  const name=prefix?`${prefix}/${item.name}`:item.name;safeRelative(name);const target=join(path,item.name),info=await fs.lstat(target)
  if(info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile()))throw new Error(`Unsupported backup entry: ${name}`)
  if(info.isDirectory())await visit(target,name)
  else{bytes+=info.size;if(result.length>=250000||bytes>50*1024**3)throw new Error('Backup exceeds 250,000 files or 50 GiB');result.push({path:name,bytes:info.size,sha256:await hashFile(target)})}
 }}await visit(root,'');return result.sort((a,b)=>a.path.localeCompare(b.path))
}
export async function copyTree(source:string,target:string):Promise<void>{
 const info=await fs.lstat(source);if(info.isSymbolicLink())throw new Error('Recovery cannot follow links')
 if(info.isDirectory()){await fs.mkdir(target,{recursive:true});for(const name of await fs.readdir(source))await copyTree(join(source,name),join(target,name))}
 else if(info.isFile()){await fs.mkdir(dirname(target),{recursive:true});await fs.copyFile(source,target)}else throw new Error('Unsupported recovery file')
}
export async function exists(path:string):Promise<boolean>{try{await fs.lstat(path);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}}
