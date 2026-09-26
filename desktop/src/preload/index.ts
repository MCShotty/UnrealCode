import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../shared/api'

const invoke = (name: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke(name, ...args)
const api: DesktopAPI = {
  workspaceArchive:id=>invoke('workspace:archive',id),workspaceRestore:id=>invoke('workspace:restore',id),
  onMaintenance:(callback)=>{ipcRenderer.on('app:maintenance-finished',callback);return ()=>ipcRenderer.removeListener('app:maintenance-finished',callback)},
  latestEvents:(id)=>invoke('session:latest',id),
  recoveryStatus:()=>invoke('recovery:status'),recoveryRetry:()=>invoke('recovery:retry'),
  backupExport:()=>invoke('recovery:export'),backupPreview:()=>invoke('recovery:preview'),backupRestore:id=>invoke('recovery:restore',id),
  storageList:()=>invoke('storage:list'),storageRemove:ids=>invoke('storage:remove',ids),
  supportPreview:()=>invoke('support:preview'),supportExport:()=>invoke('support:export'),
  updateStatus:()=>invoke('updates:status'),updateCheck:channel=>invoke('updates:check',channel),updateDownload:()=>invoke('updates:download'),updateCancel:()=>invoke('updates:cancel'),updateInstall:()=>invoke('updates:install'),
  repositorySearch:(query,filesOnly)=>invoke('repository:search',query,filesOnly),
  repositoryStatus:()=>invoke('repository:status'),
  contextSummaries:sessionId=>invoke('context:summaries',sessionId),
  contextCompact:sessionId=>invoke('context:compact',sessionId),
  contextSummarySelect:(sessionId,id)=>invoke('context:summary-select',sessionId,id),
  connections: () => invoke('connections:list'),
  connectionSave: config => invoke('connections:save',config),
  connectionRemove: id => invoke('connections:remove',id),
  connectionRevoke: id => invoke('connections:revoke',id),
  connectionCredential: (id,bearer,env) => invoke('connections:credential',id,bearer,env),
  connectionGrant: grant => invoke('connections:grant',grant),
  connectionConnect: (id,signIn) => invoke('connections:connect',id,signIn),
  connectionDisconnect: id => invoke('connections:disconnect',id),
  connectionResources: id => invoke('connections:resources',id),
  connectionResource: (id,uri) => invoke('connections:resource',id,uri),
  connectionPrompts: id => invoke('connections:prompts',id),
  connectionPrompt: (id,name,args) => invoke('connections:prompt',id,name,args),
  hostApprovals: sessionId => invoke('host:approvals',sessionId),
  hostRespond: (sessionId,id,digest,allow) => invoke('host:respond',sessionId,id,digest,allow),
  appVersion: () => invoke('app:version'),
  taskWorkspaces: () => invoke('workspace:tasks'),
  activeWorkspace: () => invoke('workspace:active'),
  workspacePreview: (id) => invoke('workspace:preview', id),
  workspaceIntegrate: (id, paths) => invoke('workspace:integrate', id, paths),
  workspaceRetain: (id) => invoke('workspace:retain', id),
  editorRead: (path) => invoke('editor:read', path),
  editorSave: (path, revision, content, workspace) => invoke('editor:save', path, revision, content, workspace),
  editorBase: (path) => invoke('editor:base', path),
  editorExternal: (path) => invoke('editor:external', path),
  sessionConfig: (sessionId) => invoke('session:config', sessionId),
  sessionMode: (sessionId, mode) => invoke('session:mode', sessionId, mode),
  approvals: (sessionId) => invoke('permission:list', sessionId),
  respondApproval: (sessionId, id, digest, allow) => invoke('permission:respond', sessionId, id, digest, allow),
  modelHealth: (provider, baseUrl, model, test) => invoke('models:health', provider, baseUrl, model, test),
  decisionTraces: (sessionId) => invoke('decision:traces', sessionId),
  decisionOverride: (sessionId, id, note) => invoke('decision:override', sessionId, id, note),
  evaluations: () => invoke('evaluation:list'),
  evaluationStart: (request) => invoke('evaluation:start', request),
  evaluationCancel: (id) => invoke('evaluation:cancel', id),
  evaluationCleanup: (id) => invoke('evaluation:cleanup', id),
  queueSnapshot: () => invoke('queue:get'),
  queueAdd: (prompt,options) => invoke('queue:add', prompt,options),
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
  githubIssues:()=>invoke('github:issues'),
  githubReviewComments:number=>invoke('github:review-comments',number),
  githubChecks:number=>invoke('github:checks',number),
  githubFailureLogs:(number,url)=>invoke('github:failure-logs',number,url),
  githubIntake:(kind,number,commentId)=>invoke('github:intake',kind,number,commentId),
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
  createSession: (config,options) => invoke('session:create', config,options),
  teamView:session=>invoke('team:view',session),
  teamConfigure:(session,options)=>invoke('team:configure',session,options),
  teamDispatch:(parent,assignment)=>invoke('team:dispatch',parent,assignment),
  teamResume:parent=>invoke('team:resume',parent),
  teamStop:parent=>invoke('team:stop',parent),
  teamWorkerAction:(parent,id,action,prompt)=>invoke('team:worker-action',parent,id,action,prompt),
  teamPreview:(parent,id)=>invoke('team:preview',parent,id),
  teamIntegrate:(parent,id,paths)=>invoke('team:integrate',parent,id,paths),
  workflowSettings:()=>invoke('workflow:settings'),
  workflowSave:value=>invoke('workflow:save',value),
  workflowRuns:()=>invoke('workflow:runs'),
  workflowRun:id=>invoke('workflow:run',id),
  workflowCancel:id=>invoke('workflow:cancel',id),
  workflowRemove:id=>invoke('workflow:remove',id),
  workflowTemplate:(session,id)=>invoke('workflow:template',session,id),
  workflowStart:(session,profile,repair,attempts)=>invoke('workflow:start',session,profile,repair,attempts),
  openSession: (sessionId) => invoke('session:open', sessionId),
  selectSession: (sessionId) => invoke('session:select', sessionId),
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
