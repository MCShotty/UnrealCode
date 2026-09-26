export type Provider = 'openai' | 'openai-codex' | 'anthropic' | 'openrouter' | 'fireworks' | 'ollama' | 'openai-compatible'
export type DecisionEngine = 'off' | 'jev' | 'laya'
export type ExecutionMode = 'plan' | 'ask' | 'agent'
export type ApprovalRequest = { id: string; sessionId: string; workspaceId: string; operationId: string; digest: string; tool: string; arguments: unknown; expiresAt: string }
export type CheckpointFile = { path: string; change: 'added' | 'deleted' | 'modified' | 'uncaptured'; reason?: string }
export type Checkpoint = { id: string; sessionId: string; messageIds: string[]; title: string; createdAt: string; state: 'capturing' | 'running' | 'complete' | 'incomplete'; reason?: string; files: CheckpointFile[]; durationMs: number }
export type CheckpointPreview = { path: string; before: string; after: string; diff: string; binary: boolean; conflict: boolean; reason?: string; beforeSize: number; afterSize: number }
export type Settings = {
  recentProjects: string[]
  trustedProjects: string[]
  provider: Provider
  model: string
  thinkingLevel: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  systemPrompt: string
  projectInstructions: Record<string, string>
  theme: 'dark' | 'light' | 'system'
  layout: { sessionWidth: number; activityWidth: number; sessions: boolean; activity: boolean; focus: boolean }
  notifications: boolean
  executionMode: ExecutionMode
  taskIsolation: boolean
  autoCompaction: boolean
  disallowedTools: string[]
  baseUrl: string
  decisionEngine: DecisionEngine
  decisionSetupSeen: boolean
  decisionModel: string
  decisionCloudProjects: string[]
  decisionCloudDeclinedProjects: string[]
  glinerEnabled: boolean
}
export type SessionInfo = { id: string; title: string; lastUpdatedAt: string; active: boolean; state?: string; parentSessionId?: string }
export type AgentEvent = { v: number; event: string; sessionId: string; seq: number; sourceSequence?: number; recordedAt?: string; payload: unknown }
export type UsageTotals = { input: number; output: number; cached: number; cacheWrite: number; reasoning: number; calls: number; decisionInput: number; decisionOutput: number; decisionCalls: number; latestInput: number }
export type SessionUsage = { sessionId: string; title: string; provider: Provider; model: string; totals: UsageTotals; contextLimit?: number; contextSource?: string; rateLimits?: Record<string, string> }
export type UsageWindow = { id: string; label: string; usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }
export type AccountUsage = { source: 'codex' | 'openai' | 'anthropic'; scope: string; status: 'fresh' | 'stale' | 'unavailable'; observedAt?: string; message?: string; totals?: UsageTotals; windows?: UsageWindow[] }
export type UsageSnapshot = { accounts: AccountUsage[]; sessions: SessionUsage[] }
export type OperationLane = { id: string; sessionId: string; type: string; status: string; startedAt?: string; endedAt?: string; durationMs?: number }
export type ExecutionSummary = { operations: OperationLane[]; modelMs: number; toolWallMs: number; toolOverlapMs: number; modelCalls: number; approvalWaitMs?: number }
export type FileEntry = { name: string; path: string; directory: boolean; size: number }
export type EditableFile = { path: string; revision: string; content: string; workspace: string }
export type SkillEntry = { name: string; description: string; content: string }
export type DockerStatus = { ready: boolean; message: string; container?: string }
export type BridgeSessionConfig = { provider: Provider; model: string; baseUrl: string; thinkingLevel: string; systemPrompt: string; disallowedTools: string[]; parentSessionId?: string; mode?: ExecutionMode; workspaceId?: string; workspace?: 'project' | 'isolated'; teamEnabled?:boolean; teamManaged?:boolean; specialist?:boolean }
export type GitHubStatus = { installed: boolean; authenticated: boolean; account?: string; message: string }
export type GitHubRepository = { nameWithOwner: string; description: string; isPrivate: boolean; url: string }
export type GitHubWorktree = { path: string; branch: string; head: string; current: boolean }
export type GitHubPullRequest = { number: number; title: string; state: string; isDraft: boolean; url: string; headRefName: string; baseRefName: string; reviewDecision?: string; checks?: string }
export type DecisionQuestion = { type: 'choice' | 'noul' | 'score'; instructions: string; criteria?: Record<string, string> | string[] }
export type DecisionBatch = { state: unknown; questions: Record<string, DecisionQuestion>; sourceRefs?: string[] }
export type DecisionResult = { engine: 'jev' | 'laya'; model: string; answers: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number }; durationMs: number }
export type DecisionStatus = { engine: DecisionEngine; available: boolean; message: string; glinerAvailable: boolean }

