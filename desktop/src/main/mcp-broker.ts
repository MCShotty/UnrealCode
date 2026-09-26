import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import Ajv from 'ajv'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ContainerMcpTransport } from './mcp-container-transport'
import type { ConnectionSecrets } from './connection-vault'
import type { CatalogTool, ConnectionConfig, ConnectionGrant, ConnectionView, HostResult } from '../shared/connections'
import { stableJSON } from './host-operations'
import { mcpFetch } from './mcp-auth'

type Stored = { version: 1; connections: ConnectionConfig[]; grants: ConnectionGrant[]; catalog: CatalogTool[] }
type Live = { client: Client; transport: Transport; revision: string; status: ConnectionView['status']; message: string; calls: Map<AbortController,string>; names: Set<string>; dirty?:boolean }
type Context = { project: string; container: string; workspace?:string }
const idPattern = /^[a-f0-9-]{36}$/
const hash = (value: unknown) => createHash('sha256').update(stableJSON(value)).digest('hex')
const authenticationError = (error: unknown) => error instanceof UnauthorizedError || (error instanceof StreamableHTTPError && [401,403].includes(error.code || 0)) || /unauthorized|401|403|authorization/i.test(String(error))
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false })
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
export class McpBroker {
  private stored: Stored = { version: 1, connections: [], grants: [], catalog: [] }
  private live = new Map<string, Live>()
  private connecting = new Set<string>()
  onChanged: () => void = () => {}
  oauth?: (config: ConnectionConfig, interactive: boolean) => Promise<OAuthClientProvider>
  constructor(private path: string, private secrets: ConnectionSecrets) {
    if (existsSync(path)) {
      const stored: Stored = JSON.parse(readFileSync(path, 'utf8'))
      if (stored.version !== 1 || !Array.isArray(stored.connections) || !Array.isArray(stored.grants) || !Array.isArray(stored.catalog)) throw new Error('Unsupported connection data; restore a backup')
      stored.connections = stored.connections.map(validateConnection); this.stored = stored
    }
  }
  private key(context: Context, id: string): string { return stableJSON([context.project, context.container, id]) }
  private save(): void { mkdirSync(dirname(this.path), { recursive: true }); const temp = `${this.path}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(this.stored), { mode: 0o600 }); renameSync(temp, this.path); this.onChanged() }
  private config(id: string): ConnectionConfig { const value = this.stored.connections.find(item => item.id === id); if (!value) throw new Error('Connection not found'); return value }
  grantFor(project: string, id: string): ConnectionGrant | undefined { return this.stored.grants.find(item => item.project === project && item.connectionId === id) }
  private allowed(context: Context, id: string): ConnectionGrant { const config = this.config(id), grant = this.grantFor(context.project, id); if (!grant || (config.kind === 'host' && !grant.hostTrusted)) throw new Error('Grant this project access in Connections before connecting'); return grant }
  views(context: Context): ConnectionView[] {
    return this.stored.connections.map(config => { const live = this.live.get(this.key(context, config.id)); return { ...structuredClone(config), status: live?.status || 'disconnected', message: live?.message || 'Connect explicitly to start this server', hasCredential: Object.keys(this.secrets.get(config.id)).length > 0, tools: this.catalog(context, config.id), grant: structuredClone(this.grantFor(context.project, config.id)) } })
  }
  async put(value: ConnectionConfig): Promise<void> {
    const config = validateConnection(value), previous = this.stored.connections.find(item => item.id === config.id)
    await this.disconnect(config.id)
    if (previous && hash(previous) !== hash(config)) { this.stored.grants = this.stored.grants.filter(item => item.connectionId !== config.id); this.secrets.remove(config.id) }
    this.stored.connections = [...this.stored.connections.filter(item => item.id !== config.id), config]; this.save()
  }
  async remove(id: string): Promise<void> { this.config(id); await this.disconnect(id); this.stored.connections = this.stored.connections.filter(item => item.id !== id); this.stored.grants = this.stored.grants.filter(item => item.connectionId !== id); this.secrets.remove(id); this.save() }
  async revoke(context: Context,id:string): Promise<void> { await this.disconnect(id,context);this.stored.grants=this.stored.grants.filter(item=>!(item.project===context.project&&item.connectionId===id));this.save() }
  async grant(context: Context, input: Omit<ConnectionGrant, 'project' | 'revision'>): Promise<void> {
    this.config(input.connectionId)
    if (!Array.isArray(input.tools) || input.tools.length > 1000 || input.tools.some(item => typeof item !== 'string' || item.length > 256) || ![input.hostTrusted,input.resources,input.prompts].every(item => typeof item === 'boolean')) throw new Error('Invalid project connection grant')
    const before = this.grantFor(context.project, input.connectionId)
    const grant = { ...input, tools: [...new Set(input.tools)], project: context.project, revision: (before?.revision || 0) + 1 }
    // Revocation aborts in-flight calls. It cannot undo actions already performed.
    for (const [key, live] of this.live) if (key === this.key(context,input.connectionId)) for (const [call,name] of live.calls) if(!input.tools.includes(name)||(this.config(input.connectionId).kind==='host'&&!input.hostTrusted))call.abort()
    this.stored.grants = [...this.stored.grants.filter(item => !(item.project === context.project && item.connectionId === input.connectionId)), grant]
    if (this.config(input.connectionId).kind === 'host' && !input.hostTrusted) await this.disconnect(input.connectionId, context)
    this.save()
  }
  setCredential(id: string, bearer: string, env: Record<string,string>): void {
    this.config(id)
    if (typeof bearer !== 'string' || bearer.length > 16384 || /[\r\n]/.test(bearer) || !env || Object.keys(env).length > 32 || Object.entries(env).some(([name,value]) => !/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(name) || typeof value !== 'string' || value.length > 16384 || value.includes('\0'))) throw new Error('Invalid connection credentials')
    this.secrets.set(id, { bearer, env: { ...env } }); this.onChanged()
  }
  async disconnect(id: string, context?: Context): Promise<void> {
    for (const [key, value] of [...this.live]) if (context ? key === this.key(context,id) : (JSON.parse(key) as string[])[2] === id) { this.live.delete(key); for (const call of value.calls.keys()) call.abort(); await value.client.close().catch(() => {}); value.status = 'disconnected' }
    this.onChanged()
  }
  async close(): Promise<void> { for (const config of this.stored.connections) await this.disconnect(config.id) }
  async connect(context: Context, id: string, interactive = false): Promise<void> {
    const config = this.config(id); this.allowed(context,id)
    const key = this.key(context,id)
    if (this.connecting.has(key)) throw new Error('This connection is already starting')
    this.connecting.add(key)
    await this.disconnect(id,context)
    const secret = this.secrets.get(id)
    try {
      const transport: Transport = config.kind === 'remote'
        ? new StreamableHTTPClientTransport(new URL(config.url!), { ...(config.auth === 'oauth' ? { authProvider: await this.oauth?.(config,interactive) } : {}), requestInit: config.auth === 'bearer' ? { headers: { Authorization: `Bearer ${String(secret.bearer || '')}` } } : undefined, fetch: mcpFetch, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } })
        : config.kind === 'host'
          ? new StdioClientTransport({ command: config.command!, args: config.args, cwd: context.workspace||context.project, env: { ...getDefaultEnvironment(), ...(secret.env as Record<string,string> || {}) }, stderr: 'pipe', maxBufferSize: 2 * 1024 * 1024 })
          : new ContainerMcpTransport(context.container, config.command!, config.args, secret.env as Record<string,string> || {})
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {})
      // No sampling, elicitation, or server-controlled filesystem roots capability.
      const client = new Client({ name: 'UnrealCode', version: '0.8.0' }, { capabilities: {} })
      const live: Live = { client, transport, revision: hash(config), status: 'connecting', message: 'Connecting…', calls: new Map(), names:new Set() }
      this.live.set(key,live); this.onChanged()
      client.onerror = () => { live.message = 'Connection error. Check endpoint, credentials, and server configuration.'; this.onChanged() }
      client.onclose = () => { live.status = 'disconnected'; live.message = 'Connection closed. Reconnect to continue.'; for (const call of live.calls.keys()) call.abort(); this.onChanged() }
      await client.connect(transport, { timeout: Math.min(config.timeoutMs,30000) })
      live.status = 'connected'; live.message = 'Connected; tools still require project selection and operation approval'
      await this.refresh(context,id)
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {if(live.calls.size){live.dirty=true;return}try { await this.refresh(context,id) } catch { live.message = 'Tool catalog refresh failed. Reconnect to refresh.'; this.onChanged() } })
      this.onChanged()
    } catch (error) {
      const live = this.live.get(key)
      if (live) { await live.client.close().catch(() => {}); live.status = 'error'; live.message = authenticationError(error) ? 'Authentication required or expired. Update credentials or use Reconnect with sign-in.' : 'Could not connect. Check the endpoint or executable and Docker status.' }
      this.onChanged(); throw new Error(live?.message || 'Connection setup failed. Check authentication and configuration.', { cause: error })
    } finally { this.connecting.delete(key) }
  }
  private connection(context: Context, id: string): Live { this.allowed(context,id); const live = this.live.get(this.key(context,id)); if (live?.status !== 'connected') throw new Error('Connection is unavailable. Reconnect in Connections.'); return live }
  private async refresh(context: Context, id: string): Promise<void> {
    const live = this.connection(context,id), collected: Tool[] = []
    if (live.client.getServerCapabilities()?.tools) {
      let cursor: string | undefined; const seen = new Set<string>()
      do { const page = await live.client.listTools(cursor ? { cursor } : {}, { timeout: 15000 }); collected.push(...page.tools); cursor = page.nextCursor; if (collected.length > 1000 || (cursor && seen.has(cursor))) throw new Error('Tool catalog exceeds its limit'); if (cursor) seen.add(cursor) } while (cursor)
    }
    const newest: CatalogTool[] = collected.map(tool => {
      if (Buffer.byteLength(stableJSON(tool)) > 64 * 1024 || tool.name.length > 256) throw new Error('Oversized MCP tool definition')
      // Compile without network resolution or coercion; malformed schemas stay unavailable.
      if('$async' in ajv.compile(tool.inputSchema))throw new Error('Asynchronous tool schemas are not supported')
      const revision = hash({ connection: live.revision, name: tool.name, schema: tool.inputSchema, description: tool.description || '' })
      return { name: `mcp_${id.replaceAll('-','').slice(0,10)}_${tool.name.replace(/[^A-Za-z0-9_]/g,'_').slice(0,24)}_${revision.slice(0,10)}`, remoteName: tool.name, connectionId: id, connectionRevision: live.revision, description: (tool.description || '').slice(0,8000), inputSchema: tool.inputSchema, revision, enabled: true }
    })
    const known = new Map(this.stored.catalog.map(item => [item.name,{ ...item, enabled: item.connectionId === id ? false : item.enabled }]))
    for (const item of newest) known.set(item.name,item)
    live.names = new Set(newest.map(item=>item.name))
    this.stored.catalog = [...known.values()]; this.save()
  }
  catalog(context: Context, id?: string): CatalogTool[] {
    return this.stored.catalog.filter(item => !id || item.connectionId === id).map(item => { const grant = this.grantFor(context.project,item.connectionId), live = this.live.get(this.key(context,item.connectionId)); return { ...structuredClone(item), enabled: !!live?.names.has(item.name) && live.status === 'connected' && !!grant?.tools.includes(item.remoteName) } })
  }
  async call(context: Context, tool: CatalogTool, args: Record<string,unknown>, signal: AbortSignal): Promise<HostResult> {
    const grant = this.allowed(context,tool.connectionId), live = this.connection(context,tool.connectionId), config = this.config(tool.connectionId)
    if (!grant.tools.includes(tool.remoteName) || live.revision !== tool.connectionRevision || !this.stored.catalog.some(item => item.name === tool.name && item.revision === tool.revision)) throw new Error('Tool grant or definition is no longer available')
    const valid = ajv.compile(tool.inputSchema)
    if (!valid(args)) throw new Error('Arguments do not match the selected tool schema')
    if (signal.aborted) throw new Error('MCP call cancelled')
    const controller = new AbortController(), abort = () => controller.abort(); signal.addEventListener('abort',abort,{ once:true }); live.calls.set(controller,tool.remoteName)
    try {
      const result = await live.client.callTool({ name: tool.remoteName, arguments: args }, undefined, { signal: controller.signal, timeout: config.timeoutMs })
      if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new Error('MCP result exceeds the 1 MB limit')
      // MCP is reference data, never a permission or a system instruction.
      return { text: this.redact(tool.connectionId, JSON.stringify(result)), error: !!result.isError }
    } catch (error) {
      if (authenticationError(error)) { live.status = 'error'; live.message = 'Authentication expired. Reconnect with sign-in.'; this.onChanged() }
      throw new Error('MCP call failed, timed out, returned invalid data, or was cancelled. Check connection health.')
    } finally { signal.removeEventListener('abort',abort); live.calls.delete(controller);if(live.dirty&&!live.calls.size&&live.status==='connected'){live.dirty=false;void this.refresh(context,tool.connectionId).catch(()=>{live.message='Tool catalog refresh failed. Reconnect to refresh.';this.onChanged()})} }
  }
  private redact(id: string, text: string): string {
    const values: string[] = []
    const visit = (value: unknown) => { if (typeof value === 'string' && value.length >= 8) values.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit) }
    visit(this.secrets.get(id)); for (const secret of values) text = text.split(secret).join('[REDACTED]')
    return text.replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[REDACTED]')
  }
  async resources(context: Context,id: string) {
    if (!this.allowed(context,id).resources) throw new Error('Resource attachment is not granted for this project')
    return (await this.connection(context,id).client.listResources({}, { timeout: 15000 })).resources.slice(0,500)
  }
  async resource(context: Context,id: string,uri: string): Promise<string> {
    if (!(await this.resources(context,id)).some(item => item.uri === uri)) throw new Error('Select a resource advertised by this connection')
    const result = await this.connection(context,id).client.readResource({ uri },{ timeout: 15000 })
    const text = JSON.stringify(result); if (Buffer.byteLength(text) > 192 * 1024) throw new Error('Resource exceeds attachment limit')
    return this.redact(id,text)
  }
  async prompts(context: Context,id: string) {
    if (!this.allowed(context,id).prompts) throw new Error('Prompt templates are not granted for this project')
    return (await this.connection(context,id).client.listPrompts({}, { timeout: 15000 })).prompts.slice(0,500)
  }
  async prompt(context: Context,id: string,name: string,args: Record<string,string>): Promise<string> {
    if (!(await this.prompts(context,id)).some(item => item.name === name)) throw new Error('Select a prompt advertised by this connection')
    if (Buffer.byteLength(JSON.stringify(args)) > 64 * 1024) throw new Error('Prompt arguments too large')
    const text = JSON.stringify(await this.connection(context,id).client.getPrompt({ name, arguments: args },{ timeout: 15000 })); if (Buffer.byteLength(text) > 192 * 1024) throw new Error('Prompt exceeds attachment limit')
    return this.redact(id,text)
  }
}
