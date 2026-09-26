import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join,relative } from 'node:path'
import type { StorageItem } from '../shared/recovery'
import { exists,within,noLinks } from './recovery-files'
type Entry={bytes:number;fingerprint:string}
async function measure(root:string):Promise<Entry>{const hash=createHash('sha256');let bytes=0;async function visit(path:string):Promise<void>{const stat=await fs.lstat(path);hash.update(`${relative(root,path)}:${stat.size}:${stat.mtimeMs}:${stat.isSymbolicLink()}`);if(stat.isSymbolicLink())return;if(stat.isDirectory())for(const name of (await fs.readdir(path)).sort())await visit(join(path,name));else bytes+=stat.size}await visit(root);return {bytes,fingerprint:hash.digest('hex')}}
export class Storage {
 constructor(private data:string){}
 async list():Promise<StorageItem[]>{const result:StorageItem[]=[]
  const add=async(path:string,category:StorageItem['category'],removable:boolean,reason:string)=>{if(!await exists(path))return;const info=await measure(path);result.push({id:createHash('sha256').update(path+info.fingerprint).digest('hex'),path,category,bytes:info.bytes,removable,reason})}
  await add(join(this.data,'checkpoints'),'checkpoints',false,'Remove individual completed checkpoints in Review. Incomplete captures and recovery copies are retained.')
  for(const root of ['workspaces','specialists']){const base=join(this.data,root);if(!await exists(base))continue
   const visit=async(path:string):Promise<void>=>{for(const item of await fs.readdir(path,{withFileTypes:true})){const at=join(path,item.name);if(item.isSymbolicLink())continue;if(item.name==='worktrees')await add(at,'worktrees',false,'Use Review → Isolated tasks to archive a fully integrated workspace. Unfinished, ignored or uncaptured files block removal.');else if(['snapshot-data','integration-recovery'].includes(item.name))await add(at,'checkpoints',false,'Task baseline, archive or integration recovery snapshots are retained with their task.');else if(item.name==='search'||item.name==='repository-index.json')await add(at,'index',true,'Rebuildable local index; original sessions and files are retained.');else if(item.isDirectory()&&!['objects','snapshot-data'].includes(item.name))await visit(at)}};await visit(base)
  }
  await add(join(this.data,'evaluations','worktrees'),'worktrees',false,'Use the evaluation report cleanup action; unfinished or uncaptured work is retained.')
  const recovery=join(this.data,'recovery');if(await exists(recovery)){
   const protectedBackup=await exists(join(this.data,'data-version.json'))?JSON.parse(await fs.readFile(join(this.data,'data-version.json'),'utf8')).backup:undefined
   const candidates=await Promise.all((await fs.readdir(recovery,{withFileTypes:true})).filter(item=>item.isDirectory()&&!item.isSymbolicLink()).map(async item=>({path:join(recovery,item.name),at:(await fs.stat(join(recovery,item.name))).mtimeMs})));candidates.sort((a,b)=>b.at-a.at)
   for(const [index,entry] of candidates.entries()){const complete=await exists(join(entry.path,'manifest.json'))||await exists(join(entry.path,'complete.json'));const removable=complete&&index>0&&entry.path!==protectedBackup&&!await exists(join(this.data,'recovery-transaction.json'));await add(entry.path,'backups',removable,removable?'Older completed recovery copy. Deleting it removes this restore point.':'Latest, migration, or unfinished recovery copy retained.')}
  }
  return result
 }
 async remove(ids:string[]):Promise<void>{if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'))throw new Error('Select storage entries');const current=await this.list();for(const id of ids){const item=current.find(row=>row.id===id);if(!item?.removable||!within(this.data,item.path))throw new Error('Storage changed or contains retained work. Refresh the preview.');await noLinks(this.data,relative(this.data,item.path).replaceAll('\\','/'));const canonical=await fs.realpath(item.path);if(!within(await fs.realpath(this.data),canonical))throw new Error('Storage cleanup cannot follow links');await fs.rm(item.path,{recursive:true,force:false})}}
}
