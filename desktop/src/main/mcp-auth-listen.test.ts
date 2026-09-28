import {randomUUID} from 'node:crypto'
import {expect,it,vi} from 'vitest'

const calls=vi.hoisted(()=>({close:vi.fn(),closeAllConnections:vi.fn()}))
vi.mock('node:http',async()=>{
 const {EventEmitter}=await import('node:events')
 return {createServer:()=>{
  const server=new EventEmitter() as InstanceType<typeof EventEmitter>&{listen:(port:number,host:string,done:()=>void)=>void;close:()=>void;closeAllConnections:()=>void}
  server.listen=()=>queueMicrotask(()=>server.emit('error',Error('callback port unavailable')))
  server.close=calls.close;server.closeAllConnections=calls.closeAllConnections
  return server
 }}
})
import {McpOAuth} from './mcp-auth'

it('clears callback listener and sign-in state when listener startup fails',async()=>{
 const config={id:randomUUID(),name:'OAuth fixture',kind:'remote' as const,url:'https://fixture.example/mcp',auth:'oauth' as const,args:[],timeoutMs:5000}
 const secrets={get:()=>({}),set:()=>{},remove:()=>{}}
 const provider=new McpOAuth(config,secrets,async()=>{},true)
 await expect(provider.signIn()).rejects.toThrow('callback port unavailable')
 expect(calls.closeAllConnections).toHaveBeenCalled()
 expect(calls.close).toHaveBeenCalled()
 expect((provider as any).server).toBeUndefined()
 expect(provider.state()).toBe('')
})
