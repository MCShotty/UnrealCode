import { actionable, classifyFailure, ActionableError } from './failures'
import { app } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { getCACertificates } from 'node:tls'
import { promisify } from 'node:util'
import type { AgentEvent, DockerStatus } from '../shared/api'
import { backendEnvironment } from './child-environment'
import { terminalDockerExecutable } from './terminal-command'
import { resolveVolume } from './state-volumes'

const execFileAsync = promisify(execFile)
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }

export function backendSourceTag(source: string, version: string): string {
  const hash = createHash('sha256')
  const visit = (path: string): void => {
    const stat = lstatSync(path)
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name))
    else if (stat.isFile()) { hash.update(relative(source, path).replaceAll('\\', '/')); hash.update(readFileSync(path)) }
  }
  for (const name of ['Dockerfile.desktop', '.dockerignore', 'LICENSE', 'go.mod', 'go.sum', 'cmd', 'harness', 'internal', 'desktop/worker', 'desktop/third-party-licenses']) visit(join(source, name))
  return `unrealcode:${version}-${hash.digest('hex').slice(0, 12)}`
}

export class DockerBridge {
  private process: ReturnType<typeof spawn> | null = null
  private pending = new Map<string, Pending>()
  private buffer = ''
  private container = ''
  private project = ''
  private message = 'Docker backend is not started'
  private imageTag = ''
  private phase: DockerStatus['phase'] = 'unavailable'
  private failure?: DockerStatus['failure']
  onEvent: (value: AgentEvent) => void = () => {}
  onStatus: (value: DockerStatus) => void = () => {}

  get containerName(): string { return this.container }
  get projectPath(): string { return this.project }
  async previewAddresses():Promise<Record<string,string>>{if(!this.container)return {};const output=await this.docker(['port',this.container]),result:Record<string,string>={};for(const line of output.split('\n')){const match=/^(\d+)\/tcp -> (127\.0\.0\.1:\d+)$/.exec(line.trim());if(match)result[match[1]]=`http://${match[2]}`}return result}
  status(): DockerStatus { return { ready: this.phase === 'running' && !!this.process && !this.process.killed, phase:this.phase,failure:this.failure,message: this.message, container: this.container || undefined } }

  async probe(): Promise<DockerStatus> {
    if (this.process) return this.status()
    try {
      const kind=await this.docker(['info','--format','{{.OSType}}'])
      if(kind!=='linux')throw new Error('Linux engine required; Docker is using Windows containers')
      this.phase='available';this.failure=undefined;this.message='Docker Desktop is ready. Open a project to start UnrealCode.'
    } catch(error) {this.phase='unavailable';this.failure=classifyFailure(error,'docker');this.message=this.failure.message}
    return this.status()
  }
  async rebuild():Promise<void>{if(this.process)throw new Error('Finish active work before rebuilding the backend');await this.ensureImage(true)}
  private sourceDirectory(): string {
    return app.isPackaged ? join(process.resourcesPath, 'backend') : resolve(__dirname, '../../..')
  }

