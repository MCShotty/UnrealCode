import {expect,it,vi} from 'vitest'
vi.mock('./settings',()=>({credentialFor:()=>({apiKey:'fixture-only-secret'})}))
import {MemoryInference} from './memory-inference'
it('restricts memory inference and reuses identical requests at the budget boundary without leaking credentials',async()=>{
 const request=vi.fn(async()=>({ID:'fixture',Output:[{Type:'message',Data:{Text:'{"ok":true}'}}],Usage:{InputTokens:3,OutputTokens:2}}))
 const broker=new MemoryInference(()=>({provider:'openai',model:'fixture',baseUrl:'',thinkingLevel:'low',requestLimit:1,tokenLimit:100}),async()=>({request}) as any,()=>{})
 const base=(await broker.start()).replace('host.docker.internal','127.0.0.1'),body={messages:[{role:'user',content:'Synthetic check'}]}
 const call=(token=broker.token,value=body)=>fetch(`${base}/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(value)})
 try{expect((await call('untrusted')).status).toBe(403);expect(request).not.toHaveBeenCalled();const first=await (await call()).text();expect(first).toContain('ok');expect(first).not.toContain('fixture-only-secret');expect((await call()).status).toBe(200);expect(request).toHaveBeenCalledTimes(1);expect((await call(broker.token,{messages:[{role:'user',content:'different'}]})).status).toBe(502);expect(broker.inputTokens).toBe(3);expect(broker.outputTokens).toBe(2)}finally{broker.close()}
})

it('retries an identical memory request after a transient provider failure',async()=>{
 const request=vi.fn().mockRejectedValueOnce(new Error('transient provider failure')).mockResolvedValueOnce({ID:'recovered',Output:[{Type:'message',Data:{Text:'ready'}}],Usage:{InputTokens:2,OutputTokens:1}})
 const broker=new MemoryInference(()=>({provider:'openai',model:'fixture',baseUrl:'',thinkingLevel:'low',requestLimit:2,tokenLimit:100}),async()=>({request}) as any,()=>{})
 const base=(await broker.start()).replace('host.docker.internal','127.0.0.1')
 const call=()=>fetch(`${base}/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${broker.token}`,'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Retry this exact request'}]})})
 try{
  expect((await call()).status).toBe(502)
  const retried=await call()
  expect(retried.status).toBe(200)
  expect(await retried.text()).toContain('ready')
  expect(request).toHaveBeenCalledTimes(2)
  expect(broker.requests).toBe(2)
 }finally{broker.close()}
})
