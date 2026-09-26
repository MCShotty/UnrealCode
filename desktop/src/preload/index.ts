import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../shared/api'

const invoke = (name: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke(name, ...args)
const api: DesktopAPI = {
  modelHealth: (provider, baseUrl, model, test) => invoke('models:health', provider, baseUrl, model, test),
  decisionTraces: (sessionId) => invoke('decision:traces', sessionId),
  decisionOverride: (sessionId, id, note) => invoke('decision:override', sessionId, id, note),
  evaluations: () => invoke('evaluation:list'),
  evaluationStart: (request) => invoke('evaluation:start', request),
  evaluationCancel: (id) => invoke('evaluation:cancel', id),
  evaluationCleanup: (id) => invoke('evaluation:cleanup', id),
  queueSnapshot: () => invoke('queue:get'),
  queueAdd: (prompt) => invoke('queue:add', prompt),
  queueEdit: (id, prompt) => invoke('queue:edit', id, prompt),
  queueReorder: (ids) => invoke('queue:reorder', ids),
  queuePause: (paused) => invoke('queue:pause', paused),
  queueAction: (id, action) => invoke('queue:action', id, action),
  contextView: (sessionId) => invoke('context:view', sessionId),
  updateContext: (sessionId, patch) => invoke('context:update', sessionId, patch),
  handoffPreview: (sessionId) => invoke('handoff:preview', sessionId),
  handoffStart: (sessionId, summary, destination) => invoke('handoff:start', sessionId, summary, destination),
  searchHistory: (query, sessionId, allProjects) => invoke('history:search', query, sessionId, allProjects),
  getEventWindow: (sessionId, sequence) => invoke('session:event-window', sessionId, sequence),
  onNavigate: (callback) => { const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value); ipcRenderer.on('app:navigate', listener); return () => ipcRenderer.removeListener('app:navigate', listener) },
  onWorkflowChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, project: string): void => callback(project); ipcRenderer.on('workflow:changed', listener); return () => ipcRenderer.removeListener('workflow:changed', listener) },
  checkpoints: () => invoke('checkpoints:list'),
  checkpointPreview: (id, path) => invoke('checkpoints:preview', id, path),
  checkpointRestore: (id, paths) => invoke('checkpoints:restore', id, paths),
  checkpointRemove: (id) => invoke('checkpoints:remove', id),
  checkpointStorage: () => invoke('checkpoints:storage'),
  getSettings: () => invoke('settings:get'),
  updateSettings: (patch) => invoke('settings:update', patch),
  saveKey: (provider, key) => invoke('settings:save-key', provider, key),
  hasKey: (provider) => invoke('settings:has-key', provider),
  saveAdminKey: (provider, key) => invoke('usage:save-admin-key', provider, key),
  hasAdminKey: (provider) => invoke('usage:has-admin-key', provider),
  clearAdminKey: (provider) => invoke('usage:clear-admin-key', provider),
  usageSnapshot: (force) => invoke('usage:snapshot', force),
  executionSummary: (sessionId) => invoke('execution:summary', sessionId),
  cancelOperation: (sessionId, operationId) => invoke('operation:cancel', sessionId, operationId),
  codexStatus: () => invoke('settings:codex-status'),
  discoverModels: (provider, baseUrl) => invoke('models:discover', provider, baseUrl),
  githubStatus: () => invoke('github:status'),
  githubRepositories: () => invoke('github:repositories'),
  githubClone: (repository) => invoke('github:clone', repository),
  githubWorktrees: () => invoke('github:worktrees'),
  githubCreateWorktree: (branch, baseRef) => invoke('github:worktree-create', branch, baseRef),
  githubBranch: () => invoke('github:branch'),
  githubFetch: () => invoke('github:fetch'),
  githubPull: () => invoke('github:pull'),
  githubStage: (paths) => invoke('github:stage', paths),
  githubUnstage: (paths) => invoke('github:unstage', paths),
  githubCommit: (message) => invoke('github:commit', message),
  githubPush: (branch) => invoke('github:push', branch),
  githubPullRequests: () => invoke('github:prs'),
  githubPullRequest: (number) => invoke('github:pr', number),
  githubCreatePullRequest: (title, body, base, draft) => invoke('github:pr-create', title, body, base, draft),
  githubReviewPullRequest: (number, action, body) => invoke('github:pr-review', number, action, body),
  decisionStatus: () => invoke('decision:status'),
  decisionConsent: () => invoke('decision:consent'),
  decisionInstall: (engine) => invoke('decision:install', engine),
  evaluateDecision: (batch) => invoke('decision:evaluate', batch),
  extractEntities: (text, labels) => invoke('decision:extract', text, labels),
  pickProject: () => invoke('project:pick'),
  openProject: (path, _trust) => invoke('project:open', path),
  projectPath: () => invoke('project:path'),
  dockerStatus: () => invoke('docker:status'),
  listSessions: () => invoke('session:list'),
  createSession: (config) => invoke('session:create', config),
  openSession: (sessionId) => invoke('session:open', sessionId),
  sendMessage: (sessionId, prompt, messageId) => invoke('session:send', sessionId, prompt, messageId),
  stopSession: (sessionId) => invoke('session:stop', sessionId),
  forkSession: (sessionId) => invoke('session:fork', sessionId),
  getEvents: async (sessionId, after) => {
    const all: import('../shared/api').AgentEvent[] = []
    let cursor = after
    for (;;) {
      const page = await invoke('session:events', sessionId, cursor) as import('../shared/api').AgentEvent[]
      if (page.length === 0) break
      all.push(...page)
      const next = page[page.length - 1].seq
      if (page.length < 1000 || next <= cursor) break
      cursor = next
    }
    return all
  },
  listFiles: (relative) => invoke('files:list', relative),
  readFile: (relative) => invoke('files:read', relative),
  gitChanges: () => invoke('files:changes'),
  gitDiff: (relative) => invoke('files:diff', relative),
  listSkills: () => invoke('skills:list'),
  saveSkill: (name, content) => invoke('skills:save', name, content),
  deleteSkill: (name) => invoke('skills:delete', name),
  terminalStart: () => invoke('terminal:start'),
  terminalWrite: (id, data) => invoke('terminal:write', id, data),
  terminalResize: (id, cols, rows) => invoke('terminal:resize', id, cols, rows),
  terminalStop: (id) => invoke('terminal:stop', id),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  onDockerStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value)
    ipcRenderer.on('docker:status-changed', listener)
    return () => ipcRenderer.removeListener('docker:status-changed', listener)
  },
  onTerminalData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  }
}
contextBridge.exposeInMainWorld('unreal', api)