export interface DesktopAPI {
  onMaintenance(callback:()=>void):()=>void
  latestEvents(sessionId:string):Promise<AgentEvent[]>
  recoveryStatus():Promise<import('./recovery').RecoveryStatus>
  recoveryRetry():Promise<void>
  backupExport():Promise<string|null>
  backupPreview():Promise<import('./recovery').BackupPreview|null>
  backupRestore(id:string):Promise<void>
  storageList():Promise<import('./recovery').StorageItem[]>
  storageRemove(ids:string[]):Promise<void>
  supportPreview():Promise<string>
  supportExport():Promise<string|null>
  updateStatus():Promise<import('./recovery').UpdateState>
  updateCheck(channel:'stable'|'preview'):Promise<import('./recovery').UpdateState>
  updateDownload():Promise<import('./recovery').UpdateState>
  updateCancel():Promise<void>
  updateInstall():Promise<void>
  workflowSettings():Promise<import('./verification').WorkflowPresets>
  workflowSave(value:import('./verification').WorkflowPresets):Promise<void>
  workflowRuns():Promise<import('./verification').WorkflowRun[]>
  workflowRun(id:string):Promise<import('./verification').WorkflowRun>
  workflowCancel(id:string):Promise<void>
  workflowRemove(id:string):Promise<void>
  workflowTemplate(sessionId:string,id:string):Promise<void>
  workflowStart(sessionId:string,profileId:string,repairTemplateId:string|undefined,maxRepairAttempts:number):Promise<string>
  teamView(sessionId:string):Promise<import('./teams').TeamView|null>
  teamConfigure(sessionId:string,options:import('./teams').TeamOptions):Promise<void>
  teamDispatch(parent:string,assignment:import('./teams').WorkerAssignment):Promise<import('./teams').SpecialistWorker>
  teamResume(parent:string):Promise<void>
  teamStop(parent:string):Promise<void>
  teamWorkerAction(parent:string,id:string,action:'cancel'|'resume'|'steer'|'retain',prompt?:string):Promise<void>
  teamPreview(parent:string,id:string):Promise<import('./task-workspaces').WorkspacePreview>
  teamIntegrate(parent:string,id:string,paths:string[]):Promise<string>
  repositorySearch(query:string,filesOnly?:boolean):Promise<import('./repository-context').RepositorySearch>
  repositoryStatus():Promise<import('./repository-context').RepositoryStatus>
  contextSummaries(sessionId:string):Promise<import('./repository-context').ContextSummary[]>
  contextCompact(sessionId:string):Promise<import('./repository-context').ContextSummary>
  contextSummarySelect(sessionId:string,id:string):Promise<void>
  connections(): Promise<import('./connections').ConnectionView[]>
  connectionSave(config: import('./connections').ConnectionConfig): Promise<void>
  connectionRemove(id: string): Promise<void>
  connectionRevoke(id: string): Promise<void>
  connectionCredential(id: string,bearer: string,env: Record<string,string>): Promise<void>
  connectionGrant(grant: Omit<import('./connections').ConnectionGrant,'project'|'revision'>): Promise<void>
  connectionConnect(id: string,signIn: boolean): Promise<void>
  connectionDisconnect(id: string): Promise<void>
  connectionResources(id: string): Promise<import('./connections').ConnectionResource[]>
  connectionResource(id: string,uri: string): Promise<string>
  connectionPrompts(id: string): Promise<import('./connections').ConnectionPrompt[]>
  connectionPrompt(id: string,name: string,args: Record<string,string>): Promise<string>
  hostApprovals(sessionId: string): Promise<import('./connections').HostApproval[]>
  hostRespond(sessionId: string,id: string,digest: string,allow: boolean): Promise<void>
  appVersion(): Promise<string>
  taskWorkspaces(): Promise<import('./task-workspaces').TaskWorkspace[]>
  activeWorkspace(): Promise<{ path: string; isolated: boolean }>
  workspacePreview(id: string): Promise<import('./task-workspaces').WorkspacePreview>
  workspaceIntegrate(id: string, paths: string[]): Promise<string>
  workspaceRetain(id: string): Promise<void>
  workspaceArchive(id:string):Promise<boolean>
  workspaceRestore(id:string):Promise<boolean>
  editorRead(path: string): Promise<EditableFile>
  editorSave(path: string, revision: string, content: string, workspace: string): Promise<EditableFile>
  editorBase(path: string): Promise<string>
  editorExternal(path: string): Promise<void>
  sessionConfig(sessionId: string): Promise<BridgeSessionConfig>
  sessionMode(sessionId: string, mode: ExecutionMode): Promise<void>
  approvals(sessionId: string): Promise<ApprovalRequest[]>
  respondApproval(sessionId: string, id: string, digest: string, allow: boolean): Promise<void>
  modelHealth(provider: Provider, baseUrl: string, model: string, test: boolean): Promise<import('./diagnostics').ModelHealth>
  decisionTraces(sessionId: string): Promise<import('./diagnostics').DecisionTrace[]>
  decisionOverride(sessionId: string, id: string, note: string): Promise<void>
  evaluations(): Promise<import('./diagnostics').EvaluationReport[]>
  evaluationStart(request: import('./diagnostics').EvaluationRequest): Promise<string>
  evaluationCancel(id: string): Promise<void>
  evaluationCleanup(id: string): Promise<void>
  queueSnapshot(): Promise<import('./workflow').QueueSnapshot>
  queueAdd(prompt: string,options?:import('./teams').TeamOptions): Promise<import('./workflow').QueueSnapshot>
  queueEdit(id: string, prompt: string): Promise<import('./workflow').QueueSnapshot>
  queueReorder(ids: string[]): Promise<import('./workflow').QueueSnapshot>
  queuePause(paused: boolean): Promise<import('./workflow').QueueSnapshot>
  queueAction(id: string, action: 'cancel' | 'retry' | 'remove'): Promise<import('./workflow').QueueSnapshot>
  contextView(sessionId?: string): Promise<import('./workflow').ContextView>
  updateContext(sessionId: string, patch: Partial<import('./workflow').ContextSelection>): Promise<import('./workflow').ContextSelection>
  handoffPreview(sessionId: string): Promise<import('./workflow').HandoffPreview>
  handoffStart(sessionId: string, summary: string, destination: Pick<BridgeSessionConfig, 'provider' | 'model' | 'baseUrl' | 'thinkingLevel'>): Promise<{ sessionId: string }>
  searchHistory(query: string, sessionId?: string, allProjects?: boolean): Promise<import('./workflow').SearchHit[]>
  getEventWindow(sessionId: string, sequence: number): Promise<AgentEvent[]>
  onNavigate(callback: (target: { project: string; sessionId: string; seq?: number }) => void): () => void
  onWorkflowChanged(callback: (project: string) => void): () => void
  checkpoints(): Promise<Checkpoint[]>
  checkpointPreview(id: string, path: string): Promise<CheckpointPreview>
  checkpointRestore(id: string, paths: string[]): Promise<string>
  checkpointRemove(id: string): Promise<void>
  checkpointStorage(): Promise<{ bytes: number; count: number }>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  saveKey(provider: string, key: string): Promise<void>
  hasKey(provider: string): Promise<boolean>
  saveAdminKey(provider: 'openai' | 'anthropic', key: string): Promise<void>
  hasAdminKey(provider: 'openai' | 'anthropic'): Promise<boolean>
  clearAdminKey(provider: 'openai' | 'anthropic'): Promise<void>
  usageSnapshot(force?: boolean): Promise<UsageSnapshot>
  executionSummary(sessionId: string): Promise<ExecutionSummary>
  cancelOperation(sessionId: string, operationId: string): Promise<void>
  codexStatus(): Promise<{ available: boolean; message: string }>
  discoverModels(provider: Provider, baseUrl: string): Promise<string[]>
  githubStatus(): Promise<GitHubStatus>
  githubIssues():Promise<import('./github-workflow').GitHubIssue[]>
  githubReviewComments(number:number):Promise<import('./github-workflow').GitHubReviewComment[]>
  githubChecks(number:number):Promise<import('./github-workflow').GitHubCheck[]>
  githubFailureLogs(number:number,url:string):Promise<string>
  githubIntake(kind:'issue'|'review-comment',number:number,commentId?:number):Promise<import('./workflow').QueueSnapshot>
  githubRepositories(): Promise<GitHubRepository[]>
  githubClone(repository: string): Promise<string>
  githubWorktrees(): Promise<GitHubWorktree[]>
  githubCreateWorktree(branch: string, baseRef: string): Promise<string>
  githubBranch(): Promise<string>
  githubFetch(): Promise<void>
  githubPull(): Promise<void>
  githubStage(paths: string[]): Promise<void>
  githubUnstage(paths: string[]): Promise<void>
  githubCommit(message: string): Promise<string>
  githubPush(branch: string): Promise<void>
  githubPullRequests(): Promise<GitHubPullRequest[]>
  githubPullRequest(number: number): Promise<GitHubPullRequest & { body: string; diff: string; comments: string[] }>
  githubCreatePullRequest(title: string, body: string, base: string, draft: boolean): Promise<string>
  githubReviewPullRequest(number: number, action: 'approve' | 'comment' | 'request-changes', body: string): Promise<void>
  decisionStatus(): Promise<DecisionStatus>
  decisionConsent(): Promise<boolean>
  decisionInstall(engine: 'laya' | 'gliner'): Promise<void>
  evaluateDecision(batch: DecisionBatch): Promise<DecisionResult>
  extractEntities(text: string, labels: string[]): Promise<Array<{ text: string; label: string; start: number; end: number; score: number }>>
  pickProject(): Promise<string | null>
  openProject(path: string, trust: boolean): Promise<DockerStatus>
  projectPath(): Promise<string | null>
  dockerStatus(): Promise<DockerStatus>
  listSessions(): Promise<SessionInfo[]>
  createSession(config: BridgeSessionConfig,options?:import('./teams').TeamOptions): Promise<{ sessionId: string }>
  openSession(sessionId: string): Promise<void>
  selectSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, prompt: string, messageId: string): Promise<void>
  stopSession(sessionId: string): Promise<void>
  forkSession(sessionId: string): Promise<{ sessionId: string }>
  getEvents(sessionId: string, after: number): Promise<AgentEvent[]>
  listFiles(relative?: string): Promise<FileEntry[]>
  readFile(relative: string): Promise<string>
  gitChanges(): Promise<string[]>
  gitDiff(relative: string): Promise<string>
  listSkills(): Promise<SkillEntry[]>
  saveSkill(name: string, content: string): Promise<void>
  deleteSkill(name: string): Promise<void>
  terminalStart(): Promise<string>
  terminalWrite(id: string, data: string): Promise<void>
  terminalResize(id: string, cols: number, rows: number): Promise<void>
  terminalStop(id: string): Promise<void>
  onEvent(callback: (event: AgentEvent) => void): () => void
  onDockerStatus(callback: (status: DockerStatus) => void): () => void
  onTerminalData(callback: (value: { id: string; data: string }) => void): () => void
  onTerminalExit(callback: (value: { id: string; code: number }) => void): () => void
}
