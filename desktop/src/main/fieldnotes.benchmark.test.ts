import {it,expect} from 'vitest'
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {monitorEventLoopDelay} from 'node:perf_hooks'
import {HistoryCache} from './history-cache'
import {Fieldnotes} from './fieldnotes'
it.skipIf(process.env.UNREAL_FIELDNOTES_BENCHMARK!=='1')('measures 10000 notes with simultaneous 100000-event indexing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-notes-bench-')),cache=new HistoryCache(root),seed=new Fieldnotes(root,cache),project=await seed.registerProject('C:\\fixture'),directory=seed.directory
 await seed.close();await mkdir(join(directory,'notes'),{recursive:true})
 const now=new Date().toISOString();for(let offset=0;offset<10000;offset+=32)await Promise.all(Array.from({length:Math.min(32,10000-offset)},async(_,i)=>{const n=offset+i;await writeFile(join(directory,'notes',`${now.replaceAll(':','-').replace('T','_')}-${n}.json`),JSON.stringify({id:randomUUID(),revision:1,title:`Guidance ${n}`,body:`Use SQLite for fixture cache ${n}. ملاحظات المشروع. Verify migration ${n%37}.`,pointer:{projectId:project.id,projectPath:project.path,projectName:project.name},enabled:true,indexing:false,createdAt:now,updatedAt:now,sync:{state:'local',attempts:0}}))}))
 const notes=new Fieldnotes(root,cache),timed=async<T>(work:()=>Promise<T>)=>{const start=performance.now();const value=await work();return {ms:performance.now()-start,value}},loop=monitorEventLoopDelay({resolution:10});loop.enable()
 try{
  const cold=await timed(()=>notes.load());console.log('Fieldnotes cold load ms',cold.ms);const warm:number[]=[],prepare:number[]=[],session=randomUUID()
  const history=(async()=>{for(let offset=0;offset<100000;offset+=250)await Promise.all(Array.from({length:250},(_,i)=>cache.ingest('fixture',{v:1,sessionId:session,seq:offset+i+1,event:'session.item',payload:{Kind:'input',Data:{Kind:'external',Payload:{Prompt:`Inspect fixture file ${offset+i}`}}}})))})()
  for(let n=0;n<40;n++){warm.push((await timed(()=>notes.suggestions(`SQLite ${n}`,'C:\\elsewhere',session))).ms);prepare.push((await timed(()=>notes.prepare('C:\\elsewhere','C:\\elsewhere',session,randomUUID(),`SQLite ${n}`))).ms)}
  await history;await cache.flush();const p95=(values:number[])=>values.sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1],report={notes:10000,events:100000,coldLoadMs:cold.ms,warmSearchP95Ms:p95(warm),sendPreparationP95Ms:p95(prepare),eventLoopP95Ms:loop.percentile(95)/1e6,eventLoopMaxMs:loop.max/1e6,rssMiB:process.memoryUsage().rss/1024**2,workers:await cache.health(),scope:'Actual SQLite writer/two reader workers, canonical timestamp note files and bounded original-text receipt preparation. No inference or native input.'}
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));console.log('FIELDNOTE_BENCHMARK '+JSON.stringify({root,...report}));expect((await notes.list()).total).toBe(10000)
 }finally{loop.disable();await notes.close();await cache.close()}
},180000)
