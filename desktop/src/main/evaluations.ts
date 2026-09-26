import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { DockerBridge } from './docker'
import { backendEnvironment } from './child-environment'
import { credentialFor } from './settings'
import { SessionUsageService, consumeUsage } from './session-usage'
import { emptyTotals } from './account-usage'
import { handoffSummary } from './handoff'
import { readFile } from './files'
import { decisionTraces } from './decision-trace'
import type { AgentEvent, BridgeSessionConfig } from '../shared/api'
import type { EvaluationRequest, EvaluationReport, EvaluationArm } from '../shared/diagnostics'

const exec = promisify(execFile)
const command = async (file: string, args: string[], cwd: string, timeout = 60000, signal?: AbortSignal): Promise<string> => (await exec(file, args, { cwd, timeout, signal, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: backendEnvironment() })).stdout.trim()
export function validateEvaluation(request: EvaluationRequest): void {
  if (!request || !Array.isArray(request.tasks) || !request.tasks.length || request.tasks.length > 10) throw new Error('Select between 1 and 10 tasks')
  if (!Number.isInteger(request.runLimit) || request.runLimit < request.tasks.length * 2 || request.runLimit > 20) throw new Error('Run limit must cover both arms of every task and be at most 20')
  if (!Number.isInteger(request.timeoutMinutes) || request.timeoutMinutes < 1 || request.timeoutMinutes > 30) throw new Error('Choose a timeout from 1 to 30 minutes per run')
  for (const task of request.tasks) if (typeof task.prompt !== 'string' || !task.prompt.trim() || task.prompt.length > 16000 || typeof task.criteria !== 'string' || !task.criteria.trim() || task.criteria.length > 4000 || typeof task.testCommand !== 'string' || task.testCommand.length > 4000) throw new Error('Each task needs a bounded prompt, completion criteria, and optional test command')
}
type DecisionConfig = { engine: string; model: string; apiKey: string; glinerEnabled: boolean }
export class Evaluations {
  private starting = false
  private active = new Map<string, { cancel: AbortController; bridge?: DockerBridge }>()
  constructor(private directory: string) {}
  private path(id: string): string { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid evaluation ID'); return join(this.directory, `${id}.json`) }
  private async save(report: EvaluationReport): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    const temporary = `${this.path(report.id)}.tmp`; await fs.writeFile(temporary, JSON.stringify(report), { mode: 0o600 }); await fs.rename(temporary, this.path(report.id))
  }
  async list(project: string): Promise<EvaluationReport[]> {
    project = await fs.realpath(project)
    const reports: EvaluationReport[] = []
    for (const name of await fs.readdir(this.directory).catch(() => [] as string[])) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
      const report = JSON.parse(await fs.readFile(join(this.directory, name), 'utf8')) as EvaluationReport
      if (report.project !== project) continue
      if (report.state === 'running' && !this.active.has(report.id)) { report.state = 'interrupted'; report.error = 'Application restarted; execution will not resume automatically.' }
      reports.push(report)
    }
    return reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async start(project: string, config: BridgeSessionConfig, request: EvaluationRequest, decision: DecisionConfig, exclusions: string[]): Promise<string> {
    validateEvaluation(request)
    if (decision.engine === 'off' || (decision.engine === 'jev' && !decision.apiKey)) throw new Error('Set up the selected decision engine and project consent before comparing runs')
    if (this.starting || this.active.size) throw new Error('Finish or cancel the active evaluation first')
    this.starting = true
    try {
      project = await fs.realpath(project)
      // Resolve the actual repository root and a fixed committed input; never clone dirty user files.
      const repository = await fs.realpath(await command('git', ['rev-parse', '--show-toplevel'], project))
      if (repository.toLowerCase() !== project.toLowerCase()) throw new Error('Open the repository root for evaluations')
      if (await command('git', ['status', '--porcelain'], project)) throw new Error('Commit or stash project changes before comparing identical committed inputs')
      const revision = await command('git', ['rev-parse', 'HEAD'], project)
      credentialFor(config.provider, config.baseUrl)
      const savedConfig: BridgeSessionConfig = { provider: config.provider, model: config.model, baseUrl: config.baseUrl, thinkingLevel: config.thinkingLevel, systemPrompt: config.systemPrompt, disallowedTools: [...config.disallowedTools], mode: config.mode || 'agent' }
      const savedRequest: EvaluationRequest = { runLimit: request.runLimit, timeoutMinutes: request.timeoutMinutes, tasks: request.tasks.map(task => ({ prompt: task.prompt, criteria: task.criteria, testCommand: task.testCommand })) }
      const id = randomUUID(), report: EvaluationReport = { id, project, createdAt: new Date().toISOString(), revision, config: savedConfig, engine: decision.engine, model: decision.model, request: savedRequest, state: 'running', arms: request.tasks.flatMap((_, task) => [{ task, decisions: false, state: 'pending' }, { task, decisions: true, state: 'pending' }]) }
      await this.save(report)
      const running = { cancel: new AbortController(), bridge: undefined as DockerBridge | undefined }; this.active.set(id, running)
      void this.run(report, running, decision, exclusions).catch(async () => { report.state = 'failed'; report.error = 'Evaluation could not finish; inspect retained worktrees and report.'; await this.save(report).catch(() => {}) }).finally(() => this.active.delete(id))
      return id
    } finally { this.starting = false }
  }
  async cancel(id: string): Promise<void> { const active = this.active.get(id); if (!active) return; active.cancel.abort(); await active.bridge?.stop() }
  stopAll(): void { for (const id of this.active.keys()) void this.cancel(id) }
  private async run(report: EvaluationReport, active: { cancel: AbortController; bridge?: DockerBridge }, decision: DecisionConfig, exclusions: string[]): Promise<void> {
    for (let index = 0; index < report.arms.length; index++) {
      if (active.cancel.signal.aborted) break
      const arm = report.arms[index], task = report.request.tasks[arm.task]
      const directory = join(this.directory, 'worktrees', report.id, String(index))
      await fs.mkdir(join(directory, '..'), { recursive: true })
      await command('git', ['worktree', 'add', '--detach', directory, report.revision], report.project)
      arm.worktree = directory; arm.retainedVolume = `unrealcode-eval-${createHash('sha256').update(directory.toLowerCase()).digest('hex').slice(0, 20)}`; arm.state = 'running'; await this.save(report)
      const bridge = new DockerBridge(); active.bridge = bridge
      const observedUsage = emptyTotals()
      const events: AgentEvent[] = []; let idle = false, failure = '', sessionId = '', usageCaptured = false
      bridge.onEvent = event => {
        events.push(event)
        consumeUsage(observedUsage, event)
        if (event.event === 'session.idle') idle = true
        if (event.event === 'session.needs_input') failure = 'Run needs user input; compare after refining the task inputs.'
        if (event.event === 'session.status' && (event.payload as any).status === 'error') failure = 'Model session failed.'
        if (event.event === 'decision.error') failure = 'Decision checkpoint failed; this run cannot establish a decision-enabled comparison.'
      }
      const start = performance.now()
      try {
        await bridge.start(directory, true)
        if (active.cancel.signal.aborted) throw new Error('Cancelled')
        await bridge.request('context.configure', { excluded: exclusions })
        let status = await bridge.request<{ available: boolean }>('decision.configure', arm.decisions ? decision : { engine: 'off', model: '', apiKey: '', glinerEnabled: decision.glinerEnabled })
        if (arm.decisions && decision.engine === 'laya' && !status.available) {
          await bridge.request('decision.install', { engine: 'laya' }, 20 * 60 * 1000)
          status = await bridge.request('decision.configure', decision)
        }
        if (arm.decisions && !status.available) throw new Error('Selected decision engine is unavailable in the isolated runtime; no alternate engine was used.')
        const created = await bridge.request<{ sessionId: string }>('session.create', { config: report.config, credential: credentialFor(report.config.provider, report.config.baseUrl) })
        sessionId = created.sessionId; arm.sessionId = sessionId
        await bridge.request('session.send', { sessionId, prompt: `${task.prompt}\n\nCompletion criteria:\n${task.criteria}`, messageId: randomUUID(), credential: credentialFor(report.config.provider, report.config.baseUrl) })
        const deadline = Date.now() + report.request.timeoutMinutes * 60000
        while (!idle || !await bridge.request<boolean>('decision.idle', {})) {
          if (active.cancel.signal.aborted) throw new Error('Cancelled')
          if (failure) throw new Error(failure)
          if (Date.now() > deadline) throw new Error('Run time limit reached')
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        if (failure) throw new Error(failure)
        if (task.testCommand.trim()) {
          try { arm.tests = { exitCode: 0, output: await command('docker', ['exec', '-w', '/workspace', bridge.containerName, 'bash', '-lc', task.testCommand], report.project, 120000, active.cancel.signal) } }
          catch (error) { const value = error as { code?: number; stdout?: string; stderr?: string }; arm.tests = { exitCode: typeof value.code === 'number' ? value.code : -1, output: `${value.stdout || ''}\n${value.stderr || ''}`.slice(0, 100000) } }
        }
        arm.state = active.cancel.signal.aborted ? 'cancelled' : 'completed'
      } catch (error) { arm.state = active.cancel.signal.aborted ? 'cancelled' : 'failed'; arm.error = (error as Error).message }
      finally {
        if (sessionId) {
          await bridge.request('session.stop', { sessionId }).catch(() => {})
          const persisted = (await new SessionUsageService(bridge).summaries().catch(() => [])).find(item => item.sessionId === sessionId)?.totals
          arm.usage = persisted || observedUsage
          usageCaptured = !!persisted
          if (!persisted) arm.error = `${arm.error || ''} Usage includes only events observed before disconnection; persisted runtime storage is retained.`.trim()
        }
        arm.elapsedMs = performance.now() - start
        arm.explanation = handoffSummary(events, [])
        arm.decisionTrace = decisionTraces(events)
        // Includes created/deleted tracked files; list untracked paths separately for review.
        let captured = true
        arm.diff = await command('git', ['diff', '--no-ext-diff', '--no-textconv', report.revision, '--'], directory).catch(() => { captured = false; return 'Diff unavailable; worktree retained' })
        const stats = await command('git', ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', report.revision, '--'], directory).catch(() => { captured = false; return '' })
        if (stats.split('\0').some(record => record.startsWith('-\t-\t'))) {
          captured = false
          arm.diff += '\nBinary changes are not recoverable from a text diff; worktree retained.'
        }
        const untracked = await command('git', ['ls-files', '--others', '--exclude-standard', '-z'], directory).catch(() => { captured = false; return '' })
        const names = untracked.split('\0').filter(Boolean); arm.createdFiles = []
        if (names.length > 100) captured = false
        let remaining = 1024 * 1024
        for (const path of names.slice(0, 100)) {
          try { const content = await readFile(directory, path); const bytes = Buffer.byteLength(content); if (bytes > remaining) throw new Error('Evaluation artifact budget exceeded'); remaining -= bytes; arm.createdFiles.push({ path, content }) }
          catch { captured = false; arm.createdFiles.push({ path, reason: 'File could not be captured as bounded text; worktree retained' }) }
        }
        await bridge.stop(); active.bridge = undefined
        await this.save(report)
        if (captured) {
          await this.removeWorktree(report, arm).catch(() => {})
          if (usageCaptured || !sessionId) await this.removeVolume(report, arm).catch(() => {})
        }
      }
      if (arm.state !== 'completed') break
    }
    report.state = active.cancel.signal.aborted ? 'cancelled' : report.arms.every(arm => arm.state === 'completed') ? 'completed' : 'failed'
    await this.save(report)
  }
  private async removeWorktree(report: EvaluationReport, arm: EvaluationArm): Promise<void> {
    if (!arm.worktree) return
    const base = await fs.realpath(join(this.directory, 'worktrees', report.id)), target = await fs.realpath(arm.worktree)
    const displacement = relative(base, target)
    if (!displacement || displacement.startsWith('..') || isAbsolute(displacement)) throw new Error('Worktree cleanup path is outside this evaluation')
    await command('git', ['worktree', 'remove', '--force', target], report.project)
    arm.worktree = undefined; await this.save(report)
  }
  private async removeVolume(report: EvaluationReport, arm: EvaluationArm): Promise<void> {
    if (!arm.retainedVolume) return
    const directory = join(this.directory, 'worktrees', report.id, String(report.arms.indexOf(arm)))
    const expected = `unrealcode-eval-${createHash('sha256').update(directory.toLowerCase()).digest('hex').slice(0, 20)}`
    if (arm.retainedVolume !== expected) throw new Error('Evaluation storage identity does not match its run')
    await command('docker', ['volume', 'rm', expected], report.project)
    arm.retainedVolume = undefined; await this.save(report)
  }
  async cleanup(project: string, id: string): Promise<void> {
    if (this.active.has(id)) throw new Error('Cancel and finish the active evaluation before cleanup')
    const report = (await this.list(project)).find(item => item.id === id); if (!report) throw new Error('Evaluation not found in this project')
    for (const arm of report.arms) { await this.removeWorktree(report, arm); await this.removeVolume(report, arm) }
  }
}
