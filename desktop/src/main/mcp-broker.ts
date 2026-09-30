import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ContainerMcpTransport } from './mcp-container-transport'
import type { ConnectionSecrets } from './connection-vault'
import type { CatalogTool, ConnectionConfig, ConnectionGrant, ConnectionView, HostResult, ConnectionPage, ConnectionResource, ConnectionPrompt } from '../shared/connections'
import { stableJSON } from './host-operations'
import { mcpFetch } from './mcp-auth'
import { McpSchemaValidator } from './mcp-schema-validator'
import { readBoundedJSONSync } from './bounded-file-read'

type Stored = { version: 1; connections: ConnectionConfig[]; grants: ConnectionGrant[]; catalog: CatalogTool[] }
type Live = { client: Client; transport: Transport; revision: string; status: ConnectionView['status']; message: string; calls: Map<AbortController,string>; names: Set<string>; dirty?:boolean }
type Context = { project: string; container: string; workspace?:string }
const idPattern = /^[a-f0-9-]{36}$/
const hash = (value: unknown) => createHash('sha256').update(stableJSON(value)).digest('hex')
const authenticationError = (error: unknown) => error instanceof UnauthorizedError || (error instanceof StreamableHTTPError && [401,403].includes(error.code || 0)) || /unauthorized|401|403|authorization/i.test(String(error))
export function validateConnection(value: ConnectionConfig): ConnectionConfig {
  if (!value || !idPattern.test(value.id) || !['remote','host','container'].includes(value.kind) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || !Array.isArray(value.args) || value.args.length > 64 || value.args.some(item => typeof item !== 'string' || item.length > 8192 || item.includes('\0'))) throw new Error('Invalid connection configuration')
  if (!['none','bearer','oauth'].includes(value.auth) || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1000 || value.timeoutMs > 300000) throw new Error('Choose an authentication method and a timeout from 1 to 300 seconds')
  if (value.kind === 'remote') {
    const url = new URL(value.url || '')
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS MCP endpoint (HTTP is allowed only on loopback); put credentials in the credential field')
    return { id: value.id, name: value.name.trim(), kind: value.kind, url: url.toString(), args: [], auth: value.auth, timeoutMs: value.timeoutMs }
  }
  if (typeof value.command !== 'string' || !value.command.trim() || value.command.length > 2048 || /[\r\n\0]/.test(value.command) || value.auth === 'oauth') throw new Error('Stdio connections need an executable and arguments; OAuth is for remote connections')
  return { id: value.id, name: value.name.trim(), kind: value.kind, command: value.command, args: [...value.args], auth: value.auth, timeoutMs: value.timeoutMs }
}
function validateStored(value:unknown):Stored{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Unsupported connection data; restore a backup')
  const stored=value as Stored
  if(stored.version!==1||!Array.isArray(stored.connections)||stored.connections.length>1000||!Array.isArray(stored.grants)||stored.grants.length>10000||!Array.isArray(stored.catalog)||stored.catalog.length>20000)throw Error('Unsupported connection data; restore a backup')
  const connections=stored.connections.map(validateConnection),ids=new Set(connections.map(item=>item.id))
  if(ids.size!==connections.length)throw Error('Duplicate saved connection identity')
  const grants:ConnectionGrant[]=[],grantKeys=new Set<string>()
  for(const item of stored.grants){
    if(!item||typeof item!=='object'||typeof item.project!=='string'||!item.project||item.project.length>32768||typeof item.connectionId!=='string'||!ids.has(item.connectionId)||typeof item.hostTrusted!=='boolean'||typeof item.resources!=='boolean'||typeof item.prompts!=='boolean'||!Number.isSafeInteger(item.revision)||item.revision<1||!Array.isArray(item.tools)||item.tools.length>1000||item.tools.some(name=>typeof name!=='string'||!name||name.length>256))throw Error('Invalid saved connection grant')
    const key=stableJSON([item.project,item.connectionId]);if(grantKeys.has(key))throw Error('Duplicate saved connection grant');grantKeys.add(key)
    const revisions=item.toolRevisions||{}
    if(!revisions||typeof revisions!=='object'||Array.isArray(revisions)||Object.entries(revisions).some(([name,revision])=>!item.tools.includes(name)||typeof revision!=='string'||!(/^[a-f0-9]{64}$/).test(revision)))throw Error('Invalid saved connection grant')
    grants.push({project:item.project,connectionId:item.connectionId,hostTrusted:item.hostTrusted,resources:item.resources,prompts:item.prompts,revision:item.revision,tools:[...new Set(item.tools)],toolRevisions:{...revisions}})
  }
  const catalog:CatalogTool[]=[],names=new Set<string>()
  for(const item of stored.catalog){
    if(!item||typeof item!=='object'||typeof item.name!=='string'||!item.name||item.name.length>256||typeof item.remoteName!=='string'||!item.remoteName||item.remoteName.length>256||typeof item.connectionId!=='string'||!ids.has(item.connectionId)||typeof item.connectionRevision!=='string'||!(/^[a-f0-9]{64}$/).test(item.connectionRevision)||typeof item.revision!=='string'||!(/^[a-f0-9]{64}$/).test(item.revision)||typeof item.description!=='string'||item.description.length>8000||!item.inputSchema||typeof item.inputSchema!=='object'||Array.isArray(item.inputSchema)||typeof item.enabled!=='boolean')throw Error('Invalid saved MCP tool catalog')
    if(names.has(item.name))throw Error('Duplicate saved MCP tool name');names.add(item.name)
    catalog.push({name:item.name,remoteName:item.remoteName,connectionId:item.connectionId,connectionRevision:item.connectionRevision,revision:item.revision,description:item.description,inputSchema:item.inputSchema,enabled:item.enabled})
  }
  return {version:1,connections,grants,catalog}
}
export class McpBroker {
  private schemas = new McpSchemaValidator()
  private stored: Stored = { version: 1, connections: [], grants: [], catalog: [] }
  private live = new Map<string, Live>()
  private connecting = new Set<string>()
  private referenceReads = new Map<AbortController, { project: string; id: string }>()
  private referencePages = new Map<string, { scope: string; kind: 'resources' | 'prompts'; revision: number; live: Live; cursor: string; seen: string[]; count: number; expires: number }>()
  private advertised = new WeakMap<Live, { revision: number; resources: Set<string>; prompts: Set<string> }>()
  cancelReferences(id: string, project?: string): void {
    for (const [controller, owner] of this.referenceReads) if (owner.id === id && (project === undefined || owner.project === project)) controller.abort()
  }
  onChanged: () => void = () => {}
  private notify(): void { try { this.onChanged() } catch { /* Window teardown cannot change connection or grant state. */ } }
  oauth?: (config: ConnectionConfig, interactive: boolean) => Promise<OAuthClientProvider>
  constructor(private path: string, private secrets: ConnectionSecrets) {
    if (existsSync(path)) this.stored=validateStored(readBoundedJSONSync<unknown>(path,64*1024*1024))
  }
  private key(context: Context, id: string): string { return stableJSON([context.project, context.container, id]) }
  private save(next:Stored): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${randomUUID()}.tmp`
    try { const encoded=JSON.stringify(next);if(Buffer.byteLength(encoded)>64*1024*1024)throw Error('Saved connection catalog exceeds its safe size limit');writeFileSync(temp, encoded, { mode: 0o600 }); renameSync(temp, this.path) }
    finally { try { unlinkSync(temp) } catch { /* The original write error remains authoritative. */ } }
    this.stored=next;this.notify()
  }
  private saveAfterCredentialRemoval(id:string,next:Stored):void{
    const previous=this.secrets.get(id)
    if(!Object.keys(previous).length){this.save(next);return}
    this.secrets.remove(id)
    try{this.save(next)}
    catch(error){
      try{this.secrets.set(id,previous)}
      catch{throw new Error('Connection metadata was preserved, but its credential could not be restored. Re-enter the server credential before reconnecting.',{cause:error})}
      throw error
    }
  }
  private config(id: string): ConnectionConfig { const value = this.stored.connections.find(item => item.id === id); if (!value) throw new Error('Connection not found'); return value }
  grantFor(project: string, id: string): ConnectionGrant | undefined { return this.stored.grants.find(item => item.project === project && item.connectionId === id) }
  private allowed(context: Context, id: string): ConnectionGrant { const config = this.config(id), grant = this.grantFor(context.project, id); if (!grant || (config.kind === 'host' && !grant.hostTrusted)) throw new Error('Grant this project access in Connections before connecting'); return grant }
  views(context: Context): ConnectionView[] {
    return this.stored.connections.map(config => { const live=this.live.get(this.key(context,config.id));let credentialState:ConnectionView['credentialState']='none';try{if(Object.keys(this.secrets.get(config.id)).length)credentialState='saved'}catch{credentialState='unavailable'}return {...structuredClone(config),status:live?.status||'disconnected',message:live?.message||'Connect explicitly to start this server',hasCredential:credentialState==='saved',credentialState,tools:this.catalog(context,config.id).map(tool=>({...tool,current:this.stored.catalog.find(item=>item.name===tool.name)?.enabled||false})),grant:structuredClone(this.grantFor(context.project,config.id))} })
  }
  async put(value: ConnectionConfig): Promise<void> {
    const config = validateConnection(value), previous = this.stored.connections.find(item => item.id === config.id)
    await this.disconnect(config.id)
    const changed=!!previous&&hash(previous)!==hash(config)
    const next={...this.stored,connections:[...this.stored.connections.filter(item=>item.id!==config.id),config],grants:changed?this.stored.grants.filter(item=>item.connectionId!==config.id):this.stored.grants,catalog:changed?this.stored.catalog.filter(item=>item.connectionId!==config.id):this.stored.catalog}
    if(changed)this.saveAfterCredentialRemoval(config.id,next)
    else this.save(next)
  }
  async remove(id: string): Promise<void> { this.config(id); await this.disconnect(id); this.saveAfterCredentialRemoval(id,{...this.stored,connections:this.stored.connections.filter(item=>item.id!==id),grants:this.stored.grants.filter(item=>item.connectionId!==id),catalog:this.stored.catalog.filter(item=>item.connectionId!==id)}) }
  windowsAddons(){return this.stored.connections.filter(c=>c.kind==='host'&&/windows.?mcp|mcp.?windows/i.test(`${c.name} ${c.command}`)).map(c=>({id:c.id,name:c.name}))}
  async withdrawWindowsAddons(ids:string[]){if(!Array.isArray(ids)||ids.some(id=>!this.windowsAddons().some(c=>c.id===id)))throw Error('Review the Windows add-on list first');for(const id of ids){await this.disconnect(id);this.cancelReferences(id)}this.save({...this.stored,grants:this.stored.grants.filter(grant=>!ids.includes(grant.connectionId))})}
  async revoke(context: Context,id:string): Promise<void> {
    this.config(id)
    this.cancelReferences(id, context.project)
    await this.disconnectProject(context.project,id)
    this.save({...this.stored,grants:this.stored.grants.filter(item=>!(item.project===context.project&&item.connectionId===id))})
  }
  async grant(context: Context, input: Omit<ConnectionGrant, 'project' | 'revision'>): Promise<void> {
    const config=this.config(input.connectionId)
    if (!Array.isArray(input.tools) || input.tools.length > 1000 || input.tools.some(item => typeof item !== 'string' || item.length > 256) || ![input.hostTrusted,input.resources,input.prompts].every(item => typeof item === 'boolean')) throw new Error('Invalid project connection grant')
    const tools=[...new Set(input.tools)],revisions=input.toolRevisions||{}
    if(!revisions||typeof revisions!=='object'||Array.isArray(revisions)||Object.keys(revisions).length!==tools.length||tools.some(name=>{
      const current=this.stored.catalog.find(item=>item.connectionId===input.connectionId&&item.remoteName===name&&item.enabled&&item.connectionRevision===hash(config))
      return !current||revisions[name]!==current.revision
    }))throw Error('Select an advertised MCP tool definition before granting it; reconnect and review changed tools')
    const before = this.grantFor(context.project, input.connectionId)
    this.cancelReferences(input.connectionId, context.project)
    const grant = { ...input, tools, toolRevisions:Object.fromEntries(tools.map(name=>[name,revisions[name]])), project: context.project, revision: (before?.revision || 0) + 1 }
    // Revocation aborts in-flight calls. It cannot undo actions already performed.
    for (const [key, live] of this.live) {
      const [project,,connectionId]=JSON.parse(key) as string[]
      if(project===context.project&&connectionId===input.connectionId)for (const [call,name] of live.calls) if(!input.tools.includes(name)||(this.config(input.connectionId).kind==='host'&&!input.hostTrusted))call.abort()
    }
    this.save({...this.stored,grants:[...this.stored.grants.filter(item => !(item.project === context.project && item.connectionId === input.connectionId)), grant]})
    if (this.config(input.connectionId).kind === 'host' && !input.hostTrusted) await this.disconnectProject(context.project,input.connectionId)
  }
  setCredential(id: string, bearer: string, env: Record<string,string>): void {
    this.config(id)
    if (typeof bearer !== 'string' || bearer.length > 16384 || /[\r\n]/.test(bearer) || !env || Object.keys(env).length > 32 || Object.entries(env).some(([name,value]) => !/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(name) || typeof value !== 'string' || value.length > 16384 || value.includes('\0'))) throw new Error('Invalid connection credentials')
    if ((bearer.length>0&&bearer.length<8)||Object.values(env).some(value=>value.length>0&&value.length<8)) throw new Error('MCP credential values must contain at least 8 characters so echoed values can be redacted')
    this.secrets.set(id, { bearer, env: { ...env } }); this.notify()
  }
  async disconnect(id: string, context?: Context): Promise<void> {
    this.cancelReferences(id, context?.project)
    for (const [key, value] of [...this.live]) if (context ? key === this.key(context,id) : (JSON.parse(key) as string[])[2] === id) { this.live.delete(key); for (const call of value.calls.keys()) call.abort(); await value.client.close().catch(() => {}); value.status = 'disconnected' }
    this.notify()
  }
  private async disconnectProject(project: string, id: string): Promise<void> {
    for (const [key, value] of [...this.live]) {
      const [currentProject,,connectionId]=JSON.parse(key) as string[]
      if(currentProject!==project||connectionId!==id)continue
      this.live.delete(key)
      for (const call of value.calls.keys()) call.abort()
      await value.client.close().catch(() => {})
      value.status='disconnected'
    }
    this.notify()
  }
  async disconnectAll(): Promise<void> { for (const config of this.stored.connections) await this.disconnect(config.id) }
  async close(): Promise<void> { await this.disconnectAll(); await this.schemas.close() }
  async connect(context: Context, id: string, interactive = false): Promise<void> {
    const config = this.config(id), grantRevision=this.allowed(context,id).revision
    const key = this.key(context,id)
    if (this.connecting.has(key)) throw new Error('This connection is already starting')
    this.connecting.add(key)
    try {
      const ensureCurrent=()=>{if(this.grantFor(context.project,id)?.revision!==grantRevision||hash(this.config(id))!==hash(config))throw new Error('Project grant or connection changed during setup')}
      await this.disconnect(id,context)
      ensureCurrent()
      const secret = this.secrets.get(id)
      const transport: Transport = config.kind === 'remote'
        ? new StreamableHTTPClientTransport(new URL(config.url!), { ...(config.auth === 'oauth' ? { authProvider: await this.oauth?.(config,interactive) } : {}), requestInit: config.auth === 'bearer' ? { headers: { Authorization: `Bearer ${String(secret.bearer || '')}` } } : undefined, fetch: mcpFetch, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } })
        : config.kind === 'host'
          ? new StdioClientTransport({ command: config.command!, args: config.args, cwd: context.workspace||context.project, env: { ...getDefaultEnvironment(), ...(secret.env as Record<string,string> || {}) }, stderr: 'pipe', maxBufferSize: 2 * 1024 * 1024 })
          : new ContainerMcpTransport(context.container, config.command!, config.args, secret.env as Record<string,string> || {})
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {})
      ensureCurrent()
      // No sampling, elicitation, or server-controlled filesystem roots capability.
      const client = new Client({ name: 'UnrealCode', version: '0.8.0' }, { capabilities: {} })
      const live: Live = { client, transport, revision: hash(config), status: 'connecting', message: 'Connecting…', calls: new Map(), names:new Set() }
      this.live.set(key,live); this.notify()
      client.onerror = () => { live.message = 'Connection error. Check endpoint, credentials, and server configuration.'; this.notify() }
      client.onclose = () => { live.status = 'disconnected'; live.message = 'Connection closed. Reconnect to continue.'; for (const call of live.calls.keys()) call.abort(); this.notify() }
      await client.connect(transport, { timeout: Math.min(config.timeoutMs,30000) })
      ensureCurrent()
      live.status = 'connected'; live.message = 'Connected; tools still require project selection and operation approval'
      await this.refresh(context,id)
      ensureCurrent()
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {if(live.calls.size){live.dirty=true;return}try { await this.refresh(context,id) } catch { live.message = 'Tool catalog refresh failed. Reconnect to refresh.'; this.notify() } })
      this.notify()
    } catch (error) {
      const live = this.live.get(key)
      if (live) { await live.client.close().catch(() => {}); live.status = 'error'; live.message = authenticationError(error) ? 'Authentication required or expired. Update credentials or use Reconnect with sign-in.' : error instanceof Error && /MCP (?:schema|tool schema|tool catalog)/.test(error.message) ? error.message : 'Could not connect. Check the endpoint or executable and Docker status.' }
      this.notify(); throw new Error(live?.message || 'Connection setup failed. Check authentication and configuration.', { cause: error })
    } finally { this.connecting.delete(key) }
  }
  private connection(context: Context, id: string): Live { this.allowed(context,id); const live = this.live.get(this.key(context,id)); if (live?.status !== 'connected') throw new Error('Connection is unavailable. Reconnect in Connections.'); return live }
  private async refresh(context: Context, id: string): Promise<void> {
    const live = this.connection(context,id), grantRevision=this.allowed(context,id).revision, collected: Tool[] = []
    if (live.client.getServerCapabilities()?.tools) {
      let cursor: string | undefined; const seen = new Set<string>()
      do { const page = await live.client.listTools(cursor ? { cursor } : {}, { timeout: 15000 }); collected.push(...page.tools); cursor = page.nextCursor; if (collected.length > 1000 || (cursor && seen.has(cursor))) throw new Error('Tool catalog exceeds its limit'); if (cursor) seen.add(cursor) } while (cursor)
    }
    if(this.grantFor(context.project,id)?.revision!==grantRevision||this.live.get(this.key(context,id))!==live)throw new Error('Project grant or connection changed during tool discovery')
    const newest: CatalogTool[] = [], validationAbort = new AbortController()
    const deadline = setTimeout(() => validationAbort.abort(), 15000)
    try {
      for (const tool of collected) {
        if (this.grantFor(context.project,id)?.revision!==grantRevision||this.live.get(this.key(context,id))!==live) throw new Error('Project grant or connection changed during tool discovery')
        if (Buffer.byteLength(stableJSON(tool)) > 64 * 1024 || tool.name.length > 256) throw new Error('Oversized MCP tool definition')
        const revision = hash({ connection: live.revision, name: tool.name, schema: tool.inputSchema, description: tool.description || '' })
        try { await this.schemas.validate(revision, tool.inputSchema, undefined, validationAbort.signal) }
        catch (error) { if (validationAbort.signal.aborted) throw new Error('MCP tool catalog validation timed out; inspect server schemas'); throw error }
        newest.push({ name: `mcp_${id.replaceAll('-','').slice(0,10)}_${tool.name.replace(/[^A-Za-z0-9_]/g,'_').slice(0,24)}_${revision.slice(0,10)}`, remoteName: tool.name, connectionId: id, connectionRevision: live.revision, description: (tool.description || '').slice(0,8000), inputSchema: tool.inputSchema, revision, enabled: true })
      }
    } finally { clearTimeout(deadline) }
    if(this.grantFor(context.project,id)?.revision!==grantRevision||this.live.get(this.key(context,id))!==live)throw new Error('Project grant or connection changed during tool discovery')
    const known = new Map(this.stored.catalog.map(item => [item.name,{ ...item, enabled: item.connectionId === id ? false : item.enabled }]))
    for (const item of newest) known.set(item.name,item)
    this.save({...this.stored,catalog:[...known.values()]})
    live.names = new Set(newest.map(item=>item.name))
  }
  catalog(context: Context, id?: string): CatalogTool[] {
    return this.stored.catalog.filter(item => !id || item.connectionId === id).map(item => { const grant = this.grantFor(context.project,item.connectionId), live = this.live.get(this.key(context,item.connectionId)); return { ...structuredClone(item), enabled: item.enabled && !!live?.names.has(item.name) && live.status === 'connected' && !!grant?.tools.includes(item.remoteName) && grant.toolRevisions?.[item.remoteName]===item.revision } })
  }
  async call(context: Context, tool: CatalogTool, args: Record<string,unknown>, signal: AbortSignal): Promise<HostResult> {
    const grant = this.allowed(context,tool.connectionId), live = this.connection(context,tool.connectionId), config = this.config(tool.connectionId)
    const current=this.stored.catalog.find(item=>item.name===tool.name&&item.revision===tool.revision&&item.connectionId===tool.connectionId)
    if (!current||!current.enabled||!live.names.has(current.name)||current.remoteName!==tool.remoteName||current.connectionRevision!==tool.connectionRevision||!grant.tools.includes(current.remoteName)||grant.toolRevisions?.[current.remoteName]!==current.revision||live.revision!==current.connectionRevision) throw new Error('Tool grant or definition is no longer available')
    if (signal.aborted) throw new Error('MCP call cancelled')
    const controller = new AbortController(), abort = () => controller.abort(); signal.addEventListener('abort',abort,{ once:true }); live.calls.set(controller,current.remoteName)
    let validated = false
    try {
      const valid = await this.schemas.validate(current.revision, current.inputSchema, args, controller.signal)
      if (!valid) throw new Error('Arguments do not match the selected tool schema')
      if (controller.signal.aborted) throw new Error('MCP call cancelled')
      if (this.grantFor(context.project,tool.connectionId)?.revision !== grant.revision || this.live.get(this.key(context,tool.connectionId)) !== live || live.status !== 'connected' || !current.enabled || !live.names.has(current.name) || !this.stored.catalog.includes(current)) throw new Error('Tool grant or definition changed before execution')
      validated = true
      const result = await live.client.callTool({ name: current.remoteName, arguments: args }, undefined, { signal: controller.signal, timeout: config.timeoutMs })
      if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new Error('MCP result exceeds the 1 MB limit')
      // MCP is reference data, never a permission or a system instruction.
      return { text: this.redact(tool.connectionId, JSON.stringify(result)), error: !!result.isError }
    } catch (error) {
      if (authenticationError(error)) { live.status = 'error'; live.message = 'Authentication expired. Reconnect with sign-in.'; this.notify() }
      if (!validated && error instanceof Error) throw error
      throw new Error('MCP call failed, timed out, returned invalid data, or was cancelled. Check connection health.')
    } finally { signal.removeEventListener('abort',abort); live.calls.delete(controller);if(live.dirty&&!live.calls.size&&live.status==='connected'){live.dirty=false;void this.refresh(context,tool.connectionId).catch(()=>{live.message='Tool catalog refresh failed. Reconnect to refresh.';this.notify()})} }
  }
  private redact(id: string, text: string): string {
    const values: string[] = []
    const visit = (value: unknown) => { if (typeof value === 'string' && value.length >= 8) values.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit) }
    visit(this.secrets.get(id))
    for (const secret of values) {
      let encoded=secret
      for(let depth=0;depth<4;depth++){
        text=text.split(encoded).join('[REDACTED]')
        const next=JSON.stringify(encoded).slice(1,-1)
        if(next===encoded)break
        encoded=next
      }
    }
    return text.replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[REDACTED]')
  }
  private async reference<T>(context: Context, id: string, kind: 'resources' | 'prompts', work: (live: Live, signal: AbortSignal, revision: number) => Promise<T>): Promise<T> {
    const grant = this.allowed(context, id), live = this.connection(context, id)
    if (!grant[kind]) throw new Error(`${kind === 'resources' ? 'Resource' : 'Prompt'} attachment is not granted for this project`)
    const controller = new AbortController()
    this.referenceReads.set(controller, { project: context.project, id })
    try {
      const result = await work(live, controller.signal, grant.revision)
      const current = this.grantFor(context.project, id)
      if (controller.signal.aborted || !current?.[kind] || current.revision !== grant.revision || this.live.get(this.key(context, id)) !== live || live.status !== 'connected') throw new Error('Connection access changed; the reference was discarded. Refresh before attaching it.')
      return result
    } finally { this.referenceReads.delete(controller) }
  }
  private async referencePage(context: Context, id: string, kind: 'resources' | 'prompts', token?: string): Promise<ConnectionPage<ConnectionResource | ConnectionPrompt>> {
    return this.reference(context, id, kind, async (live, signal, revision) => {
      const scope = stableJSON([this.key(context,id), context.workspace || context.project])
      for (const [key, page] of this.referencePages) if (page.expires < Date.now()) this.referencePages.delete(key)
      const previous = token === undefined ? undefined : this.referencePages.get(token)
      if (token !== undefined && (!previous || previous.scope !== scope || previous.kind !== kind || previous.revision !== revision || previous.live !== live)) throw new Error('This catalog page expired. Refresh the resource or prompt list.')
      const params = previous ? {cursor: previous.cursor} : {}
      const page = kind === 'resources' ? await live.client.listResources(params,{signal,timeout:15000}) : await live.client.listPrompts(params,{signal,timeout:15000})
      const items = ('resources' in page ? page.resources : page.prompts) as Array<ConnectionResource | ConnectionPrompt>
      if (Buffer.byteLength(JSON.stringify(page)) > 512 * 1024 || items.length > 500 || (previous?.count || 0) + items.length > 5000) throw new Error('MCP catalog exceeds its bounded attachment limit')
      const seen = previous?.seen || [], cursor = page.nextCursor
      if (cursor && (seen.includes(cursor) || seen.length >= 100)) throw new Error('MCP server repeated a catalog cursor or exceeded the page limit')
      let nextCursor: string | undefined
      if (cursor) {
        while (this.referencePages.size >= 256) this.referencePages.delete(this.referencePages.keys().next().value!)
        nextCursor = randomUUID()
        this.referencePages.set(nextCursor,{scope,kind,revision,live,cursor,seen:[...seen,cursor],count:(previous?.count||0)+items.length,expires:Date.now()+300000})
      }
      let known = this.advertised.get(live)
      if (!known || known.revision !== revision) { known = {revision,resources:new Set(),prompts:new Set()}; this.advertised.set(live,known) }
      for (const item of items) known[kind].add(kind === 'resources' ? (item as ConnectionResource).uri : item.name)
      return {items,nextCursor,revision}
    })
  }
  async resources(context: Context,id: string,cursor?:string): Promise<ConnectionPage<ConnectionResource>> { return this.referencePage(context,id,'resources',cursor) as Promise<ConnectionPage<ConnectionResource>> }
  private async advertisedReference(context: Context,id: string,kind:'resources'|'prompts',value:string):Promise<void> {
    const live=this.connection(context,id),revision=this.allowed(context,id).revision
    if(this.advertised.get(live)?.revision!==revision||!this.advertised.get(live)?.[kind].has(value))await this.referencePage(context,id,kind)
    if(this.advertised.get(live)?.revision!==revision||!this.advertised.get(live)?.[kind].has(value))throw Error('Select a reference advertised by this connection; load its page first')
  }
  async resource(context: Context,id: string,uri: string): Promise<string> {
    await this.advertisedReference(context,id,'resources',uri)
    return this.reference(context,id,'resources',async(live,signal)=>{
      const text=JSON.stringify(await live.client.readResource({uri},{signal,timeout:15000}))
      if(Buffer.byteLength(text)>192*1024)throw Error('Resource exceeds attachment limit')
      return this.redact(id,text)
    })
  }
  async prompts(context: Context,id: string,cursor?:string): Promise<ConnectionPage<ConnectionPrompt>> { return this.referencePage(context,id,'prompts',cursor) as Promise<ConnectionPage<ConnectionPrompt>> }
  async prompt(context: Context,id: string,name: string,args: Record<string,string>): Promise<string> {
    await this.advertisedReference(context,id,'prompts',name)
    if (Buffer.byteLength(JSON.stringify(args)) > 64 * 1024) throw new Error('Prompt arguments too large')
    return this.reference(context,id,'prompts',async(live,signal)=>{
      const text=JSON.stringify(await live.client.getPrompt({name,arguments:args},{signal,timeout:15000}))
      if(Buffer.byteLength(text)>192*1024)throw Error('Prompt exceeds attachment limit')
      return this.redact(id,text)
    })
  }
}
