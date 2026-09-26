import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentEvent, BridgeSessionConfig, DecisionBatch, DecisionStatus, Provider } from '../shared/api'
import { DockerBridge } from './docker'
import { codexStatus, credentialFor, getSettings, hasKey, rememberProject, saveKey, updateSettings, migrateLegacySettings, setDecisionConsent, saveAdminKey, hasAdminKey, clearAdminKey } from './settings'
import { AccountUsageService } from './account-usage'
import { SessionUsageService } from './session-usage'
import { deleteSkill, gitChanges, gitDiff, listFiles, listSkills, readFile, saveSkill } from './files'
import * as github from './github'
import { discoverModels } from './models'
import { CheckpointService } from './checkpoint-service'
import { backendEnvironment } from './child-environment'

if (process.env.UNREAL_DESKTOP_USER_DATA) {
  mkdirSync(process.env.UNREAL_DESKTOP_USER_DATA, { recursive: true })
  app.setPath('userData', process.env.UNREAL_DESKTOP_USER_DATA)
} else {
  app.setPath('userData', join(app.getPath('appData'), 'UnrealCode'))
}

const bridge = new DockerBridge()
const accountUsage = new AccountUsageService()
const sessionUsage = new SessionUsageService(bridge)
const execFileAsync = promisify(execFile)
let window: BrowserWindow | null = null
let checkpoints: CheckpointService | null = null
const terminals = new Map<string, { write(data: string): void; resize(cols: number, rows: number): void; kill(): void }>()

function project(): string {
  if (!bridge.projectPath) throw new Error('Open a trusted project first')
  return bridge.projectPath
}

async function sessionCredential(sessionId?: string): Promise<Record<string, string>> {
  const settings = getSettings()
  let provider = settings.provider
  let baseUrl = settings.baseUrl
  if (sessionId) {
    const config = await bridge.request<{ provider: Provider; baseUrl: string }>('session.config', { sessionId })
    provider = config.provider || provider
    baseUrl = config.baseUrl || baseUrl
  }
  return credentialFor(provider, baseUrl)
}

async function typeSafeKey(): Promise<string> {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY
  if (process.platform !== 'win32') return ''
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','User')"],
      { windowsHide: true, timeout: 5000, maxBuffer: 16 * 1024 })
    return stdout.trim()
  } catch { return '' }
}

async function configureDecision(): Promise<DecisionStatus> {
  const settings = getSettings()
  if (!bridge.projectPath) return { engine: settings.decisionEngine, available: false, glinerAvailable: false, message: 'Open a project first.' }
  const consent = settings.decisionCloudProjects.includes(bridge.projectPath)
  const key = settings.decisionEngine === 'jev' && consent ? await typeSafeKey() : ''
  const engine = settings.decisionEngine === 'jev' && !consent ? 'off' : settings.decisionEngine
  const backend = await bridge.request<DecisionStatus>('decision.configure', { engine, model: settings.decisionModel || 'jev-latest', apiKey: key, glinerEnabled: settings.glinerEnabled })
  if (settings.decisionEngine === 'jev' && !consent) return { ...backend, engine: 'jev', available: false, message: 'Allow TypeSafe cloud decisions for this project in Settings.' }
  return backend
}

async function requestDecisionConsent(canonical: string): Promise<boolean> {
  const settings = getSettings()
  if (settings.decisionCloudProjects.includes(canonical)) return true
  const consent = await dialog.showMessageBox(window!, {
    type: 'question', title: 'Allow TypeSafe decisions?', buttons: ['Allow for this project', 'Not now'], defaultId: 1, cancelId: 1,
    message: 'UnrealCode can send focused text from this workspace to TypeSafe for bounded semantic decisions.',
    detail: 'This applies to this project only. You can change it in Settings.'
  })
  const allowed = consent.response === 0
  setDecisionConsent(canonical, allowed)
  await configureDecision()
  return allowed
}

function closeTerminals(): void {
  for (const terminal of terminals.values()) terminal.kill()
  terminals.clear()
}

