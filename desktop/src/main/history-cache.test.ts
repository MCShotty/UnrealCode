import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HistoryCache } from './history-cache'
import type { AgentEvent } from '../shared/api'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
const cleanups:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()})
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'unrealcode-sqlite-'));cleanups.push(()=>rm(directory,{recursive:true,force:true}));const cache=new HistoryCache(directory);cleanups.push(()=>cache.close());return cache}
const event=(seq:number,text=`Event ${seq}`,sessionId='session-a'):AgentEvent=>({v:1,event:'session.item',sessionId,seq,recordedAt:new Date(1700000000000+seq).toISOString(),payload:{Kind:'input',Data:{Kind:'external',Payload:{Prompt:text}}}})
it('reindexes without dropping inactive isolated or offline project histories',async()=>{
 const cache=await fixture()
 for(const project of ['parent','offline-project']){await cache.putSessions(project,[{id:'isolated',title:'Keep name',lastUpdatedAt:'2026-09-28',active:false}]);await cache.ingest(project,event(1,'retained evidence','isolated'));await cache.synced(project,'isolated')}
 await cache.reindex()
 for(const project of ['parent','offline-project']){expect((await cache.page(project,'isolated')).events).toHaveLength(1);expect((await cache.sessions(project))[0].title).toBe('Keep name');expect(await cache.search([project],'retained evidence')).toHaveLength(1)}
})
it('owns three actual worker threads and reads while indexing independent sessions',async()=>{
  const cache=await fixture(),workers=await cache.health() as Array<{threadId:number;reader:boolean}>
  expect(new Set(workers.map(worker=>worker.threadId)).size).toBe(3);expect(workers.filter(worker=>worker.reader)).toHaveLength(2)
  await cache.putSessions('project',[{id:'session-a',title:'Keep this title',lastUpdatedAt:'2026-09-27',active:false}])
  expect(await cache.projects()).toEqual(['project'])
  const writing=Promise.all(Array.from({length:700},(_,index)=>cache.ingest('project',event(index+1))))
  const other=Promise.all(Array.from({length:30},(_,index)=>cache.ingest('project',event(index+1,'other','session-b'))))
  const reading=Promise.all([cache.page('project','session-a'),cache.search(['project'],'event')])
  await Promise.all([writing,other,reading]);await cache.synced('project','session-a')
  expect((await cache.status('project','session-a')).cursor).toBe(700)
  expect((await cache.sessions('project'))[0].title).toBe('Keep this title')
  expect((await cache.page('project','session-a',{limit:20})).events.map(item=>item.seq)).toEqual(Array.from({length:20},(_,i)=>681+i))
})
it('keeps a contiguous cursor, deduplicates replay, paginates, and handles literal code searches',async()=>{
  const cache=await fixture()
  await cache.ingest('p',event(3,'src/Example.ts foo[0]'))
  expect(await cache.cursor('p','session-a')).toBe(0)
  await Promise.all([cache.ingest('p',event(1)),cache.ingest('p',event(2))]);await cache.ingest('p',event(3,'incorrect duplicate'))
  expect(await cache.cursor('p','session-a')).toBe(3)
  expect(await cache.search(['p'],'incorrect')).toHaveLength(0)
  expect(await cache.search(['p'],'foo[0]')).toHaveLength(1)
  expect(await cache.search(['p'],'src/EXAMPLE.ts')).toHaveLength(1)
  expect((await cache.page('p','session-a',{before:3})).events.map(item=>item.seq)).toEqual([1,2])
  await cache.addFiles('p','session-a',4,['src/new-file.ts']);await cache.ingest('p',event(4))
  expect(await cache.search(['p'],'new-file.ts')).toHaveLength(1)
  expect(await cache.search(['other'],'foo')).toHaveLength(0)
})
it('reopens offline and rebuilds a damaged disposable cache',async()=>{
  const cache=await fixture();await cache.ingest('p',event(1,'saved offline'));await cache.close()
  const reopened=new HistoryCache(cache.profile);cleanups.push(()=>reopened.close())
  expect((await reopened.page('p','session-a')).events).toHaveLength(1)
  await reopened.close();await writeFile(cache.path,'broken sqlite')
  const broken=new HistoryCache(cache.profile);cleanups.push(()=>broken.close())
  expect((await broken.status('p','session-a')).state).toBe('unavailable')
  await broken.rebuild();await broken.ingest('p',event(1,'replayed'))
  expect(await broken.search(['p'],'replayed')).toHaveLength(1)
})
it('recovers after a writer crash and a bounded database lock without advancing lost cursors',async()=>{
  const cache=await fixture();await cache.ingest('p',event(1))
  await (cache as unknown as {writer:{worker:Worker}}).writer.worker.terminate()
  await cache.ingest('p',event(2));expect(await cache.cursor('p','session-a')).toBe(2)
  const other=new DatabaseSync(cache.path);other.exec('BEGIN IMMEDIATE')
  try{await expect(cache.ingest('p',event(3))).rejects.toThrow(/locked/);expect(await cache.cursor('p','session-a')).toBe(2)}finally{other.exec('ROLLBACK');other.close()}
  await cache.ingest('p',event(3));expect(await cache.cursor('p','session-a')).toBe(3)
},10000)
it('rolls an interrupted transaction back with its event, FTS entry and replay cursor together',async()=>{
  const cache=await fixture();await cache.ingest('p',event(1))
  const interrupted=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(workerData);db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO events(project,session,seq,kind,payload,text) VALUES(?,?,?,?,?,?)').run('p','session-a',2,'session.item','{}','uncommitted marker');
    db.prepare('UPDATE sessions SET cursor=2,high=2 WHERE project=? AND session=?').run('p','session-a');
    parentPort.postMessage('transaction-open');setInterval(()=>{},1000);
  `,{eval:true,workerData:cache.path})
  try{
    await new Promise<void>((resolve,reject)=>{interrupted.once('message',()=>resolve());interrupted.once('error',reject)})
    expect(await cache.cursor('p','session-a')).toBe(1)
  }finally{await interrupted.terminate()}
  expect(await cache.search(['p'],'uncommitted marker')).toEqual([])
  expect((await cache.page('p','session-a')).events.map(item=>item.seq)).toEqual([1])
  await cache.ingest('p',event(2));expect(await cache.cursor('p','session-a')).toBe(2)
})

it('does not cancel independent concurrent history readers',async()=>{
  const cache=await fixture()
  await Promise.all([cache.ingest('p',event(1,'A','session-a')),cache.ingest('p',event(1,'B','session-b'))])
  const pages=await Promise.all([cache.page('p','session-a'),cache.page('p','session-b')])
  expect(pages.map(page=>page.events[0].sessionId)).toEqual(['session-a','session-b'])
  const hits=await Promise.all([cache.search(['p'],'A','session-a'),cache.search(['p'],'B','session-b')])
  expect(hits.map(items=>items[0].sessionId)).toEqual(['session-a','session-b'])
})
it('only supersedes explicitly grouped queries, including delayed requests before the worker read',async()=>{
  const cache=await fixture();await cache.ingest('p',event(1))
  let release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve})
  const older=cache.query('window-history',async cancel=>{await delayed;return cache.page('p','session-a',{},cancel)})
  const checked=expect(older).rejects.toMatchObject({code:'HISTORY_QUERY_CANCELLED'})
  const newer=await cache.page('p','session-a',{},'window-history')
  expect(newer.events).toHaveLength(1);release();await checked
})

it('keeps native-context provenance beyond a short history page and through inherited history',async()=>{
 const cache=await fixture()
 const native:AgentEvent={v:1,event:'session.item',sessionId:'native',seq:1,payload:{Kind:'model_response',Data:{TurnID:'turn',Response:{Output:[{Type:'tool_call',Data:{CallID:'call',Name:'Computer',Arguments:'{}'}}]}}}}
 for(const sessionId of ['native','fork']){
  await cache.ingest('p',{...native,sessionId})
  await Promise.all(Array.from({length:400},(_,i)=>cache.ingest('p',event(i+2,'Later activity',sessionId))))
  expect((await cache.page('p',sessionId,{limit:250})).events.some(row=>JSON.stringify(row.payload).includes('Computer'))).toBe(false)
  expect(await cache.nativeContext('p',sessionId,401)).toBe(true)
 }
 await cache.ingest('p',{...event(1,'Pinned screenshot','pinned'),payload:{Kind:'input',Data:{Kind:'external',Payload:{prompt:'Attached evidence',nativeContext:true}}}})
 expect(await cache.nativeContext('p','pinned',1)).toBe(true)
 await cache.ingest('p',event(1,'Ordinary result','ordinary'));expect(await cache.nativeContext('p','ordinary',1)).toBe(false)
 await cache.ingest('p',event(3,'History gap','ordinary'));expect(await cache.nativeContext('p','ordinary',3)).toBeUndefined()
})
