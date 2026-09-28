import { afterEach,it,expect,vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp,writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { ListToolsRequestSchema,CallToolRequestSchema,ListResourcesRequestSchema,ReadResourceRequestSchema,ListPromptsRequestSchema,GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpBroker,validateConnection } from './mcp-broker'
import type { ConnectionConfig } from '../shared/connections'
import type { ConnectionSecrets } from './connection-vault'

class Secrets implements ConnectionSecrets { values=new Map<string,Record<string,unknown>>(); get(id:string){return structuredClone(this.values.get(id)||{})};set(id:string,value:Record<string,unknown>){this.values.set(id,structuredClone(value))};remove(id:string){this.values.delete(id)} }
afterEach(()=>vi.restoreAllMocks())
const context={project:process.cwd(),container:'fixture'},config=(kind:ConnectionConfig['kind']):ConnectionConfig=>({id:randomUUID(),name:'Fixture',kind,args:[],auth:'none',timeoutMs:5000})
async function selectEcho(broker:McpBroker,id:string,hostTrusted=false,resources=false,prompts=false){
 const tool=broker.views(context).find(item=>item.id===id)?.tools.find(item=>item.current&&item.remoteName==='echo')
 if(!tool)throw Error('Fixture echo tool was not discovered')
 await broker.grant(context,{connectionId:id,hostTrusted,tools:['echo'],toolRevisions:{echo:tool.revision},resources,prompts})
 return broker.catalog(context,id).find(item=>item.name===tool.name)!
}
it('rejects credentials and insecure remote addresses in configuration',()=>{
 expect(()=>validateConnection({...config('remote'),url:'https://user:password@example.test/mcp'})).toThrow()
 expect(()=>validateConnection({...config('remote'),url:'http://example.test/mcp'})).toThrow()
 expect(()=>validateConnection({...config('remote'),url:'https://example.test/mcp?key=secret'})).toThrow()
})
it('rejects malformed persisted MCP grants while preserving the original file',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-damaged-grant-')),'connections.json')
 const item={...config('remote'),url:'https://example.test/mcp'}
 const original=JSON.stringify({version:1,connections:[item],grants:[{project:context.project,connectionId:item.id,tools:'write',hostTrusted:true,resources:true,prompts:true,revision:1}],catalog:[]})
 await writeFile(path,original)
 expect(()=>new McpBroker(path,new Secrets())).toThrow('Invalid saved connection grant')
 expect(await readFile(path,'utf8')).toBe(original)
})
it('loads legacy name-only grants without treating them as reviewed tool definitions',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-legacy-grant-')),'connections.json'),item={...config('remote'),url:'https://example.test/mcp'}
 await writeFile(path,JSON.stringify({version:1,connections:[item],grants:[{project:context.project,connectionId:item.id,hostTrusted:false,tools:['echo'],resources:false,prompts:false,revision:1}],catalog:[]}))
 const broker=new McpBroker(path,new Secrets())
 try{
  expect(broker.grantFor(context.project,item.id)?.tools).toEqual(['echo'])
  expect(broker.grantFor(context.project,item.id)?.toolRevisions).toEqual({})
  await expect(broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:['echo'],resources:false,prompts:false})).rejects.toThrow('advertised')
 }finally{await broker.close()}
})
it('does not pre-authorize an MCP tool name before its definition is discovered',async()=>{
 const broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-pregrant-')),'connections.json'),new Secrets())
 const item={...config('remote'),url:'https://example.test/mcp'}
 try{
  await broker.put(item)
  await expect(broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:['future_write'],resources:false,prompts:false})).rejects.toThrow('advertised')
  expect(broker.grantFor(context.project,item.id)).toBeUndefined()
  await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:false,prompts:false})
 }finally{await broker.close()}
})
it('rejects short MCP credential values that cannot be safely redacted',async()=>{
 const broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-short-')),'connections.json'),new Secrets())
 const item={...config('remote'),url:'https://example.test/mcp'}
 await broker.put(item)
 expect(()=>broker.setCredential(item.id,'abc',{})).toThrow('at least 8')
 expect(()=>broker.setCredential(item.id,'',{SHORT_SECRET:'abc'})).toThrow('at least 8')
})
it('keeps connection settings accessible when the encrypted credential store cannot be read',async()=>{
 const secrets=new Secrets(),broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-vault-unavailable-')),'connections.json'),secrets)
 const item={...config('remote'),url:'https://example.test/mcp'}
 try{
  await broker.put(item)
  vi.spyOn(secrets,'get').mockImplementationOnce(()=>{throw Error('Windows credential encryption unavailable')})
  const views=broker.views(context)
  expect(views).toHaveLength(1)
  expect(views[0].credentialState).toBe('unavailable')
 }finally{await broker.close()}
})
it('persists connection and grant changes when renderer notifications fail',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-notify-')),'connections.json'),broker=new McpBroker(path,new Secrets())
 const item={...config('remote'),url:'https://example.test/mcp'}
 broker.onChanged=()=>{throw Error('renderer closed')}
 try{
  await broker.put(item)
  await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:false,prompts:false})
  const reopened=new McpBroker(path,new Secrets())
  try{expect(reopened.views(context)[0].grant?.connectionId).toBe(item.id)}finally{await reopened.close()}
 }finally{await broker.close()}
})
it('keeps the previous MCP grant when its metadata save fails',async()=>{
 const broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-failed-grant-')),'connections.json'),new Secrets())
 const item={...config('remote'),url:'https://example.test/mcp'}
 try{
  await broker.put(item)
  const initial={connectionId:item.id,hostTrusted:false,tools:[],resources:false,prompts:false}
  await broker.grant(context,initial)
  vi.spyOn(broker as any,'save').mockImplementationOnce(()=>{throw Error('disk full')})
  await expect(broker.grant(context,{...initial,resources:true})).rejects.toThrow('disk full')
  expect(broker.grantFor(context.project,item.id)?.tools).toEqual([])
  expect(broker.grantFor(context.project,item.id)?.resources).toBe(false)
 }finally{await broker.close()}
})
it('preserves a connection, its grant, and its credential after a failed edit or removal',async()=>{
 const secrets=new Secrets(),broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-failed-edit-')),'connections.json'),secrets)
 const item={...config('remote'),url:'https://example.test/mcp'}
 try{
  await broker.put(item)
  await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:false,prompts:false})
  broker.setCredential(item.id,'fixture-secret-value',{})
  const save=vi.spyOn(broker as any,'save').mockImplementationOnce(()=>{throw Error('disk full')})
  await expect(broker.put({...item,name:'Changed'})).rejects.toThrow('disk full')
  expect(broker.views(context)[0].name).toBe('Fixture')
  expect(broker.grantFor(context.project,item.id)?.tools).toEqual([])
  expect(secrets.get(item.id).bearer).toBe('fixture-secret-value')
  save.mockImplementationOnce(()=>{throw Error('disk full')})
  await expect(broker.remove(item.id)).rejects.toThrow('disk full')
  expect(broker.views(context)).toHaveLength(1)
  expect(broker.grantFor(context.project,item.id)?.tools).toEqual([])
  expect(secrets.get(item.id).bearer).toBe('fixture-secret-value')
 }finally{await broker.close()}
})
it('does not connect a changed MCP endpoint with an old credential when credential cleanup fails',async()=>{
 const secrets=new Secrets(),broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-credential-cleanup-')),'connections.json'),secrets)
 const item={...config('remote'),url:'https://old.example/mcp'}
 try{
  await broker.put(item)
  broker.setCredential(item.id,'fixture-old-server-token',{})
  vi.spyOn(secrets,'remove').mockImplementationOnce(()=>{throw Error('credential store unavailable')})
  await expect(broker.put({...item,url:'https://new.example/mcp'})).rejects.toThrow('credential store unavailable')
  expect(broker.views(context)[0].url).toBe('https://old.example/mcp')
  expect(secrets.get(item.id).bearer).toBe('fixture-old-server-token')
 }finally{await broker.close()}
})
it('stops live project MCP calls even when revocation cannot be saved',async()=>{
 const broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-failed-revoke-')),'connections.json'),new Secrets())
 const item={...config('remote'),url:'https://example.test/mcp'}
 try{
  await broker.put(item)
  await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:false,prompts:false})
  const call=new AbortController(),close=vi.fn(async()=>{})
  const key=JSON.stringify([context.project,context.container,item.id])
  ;(broker as any).live.set(key,{client:{close},calls:new Map([[call,'echo']]),status:'connected'})
  vi.spyOn(broker as any,'save').mockImplementationOnce(()=>{throw Error('disk full')})
  await expect(broker.revoke(context,item.id)).rejects.toThrow('disk full')
  expect(call.signal.aborted).toBe(true)
  expect(close).toHaveBeenCalled()
  expect(broker.grantFor(context.project,item.id)).toBeDefined()
 }finally{await broker.close()}
})
it('does not finish connecting after its project grant is revoked',async()=>{
 const broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-race-')),'connections.json'),new Secrets())
 const item={...config('remote'),auth:'oauth' as const,url:'https://example.test/mcp'}
 await broker.put(item)
 await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:false,prompts:false})
 let entered!:()=>void,release!:()=>void
 const started=new Promise<void>(resolve=>{entered=resolve})
 const gate=new Promise<any>(resolve=>{release=()=>resolve({})})
 broker.oauth=async()=>{entered();return gate}
 const pending=broker.connect(context,item.id,true)
 try{
  await started
  await broker.revoke(context,item.id)
  release()
  await expect(pending).rejects.toThrow()
  expect(broker.views(context)[0].status).toBe('disconnected')
 }finally{release();await pending.catch(()=>{});await broker.close()}
})
it('redacts credentials echoed inside nested JSON text',async()=>{
 const broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-escaped-')),'connections.json'),new Secrets())
 const item={...config('host'),command:process.execPath,args:[resolve('scripts/fixture-mcp.mjs')]}
 const secret='fixture"slash\\secret'
 try{
  await broker.put(item)
  await broker.grant(context,{connectionId:item.id,hostTrusted:true,tools:[],resources:false,prompts:false})
  broker.setCredential(item.id,'',{FIXTURE_SECRET:secret})
  await broker.connect(context,item.id)
  const tool=await selectEcho(broker,item.id,true)
  const result=await broker.call(context,tool,{text:'hello'},new AbortController().signal)
  expect(result.text).toContain('[REDACTED]')
  expect(result.text).not.toContain('fixture')
 }finally{await broker.close()}
})
it('requires host trust, passes only server credentials and validates arguments',async()=>{
 const secrets=new Secrets(),broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-')),'connections.json'),secrets)
 const item={...config('host'),command:process.execPath,args:[resolve('scripts/fixture-mcp.mjs')]}
 await broker.put(item);await expect(broker.connect(context,item.id)).rejects.toThrow('Grant')
 await broker.grant(context,{connectionId:item.id,hostTrusted:true,tools:[],resources:false,prompts:false})
 broker.setCredential(item.id,'',{FIXTURE_SECRET:'fixture-server-secret'})
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='unrelated-fixture-provider-credential'
 try {
  const sibling={...context,container:'fixture-sibling'}
  await broker.connect(context,item.id);await broker.connect(sibling,item.id)
  await selectEcho(broker,item.id,true)
  expect(broker.views(sibling)[0].status).toBe('connected')
  const tool=broker.catalog(context).find(t=>t.enabled)!
  await expect(broker.call(context,tool,{text:42},new AbortController().signal)).rejects.toThrow('Arguments')
  const result=await broker.call(context,tool,{text:'hi'},new AbortController().signal)
  expect(result.text).toContain('hi');expect(result.text).toContain('[REDACTED]');expect(result.text).toContain('absent');expect(result.text).not.toContain('fixture-server-secret')
  await broker.revoke(context,item.id)
  expect(broker.views(sibling)[0].status).toBe('disconnected')
  await expect(broker.call(context,tool,{text:'blocked'},new AbortController().signal)).rejects.toThrow('Grant')
  await selectEcho(broker,item.id,true)
  await broker.connect(context,item.id);await broker.connect(sibling,item.id)
  await selectEcho(broker,item.id,false)
  expect(broker.views(sibling)[0].status).toBe('disconnected')
  await selectEcho(broker,item.id,true)
  await broker.connect(context,item.id)
  await broker.disconnectAll()
  await broker.connect(context,item.id)
  expect((await broker.call(context,broker.catalog(context).find(t=>t.enabled)!,{text:'after maintenance'},new AbortController().signal)).text).toContain('after maintenance')
 } finally {if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;await broker.close()}
})
it('supports HTTP tools/resources/prompts, expiry, malformed results, and revocation cancellation',async()=>{
 let authorized=true,description='Echo text',textPattern:string|undefined,serverCalls=0,waiting:()=>void=()=>{},started=new Promise<void>(resolve=>{waiting=resolve})
 const fixture=new Server({name:'fixture',version:'1'},{capabilities:{tools:{listChanged:true},resources:{},prompts:{}}})
 fixture.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',description,inputSchema:{type:'object',properties:{text:{type:'string',...(textPattern?{pattern:textPattern}:{})}},required:['text']}}]}))
 fixture.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  serverCalls++
  if(request.params.arguments?.text==='wait'){waiting();await new Promise<void>(resolve=>extra.signal.addEventListener('abort',()=>resolve(),{once:true}))}
  if(request.params.arguments?.text==='malformed')return{content:[{type:'invalid',value:3}]} as never
  return{content:[{type:'text',text:String(request.params.arguments?.text)}]}
 })
 fixture.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri:'fixture://notes',name:'Notes'}]}));fixture.setRequestHandler(ReadResourceRequestSchema,async()=>({contents:[{uri:'fixture://notes',text:'fixture reference'}]}))
 fixture.setRequestHandler(ListPromptsRequestSchema,async()=>({prompts:[{name:'review',arguments:[{name:'focus',required:true}]}]}));fixture.setRequestHandler(GetPromptRequestSchema,async()=>({messages:[{role:'user',content:{type:'text',text:'Review fixture'}}]}))
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true});await fixture.connect(transport)
 const server=createServer(async(req,res)=>{if(!authorized||req.headers.authorization!=='Bearer fixture-http-token'){res.writeHead(401).end();return}try{
  let body='';for await(const part of req)body+=part
  const headers=new Headers();for(const[key,value]of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value)
  const response=await transport.handleRequest(new Request('http://127.0.0.1/mcp',{method:req.method,headers,...(body?{body}:{})}))
  response.headers.forEach((value,key)=>{if(!['content-length','transfer-encoding'].includes(key))res.setHeader(key,value)})
  res.statusCode=response.status
  if(response.body){const reader=response.body.getReader();res.on('close',()=>void reader.cancel().catch(()=>{}));for(;;){const{done,value}=await reader.read();if(done)break;res.write(value)}}res.end()
 }catch{if(!res.headersSent)res.writeHead(500);res.end()}})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-http-')),'connections.json'),new Secrets()),item={...config('remote'),auth:'bearer' as const,url:`http://127.0.0.1:${(server.address() as {port:number}).port}/mcp`}
 try{
  await broker.put(item);broker.setCredential(item.id,'fixture-http-token',{});await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:true,prompts:true});await broker.connect(context,item.id);await selectEcho(broker,item.id,false,true,true)
  const tool=broker.catalog(context).find(t=>t.enabled)!;expect((await broker.call(context,tool,{text:'works'},new AbortController().signal)).text).toContain('works')
  await expect(fixture.createMessage({messages:[{role:'user',content:{type:'text',text:'Do not run a model'}}],maxTokens:10})).rejects.toMatchObject({code:-32601})
  expect(await broker.resource(context,item.id,'fixture://notes')).toContain('fixture reference');expect(await broker.prompt(context,item.id,'review',{focus:'tests'})).toContain('Review fixture')
  await expect(broker.resource(context,item.id,'file:///private')).rejects.toThrow('advertised')
  await expect(broker.call(context,tool,{text:'malformed'},new AbortController().signal)).rejects.toThrow('invalid data')
  const pending=broker.call(context,tool,{text:'wait'},new AbortController().signal);void pending.catch(()=>{});await started
  await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:true,prompts:true});await expect(pending).rejects.toThrow('cancelled')
  await selectEcho(broker,item.id,false,true,true)
  description='Changed schema description';await fixture.sendToolListChanged()
  await vi.waitFor(()=>expect(broker.views(context)[0].tools.find(t=>t.current)?.revision).not.toBe(tool.revision),{timeout:5000})
  expect(broker.catalog(context).some(t=>t.enabled)).toBe(false)
  const oldGrant=broker.grantFor(context.project,item.id)!
  await expect(broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:oldGrant.tools,toolRevisions:oldGrant.toolRevisions,resources:false,prompts:true})).rejects.toThrow('advertised')
  const callsAfterRefresh=serverCalls
  await expect(broker.call(context,tool,{text:'stale definition'},new AbortController().signal)).rejects.toThrow('definition')
  expect(serverCalls).toBe(callsAfterRefresh)
  const beforeRegex=await selectEcho(broker,item.id,false,true,true)
  textPattern='^(a+)+$';await fixture.sendToolListChanged()
  await vi.waitFor(()=>expect(broker.views(context)[0].tools.find(t=>t.current)?.revision).not.toBe(beforeRegex.revision),{timeout:5000})
  expect(broker.catalog(context).some(t=>t.enabled)).toBe(false)
  const regexTool=await selectEcho(broker,item.id,false,true,true),callsBefore=serverCalls
  const stalled=broker.call(context,regexTool,{text:'a'.repeat(100)+'!'},new AbortController().signal)
  let mainTimerRan=false;await new Promise<void>(resolve=>setTimeout(()=>{mainTimerRan=true;resolve()},20));expect(mainTimerRan).toBe(true)
  await expect(stalled).rejects.toThrow('timed out');expect(serverCalls).toBe(callsBefore)
  await expect(broker.call(context,regexTool,{text:'a'.repeat(100)+'!'},new AbortController().signal)).rejects.toThrow('previously timed out')
  description='Revocation during validation';await fixture.sendToolListChanged()
  await vi.waitFor(()=>expect(broker.views(context)[0].tools.find(t=>t.current)?.revision).not.toBe(regexTool.revision),{timeout:5000})
  const nextRegexTool=await selectEcho(broker,item.id,false,true,true)
  const revokedDuringValidation=broker.call(context,nextRegexTool,{text:'a'.repeat(100)+'!'},new AbortController().signal)
  await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:true,prompts:true})
  await expect(revokedDuringValidation).rejects.toThrow('cancelled');expect(serverCalls).toBe(callsBefore)
  await selectEcho(broker,item.id,false,true,true)
  textPattern=undefined;await fixture.sendToolListChanged()
  await vi.waitFor(()=>expect(broker.views(context)[0].tools.find(t=>t.current)?.revision).not.toBe(nextRegexTool.revision),{timeout:5000})
  await selectEcho(broker,item.id,false,true,true)
  authorized=false;await expect(broker.call(context,broker.catalog(context).find(t=>t.enabled)!,{text:'expired'},new AbortController().signal)).rejects.toThrow();expect(broker.views(context)[0].status).toBe('error')
 }finally{await broker.close();await fixture.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},15000)
