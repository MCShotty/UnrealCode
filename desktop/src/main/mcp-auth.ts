import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { ConnectionConfig } from '../shared/connections'
import type { ConnectionSecrets } from './connection-vault'

const loopback=(url:URL)=>['127.0.0.1','localhost','[::1]'].includes(url.hostname)
function savedRedirect(value:unknown):string{
  if(typeof value!=='string'||value.length>2048)return ''
  try{const url=new URL(value);if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)>0&&url.pathname==='/callback'&&!url.username&&!url.password&&!url.search&&!url.hash)return url.toString()}
  catch{/* Malformed saved callback data never becomes an authorization destination. */}
  return ''
}

export async function mcpFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const target = new URL(url)
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(target.hostname))) throw new Error('MCP authentication requires HTTPS or loopback')
  if (target.username || target.password) throw new Error('Credentials in endpoint URLs are not supported')
  const response = await fetch(target, { ...init, redirect: 'error' })
  if (!response.body) return response
  let bytes = 0
  const bounded = response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({ transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > 8 * 1024 * 1024) { controller.error(new Error('MCP response exceeds 8 MB')); return } controller.enqueue(chunk) } }))
  return new Response(bounded,{ status:response.status, statusText:response.statusText, headers:response.headers })
}

export class McpOAuth implements OAuthClientProvider {
  private server?: Server
  private redirect = ''
  private verifier = ''
  private nonce = ''
  private code?: Promise<string>
  private settle?: (code: string) => void
  private reject?: (reason: Error) => void
  private timer?: NodeJS.Timeout
  constructor(private config: ConnectionConfig,private secrets: ConnectionSecrets,private open: (url:string)=>Promise<void>,private interactive: boolean) {
    this.redirect = savedRedirect(this.secrets.get(config.id).redirect)
  }
  get redirectUrl(): string | undefined { return this.redirect || undefined }
  get clientMetadata(): OAuthClientMetadata { return { client_name:'UnrealCode', redirect_uris: this.redirect ? [this.redirect] : [], grant_types:['authorization_code','refresh_token'], response_types:['code'], token_endpoint_auth_method:'none' } }
  private get value() { return this.secrets.get(this.config.id) }
  private save(patch: Record<string,unknown>): void { this.secrets.set(this.config.id,{ ...this.value,...patch }) }
  state(): string { return this.nonce }
  clientInformation(): OAuthClientInformationMixed | undefined { return this.value.client as OAuthClientInformationMixed | undefined }
  saveClientInformation(client: OAuthClientInformationMixed): void { this.save({ client }) }
  tokens(): OAuthTokens | undefined { return this.value.tokens as OAuthTokens | undefined }
  saveTokens(tokens: OAuthTokens): void { this.save({ tokens }) }
  saveCodeVerifier(value: string): void { this.verifier = value }
  codeVerifier(): string { if (!this.verifier) throw new Error('OAuth verifier expired. Reconnect with sign-in.'); return this.verifier }
  discoveryState(): OAuthDiscoveryState | undefined { return this.value.discovery as OAuthDiscoveryState | undefined }
  saveDiscoveryState(discovery: OAuthDiscoveryState): void { this.save({ discovery }) }
  invalidateCredentials(scope: 'all'|'client'|'tokens'|'verifier'|'discovery'): void {
    if (scope === 'verifier') { this.verifier=''; return }
    const value = this.value
    if (scope === 'all') { this.secrets.remove(this.config.id); return }
    delete value[scope]; this.secrets.set(this.config.id,value)
  }
  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.interactive || !this.server || !this.nonce) throw new Error('Authentication required. Use Reconnect with sign-in.')
    const discovery = this.discoveryState()
    const issuer = discovery?.authorizationServerUrl
    let issuerURL:URL|undefined
    try{if(issuer)issuerURL=new URL(issuer)}catch{/* Invalid discovery data is rejected below. */}
    const allowed=(value:URL)=>value.protocol==='https:'||(value.protocol==='http:'&&loopback(value))
    if (!issuerURL||!allowed(issuerURL)||!allowed(url)||issuerURL.username||issuerURL.password||url.username||url.password||url.hash||issuerURL.origin!==url.origin||url.searchParams.get('state')!==this.nonce)throw new Error('Authorization URL failed issuer or state validation')
    await this.open(url.toString())
  }
  async signIn(): Promise<void> {
    if (!this.interactive) throw new Error('Sign-in requires a user action')
    this.nonce=randomBytes(32).toString('hex')
    this.code = new Promise<string>((resolve,reject)=> { this.settle=resolve; this.reject=reject })
    // Install a handler immediately so timeout cannot create an unhandled rejection.
    void this.code.catch(()=>{})
    try{
    this.server=createServer((request,response)=> {
      let url:URL
      try{url=new URL(request.url || '/','http://127.0.0.1')}
      catch{response.writeHead(400).end('Invalid OAuth callback');return}
      if (request.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== this.nonce) { response.writeHead(400).end('Invalid OAuth callback'); return }
      const code=url.searchParams.get('code')
      if (!code || code.length>8192 || url.searchParams.has('error')) { response.writeHead(400).end('Authorization declined'); this.reject?.(new Error('Authorization declined')); return }
      response.writeHead(200,{ 'Content-Type':'text/plain','Cache-Control':'no-store' }).end('Connected to UnrealCode. You can close this tab.'); this.settle?.(code); this.settle=undefined
    })
    await new Promise<void>((resolve,reject)=>{ this.server!.once('error',reject); this.server!.listen(0,'127.0.0.1',resolve) })
    const port=(this.server.address() as {port:number}).port
    const next=`http://127.0.0.1:${port}/callback`
    // Dynamic registrations often bind the exact redirect URI. Re-register when
    // using a new loopback port instead of reusing incompatible client metadata.
    if (this.redirect !== next) this.invalidateCredentials('client')
    this.redirect=next; this.save({ redirect:next })
    this.timer=setTimeout(()=>this.reject?.(new Error('Sign-in timed out; reconnect to retry')),180000)
      const result=await auth(this,{serverUrl:this.config.url!,fetchFn:mcpFetch})
      if (result === 'REDIRECT') await auth(this,{serverUrl:this.config.url!,authorizationCode:await this.code,fetchFn:mcpFetch})
    } finally {
      clearTimeout(this.timer);this.timer=undefined
      const server=this.server;this.server=undefined
      try{server?.closeAllConnections()}catch{}
      try{server?.close()}catch{}
      this.verifier='';this.nonce='';this.code=undefined;this.settle=undefined;this.reject=undefined
    }
  }
}
