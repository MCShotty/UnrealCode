import {Worker} from 'node:worker_threads'
import {promises as fs} from 'node:fs'
import {join,basename} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {projectBytes,openConfinedStream} from './project-fs'
import {readBoundedRegularFile} from './bounded-file-read'
import type {DocumentHandle} from '../shared/document'

const maxBytes=40*1024*1024
const languages={
 eng:{sha256:'7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',size:4113088},
 ara:{sha256:'e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729',size:1432056}
} as const
export type DocumentLanguage=keyof typeof languages
type SavedDocument={handle:DocumentHandle;bytes:Buffer;password?:string;project?:string;attached?:Set<string>}
type WorkerMethod='metadata'|'page'|'search'|'ocr-page'|'ocr-image'

export class DocumentReader {
 private documents=new Map<string,SavedDocument>()
 private downloads=new Map<string,Promise<string>>()
 private running=0
 private waiting:Array<()=>void>=[]
 constructor(private profile:string){}
 private async slot(signal?:AbortSignal):Promise<()=>void>{
  signal?.throwIfAborted()
  const lease=()=>{let released=false;return()=>{
   if(released)return;released=true
   const next=this.waiting.shift()
   // Transfer the reserved slot directly; a new request cannot steal it
   // before the queued request resumes on its next microtask.
   if(next)next();else this.running--
  }}
  if(this.running<2){this.running++;return lease()}
  if(this.waiting.length>=16)throw Error('Document reader is busy; retry after active parsing finishes')
  return new Promise<()=>void>((resolve,reject)=>{
   const wake=()=>{signal?.removeEventListener('abort',cancel);resolve(lease())}
   const cancel=()=>{const index=this.waiting.indexOf(wake);if(index>=0)this.waiting.splice(index,1);reject(new Error('Document operation cancelled'))}
   this.waiting.push(wake)
   signal?.addEventListener('abort',cancel,{once:true})
  })
 }
 private async worker<T>(method:WorkerMethod,options:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
  const release=await this.slot(signal)
  try{
   signal?.throwIfAborted()
   return await new Promise<T>((resolve,reject)=>{
    const worker=new Worker(join(__dirname,'document-worker.cjs'),{workerData:{method,...options}})
    let done=false
    const finish=(error?:Error,value?:T)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate().then(()=>{if(error)reject(error);else resolve(value!)}).catch(termination=>reject(termination))}
    const abort=()=>finish(new Error('Document operation cancelled'))
    const timer=setTimeout(()=>finish(new Error('Document operation timed out')),method.startsWith('ocr')?120000:30000)
    signal?.addEventListener('abort',abort,{once:true})
    worker.on('message',message=>message.ok?finish(undefined,message.value):finish(Object.assign(new Error(message.error?.message||'Document processing failed'),{code:message.error?.code})))
    worker.on('error',error=>finish(error instanceof Error?error:new Error(String(error))))
    worker.on('exit',code=>{if(!done)finish(new Error(`Document worker exited (${code})`))})
   })
  }finally{release()}
 }
 private async open(bytes:Buffer,path:string,source:'project'|'external',project?:string,password?:string):Promise<DocumentHandle>{
  if(bytes.length>maxBytes)throw Error('PDF exceeds the 40 MiB reader limit')
  if(!path.toLowerCase().endsWith('.pdf'))throw Error('Choose a PDF document')
  const metadata=await this.worker<{pages:number;title:string}>('metadata',{bytes,password})
  const handle:DocumentHandle={id:randomUUID(),name:basename(path),path,source,revision:createHash('sha256').update(bytes).digest('hex'),pages:metadata.pages,title:metadata.title}
  if(this.documents.size>=4)this.documents.delete(this.documents.keys().next().value!)
  this.documents.set(handle.id,{handle,bytes,password,project})
  return handle
 }
 async openProject(project:string,path:string,password?:string):Promise<DocumentHandle>{
  if(typeof path!=='string'||!path||path.length>4096)throw Error('Choose a project PDF')
  const stream=await openConfinedStream(project,path,false,false)
  let bytes:Buffer
  try{
   const size=(await stream.stat()).size
   if(size>maxBytes)throw Error('PDF exceeds the 40 MiB reader limit')
   const chunks:Buffer[]=[]
   let received=0
   for(;;){
    const buffer=Buffer.allocUnsafe(Math.min(1024*1024,maxBytes+1-received))
    const {bytesRead}=await stream.read(buffer,0,buffer.length,null)
    if(bytesRead===0)break
    received+=bytesRead
    if(received>maxBytes)throw Error('PDF grew beyond the 40 MiB reader limit')
    chunks.push(buffer.subarray(0,bytesRead))
   }
   bytes=Buffer.concat(chunks,received)
  }finally{await stream.close()}
  return this.open(bytes,path,'project',project,password)
 }
 async openExternal(path:string,password?:string):Promise<DocumentHandle>{
  const bytes=await readBoundedRegularFile(path,maxBytes)
  return this.open(bytes,path,'external',undefined,password)
 }
 private owned(id:string):SavedDocument{const value=this.documents.get(id);if(!value)throw Error('Document is no longer open; select it again');return value}
  attach(id:string,project:string,session:string):DocumentHandle{const value=this.owned(id);if(value.handle.source!=='external')throw Error('Only an external PDF needs explicit attachment');value.attached||=new Set();value.attached.add(`${project}\0${session}`);return value.handle}
  agentDocument(id:string,project:string,session:string):DocumentHandle{const value=this.owned(id);if(value.handle.source==='project'&&value.project===project||value.attached?.has(`${project}\0${session}`))return value.handle;throw Error('Agent access is limited to its trusted project or an external PDF explicitly attached to this conversation')}
 get(id:string):DocumentHandle{return this.owned(id).handle}
 bytes(id:string):Uint8Array{return new Uint8Array(this.owned(id).bytes)}
 async page(id:string,page:number,signal?:AbortSignal){const value=this.owned(id);return this.worker<{page:number;text:string;method:'embedded';truncated:boolean}>('page',{bytes:value.bytes,password:value.password,page},signal)}
 async search(id:string,query:string,fromPage=1,limit=10,signal?:AbortSignal){const value=this.owned(id);return this.worker<{matches:Array<{page:number;excerpt:string}>;nextPage?:number}>('search',{bytes:value.bytes,password:value.password,query,fromPage,limit},signal)}
 async ocrPage(id:string,page:number,language:DocumentLanguage,signal?:AbortSignal){const value=this.owned(id),languagePath=await this.language(language);return this.worker<{page:number;text:string;confidence:number;language:string;method:'ocr';truncated:boolean}>('ocr-page',{bytes:value.bytes,password:value.password,page,language,languagePath},signal)}
 async ocrImage(project:string,path:string,language:DocumentLanguage,signal?:AbortSignal){const {bytes}=await projectBytes(project,path,20*1024*1024),languagePath=await this.language(language);return this.worker<{text:string;confidence:number;language:string;method:'ocr';truncated:boolean}>('ocr-image',{bytes,language,languagePath},signal)}
 close(id:string):void{this.documents.delete(id)}
 closeAll():void{this.documents.clear()}
 private language(language:DocumentLanguage):Promise<string>{
  if(!(language in languages))return Promise.reject(new Error('Choose English or Arabic OCR'))
  const pending=this.downloads.get(language)
  if(pending)return pending
  const work=this.fetchLanguage(language).finally(()=>this.downloads.delete(language))
  this.downloads.set(language,work)
  return work
 }
 private async fetchLanguage(language:DocumentLanguage):Promise<string>{
  const base=join(this.profile,'document-languages','tessdata-fast-4.1.0'),destination=join(base,`${language}.traineddata`),expected=languages[language]
  await fs.mkdir(base,{recursive:true})
  const current=await fs.readFile(destination).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error})
  if(current&&current.length===expected.size&&createHash('sha256').update(current).digest('hex')===expected.sha256)return base
  const url=`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/65727574dfcd264acbb0c3e07860e4e9e9b22185/${language}.traineddata`
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)})
  if(!response.ok||response.url!==url)throw Error('OCR language download failed; retry when online')
  const size=Number(response.headers.get('content-length')||0)
  if(size>expected.size)throw Error('OCR language download exceeds its pinned size')
  if(!response.body)throw Error('OCR language download returned no data')
  const chunks:Buffer[]=[]
  let received=0
  for await(const chunk of response.body){
   const bytes=Buffer.from(chunk)
   received+=bytes.length
   if(received>expected.size){await response.body.cancel().catch(()=>{});throw Error('OCR language download exceeds its pinned size')}
   chunks.push(bytes)
  }
  const bytes=Buffer.concat(chunks,received)
  if(bytes.length!==expected.size||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('OCR language checksum mismatch; downloaded data was rejected')
  const temporary=join(base,`${language}.${randomUUID()}.partial`)
  try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,destination)}finally{await fs.rm(temporary,{force:true}).catch(()=>{})}
  return base
 }
}
