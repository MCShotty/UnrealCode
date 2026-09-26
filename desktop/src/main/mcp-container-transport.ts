import { spawn,execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { backendEnvironment } from './child-environment'

// The first stdin frame supplies only this server's secrets, before MCP begins.
// No credential appears in docker arguments, docker configuration, or logs.
const bootstrap = `import os,sys,json
line=b''
while not line.endswith(b'\\n'):
 b=os.read(0,1)
 if not b: raise SystemExit(1)
 line+=b
 if len(line)>600000: raise SystemExit(1)
c=json.loads(line)
if os.getpgrp()!=os.getpid(): os.setsid()
os.environ.update(c['env'])
os.environ['UNREALCODE_MCP_OWNER']=c['owner']
with open(c['pid'],'x') as f: f.write(str(os.getpid()))
os.execvpe(c['command'],[c['command']]+c['args'],os.environ)`
const terminate = `import os,sys,signal
try:
 pid=int(open(sys.argv[1]).read())
 data=open('/proc/'+str(pid)+'/environ','rb').read().split(b'\\0')
 if ('UNREALCODE_MCP_OWNER='+sys.argv[2]).encode() in data: os.killpg(pid,signal.SIGTERM)
except (FileNotFoundError,ProcessLookupError): pass
try: os.unlink(sys.argv[1])
except FileNotFoundError: pass`
export class ContainerMcpTransport implements Transport {
  private child?: ReturnType<typeof spawn>
  private buffer = new ReadBuffer({ maxBufferSize: 2 * 1024 * 1024 })
  private owner = randomUUID()
  private pidPath = `/tmp/unrealcode-mcp-${this.owner}.pid`
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  constructor(private container: string, private command: string, private args: string[], private env: Record<string, string>) {}
  async start(): Promise<void> {
    if (this.child) throw new Error('MCP transport already started')
    const child = this.child = spawn('docker', ['exec', '-i', '-w', '/workspace', this.container, 'python3', '-u', '-c', bootstrap], { windowsHide: true, env: backendEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    child.stderr?.resume() // Server stderr can contain secrets; never forward it.
    child.stdout?.on('data', chunk => { try { this.buffer.append(chunk); for (;;) { const message = this.buffer.readMessage(); if (!message) break; this.onmessage?.(message) } } catch { this.onerror?.(new Error('Malformed or oversized container MCP response')); void this.close() } })
    child.on('close', () => { this.child = undefined; this.onclose?.() })
    child.on('error', () => this.onerror?.(new Error('Container MCP process could not start')))
    await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('spawn', () => { child.stdin!.write(JSON.stringify({ command: this.command, args: this.args, env: this.env,owner:this.owner,pid:this.pidPath }) + '\n', error => error ? reject(error) : resolve()) }) })
  }
  async send(message: JSONRPCMessage): Promise<void> { if (!this.child?.stdin?.writable) throw new Error('Container MCP disconnected'); await new Promise<void>((resolve, reject) => this.child!.stdin!.write(serializeMessage(message), error => error ? reject(error) : resolve())) }
  async close(): Promise<void> { const child = this.child; this.child = undefined; child?.stdin?.end(); await promisify(execFile)('docker',['exec',this.container,'python3','-c',terminate,this.pidPath,this.owner],{ windowsHide:true,env:backendEnvironment(),timeout:5000 }).catch(()=>{});child?.kill(); this.buffer.clear() }
}
