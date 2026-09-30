import { expect, it } from 'vitest'
import { MemoryInferencePool } from './memory-inference-pool'
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
