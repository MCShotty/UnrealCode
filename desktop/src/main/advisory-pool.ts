type Waiting = { key: string; start(): void; abort(): void }
/** Separate from memory inference. A cancelled running lease stays occupied
 * until its backend confirms settlement or that backend has exited. */
export class AdvisoryPool {
  private active = new Set<string>()
  private queue: Waiting[] = []
  constructor(private limit = 2, private maximumQueued = 128) {}
  acquire(key: string, signal: AbortSignal): Promise<()=>void> {
    if(signal.aborted) return Promise.reject(Error('Decision lease cancelled'))
    if(this.active.has(key) || this.queue.some(item=>item.key === key)) return Promise.reject(Error('Duplicate decision lease'))
    if(this.queue.length >= this.maximumQueued) return Promise.reject(Error('Decision lease queue is full'))
    return new Promise((resolve,reject)=>{
      const waiting: Waiting = { key, start:()=>{
        signal.removeEventListener('abort',waiting.abort)
        if(signal.aborted) { reject(Error('Decision lease cancelled')); this.drain(); return }
        this.active.add(key)
        let released = false
        resolve(()=>{ if(released)return; released=true; this.active.delete(key); this.drain() })
      }, abort:()=>{ const index=this.queue.indexOf(waiting); if(index<0)return; this.queue.splice(index,1);signal.removeEventListener('abort',waiting.abort);reject(Error('Decision lease cancelled')) } }
      if(this.active.size < this.limit) waiting.start()
      else { signal.addEventListener('abort',waiting.abort,{once:true}); this.queue.push(waiting) }
    })
  }
  private drain():void { while(this.active.size < this.limit && this.queue.length) this.queue.shift()!.start() }
}
export const advisoryPool = new AdvisoryPool()
