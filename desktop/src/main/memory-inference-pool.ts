/** One app-wide provider-dispatch limit. Never hold a slot around a Hindsight
 * HTTP operation: that operation can call back into the inference broker. */
export class MemoryInferencePool {
 private active=0
 private queue:Array<()=>void>=[]
 constructor(private limit=2,private maximumQueued=32){}
 run<T>(work:()=>Promise<T>):Promise<T>{
  if(this.queue.length>=this.maximumQueued)return Promise.reject(Error('Memory inference is busy; retry shortly'))
  return new Promise<T>((resolve,reject)=>{
   const start=()=>{this.active++;void Promise.resolve().then(work).then(resolve,reject).finally(()=>{this.active--;this.queue.shift()?.()})}
   if(this.active<this.limit)start();else this.queue.push(start)
  })
 }
}
export const memoryInferencePool=new MemoryInferencePool()
