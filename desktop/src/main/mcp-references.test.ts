import { expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { McpBroker } from './mcp-broker'

async function fixture(client: Record<string, unknown>) {
 const id=randomUUID(), context={project:'fixture-project',container:'fixture-container',workspace:'fixture-workspace'}
 const broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-reference-test-')),'connections.json'),{get:()=>({}),set:()=>{},remove:()=>{}})
 await broker.put({id,name:'Fixture',kind:'remote',url:'http://127.0.0.1/mcp',args:[],auth:'none',timeoutMs:5000})
 await broker.grant(context,{connectionId:id,hostTrusted:false,resources:true,prompts:true,tools:[]})
 const internal=broker as any
 internal.live.set(internal.key(context,id),{client:{...client,close:async()=>{}},calls:new Map(),names:new Set(),revision:'fixture',status:'connected'})
 return {broker,context,id}
}
it('cancels and discards a delayed resource or prompt when its grant changes',async()=>{
 for(const kind of ['resources','prompts'] as const){
  let resolve!:(value:unknown)=>void,signal:AbortSignal|undefined
  const {broker,context,id}=await fixture({
   listResources:async()=>({resources:[{name:'Note',uri:'fixture://note'}]}),listPrompts:async()=>({prompts:[{name:'review'}]}),
   readResource:(_params:unknown,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(done=>{resolve=done})},
   getPrompt:(_params:unknown,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(done=>{resolve=done})}
  })
  try{
   const pending=kind==='resources'?broker.resource(context,id,'fixture://note'):broker.prompt(context,id,'review',{})
   const checked=expect(pending).rejects.toThrow('access changed')
   while(!resolve)await new Promise(done=>setTimeout(done,1))
   await broker.grant(context,{connectionId:id,hostTrusted:false,resources:false,prompts:false,tools:[]})
   expect(signal?.aborted).toBe(true)
   resolve(kind==='resources'?{contents:[{uri:'fixture://note',text:'withdrawn'}]}:{messages:[{role:'user',content:{type:'text',text:'withdrawn'}}]})
   await checked
  }finally{await broker.close()}
 }
})
it('pages catalogs and rejects recycled, foreign and revoked cursors',async()=>{
 const {broker,context,id}=await fixture({listResources:async({cursor}:{cursor?:string})=>({resources:[{uri:cursor?'fixture://two':'fixture://one',name:cursor?'Two':'One'}],nextCursor:cursor?undefined:'second'}),readResource:async({uri}:{uri:string})=>({contents:[{uri,text:'page two'}]}),listPrompts:async()=>({prompts:[{name:'review'}],nextCursor:'repeat'})})
 try{
  const first=await broker.resources(context,id),second=await broker.resources(context,id,first.nextCursor)
  expect(first.items[0].name).toBe('One');expect(second.items[0].name).toBe('Two');expect(second.nextCursor).toBeUndefined()
  expect(await broker.resource(context,id,'fixture://two')).toContain('page two')
  await expect(broker.resources({...context,workspace:'another'},id,first.nextCursor)).rejects.toThrow('expired')
  const prompts=await broker.prompts(context,id)
  await expect(broker.prompts(context,id,prompts.nextCursor)).rejects.toThrow('repeated')
  await broker.grant(context,{connectionId:id,hostTrusted:false,resources:true,prompts:true,tools:[]})
  await expect(broker.resources(context,id,first.nextCursor)).rejects.toThrow('expired')
 }finally{await broker.close()}
})
