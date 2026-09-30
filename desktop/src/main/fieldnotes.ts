import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicMetadata } from './atomic-metadata'
import { readBoundedJSON } from './bounded-file-read'
import { storageLocation, timestampPath } from './storage-locations'
import { redactContent } from './failures'
import { ensureGuidanceDataVersion } from './feature-data-version'
import type { HistoryCache } from './history-cache'
import type { Fieldnote, FieldnoteDraft, FieldnoteInput, FieldnoteInterpretation, FieldnotePage, FieldnotePointer, FieldnoteQuery, FieldnoteReceipt, FieldnoteSelection, FieldnoteSnapshot, FieldnoteSync } from '../shared/fieldnotes'
import { FIELDNOTE_CONTEXT_MAX_BYTES, FIELDNOTE_CONTEXT_MAX_NOTES, FIELDNOTE_MAX_BYTES } from '../shared/fieldnotes'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
type Header={path:string;revision:number;enabled:boolean;deleted:boolean;sync:FieldnoteSync}
type ProjectRef={id:string;path:string;name:string}
type ReceiptLocation={path:string;project:string;sessionId:string;createdAt:string}
function safeSnapshot(note:FieldnoteSnapshot):FieldnoteSnapshot{const title=redactContent(note.title),text=redactContent(note.text),pointer={...note.pointer,projectPath:redactContent(note.pointer.projectPath),projectName:redactContent(note.pointer.projectName),...(note.pointer.sessionTitle?{sessionTitle:redactContent(note.pointer.sessionTitle)}:{})};return {...note,title,text,pointer,...(title!==note.title||text!==note.text||JSON.stringify(pointer)!==JSON.stringify(note.pointer)?{redacted:true}:{})}}
export type NoteMemory={
 available():Promise<{enabled:boolean;generation:number}>
 analyse(text:string):Promise<{text:string;provider:string;model:string;generation:number}>
 retain(note:Fieldnote):Promise<void>
 withdraw(id:string):Promise<void>
 state(id:string,revision:number):Promise<'pending'|'retained'|'failed'>
}
export class Fieldnotes {
 private directoryValue?:string
 get directory():string{return this.directoryValue||=storageLocation(this.profile,'fieldnotes','library')}
 private loaded?:Promise<void>
 private tail:Promise<unknown>=Promise.resolve()
 private headers=new Map<string,Header>()
 private receipts=new Map<string,ReceiptLocation>()
 private projectionVersion=-1
 private projectionFailed=false
 private projecting?:Promise<void>
 private projects:ProjectRef[]=[]
 private drafts:FieldnoteDraft[]=[]
 private indexing=false
 private rerun=false
 private stopped=false
 private message=''
 private timer?:ReturnType<typeof setTimeout>
 onChanged:()=>void=()=>{}
 constructor(private profile:string,private cache:HistoryCache,private memory?:NoteMemory){}
 private notify(){try{this.onChanged()}catch{/* A detached view cannot undo a note. */}}
 private async read<T>(name:string,fallback:T):Promise<T>{try{return await readBoundedJSON<T>(join(this.directory,name),8*1024*1024)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw error}}
 private header(note:Fieldnote,path:string){return {path,revision:note.revision,enabled:note.enabled,deleted:!!note.deletedAt,sync:note.sync}}
 async load():Promise<void>{
  if(!this.loaded)this.loaded=(async()=>{
   await ensureGuidanceDataVersion(this.profile)
   await fs.mkdir(join(this.directory,'notes'),{recursive:true});await fs.mkdir(join(this.directory,'receipts'),{recursive:true})
   const schema=await this.read<{version:number}>('schema.json',{version:1})
   if(schema.version!==1)throw Error('Fieldnotes were created by a newer app. Restore a backup or install the matching version.')
   this.projects=await this.read<ProjectRef[]>('projects.json',[]);this.drafts=await this.read<FieldnoteDraft[]>('drafts.json',[])
   if(!Array.isArray(this.projects)||!Array.isArray(this.drafts)||this.projects.length>20000||this.drafts.length>32)throw Error('Fieldnote metadata is damaged; originals are preserved.')
   for(const p of this.projects)if(!p||!uuid.test(p.id)||typeof p.path!=='string'||typeof p.name!=='string')throw Error('Invalid saved Fieldnote pointer')
   const entries=await fs.readdir(join(this.directory,'notes'),{withFileTypes:true})
   if(entries.length>20000)throw Error('Fieldnote library exceeds its supported size; export before adding more notes.')
   await this.cache.resetFieldnotes().catch(()=>{this.message='Search cache unavailable. Explicitly selected notes still work.'})
   for(let offset=0;offset<entries.length;offset+=32){
    const notes=await Promise.all(entries.slice(offset,offset+32).filter(e=>e.isFile()&&e.name.endsWith('.json')).map(async e=>{
     const path=join(this.directory,'notes',e.name),note=await readBoundedJSON<Fieldnote>(path,128*1024)
     this.validateStored(note);if(this.headers.has(note.id))throw Error('Duplicate canonical Fieldnote identity; originals are preserved.')
     this.headers.set(note.id,this.header(note,path));return note
    }))
    await this.project(notes);await new Promise(resolve=>setImmediate(resolve))
   }
   const receiptFiles=await fs.readdir(join(this.directory,'receipts'),{withFileTypes:true})
   for(let offset=0;offset<receiptFiles.length;offset+=16){await Promise.all(receiptFiles.slice(offset,offset+16).filter(e=>e.isFile()&&e.name.endsWith('.json')).map(async e=>{
    const path=join(this.directory,'receipts',e.name),receipt=await readBoundedJSON<FieldnoteReceipt>(path,128*1024)
    if(!uuid.test(receipt.messageId)||!uuid.test(receipt.sessionId)||!Array.isArray(receipt.notes)||receipt.notes.length>8)throw Error('Invalid Fieldnote context receipt; original data is preserved.')
    this.rememberReceipt(receipt,path);await this.cache.putFieldnoteReceipt(receipt).catch(()=>{})
   }));await new Promise(resolve=>setImmediate(resolve))}
   await atomicMetadata(join(this.directory,'schema.json'),JSON.stringify({version:1}))
   if(!this.projectionFailed)this.projectionVersion=this.cache.generation
  })()
  return this.loaded
 }
 private validateStored(note:Fieldnote){
  if(!note||!uuid.test(note.id)||!Number.isSafeInteger(note.revision)||note.revision<1||typeof note.body!=='string'||Buffer.byteLength(note.body)>FIELDNOTE_MAX_BYTES||typeof note.title!=='string'||note.title.length>160||!note.pointer||!uuid.test(note.pointer.projectId)||typeof note.enabled!=='boolean'||typeof note.indexing!=='boolean'||!note.sync||!['local','pending','analysing','retaining','indexed','failed','disabled'].includes(note.sync.state))throw Error('Invalid Fieldnote data; originals are preserved.')
 }
 private mutate<T>(work:()=>Promise<T>):Promise<T>{const next=this.tail.catch(()=>{}).then(async()=>{await this.load();if(this.stopped)throw Error('Fieldnotes are closing');return work()});this.tail=next;return next}
 private async project(notes:Fieldnote[]){try{await this.cache.putFieldnotes(notes);if(!this.projectionFailed)this.message=''}catch{this.projectionFailed=true;this.projectionVersion=-1;this.message='Search cache unavailable. Your notes are saved; rebuild the history cache to restore search.'}}
 private async persist(note:Fieldnote){
  const path=this.headers.get(note.id)?.path||timestampPath(join(this.directory,'notes'),'.json')
  await atomicMetadata(path,JSON.stringify(note));this.headers.set(note.id,this.header(note,path));await this.project([note]);this.notify()
 }
 private rememberReceipt(receipt:FieldnoteReceipt,path:string){this.receipts.set(receipt.messageId,{path,project:receipt.project,sessionId:receipt.sessionId,createdAt:receipt.createdAt})}
 private async storedReceipt(project:string,workspace:string,sessionId:string,messageId:string):Promise<FieldnoteReceipt>{
  const location=this.receipts.get(messageId);if(!location)throw Error('Fieldnote receipt no longer exists')
  const receipt=await readBoundedJSON<FieldnoteReceipt>(location.path,128*1024)
  if(receipt.sessionId!==sessionId||receipt.workspace!==workspace||receipt.project!==project)throw Error('Fieldnote receipt belongs to another task')
  return {...receipt,notes:receipt.notes.filter(n=>this.valid([n])).map(safeSnapshot)}
 }
 private async ensureProjection(){
  await this.load();if(this.projectionVersion===this.cache.generation)return
  if(!this.projecting)this.projecting=this.mutate(async()=>{
   const version=this.cache.generation,ids=[...this.headers.keys()]
   for(let offset=0;offset<ids.length;offset+=32)await this.cache.putFieldnotes(await Promise.all(ids.slice(offset,offset+32).map(id=>this.get(id))))
   this.projectionVersion=version;this.projectionFailed=false;this.message=''
  }).finally(()=>{this.projecting=undefined})
  await this.projecting
 }
 async get(id:string):Promise<Fieldnote>{await this.load();const item=this.headers.get(id);if(!item)throw Error('Fieldnote no longer exists');return readBoundedJSON<Fieldnote>(item.path,128*1024)}
 async targets():Promise<ProjectRef[]>{await this.load();return structuredClone(this.projects)}
 async registerProject(path:string,name=basename(path)):Promise<ProjectRef>{return this.mutate(async()=>{
  if(typeof path!=='string'||!path||path.length>4096||typeof name!=='string'||name.length>256)throw Error('Invalid project pointer')
  const existing=this.projects.find(p=>p.path.toLowerCase()===path.toLowerCase());if(existing)return structuredClone(existing)
  const entry={id:randomUUID(),path,name};const next=[...this.projects,entry]
  await atomicMetadata(join(this.directory,'projects.json'),JSON.stringify(next));this.projects=next;return structuredClone(entry)
 })}
 private pointer(input:FieldnotePointer):FieldnotePointer{
  const project=this.projects.find(p=>p.id===input?.projectId)
  if(!project||input.projectPath!==project.path||input.sessionId!==undefined&&!uuid.test(input.sessionId))throw Error('Choose a saved project and a valid session pointer')
  return {projectId:project.id,projectPath:project.path,projectName:project.name,...(input.sessionId?{sessionId:input.sessionId,sessionTitle:String(input.sessionTitle||input.sessionId).slice(0,256)}:{})}
 }
 async save(input:FieldnoteInput):Promise<Fieldnote>{return this.mutate(async()=>{
  if(!input||typeof input.title!=='string'||!input.title.trim()||input.title.length>160||typeof input.body!=='string'||!input.body.trim()||Buffer.byteLength(input.body)>FIELDNOTE_MAX_BYTES||typeof input.enabled!=='boolean'||typeof input.indexing!=='boolean')throw Error('Use a title up to 160 characters and a nonempty note up to 16 KiB.')
  const previous=input.id?await this.get(input.id):undefined
  if(previous&&(previous.deletedAt||previous.revision!==input.expectedRevision))throw Error('This note changed elsewhere. Your draft is retained; reload before saving.')
  if(input.pointer?.sessionId&&!(previous?.pointer.projectId===input.pointer.projectId&&previous.pointer.sessionId===input.pointer.sessionId)){
   const pointer=this.pointer(input.pointer),sessions=await this.cache.sessions(pointer.projectPath)
   const session=sessions.find(item=>item.id===pointer.sessionId);if(!session)throw Error('Choose a session belonging to the selected project. Saved archived pointers remain readable.')
   input={...input,pointer:{...pointer,sessionTitle:session.title}}
  }
  if(!previous&&this.headers.size>=10000)throw Error('The library has reached 10,000 notes. Export and review existing notes before adding more.')
   const now=new Date().toISOString(),note:Fieldnote={id:previous?.id||randomUUID(),revision:(previous?.revision||0)+1,title:input.title.trim(),body:input.body,pointer:this.pointer(input.pointer),enabled:input.enabled,indexing:input.indexing,createdAt:previous?.createdAt||now,updatedAt:now,sync:{state:input.enabled&&input.indexing?'pending':input.enabled?'local':'disabled',attempts:0,documentId:previous?.sync.documentId}}
  await this.persist(note);this.schedule();return note
 })}
 async remove(id:string,revision:number):Promise<void>{await this.mutate(async()=>{
  const note=await this.get(id);if(note.revision!==revision)throw Error('This note changed. Reload before deleting it.')
  await this.persist({...note,revision:note.revision+1,title:'Deleted Fieldnote',body:'',enabled:false,deletedAt:new Date().toISOString(),interpretation:undefined,sync:{state:'disabled',attempts:0,documentId:note.sync.documentId}})
 });this.schedule()}
 async list(query:FieldnoteQuery={},group?:string):Promise<FieldnotePage>{await this.ensureProjection();return this.cache.searchFieldnotes(query,group)}
 valid(dependencies:Array<{id:string;revision:number}>):boolean{return dependencies.every(ref=>{const h=this.headers.get(ref.id);return h&&h.enabled&&!h.deleted&&h.revision===ref.revision})}
 authority(){return [...this.headers].map(([id,h])=>({id,revision:h.revision,enabled:h.enabled&&!h.deleted}))}
 async savedDrafts():Promise<FieldnoteDraft[]>{await this.load();return structuredClone(this.drafts)}
 async draft(key:string,value:FieldnoteInput|null):Promise<void>{await this.mutate(async()=>{
  if(typeof key!=='string'||key.length>100||Buffer.byteLength(JSON.stringify(value))>24000)throw Error('Fieldnote draft is too large')
  const next=this.drafts.filter(d=>d.key!==key);if(value)next.push({key,value,updatedAt:new Date().toISOString()})
  if(next.length>32)throw Error('Save or discard an existing draft before creating another')
  await atomicMetadata(join(this.directory,'drafts.json'),JSON.stringify(next));this.drafts=next
 })}
 async suggestions(query:string,project:string,sessionId?:string):Promise<FieldnotePage>{return this.list({query:query.slice(0,8000),project,sessionId,suggest:true,limit:24})}
 async prepare(project:string,workspace:string,sessionId:string,messageId:string,query:string,selection:FieldnoteSelection={include:[],exclude:[]},semanticIds:string[]=[]):Promise<FieldnoteReceipt>{
  await this.load();if(!uuid.test(sessionId)||!uuid.test(messageId)||!selection||!Array.isArray(selection.include)||!Array.isArray(selection.exclude)||selection.include.length>32||selection.exclude.length>100||[...selection.include,...selection.exclude].some(id=>!uuid.test(id)))throw Error('Invalid Fieldnote context selection')
  const prior=this.receipts.get(messageId)
  if(prior)return this.storedReceipt(project,workspace,sessionId,messageId)
  const local=await this.suggestions(query,project,sessionId).catch(()=>({notes:[]}))
  const ids=[...new Set([...selection.include,...local.notes.map(n=>n.id),...semanticIds.slice(0,24)])]
  const notes:FieldnoteSnapshot[]=[],omitted:FieldnoteReceipt['omitted']=[];let bytes=0
  for(const id of ids){
   if(selection.exclude.includes(id)&&!selection.include.includes(id))continue
   const note=await this.get(id).catch(()=>undefined)
   if(!note||note.deletedAt||!note.enabled){if(selection.include.includes(id))throw Error('A selected Fieldnote was disabled or removed. Review the selection before sending.');continue}
   const text=redactContent(note.body),size=Buffer.byteLength(text)
   if(notes.length>=FIELDNOTE_CONTEXT_MAX_NOTES||bytes+size>FIELDNOTE_CONTEXT_MAX_BYTES){if(selection.include.includes(id))throw Error('Selected Fieldnotes exceed eight notes or 16 KiB. Reduce the selection before sending.');omitted.push({id,title:note.title,reason:'Context budget'});continue}
   bytes+=size;notes.push(safeSnapshot({id,revision:note.revision,title:note.title,text,pointer:note.pointer,reason:selection.include.includes(id)?'Selected by you':note.pointer.projectPath===project&&note.pointer.sessionId===sessionId?'Current session':note.pointer.projectPath===project?'Current project':semanticIds.includes(id)?'Relevant memory':'Matching guidance',...(text!==note.body?{redacted:true}:{})}))
  }
  const receipt:FieldnoteReceipt={messageId,project,workspace,sessionId,createdAt:new Date().toISOString(),state:'prepared',notes,omitted}
  await this.mutate(async()=>{if(this.receipts.has(messageId))return;const path=timestampPath(join(this.directory,'receipts'),'.json');await atomicMetadata(path,JSON.stringify(receipt));this.rememberReceipt(receipt,path);await this.cache.putFieldnoteReceipt(receipt).catch(()=>{})})
  return this.storedReceipt(project,workspace,sessionId,messageId)
 }
 async accepted(messageId:string):Promise<void>{await this.mutate(async()=>{const location=this.receipts.get(messageId);if(!location)return;const receipt=await readBoundedJSON<FieldnoteReceipt>(location.path,128*1024);receipt.state='accepted';await atomicMetadata(location.path,JSON.stringify(receipt));await this.cache.putFieldnoteReceipt(receipt).catch(()=>{})})}
 async inherit(project:string,workspace:string,sessionId:string,messageId:string,parentSessionId:string):Promise<FieldnoteReceipt>{
  await this.load()
  if(!uuid.test(sessionId)||!uuid.test(messageId)||!uuid.test(parentSessionId))throw Error('Invalid Fieldnote context identity')
  if(this.receipts.has(messageId))return this.storedReceipt(project,workspace,sessionId,messageId)
  const parent=(await this.receiptPage(project,parentSessionId)).find(r=>r.state==='accepted')
  const receipt:FieldnoteReceipt={project,workspace,sessionId,messageId,createdAt:new Date().toISOString(),state:'prepared',notes:(parent?.notes||[]).filter(n=>this.valid([n])).map(n=>({...n,reason:parentSessionId===sessionId?'Retained for task continuation':'Inherited from parent task'})),omitted:[]}
   await this.mutate(async()=>{if(this.receipts.has(messageId))return;const path=timestampPath(join(this.directory,'receipts'),'.json');await atomicMetadata(path,JSON.stringify(receipt));this.rememberReceipt(receipt,path);await this.cache.putFieldnoteReceipt(receipt).catch(()=>{})})
   return this.storedReceipt(project,workspace,sessionId,messageId)
 }
 async receiptPage(project:string,sessionId:string){
  await this.load()
  const cached=await this.cache.fieldnoteReceipts(project,sessionId).catch(()=>[])
  const locations=[...this.receipts.values()].reverse().filter(row=>row.project===project&&row.sessionId===sessionId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)
  const originals=await Promise.all(locations.map(row=>readBoundedJSON<FieldnoteReceipt>(row.path,128*1024))),ids=new Set(originals.map(row=>row.messageId))
  // Accepted canonical Go events can establish a receipt when the local
  // acknowledgement failed. A partial cache must never hide a newer original.
  return [...originals.map(row=>cached.some(item=>item.messageId===row.messageId&&item.state==='accepted')?{...row,state:'accepted' as const}:row),...cached.filter(row=>!ids.has(row.messageId))].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)
 }
 async status(){await this.load();return {ready:true,count:[...this.headers.values()].filter(h=>!h.deleted).length,pending:[...this.headers.values()].filter(h=>['pending','analysing','retaining','failed'].includes(h.sync.state)).length,...(this.message?{message:this.message}:{})}}
 async export(){await this.load();const notes:Fieldnote[]=[];for(const id of this.headers.keys())notes.push(await this.get(id));return JSON.stringify({version:1,exportedAt:new Date().toISOString(),projects:this.projects,notes,drafts:this.drafts},null,2)}
 async retry(id:string){await this.mutate(async()=>{const note=await this.get(id);if(note.deletedAt||!note.enabled||!note.indexing)throw Error('Enable memory indexing for this note first');await this.persist({...note,sync:{state:'pending',attempts:0}})});this.schedule()}
 schedule(delay=100){if(this.stopped)return;if(this.indexing){this.rerun=true;return}if(this.timer)return;this.timer=setTimeout(()=>{this.timer=undefined;void this.drain().catch(error=>{this.message=String(error);this.notify()})},delay);this.timer.unref()}
 private async updateSync(id:string,revision:number,work:(note:Fieldnote)=>Fieldnote){return this.mutate(async()=>{const note=await this.get(id);if(note.revision!==revision)return;await this.persist(work(note))})}
 private async drain(){
  if(this.indexing||!this.memory||this.stopped)return
  this.indexing=true
  try{
   await this.load();const available=await this.memory.available();if(!available.enabled)return
   for(const [id,header] of this.headers){
    if(this.stopped)break
    if(['indexed','local','disabled'].includes(header.sync.state)&&(!header.sync.documentId||header.sync.state==='indexed'))continue
    if(header.sync.retryAt&&Date.parse(header.sync.retryAt)>Date.now()){this.rerun=true;continue}
    let note=await this.get(id)
    if(note.deletedAt||!note.enabled||!note.indexing){await this.memory.withdraw(id);await this.updateSync(id,note.revision,n=>({...n,sync:{...n.sync,documentId:undefined}}));continue}
    if(note.sync.state==='retaining'){
     const state=await this.memory.state(id,note.revision)
     if(state==='retained')await this.updateSync(id,note.revision,n=>({...n,sync:{...n.sync,state:'indexed'}}))
     else if(state==='failed')await this.updateSync(id,note.revision,n=>({...n,sync:{...n.sync,state:'failed',error:'Memory retention failed. Your local note remains available.'}}))
     continue
    }
    if(!['pending','analysing'].includes(note.sync.state)||header.sync.attempts>=3)continue
    try{
     await this.updateSync(id,note.revision,n=>({...n,sync:{state:'analysing',attempts:n.sync.attempts+1,generation:available.generation}}))
     const source=redactContent(note.body),result=await this.memory.analyse(JSON.stringify({title:redactContent(note.title),source,attribution:safeSnapshot({id:note.id,revision:note.revision,title:note.title,text:source,pointer:note.pointer,reason:"Interpretation"}).pointer}))
     const current=await this.memory.available();if(!current.enabled||current.generation!==result.generation)throw Error('Memory configuration changed; retry indexing with the verified model.')
     const parsed=JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g,''))
     if(typeof parsed.summary!=='string'||parsed.summary.length>2000||typeof parsed.applicability!=='string'||parsed.applicability.length>1000||!Array.isArray(parsed.topics)||parsed.topics.length>20||parsed.topics.some((v:unknown)=>typeof v!=='string'||v.length>100)||!Array.isArray(parsed.quotes)||parsed.quotes.length>8||parsed.quotes.some((v:unknown)=>typeof v!=='string'||!v||!source.includes(v)))throw Error('The memory model returned an invalid interpretation. Your original note is preserved.')
     if(!this.valid([{id,revision:note.revision}]))continue
     const interpretation:FieldnoteInterpretation={summary:parsed.summary,topics:parsed.topics,applicability:parsed.applicability,quotes:parsed.quotes,revision:note.revision,model:result.model,provider:result.provider,createdAt:new Date().toISOString()}
     note={...note,interpretation,sync:{state:'retaining',attempts:note.sync.attempts+1,generation:result.generation,documentId:`fieldnote-${id}`}}
     await this.updateSync(id,note.revision,()=>note)
     if(this.valid([{id,revision:note.revision}]))await this.memory.retain(note)
    }catch(error){await this.updateSync(id,note.revision,n=>{const retry=n.sync.attempts<3&&/busy|ECONNRESET|ETIMEDOUT|temporarily|HTTP 50[234]|HTTP 429/i.test(String(error));if(retry)this.rerun=true;return {...n,sync:{...n.sync,state:retry?'pending':'failed',error:redactContent(String(error)).slice(0,500),retryAt:retry?new Date(Date.now()+5000*n.sync.attempts).toISOString():undefined}}})}
    await new Promise(resolve=>setImmediate(resolve))
   }
  }finally{this.indexing=false;this.notify();if(this.rerun){this.rerun=false;this.schedule(1000)}}
 }
 async close(){this.stopped=true;if(this.timer)clearTimeout(this.timer);await this.tail.catch(()=>{});while(this.indexing)await new Promise(resolve=>setTimeout(resolve,20))}
}
