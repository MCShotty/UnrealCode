import { createHash,randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs,watch,type FSWatcher } from 'node:fs'
import { dirname,join } from 'node:path'
import { promisify } from 'node:util'
import { editorPath } from './editor-files'
import {projectBytes,projectEntries} from './project-fs'
import type { RepositoryHit,RepositorySearch,RepositoryStatus } from '../shared/repository-context'
type FileRecord = { path: string; signature: string; revision: string; text: string }
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
const maxFile=512*1024,maxBytes=64*1024*1024,maxFiles=20000
export class RepositoryIndex {
 private records=new Map<string,FileRecord>()
 private refreshedAt?:string
 private omitted=0
 private inflight?:Promise<void>
 private loaded?:Promise<void>
 private watcher?:FSWatcher
 private timer?:NodeJS.Timeout
 private generation=0
 constructor(private root:string,private path:string,private excluded:()=>string[]){}
 private excludes(path:string):boolean { const name=path.replaceAll('\\','/').toLowerCase();return ['.git','node_modules','.venv','__pycache__',...this.excluded()].some(value=>name===value.toLowerCase()||name.startsWith(`${value.toLowerCase()}/`)) }
 private load():Promise<void>{return this.loaded ||= (async()=>{try{const value=JSON.parse(await fs.readFile(this.path,'utf8'));if(value.version!==1)throw Error('Unknown index version');for(const record of value.files as FileRecord[])if(!this.excludes(record.path))this.records.set(record.path,record);this.refreshedAt=value.refreshedAt}catch{/* Rebuild disposable index from project files. */}})()}
 status():RepositoryStatus{return{files:this.records.size,bytes:[...this.records.values()].reduce((sum,item)=>sum+Buffer.byteLength(item.text),0),refreshedAt:this.refreshedAt,omitted:this.omitted,refreshing:!!this.inflight}}
 start():void{if(this.watcher)return;try{this.watcher=watch(this.root,{recursive:true},(_kind,name)=>{if(name&&!this.excludes(name)){clearTimeout(this.timer);this.timer=setTimeout(()=>void this.refresh().catch(()=>{}),750)}})}catch{/* Manual retrieval still refreshes before searching. */}void this.refresh().catch(()=>{})}
 close():void{this.watcher?.close();this.watcher=undefined;clearTimeout(this.timer);this.generation++}
 refresh():Promise<void>{if(!this.inflight)this.inflight=this.scan().finally(()=>{this.inflight=undefined});return this.inflight}
 private async names():Promise<string[]>{
  try{const result=await promisify(execFile)('git',['ls-files','-co','--exclude-standard','-z'],{cwd:this.root,windowsHide:true,timeout:15000,maxBuffer:8*1024*1024});return [...new Set(result.stdout.split('\0').filter(Boolean))].sort()}
  catch{const result:string[]=[];const visit=async(path:string)=>{for(const item of await projectEntries(this.root,path)){const relative=path?`${path}/${item.name}`:item.name;if(this.excludes(relative))continue;if(result.length>=maxFiles){this.omitted++;return}if(item.directory)await visit(relative);else result.push(relative)}};await visit('');return result.sort()}
 }
 private async read(path:string):Promise<FileRecord>{
  const target=await editorPath(this.root,path),stat=await fs.lstat(target)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxFile)throw Error('Not bounded regular text')
  const signature=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  const cached=this.records.get(path);if(cached?.signature===signature)return cached
  const {bytes}=await projectBytes(this.root,path,maxFile)
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0'))throw Error('Binary file')
  return{path,signature,revision:digest(bytes),text}
 }
 private async scan():Promise<void>{
  await this.load();const generation=this.generation;this.omitted=0;const names=await this.names(),next=new Map<string,FileRecord>();let bytes=0
  for(const name of names){if(this.excludes(name))continue;if(next.size>=maxFiles||bytes>=maxBytes){this.omitted++;continue}try{const record=await this.read(name),size=Buffer.byteLength(record.text);if(bytes+size>maxBytes){this.omitted++;continue}next.set(name,record);bytes+=size}catch{this.omitted++}if(generation!==this.generation)return}
  this.records=next;this.refreshedAt=new Date().toISOString();await fs.mkdir(dirname(this.path),{recursive:true});const temporary=`${this.path}.${randomUUID()}.tmp`;await fs.writeFile(temporary,JSON.stringify({version:1,refreshedAt:this.refreshedAt,files:[...next.values()]}),{mode:0o600});await fs.rename(temporary,this.path)
 }
 async search(query:string,filesOnly=false):Promise<RepositorySearch>{
  if(typeof query!=='string'||!query.trim()||query.length>500)throw Error('Enter a search query below 500 characters')
  await this.refresh();const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0,12),hits:RepositoryHit[]=[]
  for(const entry of this.records.values()){
   if(this.excludes(entry.path))continue
   const filename=terms.every(term=>entry.path.toLowerCase().includes(term));if(filesOnly&&!filename)continue
   const lines=entry.text.split(/\r?\n/);let matched=0
   for(let index=0;index<lines.length;index++){
    if(!filename&&!terms.every(term=>lines[index].toLowerCase().includes(term)))continue
    const start=Math.max(0,index-2),end=Math.min(lines.length,index+4)
    hits.push({path:entry.path,line:start+1,endLine:end,text:lines.slice(start,end).join('\n').slice(0,3000),revision:entry.revision,reason:filename?'Filename matches search terms':'Source line matches search terms'})
    if(filename||++matched>=3)break;index=end-1
   }
   if(hits.length>=60)break
  }
  // Re-read returned files even if timestamps stayed the same. Stale snippets
  // are omitted; a later query will rebuild the affected cache entry.
  const fresh:RepositoryHit[]=[]
  for(const hit of hits){try{const {bytes}=await projectBytes(this.root,hit.path,maxFile);if(digest(bytes)!==hit.revision){this.records.delete(hit.path);continue}fresh.push(hit)}catch{this.records.delete(hit.path)}}
  return{query,hits:fresh.slice(0,30),status:this.status()}
 }
}
