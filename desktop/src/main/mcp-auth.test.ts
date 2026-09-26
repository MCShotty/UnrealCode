import { it,expect } from 'vitest'
import { createServer } from 'node:http'
import { randomUUID,createHash } from 'node:crypto'
import { McpOAuth } from './mcp-auth'

it('performs scoped OAuth with PKCE, rejects wrong state, and keeps tokens out of connection metadata',async()=>{
 let issuer='',challenge='',exchanged=false,opened=false
 const saved=new Map<string,Record<string,unknown>>()
 const secrets={get:(id:string)=>structuredClone(saved.get(id)||{}),set:(id:string,value:Record<string,unknown>)=>{saved.set(id,structuredClone(value))},remove:(id:string)=>{saved.delete(id)}}
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json'); const send=(value:unknown)=>{const text=JSON.stringify(value);res.write(text);res.end()}
  const path=new URL(req.url||'/',issuer).pathname
  if(path.startsWith('/.well-known/oauth-protected-resource')){send({resource:`${issuer}/mcp`,authorization_servers:[issuer]});return}
  if(path.startsWith('/.well-known/oauth-authorization-server')){send({issuer,authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,registration_endpoint:`${issuer}/register`,response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});return}
  let body='';for await(const part of req)body+=part
  if(path==='/register'){send({...JSON.parse(body),client_id:'fixture-client'});return}
  if(path==='/token'){const values=new URLSearchParams(body);expect(values.get('code')).toBe('fixture-code');expect(createHash('sha256').update(values.get('code_verifier')||'').digest('base64url')).toBe(challenge);exchanged=true;send({access_token:'fixture-oauth-access',refresh_token:'fixture-oauth-refresh',token_type:'Bearer',expires_in:3600});return}
  res.writeHead(404).end('{}')
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));issuer=`http://127.0.0.1:${(server.address() as {port:number}).port}`
 const config={id:randomUUID(),name:'OAuth fixture',kind:'remote' as const,url:`${issuer}/mcp`,auth:'oauth' as const,args:[],timeoutMs:5000}
 const provider=new McpOAuth(config,secrets,async value=>{
  opened=true;const url=new URL(value);challenge=url.searchParams.get('code_challenge')||''
  const callback=new URL(url.searchParams.get('redirect_uri')!);callback.searchParams.set('code','fixture-code');callback.searchParams.set('state','wrong')
  expect((await fetch(callback)).status).toBe(400);callback.searchParams.set('state',url.searchParams.get('state')!);expect((await fetch(callback)).status).toBe(200)
 },true)
 try{await provider.signIn();expect(opened&&exchanged).toBe(true);expect(provider.tokens()?.access_token).toBe('fixture-oauth-access');expect(JSON.stringify(config)).not.toContain('fixture-oauth-access');await expect(new McpOAuth(config,secrets,async()=>{},false).redirectToAuthorization(new URL(`${issuer}/authorize`))).rejects.toThrow('Reconnect')}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},15000)
