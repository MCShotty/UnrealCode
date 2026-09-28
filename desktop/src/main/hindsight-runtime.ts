import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {createInterface} from 'node:readline'
import {createHash,randomUUID} from 'node:crypto'
import {promises as fs,createReadStream,createWriteStream,existsSync} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {join} from 'node:path'
import {app} from 'electron'
import {backendEnvironment} from './child-environment'
import {terminalDockerExecutable} from './terminal-command'
import {atomicMetadata} from './atomic-metadata'
import {readBoundedJSON,readBoundedJSONSync} from './bounded-file-read'
const exec=promisify(execFile)
export const HINDSIGHT_IMAGE='ghcr.io/vectorize-io/hindsight@sha256:ba46d6f4ecadb93f71747428e39fd429df0e0adfc0c066b76a365c06b219db8b'
export const MEMORY_POSTGRES_IMAGE='pgvector/pgvector@sha256:dca0d688bbb31d3f851502ffcb9c7791387b4fcc544ae434dab41761e5ece317'
function manifestRecord(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid memory runtime metadata');return value as Record<string,any>}
export class HindsightRuntime {
 private process?:ChildProcess
 private pending=new Map<string,{resolve(value:any):void;reject(error:Error):void;timer:NodeJS.Timeout}>()
 private starting?:Promise<void>
 private stopping?:Promise<void>
 private cancelStartup?:()=>void
 private epoch=0
 private ready=false
 state:'disabled'|'starting'|'ready'|'unavailable'='disabled'
 message='Memory runtime is stopped'
 onChanged:()=>void=()=>{}
 readonly identity:string
 readonly database:string
 readonly volume:string
 readonly cache:string
 private generation:string
 constructor(private directory:string){
  const path=join(directory,'runtime.json'),saved=existsSync(path)?manifestRecord(readBoundedJSONSync<unknown>(path,1024*1024)):undefined
  this.generation=saved?String(saved.generation||''):''
  if(this.generation&&!/^[a-f0-9-]{36}$/.test(this.generation))throw Error('Invalid memory runtime generation')
  const stored=saved?.volume===undefined?undefined:/^unrealcode-memory-([a-f0-9]{16})$/.exec(String(saved.volume))?.[1]
  if(saved?.volume!==undefined&&!stored||saved?.cache!==undefined&&saved.cache!==`unrealcode-memory-models-${stored}`)throw Error('Invalid memory runtime volume identity')
  this.identity=stored&&!saved?.restoreRequired?stored:createHash('sha256').update(directory.toLowerCase()+this.generation).digest('hex').slice(0,16)
  this.database=`unrealcode-memory-db-${this.identity}`;this.volume=`unrealcode-memory-${this.identity}`;this.cache=`unrealcode-memory-models-${this.identity}`
 }
 private docker(args:string[],timeout=30000){return exec(terminalDockerExecutable(backendEnvironment()),args,{windowsHide:true,timeout,maxBuffer:4*1024*1024,env:backendEnvironment()})}
 private async image(name:string){try{await this.docker(['image','inspect',name]);return}catch{this.message='Downloading the pinned memory runtime…';this.onChanged();await this.docker(['pull',name],600000)}}
 async start(baseUrl:string,token:string,model:string):Promise<void>{if(this.ready)return;if(this.starting)return this.starting;const epoch=this.epoch;this.starting=(async()=>{if(this.stopping)await this.stopping;if(epoch!==this.epoch)throw Error('Memory startup was cancelled');await this.launch(baseUrl,token,model,epoch)})().finally(()=>{this.starting=undefined});return this.starting}
 private async launch(baseUrl:string,token:string,model:string,epoch:number){
  this.state='starting';this.message='Preparing Hindsight and its private database';this.onChanged()
  try{
   const active=()=>{if(epoch!==this.epoch)throw Error('Memory startup was cancelled')}
   await fs.mkdir(this.directory,{recursive:true})
   const manifest=join(this.directory,'runtime.json');let previous:Record<string,any>|undefined;try{previous=manifestRecord(await readBoundedJSON(manifest,1024*1024))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
   if(previous?.restoreRequired&&!previous.backup)throw Error('Memory restore needs its verified database dump. The prior volume and metadata were preserved.')
   if(!previous){previous={version:1,image:HINDSIGHT_IMAGE,postgres:MEMORY_POSTGRES_IMAGE,volume:this.volume,cache:this.cache,generation:this.generation};await atomicMetadata(manifest,JSON.stringify(previous))}
   if(previous&&!previous.restoreRequired&&previous.image!==HINDSIGHT_IMAGE)await this.snapshot()
   if(previous&&previous.postgres!==MEMORY_POSTGRES_IMAGE)throw Error('The memory database major version changed. Restore its verified dump into a new runtime before upgrading.')
   await Promise.all([this.image(HINDSIGHT_IMAGE),this.image(MEMORY_POSTGRES_IMAGE)])
   active()
   const network=`unrealcode-memory-net-${this.identity}`
   try{await this.docker(['network','inspect',network])}catch{await this.docker(['network','create',network])}
   for(const volume of [this.volume,this.cache])await this.docker(['volume','create','--label','ai.unrealcode.kind=memory',volume])
   try{await this.docker(['inspect',this.database]);await this.docker(['start',this.database])}catch{await this.docker(['run','-d','--name',this.database,'--network',network,'--label','ai.unrealcode.kind=memory','--memory','512m','--cpus','1','-e','POSTGRES_USER=unrealcode','-e','POSTGRES_DB=memory','-e','POSTGRES_HOST_AUTH_METHOD=trust','--mount',`type=volume,source=${this.volume},target=/var/lib/postgresql/data`,MEMORY_POSTGRES_IMAGE])}
   await this.waitForDatabase(active)
   active()
   if(previous?.restoreRequired&&previous.backup&&!previous.backup.empty){
    const dump=join(this.directory,'database.dump'),hash=createHash('sha256');for await(const bytes of createReadStream(dump))hash.update(bytes);if(hash.digest('hex')!==previous.backup.sha256)throw Error('Memory recovery dump failed its integrity check')
    const child=spawn(terminalDockerExecutable(backendEnvironment()),['exec','-i',this.database,'pg_restore','--clean','--if-exists','--no-owner','--single-transaction','-U','unrealcode','-d','memory'],{windowsHide:true,stdio:['pipe','ignore','ignore'],env:backendEnvironment()})
    const completed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Memory database restore failed; prior data remains in its original volume')))})
    await Promise.all([pipeline(createReadStream(dump),child.stdin!),completed])
   }
   active()
   const worker=app.isPackaged?join(process.resourcesPath,'backend','desktop','worker','hindsight_bridge.py'):join(__dirname,'../../worker/hindsight_bridge.py')
   const name=`unrealcode-memory-api-${this.identity}`
   try{await this.docker(['inspect',name]);await this.docker(['rm','-f',name])}catch{/* No previous owned API process. Database contents stay in their volume. */}
   const child=spawn(terminalDockerExecutable(backendEnvironment()),['run','--rm','-i','--name',name,'--network',network,'--label','ai.unrealcode.kind=memory','--memory','3g','--cpus','2','--cap-drop=ALL','--security-opt=no-new-privileges','--mount',`type=bind,source=${worker},target=/unrealcode/hindsight_bridge.py,readonly`,'--mount',`type=volume,source=${this.cache},target=/home/hindsight/.cache`,'--entrypoint','python',HINDSIGHT_IMAGE,'/unrealcode/hindsight_bridge.py'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:backendEnvironment()})
   this.process=child
   const lines=createInterface({input:child.stdout!})
   await new Promise<void>((resolve,reject)=>{
    let startup=true;const timer=setTimeout(()=>{if(startup){startup=false;reject(Error('Hindsight startup timed out'))}},330000)
    const cancel=()=>{if(startup){startup=false;clearTimeout(timer);reject(Error('Memory startup was cancelled'))}}
    this.cancelStartup=cancel
    const failed=()=>{if(this.process!==child)return;this.ready=false;this.state='unavailable';this.message='Hindsight stopped. Coding remains available.';this.onChanged();for(const call of this.pending.values()){clearTimeout(call.timer);call.reject(Error(this.message))}this.pending.clear();if(startup){startup=false;clearTimeout(timer);reject(Error(this.message))}}
    child.on('error',failed);child.on('exit',failed);child.stdin!.on('error',failed);child.stderr!.on('data',()=>{/* Upstream diagnostics are not copied into app logs or renderer state. */})
    lines.on('line',line=>{if(this.process!==child)return;let value:any;try{value=JSON.parse(line)}catch{return};if(typeof value.progress==='string'){this.message=value.progress.slice(0,200);this.onChanged();return};if(value.ready&&startup){startup=false;clearTimeout(timer);this.cancelStartup=undefined;resolve();return};const call=this.pending.get(value.id);if(!call)return;clearTimeout(call.timer);this.pending.delete(value.id);value.error?call.reject(Error(String(value.error))):call.resolve(value.result)})
    child.stdin!.write(JSON.stringify({environment:{HINDSIGHT_API_DATABASE_URL:`postgresql://unrealcode@${this.database}:5432/memory`,HINDSIGHT_API_LLM_PROVIDER:'openai',HINDSIGHT_API_LLM_BASE_URL:baseUrl,HINDSIGHT_API_LLM_API_KEY:token,HINDSIGHT_API_LLM_MODEL:model,HINDSIGHT_API_LLM_TIMEOUT:'120',HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU:'true',HINDSIGHT_API_EMBEDDINGS_LOCAL_TRUST_REMOTE_CODE:'false',HINDSIGHT_API_DB_POOL_MIN_SIZE:'1',HINDSIGHT_API_DB_POOL_MAX_SIZE:'8'}})+'\n')
   })
   await atomicMetadata(manifest,JSON.stringify({version:1,image:HINDSIGHT_IMAGE,postgres:MEMORY_POSTGRES_IMAGE,volume:this.volume,cache:this.cache,generation:this.generation,backup:previous?.backup}))
   if(epoch!==this.epoch)throw Error('Memory startup was cancelled')
   this.ready=true;this.state='ready';this.message='Hindsight memory is ready';this.onChanged()
  }catch(error){const cancelled=epoch!==this.epoch;await this.stop();if(!cancelled){this.state='unavailable';this.message=error instanceof Error?error.message:'Memory runtime unavailable';this.onChanged()}throw error}
 }
 private async waitForDatabase(active:()=>void):Promise<void>{
  // The image temporarily starts a Unix-socket-only server during first init.
  // TCP readiness identifies the final server, avoiding its planned shutdown.
  for(let attempt=0;attempt<30;attempt++){
   active()
   try{await this.docker(['exec',this.database,'pg_isready','-h','127.0.0.1','-U','unrealcode','-d','memory']);active();await this.docker(['exec',this.database,'psql','-h','127.0.0.1','-U','unrealcode','-d','memory','-c','CREATE EXTENSION IF NOT EXISTS vector;']);return}
   catch{active();if(attempt===29)throw Error('Memory database did not become ready');await new Promise(resolve=>setTimeout(resolve,500))}
  }
 }
 async snapshot():Promise<void>{
  const manifest=join(this.directory,'runtime.json')
  if(!existsSync(this.directory))return
  const available=await this.docker(['volume','ls','--filter',`name=${this.volume}`,'--format','{{.Name}}'])
  const hasVolume=available.stdout.split(/\r?\n/).some(name=>name.trim()===this.volume)
  if(!existsSync(manifest)){
   if(hasVolume)throw Error('Memory runtime manifest is missing while its database volume exists. Restore the metadata before backing up.')
   return
  }
  const previous=manifestRecord(await readBoundedJSON(manifest,1024*1024))
  if(!hasVolume){
   const dump=join(this.directory,'database.dump')
   if(previous.backup?.sha256){
    if(!/^[a-f0-9]{64}$/.test(previous.backup.sha256)||!existsSync(dump))throw Error('Memory database volume is missing and its prior dump cannot be verified')
    const hash=createHash('sha256');for await(const bytes of createReadStream(dump))hash.update(bytes)
    if(hash.digest('hex')!==previous.backup.sha256)throw Error('Memory database volume is missing and its prior dump failed verification')
    return
   }
   if(previous.backup?.empty===true&&!existsSync(dump))return
   if(previous.backup||existsSync(dump))throw Error('Memory database volume is missing; inspect the retained dump before backing up')
   await atomicMetadata(manifest,JSON.stringify({...previous,backup:{empty:true,createdAt:new Date().toISOString()}}))
   return
  }
  // An existing volume can hold newer memories than the last dump. A missing
  // database container is a blocker, not proof that the volume is empty.
  await this.docker(['inspect',this.database])
  await this.docker(['start',this.database]);await fs.mkdir(this.directory,{recursive:true})
  let healthy=false;for(let i=0;i<30;i++){try{await this.docker(['exec',this.database,'pg_isready','-U','unrealcode','-d','memory']);healthy=true;break}catch{await new Promise(resolve=>setTimeout(resolve,500))}}if(!healthy)throw Error('Memory database is not ready for backup')
  const temporary=join(this.directory,`${randomUUID()}.dump.partial`),target=join(this.directory,'database.dump')
  const child=spawn(terminalDockerExecutable(backendEnvironment()),['exec',this.database,'pg_dump','-U','unrealcode','-Fc','memory'],{windowsHide:true,stdio:['ignore','pipe','ignore'],env:backendEnvironment()})
  const completed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Memory recovery dump failed')))})
  await Promise.all([pipeline(child.stdout!,createWriteStream(temporary,{flags:'wx',mode:0o600})),completed]);const hash=createHash('sha256');for await(const bytes of createReadStream(temporary))hash.update(bytes)
  const checker=spawn(terminalDockerExecutable(backendEnvironment()),['exec','-i',this.database,'pg_restore','--list'],{windowsHide:true,stdio:['pipe','ignore','ignore'],env:backendEnvironment()});const checked=new Promise<void>((resolve,reject)=>{checker.once('error',reject);checker.once('exit',code=>code===0?resolve():reject(Error('Memory dump validation failed')))});await Promise.all([pipeline(createReadStream(temporary),checker.stdin!),checked]);await fs.rename(temporary,target);const path=join(this.directory,'runtime.json');let prior:Record<string,any>={version:1,image:HINDSIGHT_IMAGE,postgres:MEMORY_POSTGRES_IMAGE,volume:this.volume,cache:this.cache,generation:this.generation};try{prior=manifestRecord(await readBoundedJSON(path,1024*1024))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}await atomicMetadata(path,JSON.stringify({...prior,backup:{sha256:hash.digest('hex'),createdAt:new Date().toISOString(),bytes:(await fs.stat(target)).size}}))
 }
 async storage():Promise<{databaseBytes:number;modelCacheBytes:number}>{
  const size=async(volume:string)=>{try{await this.docker(['volume','inspect',volume])}catch{return 0};const result=await this.docker(['run','--rm','--network','none','--read-only','--cap-drop=ALL','--mount',`type=volume,source=${volume},target=/storage,readonly`,'--entrypoint','du',MEMORY_POSTGRES_IMAGE,'-sb','/storage'],60000);const bytes=Number(result.stdout.split(/\s/)[0]);if(!Number.isFinite(bytes)||bytes<0)throw Error('Memory storage measurement failed');return bytes};const [databaseBytes,modelCacheBytes]=await Promise.all([size(this.volume),size(this.cache)]);return {databaseBytes,modelCacheBytes}
 }
 async clearModelCache(){await this.stop();await this.docker(['volume','rm',this.cache]);this.message='Local embedding and reranking cache removed. Retained memories are preserved.';this.onChanged()}
 request(method:string,bank:string,suffix:string,body?:unknown):Promise<any>{
  if(!this.ready||!this.process) return Promise.reject(Error('Memory runtime is unavailable'))
  if(!/^[a-z0-9-]{1,100}$/.test(bank)||!(suffix===''&&method==='DELETE'&&/-reflect-[a-f0-9]{32}$/.test(bank)||/^\/(memories(?:\/recall|\/list)?|reflect|documents(?:\/[a-zA-Z0-9_-]+)?)$/.test(suffix))||!['GET','POST','DELETE','PUT'].includes(method))return Promise.reject(Error('Unsupported memory operation'))
  const id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Memory request timed out; retained outbox will be reconciled by document ID'))},125000);this.pending.set(id,{resolve,reject,timer});try{this.process!.stdin!.write(JSON.stringify({id,method,path:`/v1/default/banks/${bank}${suffix}`,...(body===undefined?{}:{body})})+'\n')}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error)}})
 }
 async stop(){this.epoch++;this.ready=false;this.cancelStartup?.();this.cancelStartup=undefined;const child=this.process;this.process=undefined;for(const call of this.pending.values()){clearTimeout(call.timer);call.reject(Error('Memory runtime stopped before the request completed'))}this.pending.clear();try{child?.stdin?.end()}catch{}if(!this.stopping)this.stopping=(async()=>{try{await this.docker(['stop','-t','5',`unrealcode-memory-api-${this.identity}`],10000)}catch{}try{await this.docker(['stop',this.database],15000)}catch{}})().finally(()=>{this.stopping=undefined});await this.stopping;this.state='disabled';this.message='Memory stopped; retained storage is preserved';this.onChanged()}
}