  private async docker(args: string[], timeout = 15000): Promise<string> {
    const environment=backendEnvironment()
    const { stdout } = await execFileAsync(terminalDockerExecutable(environment), args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, env: environment })
    return stdout.trim()
  }

  private async hostCA(): Promise<string | null> {
    if (process.platform !== 'win32' || typeof getCACertificates !== 'function') return null
    const certificates = getCACertificates('system')
    if (certificates.length === 0) return null
    const path = join(app.getPath('userData'), 'host-ca-bundle.crt')
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(path, certificates.join('\n') + '\n', { mode: 0o600 })
    return path
  }

  private async ensureImage(force = false): Promise<void> {
    const source = this.sourceDirectory()
    const tag = backendSourceTag(source, app.getVersion())
    this.imageTag = tag
    if (app.isPackaged && !force) {
      try { await this.docker(['image', 'inspect', tag]); return } catch { /* build below */ }
    }
    this.phase='building';this.message = 'Building UnrealCode backend image…'
    this.onStatus(this.status())
    const args = ['build', '-f', join(source, 'Dockerfile.desktop'), '-t', tag]
    const ca = await this.hostCA()
    if (ca) args.push('--secret', `id=host_ca,src=${ca}`)
    args.push(source)
    try{await this.docker(args,10*60*1000)}catch(error){throw actionable(error,'docker-build')}
  }

  async start(projectPath: string, evaluationGit = false, previewPorts:number[]=[]): Promise<DockerStatus> {
    if(previewPorts.length>10||previewPorts.some(port=>!Number.isInteger(port)||port<1024||port>65535))throw Error('Invalid preview ports')
    await this.stop()
    this.phase='checking';this.failure=undefined;this.message = 'Checking Docker Desktop…'
    this.onStatus(this.status())
    const available=await this.probe();if(available.failure)throw new ActionableError(available.failure)
    await this.ensureImage()
    const digest = createHash('sha256').update(projectPath.toLocaleLowerCase()).digest('hex').slice(0, 20)
    const volume = await resolveVolume(app.getPath('userData'), projectPath, evaluationGit)
    await this.migrateStateVolume(projectPath, volume)
    this.container = `unrealcode-${digest.slice(0, 8)}-${randomUUID().slice(0, 8)}`
    this.project = projectPath
    const tag = this.imageTag
    const args = [
      'run', '--rm', '--init', '-i', '--name', this.container,
        ...previewPorts.flatMap(port=>['--publish',`127.0.0.1::${port}`]),
      '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--mount', `type=bind,source=${projectPath},target=/workspace`,
      '--mount', `type=volume,source=${volume},target=/state`,
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m',
      ...(evaluationGit ? ['-e', 'GIT_DIR=/state/evaluation-git', '-e', 'GIT_WORK_TREE=/workspace'] : []), tag
    ]
    const environment=backendEnvironment()
    const child = spawn(terminalDockerExecutable(environment), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: environment })
    this.process = child
    this.buffer = ''
    child.stdout.on('data', (data: Buffer) => this.consume(data.toString('utf8')))
    let stderr = ''
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString('utf8')).slice(-3000) })
    child.on('error', (error) => this.fail(error))
    child.on('exit', (code) => this.fail(new Error(stderr.trim() || `Docker backend exited (${code})`)))
    try {
      const health = await this.request<{ version: number; capabilities?: string[] }>('health', {}, 30000)
      if (health.version !== 1 || !['permissions.v1', 'files.v1', 'sessions.v1', 'mcp.v1', 'context.v1', 'teams.v1', 'verification.v1', 'history.latest.v1', 'lifecycle.v1', 'controls.v1', 'inference.v1', 'hooks.v1', 'goal.usage.v1', 'questions.v2', 'provider.issue.v1', 'plan.progress.v1'].every(value => health.capabilities?.includes(value))) {
        throw new Error('The Docker backend is incompatible with this desktop version. Rebuild the backend image and reopen the project.')
      }
      if (evaluationGit) await this.docker(['exec', this.container, 'sh', '-c', 'if test ! -f /state/evaluation-git/HEAD; then env -u GIT_DIR -u GIT_WORK_TREE git init --bare /state/evaluation-git && git add --all && git -c user.name=UnrealCode -c user.email=evaluation@localhost commit --allow-empty -m "Task input snapshot"; fi'], 60000)
      this.phase='running';this.failure=undefined;this.message = 'Container running'
      this.onStatus(this.status())
      return this.status()
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  private async migrateStateVolume(projectPath: string, target: string): Promise<void> {
    if (projectPath.toLocaleLowerCase() !== 'i:\\unrealcode') return
    try {
      await this.docker(['volume', 'inspect', target])
      const tag = this.imageTag
      try {
        await this.docker(['run', '--rm', '--user', '0:0', '--entrypoint', '/bin/bash', '--mount', `type=volume,source=${target},target=/to`, tag, '-c', 'test -f /to/.unrealcode-migrated'])
        return
      } catch { /* Earlier interrupted copy; retry from the unchanged source. */ }
    } catch { /* target does not exist */ }
    const legacyDigest = createHash('sha256').update('i:\\unrealgui').digest('hex').slice(0, 20)
    const source = `unreal-desktop-${legacyDigest}`
    const tag = this.imageTag
    try { await this.docker(['volume', 'inspect', source]) } catch {
      await this.docker(['volume', 'create', target])
      await this.docker(['run', '--rm', '--user', '0:0', '--entrypoint', '/bin/bash', '--mount', `type=volume,source=${target},target=/to`, tag, '-c', 'touch /to/.unrealcode-migrated'])
      return
    }
    const using = await this.docker(['ps', '-q', '--filter', `volume=${source}`])
    if (using) throw new Error('Close the old Unreal Agent Desktop app before migrating its saved sessions.')
    await this.docker(['volume', 'create', target])
    await this.docker(['run', '--rm', '--user', '0:0', '--entrypoint', '/bin/bash', '--mount', `type=volume,source=${source},target=/from,readonly`,
      '--mount', `type=volume,source=${target},target=/to`, tag, '-c', 'cp -a /from/. /to/ && chown -R 10001:10001 /to && touch /to/.unrealcode-migrated'], 60000)
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let value: Record<string, unknown>
      try { value = JSON.parse(line) as Record<string, unknown> } catch { continue }
      if (typeof value.event === 'string') {
        this.onEvent(value as AgentEvent)
      } else if (typeof value.id === 'string') {
        const pending = this.pending.get(value.id)
        if (!pending) continue
        clearTimeout(pending.timeout)
        this.pending.delete(value.id)
        if (value.ok) pending.resolve(value.result)
        else pending.reject(new Error(String(value.error || 'Backend request failed')))
      }
    }
  }

  request<T>(method: string, params: unknown, timeoutMs = 60000): Promise<T> {
    const child = this.process
    if (!child || child.killed || !child.stdin?.writable) return Promise.reject(new Error('Docker backend is not connected'))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)) }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout })
      child.stdin!.write(JSON.stringify({ v: 1, id, method, params }) + '\n', (error) => {
        if (error) { clearTimeout(timeout); this.pending.delete(id); reject(error) }
      })
    })
  }

  private fail(error: Error): void {
    if (!this.process) return
    this.process = null
    this.phase='unavailable';this.failure=classifyFailure(error,'docker');this.message = this.failure.message
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error) }
    this.pending.clear()
    this.onStatus(this.status())
  }

  async stop(): Promise<void> {
    const child = this.process
    if (!child) { this.project = ''; return }
    this.process = null
    child.stdin?.end()
    const name = this.container
    this.container = ''
    this.project = ''
    try { await this.docker(['stop', '--time', '3', name], 10000) } catch { /* already exited */ }
    child.kill()
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error('Backend stopped')) }
    this.pending.clear()
    this.phase='unavailable';this.message = 'Docker backend stopped'
    this.onStatus(this.status())
  }
}
