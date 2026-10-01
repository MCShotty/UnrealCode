import { expect, it } from 'vitest'
import { MemoryInferencePool } from './memory-inference-pool'
it('withdraws queued analysis without dispatching it or freeing an active provider slot early',async()=>{
 const pool=new MemoryInferencePool(1),controller=new AbortController();let release!:()=>void,second=false
 const first=pool.run(()=>new Promise<void>(resolve=>release=resolve))
 const queued=pool.run(async()=>{second=true},controller.signal),rejected=expect(queued).rejects.toThrow('cancelled')
 await Promise.resolve();controller.abort();await rejected;expect(second).toBe(false);release();await first
})
it('cancels before the first dispatch microtask',async()=>{
 const pool=new MemoryInferencePool(1),controller=new AbortController();let called=false
 const work=pool.run(async()=>{called=true},controller.signal);controller.abort();await expect(work).rejects.toThrow('cancelled');expect(called).toBe(false)
})
it('shares two provider slots fairly and releases them after failures',async()=>{
 const pool=new MemoryInferencePool(2,8),started:number[]=[],release:Array<()=>void>=[]
 const tasks=Array.from({length:5},(_,id)=>pool.run(async()=>{started.push(id);await new Promise<void>(resolve=>{release[id]=resolve});if(id===0)throw Error('fixture');return id}))
 const results=Promise.allSettled(tasks)
 await Promise.resolve();expect(started).toEqual([0,1]);release[0]();release[1]()
 for(let i=0;i<10&&started.length<4;i++)await Promise.resolve()
 expect(started).toEqual([0,1,2,3]);release[2]();release[3]()
 for(let i=0;i<10&&started.length<5;i++)await Promise.resolve()
 release[4]();expect((await results).filter(r=>r.status==='fulfilled')).toHaveLength(4)
})