function registerIPC(): void {
  const checkpointService = (): CheckpointService => { if (!checkpoints) throw new Error('Open a project first'); return checkpoints }
  const idleMutation = <T>(work: () => Promise<T>): Promise<T> => checkpointService().exclusive(async () => {
    if (checkpointService().busy || !await bridge.request<boolean>('project.idle', {})) throw new Error('Wait for active project work to finish before changing files or Git state')
    return work()
  })
  ipcMain.handle('checkpoints:list', () => checkpointService().store.list())
  ipcMain.handle('checkpoints:preview', (_event, id: string, path: string) => checkpointService().store.preview(id, path))
  ipcMain.handle('checkpoints:storage', () => checkpointService().store.storage())
  ipcMain.handle('checkpoints:remove', (_event, id: string) => checkpointService().exclusive(() => checkpointService().store.remove(id)))
  ipcMain.handle('checkpoints:restore', (_event, id: string, paths: string[]) => checkpointService().exclusive(async () => {
    if (checkpointService().busy || terminals.size || !await bridge.request<boolean>('project.idle', {})) throw new Error('Stop active work and close the container terminal before restoring files')
    return checkpointService().store.restore(id, paths)
  }))
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', async (_event, patch) => {
    const next = updateSettings(patch)
    nativeTheme.themeSource = next.theme
    window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#101726' : '#f3f5fb')
    if (bridge.projectPath) {
      if (next.decisionEngine === 'jev' && !next.decisionCloudProjects.includes(bridge.projectPath) && !next.decisionCloudDeclinedProjects.includes(bridge.projectPath)) await requestDecisionConsent(bridge.projectPath)
      await configureDecision()
    }
    return getSettings()
  })
  ipcMain.handle('settings:save-key', (_event, provider: string, key: string) => saveKey(provider, key))
  ipcMain.handle('settings:has-key', (_event, provider: string) => hasKey(provider))
  ipcMain.handle('usage:save-admin-key', (_event, provider: 'openai' | 'anthropic', key: string) => {
    saveAdminKey(provider, key)
    accountUsage.invalidate(provider)
  })
  ipcMain.handle('usage:has-admin-key', (_event, provider: 'openai' | 'anthropic') => hasAdminKey(provider))
  ipcMain.handle('usage:clear-admin-key', (_event, provider: 'openai' | 'anthropic') => {
    clearAdminKey(provider)
    accountUsage.invalidate(provider)
  })
  ipcMain.handle('usage:snapshot', async (_event, force = false) => {
    const [accounts, sessions] = await Promise.all([accountUsage.snapshot(force), sessionUsage.summaries()])
    return { accounts, sessions }
  })
  ipcMain.handle('execution:summary', (_event, sessionId: string) => sessionUsage.execution(sessionId))
  ipcMain.handle('operation:cancel', (_event, sessionId: string, operationId: string) => bridge.request('operation.cancel', { sessionId, operationId }))
  ipcMain.handle('settings:codex-status', () => codexStatus())
  ipcMain.handle('models:discover', (_event, provider: Provider, baseUrl: string) => discoverModels(provider, baseUrl))
  ipcMain.handle('decision:status', () => configureDecision())
  ipcMain.handle('decision:consent', async () => requestDecisionConsent(project()))
  ipcMain.handle('decision:install', async (_event, engine: 'laya' | 'gliner') => {
    if (engine !== 'laya' && engine !== 'gliner') throw new Error('Invalid local engine')
    await bridge.request('decision.install', { engine }, 20 * 60 * 1000)
    return configureDecision()
  })
  ipcMain.handle('decision:evaluate', async (_event, batch: DecisionBatch) => {
    await configureDecision()
    return bridge.request('decision.evaluate', batch, getSettings().decisionEngine === 'laya' ? 10 * 60 * 1000 : 120000)
  })
  ipcMain.handle('decision:extract', (_event, text: string, labels: string[]) => bridge.request('decision.extract', { text, labels }, 10 * 60 * 1000))
  ipcMain.handle('github:status', () => github.githubStatus())
  ipcMain.handle('github:repositories', () => github.githubRepositories())
  ipcMain.handle('github:clone', async (_event, repository: string) => {
    const chosen = await dialog.showOpenDialog(window!, { title: 'Choose a folder for the clone', properties: ['openDirectory'] })
    if (chosen.canceled || !chosen.filePaths[0]) throw new Error('Clone canceled')
    return github.githubClone(repository, chosen.filePaths[0])
  })
  ipcMain.handle('github:worktrees', () => github.githubWorktrees(project()))
  ipcMain.handle('github:worktree-create', (_event, branch: string, baseRef: string) => github.githubCreateWorktree(project(), branch, baseRef))
  ipcMain.handle('github:branch', () => github.githubBranch(project()))
  ipcMain.handle('github:fetch', () => idleMutation(() => github.githubFetch(project())))
  ipcMain.handle('github:pull', () => idleMutation(() => github.githubPull(project())))
  ipcMain.handle('github:stage', (_event, paths: string[]) => idleMutation(() => github.githubStage(project(), paths, true)))
  ipcMain.handle('github:unstage', (_event, paths: string[]) => idleMutation(() => github.githubStage(project(), paths, false)))
  ipcMain.handle('github:commit', (_event, message: string) => idleMutation(() => github.githubCommit(project(), message)))
  ipcMain.handle('github:push', (_event, branch: string) => idleMutation(() => github.githubPush(project(), branch)))
  ipcMain.handle('github:prs', () => github.githubPullRequests(project()))
  ipcMain.handle('github:pr', (_event, number: number) => github.githubPullRequest(project(), number))
  ipcMain.handle('github:pr-create', (_event, title: string, body: string, base: string, draft: boolean) => github.githubCreatePullRequest(project(), title, body, base, draft))
  ipcMain.handle('github:pr-review', (_event, number: number, action: 'approve' | 'comment' | 'request-changes', body: string) => github.githubReviewPullRequest(project(), number, action, body))

  ipcMain.handle('project:pick', async () => {
    const chosen = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] })
    return chosen.canceled ? null : chosen.filePaths[0]
  })
  ipcMain.handle('project:path', () => bridge.projectPath || null)
  ipcMain.handle('project:open', async (_event, requested: string) => {
    const canonical = await fs.realpath(requested)
    const stat = await fs.stat(canonical)
    if (!stat.isDirectory()) throw new Error('Project must be a directory')
    if (!getSettings().trustedProjects.includes(canonical)) {
      const choice = await dialog.showMessageBox(window!, {
        type: 'warning', buttons: ['Trust and open', 'Cancel'], defaultId: 1, cancelId: 1,
        title: 'Trust this workspace?',
        message: `UnrealCode can run commands and edit files in:\n${canonical}`,
        detail: 'Open only projects you trust. The selected folder is mounted into the agent container.'
      })
      if (choice.response !== 0) throw new Error('Workspace trust was not granted')
    }
    closeTerminals()
    if (checkpoints?.busy) throw new Error('Stop active work before switching projects')
    sessionUsage.clear()
    const status = await bridge.start(canonical)
    checkpoints = new CheckpointService(canonical, app.getPath('userData'))
    await checkpoints.store.recover()
    checkpoints.onState = (sessionId, state, checkpointId) => window?.webContents.send('agent:event', { v: 1, event: 'desktop.state', sessionId, seq: -Date.now(), payload: { state, checkpointId } })
    rememberProject(canonical)
    const settings = getSettings()
    if (settings.decisionEngine === 'jev' && !settings.decisionCloudProjects.includes(canonical) && !settings.decisionCloudDeclinedProjects.includes(canonical)) await requestDecisionConsent(canonical)
    await configureDecision()
    return status
  })
  ipcMain.handle('docker:status', () => bridge.probe())

  ipcMain.handle('session:list', () => bridge.request('session.list', {}))
  ipcMain.handle('session:create', async (_event, supplied: BridgeSessionConfig) => {
    const settings = getSettings()
    const config: BridgeSessionConfig = {
      provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl,
      thinkingLevel: settings.thinkingLevel, systemPrompt: settings.projectInstructions[project()] || settings.systemPrompt,
      disallowedTools: settings.disallowedTools
    }
    if (Buffer.byteLength(config.systemPrompt, 'utf8') > 256 * 1024) throw new Error('Project instructions exceed 256 KB')
    void supplied
    return bridge.request('session.create', { config, credential: await sessionCredential() })
  })
  ipcMain.handle('session:open', (_event, sessionId: string) => checkpointService().exclusive(async () => {
    await bridge.request('session.open', { sessionId, credential: await sessionCredential(sessionId) })
  }))
  ipcMain.handle('session:send', async (_event, sessionId: string, prompt: string, messageId: string) => {
    if (typeof prompt !== 'string' || Buffer.byteLength(prompt, 'utf8') > 1024 * 1024) throw new Error('Message exceeds 1 MB')
    const credential = await sessionCredential(sessionId)
    await checkpointService().send(sessionId, messageId, prompt, () => bridge.request('session.send', { sessionId, prompt, messageId, credential }), terminals.size > 0)
  })
  ipcMain.handle('session:stop', (_event, sessionId: string) => bridge.request('session.stop', { sessionId }))
  ipcMain.handle('session:fork', async (_event, sessionId: string) => bridge.request('session.fork', { sessionId, credential: await sessionCredential(sessionId) }))
  ipcMain.handle('session:events', (_event, sessionId: string, after: number) => bridge.request('session.events', { sessionId, after, limit: 1000 }))

  ipcMain.handle('files:list', (_event, relative?: string) => listFiles(project(), relative))
  ipcMain.handle('files:read', (_event, relative: string) => readFile(project(), relative))
  ipcMain.handle('files:changes', () => gitChanges(project()))
  ipcMain.handle('files:diff', (_event, relative: string) => gitDiff(project(), relative))
  ipcMain.handle('skills:list', () => listSkills(project()))
  ipcMain.handle('skills:save', (_event, name: string, content: string) => idleMutation(() => saveSkill(project(), name, content)))
  ipcMain.handle('skills:delete', (_event, name: string) => idleMutation(() => deleteSkill(project(), name)))

  ipcMain.handle('terminal:start', () => checkpointService().exclusive(async () => {
    const container = bridge.containerName
    if (!container) throw new Error('Container is not running')
    const pty = await import('node-pty')
    const terminal = pty.spawn('docker', ['exec', '-it', container, '/bin/bash'], {
      name: 'xterm-256color', cols: 100, rows: 30, cwd: project(),
      env: backendEnvironment()
    })
    const id = randomUUID()
    terminals.set(id, terminal)
    checkpointService().markExternalWork()
    terminal.onData((data: string) => window?.webContents.send('terminal:data', { id, data }))
    terminal.onExit(({ exitCode }: { exitCode: number }) => {
      terminals.delete(id)
      window?.webContents.send('terminal:exit', { id, code: exitCode })
    })
    return id
  }))
  ipcMain.handle('terminal:write', (_event, id: string, data: string) => terminals.get(id)?.write(data))
  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => terminals.get(id)?.resize(cols, rows))
  ipcMain.handle('terminal:stop', (_event, id: string) => { terminals.get(id)?.kill(); terminals.delete(id) })
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1000, minHeight: 650,
    title: 'UnrealCode', backgroundColor: nativeTheme.shouldUseDarkColors ? '#101726' : '#f3f5fb',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const openInBrowser = (url: string): void => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(url)
    } catch { /* Ignore malformed links. */ }
  }
  window.webContents.setWindowOpenHandler(({ url }) => { openInBrowser(url); return { action: 'deny' } })
  window.webContents.on('will-navigate', (event, url) => { event.preventDefault(); openInBrowser(url) })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
  window.on('closed', () => { window = null })
}

app.whenReady().then(() => {
  migrateLegacySettings()
  nativeTheme.themeSource = getSettings().theme
  nativeTheme.on('updated', () => window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#101726' : '#f3f5fb'))
  app.setAppUserModelId('ai.mcshotty.unrealcode')
  registerIPC()
  bridge.onEvent = (value: AgentEvent) => {
    window?.webContents.send('agent:event', value)
    void checkpoints?.event(value).catch((error) => window?.webContents.send('agent:event', { ...value, event: 'desktop.state', payload: { state: 'failed', message: String(error) } }))
  }
  bridge.onStatus = (value) => window?.webContents.send('docker:status-changed', value)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { closeTerminals(); void bridge.stop() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
