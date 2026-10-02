import {expect,it} from 'vitest'
import {AdvisoryPool} from './advisory-pool'
it('shares two actual slots across projects and keeps them until settlement',async()=>{
  const pool=new AdvisoryPool(),a=new AbortController(),b=new AbortController(),c=new AbortController()
  const releaseA=await pool.acquire('project-a',a.signal),releaseB=await pool.acquire('project-b',b.signal)
  let started=false
  const third=pool.acquire('project-c',c.signal).then(release=>{started=true;return release})
  a.abort();await Promise.resolve();expect(started).toBe(false)
  releaseA();const releaseC=await third;expect(started).toBe(true)
  releaseA();releaseB();releaseC()
})
it('cancels queued work, rejects duplicate identities and preserves FIFO',async()=>{
  const pool=new AdvisoryPool(1),initial=new AbortController(),drop=new AbortController(),next=new AbortController()
  const release=await pool.acquire('first',initial.signal)
  await expect(pool.acquire('first',initial.signal)).rejects.toThrow('Duplicate')
  const cancelled=pool.acquire('cancelled',drop.signal);const rejection=expect(cancelled).rejects.toThrow('cancelled')
  const later=pool.acquire('next',next.signal)
  drop.abort();await rejection;release();(await later)()
  const final=await pool.acquire('after',new AbortController().signal);final()
})
