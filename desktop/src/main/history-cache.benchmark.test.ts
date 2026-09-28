import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { HistoryCache } from './history-cache'
import { LegacyConversationIndex } from './legacy-conversation-index'
import type { AgentEvent } from '../shared/api'

it.skipIf(process.env.UNREAL_HISTORY_BENCHMARK!=='1')('measures 100,000 cached events against the previous JSONL index',async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-history-benchmark-')),legacy=join(root,'legacy');await fs.mkdir(legacy)
 const cache=new HistoryCache(join(root,'profile')),samples:number[]=[]
 const loop=monitorEventLoopDelay({resolution:10});loop.enable();const sample=setInterval(()=>samples.push(process.memoryUsage().rss),25)
 const events:AgentEvent[]=[]
 for(let session=0;session<100;session++){
  const id=`00000000-0000-0000-0000-${String(session).padStart(12,'0')}`,rows=[]
  for(let seq=1;seq<=1000;seq++){
   const text=seq===700?`Review src/specific-needle-${session}.ts`:`Read source and run checks for file ${seq} in task ${session}`
   events.push({v:1,sessionId:id,seq,event:'session.item',recordedAt:new Date(1700000000000+session*1000+seq).toISOString(),payload:{Kind:'input',Data:{Kind:'external',Payload:{Prompt:text}}}})
   rows.push(JSON.stringify({seq,kind:'session.item',text,recordedAt:new Date(1700000000000+session*1000+seq).toISOString()}))
  }
  await fs.writeFile(join(legacy,`${id}.jsonl`),rows.join('\n'))
 }
 const time=async<T>(work:()=>Promise<T>)=>{const start=performance.now();const value=await work();return {ms:performance.now()-start,value}}
 try{
  const indexed=await time(async()=>{for(let offset=0;offset<events.length;offset+=500)await Promise.all(events.slice(offset,offset+500).map(event=>cache.ingest('project',event)))})
  await cache.close()
  const old=new LegacyConversationIndex('project',legacy),fresh=new HistoryCache(cache.profile)
  const oldCold=await time(()=>old.search('specific-needle')),newCold=await time(()=>fresh.search(['project'],'specific-needle'))
  expect(newCold.value.length).toBe(oldCold.value.length)
  const oldWarm:number[]=[],newWarm:number[]=[],pages:number[]=[]
  for(let count=0;count<20;count++){oldWarm.push((await time(()=>old.search('specific-needle'))).ms);newWarm.push((await time(()=>fresh.search(['project'],'specific-needle'))).ms);pages.push((await time(()=>fresh.page('project',events[0].sessionId,{limit:500}))).ms)}
  const median=(items:number[])=>items.sort((a,b)=>a-b)[Math.floor(items.length/2)]
  const report={events:100000,sessions:100,indexBuildMs:indexed.ms,jsonlSearchColdMs:oldCold.ms,sqliteSearchColdMs:newCold.ms,jsonlSearchWarmMedianMs:median(oldWarm),sqliteSearchWarmMedianMs:median(newWarm),sqliteHistoryPageMedianMs:median(pages),eventLoopP95Ms:loop.percentile(95)/1e6,eventLoopMaxMs:loop.max/1e6,processPeakRssMiB:Math.max(...samples)/1024**2,workers:await fresh.health(),scope:'Same process; peak RSS and event-loop figures include fixture creation, both implementations, and tests. No provider/token saving claim.'}
  await fs.writeFile(join(root,'report.json'),JSON.stringify(report,null,2));console.log('HISTORY_BENCHMARK '+JSON.stringify({root,...report}));await fresh.close()
 }finally{clearInterval(sample);loop.disable();await cache.close()}
},120000)
