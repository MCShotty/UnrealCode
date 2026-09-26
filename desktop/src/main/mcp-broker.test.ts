import { it,expect } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
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
const context={project:process.cwd(),container:'fixture'},config=(kind:ConnectionConfig['kind']):ConnectionConfig=>({id:randomUUID(),name:'Fixture',kind,args:[],auth:'none',timeoutMs:5000})
it('rejects credentials and insecure remote addresses in configuration',()=>{
 expect(()=>validateConnection({...config('remote'),url:'https://user:password@example.test/mcp'})).toThrow()
 expect(()=>validateConnection({...config('remote'),url:'http://example.test/mcp'})).toThrow()
 expect(()=>validateConnection({...config('remote'),url:'https://example.test/mcp?key=secret'})).toThrow()
})
it('requires host trust, passes only server credentials and validates arguments',async()=>{
 const secrets=new Secrets(),broker=new McpBroker(join(await mkdtemp(join(tmpdir(),'unrealcode-mcp-')),'connections.json'),secrets)
 const item={...config('host'),command:process.execPath,args:[resolve('scripts/fixture-mcp.mjs')]}
 await broker.put(item);await expect(broker.connect(context,item.id)).rejects.toThrow('Grant')
 await broker.grant(context,{connectionId:item.id,hostTrusted:true,tools:['echo'],resources:false,prompts:false})
 broker.setCredential(item.id,'',{FIXTURE_SECRET:'fixture-server-secret'})
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='unrelated-fixture-provider-credential'
 try {
  await broker.connect(context,item.id);const tool=broker.catalog(context).find(t=>t.enabled)!
  await expect(broker.call(context,tool,{text:42},new AbortController().signal)).rejects.toThrow('Arguments')
  const result=await broker.call(context,tool,{text:'hi'},new AbortController().signal)
  expect(result.text).toContain('hi');expect(result.text).toContain('[REDACTED]');expect(result.text).toContain('absent');expect(result.text).not.toContain('fixture-server-secret')
  await broker.revoke(context,item.id);await expect(broker.call(context,tool,{text:'blocked'},new AbortController().signal)).rejects.toThrow('Grant')
 } finally {if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;await broker.close()}
})
it('supports HTTP tools/resources/prompts, expiry, malformed results, and revocation cancellation',async()=>{
 let authorized=true,description='Echo text',waiting:()=>void=()=>{},started=new Promise<void>(resolve=>{waiting=resolve})
 const fixture=new Server({name:'fixture',version:'1'},{capabilities:{tools:{listChanged:true},resources:{},prompts:{}}})
 fixture.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',description,inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]}))
 fixture.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
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
  await broker.put(item);broker.setCredential(item.id,'fixture-http-token',{});await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:['echo'],resources:true,prompts:true});await broker.connect(context,item.id)
  const tool=broker.catalog(context).find(t=>t.enabled)!;expect((await broker.call(context,tool,{text:'works'},new AbortController().signal)).text).toContain('works')
  await expect(fixture.createMessage({messages:[{role:'user',content:{type:'text',text:'Do not run a model'}}],maxTokens:10})).rejects.toMatchObject({code:-32601})
  expect(await broker.resource(context,item.id,'fixture://notes')).toContain('fixture reference');expect(await broker.prompt(context,item.id,'review',{focus:'tests'})).toContain('Review fixture')
  await expect(broker.resource(context,item.id,'file:///private')).rejects.toThrow('advertised')
  await expect(broker.call(context,tool,{text:'malformed'},new AbortController().signal)).rejects.toThrow('invalid data')
  const pending=broker.call(context,tool,{text:'wait'},new AbortController().signal);void pending.catch(()=>{});await started
  await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:[],resources:true,prompts:true});await expect(pending).rejects.toThrow('cancelled')
  await broker.grant(context,{connectionId:item.id,hostTrusted:false,tools:['echo'],resources:true,prompts:true})
  description='Changed schema description';await fixture.sendToolListChanged()
  await new Promise(resolve=>setTimeout(resolve,100));expect(broker.catalog(context).find(t=>t.enabled)?.revision).not.toBe(tool.revision)
  authorized=false;await expect(broker.call(context,broker.catalog(context).find(t=>t.enabled)!,{text:'expired'},new AbortController().signal)).rejects.toThrow();expect(broker.views(context)[0].status).toBe('error')
 }finally{await broker.close();await fixture.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},15000)
