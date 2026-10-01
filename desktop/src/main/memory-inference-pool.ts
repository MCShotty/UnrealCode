/** One app-wide provider-dispatch limit. Never hold a slot around a Hindsight
 * HTTP operation: that operation can call back into the inference broker. */
export class MemoryInferencePool {
 private active=0
 private queue:Array<{start():void;abort?():void}>=[]
 constructor(private limit=2,private maximumQueued=32){}
 run<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)return Promise.reject(Object.assign(Error('Memory analysis cancelled'),{name:'AbortError'}))
  if(this.queue.length>=this.maximumQueued)return Promise.reject(Error('Memory inference is busy; retry shortly'))
  return new Promise<T>((resolve,reject)=>{
   const queued:{start():void;abort?():void}={start:()=>{if(queued.abort)signal?.removeEventListener('abort',queued.abort);if(signal?.aborted){reject(Object.assign(Error('Memory analysis cancelled'),{name:'AbortError'}));this.queue.shift()?.start();return}this.active++;void Promise.resolve().then(()=>{if(signal?.aborted)throw Object.assign(Error('Memory analysis cancelled'),{name:'AbortError'});return work()}).then(resolve,reject).finally(()=>{this.active--;this.queue.shift()?.start()})}}
   if(this.active<this.limit)queued.start();else{queued.abort=()=>{const index=this.queue.indexOf(queued);if(index>=0){this.queue.splice(index,1);reject(Object.assign(Error('Memory analysis cancelled'),{name:'AbortError'}))}};signal?.addEventListener('abort',queued.abort,{once:true});this.queue.push(queued)}
  })
 }
}
export const memoryInferencePool=new MemoryInferencePool()
