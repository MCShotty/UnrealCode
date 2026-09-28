import { Worker } from 'node:worker_threads'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent, Checkpoint, SessionInfo } from '../shared/api'
import type { CacheStatus, HistoryPage } from '../shared/history'
import type { SearchHit } from '../shared/workflow'
import type { WorkView, ActivityPage, ActivityDetail, ActivityQuery } from '../shared/activity'
import { storageLocation, timestampName } from './storage-locations'
import { classifyFailure, withEventFailure } from './failures'

type Job = { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
class CacheWorker {
  worker: Worker
  ready: Promise<void>
  private jobs = new Map<number, Job>()
  private next = 0
  private failed?: Error
  get broken():boolean{return !!this.failed}
  constructor(path: string, reader: boolean) {
    this.worker = new Worker(join(__dirname, 'history-worker.cjs'), { workerData: { path, reader } })
    this.ready = new Promise((resolve,reject)=>{
      this.worker.on('message',message=>{
        if(message.ready){resolve();return}
        const pending=this.jobs.get(message.id);if(!pending)return
        this.jobs.delete(message.id);clearTimeout(pending.timer)
        if(message.ok)pending.resolve(message.value);else pending.reject(Object.assign(new Error(message.error.message),{code:message.error.code}))
      })
      const fail=(error:Error):void=>{this.failed=error;reject(error);for(const job of this.jobs.values()){clearTimeout(job.timer);job.reject(error)}this.jobs.clear()}
      this.worker.on('error',fail);this.worker.on('exit',code=>fail(new Error(`History worker exited (${code})`)))
    })
  }
  async request<T>(method:string,params:unknown={},cancel?:Int32Array):Promise<T>{
    await this.ready;if(this.failed)throw this.failed
    if(this.jobs.size>=64)throw new Error('History cache queue is full; synchronization will retry')
    const id=++this.next
    return new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>{this.jobs.delete(id);reject(new Error('History cache request timed out'));void this.worker.terminate()},30000);this.jobs.set(id,{resolve,reject,timer});this.worker.postMessage({id,method,params,cancel})})
  }
  async close():Promise<void>{try{await this.request('close')}catch{/* failed workers already released their connections */}finally{await this.worker.terminate()}}
}
export class HistoryCache {
  readonly path: string
  private writer?: CacheWorker
  private readers: CacheWorker[]=[]
  private ready?:Promise<void>
  private closed=false
  private reader=0
  private pending: Array<{ project:string;event:AgentEvent;resolve():void;reject(error:unknown):void }>=[]
  private scheduled=false
  private writing:Promise<void>=Promise.resolve()
  private failure?:unknown
  private rebuilding?:Promise<void>
  private queryGroups=new Map<string,Int32Array>()
  constructor(readonly profile:string){this.path=storageLocation(profile,'history-cache','history',undefined,'.sqlite')}
  private start():Promise<void>{
    if(this.closed)return Promise.reject(new Error('History cache is closed'))
    if(!this.ready)this.ready=(async()=>{await fs.mkdir(join(this.profile,'history-cache'),{recursive:true});this.writer=new CacheWorker(this.path,false);await this.writer.ready;this.readers=[new CacheWorker(this.path,true),new CacheWorker(this.path,true)];await Promise.all(this.readers.map(worker=>worker.ready))})().catch(error=>{this.failure=error;throw error})
    return this.ready
  }
  async query<T>(group:string|undefined,work:(cancel?:Int32Array)=>Promise<T>):Promise<T>{
    if(!group)return work()
    const prior=this.queryGroups.get(group);if(prior)Atomics.store(prior,0,1)
    const cancel=new Int32Array(new SharedArrayBuffer(4));this.queryGroups.set(group,cancel)
    try{const value=await work(cancel);if(Atomics.load(cancel,0))throw Object.assign(new Error('History query cancelled'),{code:'HISTORY_QUERY_CANCELLED'});return value}
    finally{if(this.queryGroups.get(group)===cancel)this.queryGroups.delete(group)}
  }
  private async read<T>(method:string,params:unknown,query?:string|Int32Array):Promise<T>{
    if(typeof query==='string')return this.query(query,cancel=>this.read(method,params,cancel))
    await this.start();const index=this.reader++%this.readers.length;if(this.readers[index].broken)this.readers[index]=new CacheWorker(this.path,true);return this.readers[index].request<T>(method,params,query)
  }
  private async write<T>(method:string,params:unknown):Promise<T>{await this.start();if(this.writer!.broken)this.writer=new CacheWorker(this.path,false);return this.writer!.request<T>(method,params)}
  ingest(project:string,event:AgentEvent):Promise<void>{
    if(!Number.isSafeInteger(event.seq)||event.seq<1)return Promise.resolve()
    event=withEventFailure(event)
    if(this.pending.length>=2000)return Promise.reject(new Error('History cache backlog; replay required'))
    return new Promise((resolve,reject)=>{this.pending.push({project,event,resolve,reject});if(!this.scheduled){this.scheduled=true;setImmediate(()=>this.drain())}})
  }
  private drain():void {
    this.writing=(async()=>{
      while(this.pending.length){
        const batch=this.pending.splice(0,250)
        try{await this.write('ingest',{batch:batch.map(({project,event})=>({project,event}))});this.failure=undefined;batch.forEach(item=>item.resolve())}
        catch(error){this.failure=error;batch.forEach(item=>item.reject(error))}
        await new Promise(resolve=>setImmediate(resolve))
      }
      this.scheduled=false
    })()
  }
  async flush():Promise<void>{while(this.pending.length||this.scheduled){await new Promise(resolve=>setImmediate(resolve));await this.writing}await this.writing}
  async sessions(project:string):Promise<SessionInfo[]>{return this.read('sessions.list',{project})}
  async workView(project:string,session:string,connected:boolean,range:{from?:number;to?:number}={},query?:string,active=connected):Promise<WorkView>{return this.read('work.view',{project,session,connected,active,...range},query)}
  async activityPage(project:string,session:string,connected:boolean,query:ActivityQuery={},supersede?:string,active=connected):Promise<ActivityPage>{return this.read('activity.page',{project,session,connected,active,query},supersede)}
  async activityDetail(project:string,session:string,connected:boolean,id:string,offset=0,active=connected):Promise<ActivityDetail>{return this.read('activity.detail',{project,session,connected,active,id,offset})}
  async projects():Promise<string[]>{return this.read('projects.list',{})}
  async putSessions(project:string,sessions:SessionInfo[]):Promise<void>{await this.write('sessions.put',{project,sessions})}
  async status(project:string,session:string):Promise<CacheStatus>{try{const status=await this.read<CacheStatus>('status',{project,session});return this.failure?{...status,state:'partial',failure:classifyFailure(this.failure,'history-cache')}:status}catch(error){return {state:'unavailable',cursor:0,latest:0,failure:classifyFailure(this.failure||error,'history-cache')}}}
  async cursor(project:string,session:string):Promise<number>{await this.flush();return (await this.read<CacheStatus>('status',{project,session})).cursor}
  async synced(project:string,session:string):Promise<void>{await this.flush();await this.write('sync',{project,session})}
  async page(project:string,session:string,options:{before?:number;around?:number;limit?:number}={},query?:string|Int32Array):Promise<HistoryPage>{const page=await this.read<HistoryPage>('page',{project,session,...options},query);if(this.failure)page.cache={...page.cache,state:'partial',failure:classifyFailure(this.failure,'history-cache')};return page}
  async addFiles(project:string,session:string,seq:number,paths:string[]):Promise<void>{await this.flush();await this.write('files',{project,session,seq,paths})}
  async addCheckpoint(project:string,checkpoint:Pick<Checkpoint,'sessionId'|'messageIds'|'files'>):Promise<void>{await this.flush();await this.write('checkpoint.files',{project,session:checkpoint.sessionId,messageIds:checkpoint.messageIds,paths:checkpoint.files.map(file=>file.path)})}
  search(projects:string[],query:string,session?:string,supersedeKey?:string):Promise<SearchHit[]>{return this.read('search',{projects,query,session},supersedeKey)}
  async health():Promise<unknown[]>{await this.start();return Promise.all([this.writer!,...this.readers].map(worker=>worker.request('health')))}
  async reindex():Promise<void>{await this.flush();await this.write('reindex',{});this.failure=undefined}
  async close():Promise<void>{await this.flush();await Promise.all(this.readers.map(worker=>worker.close()));await this.writer?.close();this.closed=true}
  rebuild():Promise<void>{if(!this.rebuilding)this.rebuilding=this.rebuildFresh().finally(()=>{this.rebuilding=undefined});return this.rebuilding}
  private async rebuildFresh():Promise<void>{await this.close();const name=timestampName();for(const extension of ['','-wal','-shm'])await fs.rename(this.path+extension,this.path+`.quarantine-${name}`+extension).catch(error=>{if(error.code!=='ENOENT')throw error});this.closed=false;this.ready=undefined;this.failure=undefined;this.writer=undefined;this.readers=[];await this.start()}
}
const caches=new Map<string,HistoryCache>()
export function historyCache(profile:string):HistoryCache{let cache=caches.get(profile);if(!cache){cache=new HistoryCache(profile);caches.set(profile,cache)}return cache}
export async function closeHistoryCaches():Promise<void>{await Promise.all([...caches.values()].map(cache=>cache.close()));caches.clear()}
export async function resetHistoryCaches():Promise<void>{for(const cache of caches.values())await cache.rebuild()}
