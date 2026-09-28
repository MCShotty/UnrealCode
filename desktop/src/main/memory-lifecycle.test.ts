import {afterEach,expect,it,vi} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const bridgeControl=vi.hoisted(()=>({start:vi.fn(async()=>{}),stop:vi.fn(async()=>{})}))
vi.mock('./settings',()=>({credentialFor:()=>({})}))
vi.mock('./hindsight-runtime',()=>({HindsightRuntime:class{state='disabled';start=vi.fn(async()=>{this.state='ready'});stop=vi.fn(async()=>{this.state='disabled'});request=vi.fn(async()=>({results:[]}))}}))
vi.mock('./docker',()=>({DockerBridge:class{status=()=>({ready:false});start=bridgeControl.start;stop=bridgeControl.stop}}))
import {HindsightMemory} from './hindsight-memory'
const roots:string[]=[]
afterEach(async()=>{vi.clearAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function setup(){const root=await mkdtemp(join(tmpdir(),'unrealcode-memory-lifecycle-'));roots.push(root);const memory=new HindsightMemory(root);await memory.status('');const profile={provider:'ollama',model:'fixture',baseUrl:'',thinkingLevel:'low',requestLimit:1,tokenLimit:1000};(memory as any).value.settings={version:2,enabled:true,globalConsent:true,projects:[],profile,verifiedProfile:(memory as any).fingerprint(profile)};return memory}
it('shares the configured request budget between observer and retention inference',async()=>{
 const memory=await setup(),request=vi.fn(async()=>({Output:[{Type:'message',Data:{Text:'{}'}}],Usage:{InputTokens:3,OutputTokens:1}}))
 vi.spyOn(memory as any,'inferenceBridge').mockResolvedValue({request,stop:vi.fn(async()=>{})})
 try {
  await memory.start();const broker=(memory as any).inference,address=broker.server.address()
  await memory.analyse('Synthetic observer evidence')
  const response=await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${broker.token}`,'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Synthetic retention'}]})})
  expect(response.status).toBe(502);expect(request).toHaveBeenCalledTimes(1)
  expect((await memory.status('')).requests).toBe(1)
 } finally {await memory.stop()}
})
it('reserves one shared budget slot for concurrent identical retention requests',async()=>{
 const memory=await setup();let release!:(value:any)=>void;const request=vi.fn(()=>new Promise(resolve=>release=resolve))
 vi.spyOn(memory as any,'inferenceBridge').mockResolvedValue({request,stop:vi.fn(async()=>{})})
 try{
  await memory.start();const broker=(memory as any).inference,address=broker.server.address(),call=()=>fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${broker.token}`,'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Same retention'}]})})
  const first=call(),second=call();await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
  await expect(memory.analyse('Later observer')).rejects.toThrow('limits reached')
  release({Output:[],Usage:{InputTokens:3,OutputTokens:1}})
  expect((await first).status).toBe(200);expect((await second).status).toBe(200);expect(request).toHaveBeenCalledTimes(1)
  await vi.waitFor(async()=>expect(await memory.status('')).toMatchObject({requests:1,inputTokens:3,outputTokens:1}))
 }finally{await memory.stop()}
})
it('charges observer tokens against later retention requests',async()=>{
 const memory=await setup(),value=(memory as any).value
 value.settings.profile={...value.settings.profile,requestLimit:10,tokenLimit:4};value.settings.verifiedProfile=(memory as any).fingerprint(value.settings.profile)
 const request=vi.fn(async()=>({Output:[],Usage:{InputTokens:3,OutputTokens:1}}));vi.spyOn(memory as any,'inferenceBridge').mockResolvedValue({request,stop:vi.fn(async()=>{})})
 try{await memory.start();const broker=(memory as any).inference,address=broker.server.address();await memory.analyse('Use the remaining token budget')
 const result=await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${broker.token}`,'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Later retention'}]})})
 expect(result.status).toBe(502);expect(request).toHaveBeenCalledTimes(1)
 }finally{await memory.stop()}
})
it('settles and cleans a late inference bridge before shutdown finishes',async()=>{
 const memory=await setup();let release!:()=>void,stopped=false
 bridgeControl.start.mockImplementationOnce(()=>new Promise<void>(resolve=>release=resolve))
 const opening=(memory as any).inferenceBridge();const rejected=expect(opening).rejects.toThrow('cancelled')
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 const stopping=memory.stop().then(()=>{stopped=true})
 await new Promise(resolve=>setTimeout(resolve,10));expect(stopped).toBe(false)
 await expect((memory as any).inferenceBridge()).rejects.toThrow('stopping')
 release();await rejected;await stopping;expect(bridgeControl.stop).toHaveBeenCalled();expect((memory as any).bridge).toBeUndefined()
})
it('still shuts down after a rejected metadata action',async()=>{
 const memory=await setup();await expect(memory.correct('','missing','Correction')).rejects.toThrow('Unknown memory')
 await expect(memory.stop()).resolves.toBeUndefined()
})
