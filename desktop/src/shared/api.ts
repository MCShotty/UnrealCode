export type Provider = 'openai' | 'openai-codex' | 'anthropic' | 'openrouter' | 'fireworks' | 'ollama' | 'openai-compatible'
export type DecisionEngine = 'off' | 'jev' | 'laya'
export type Settings = {
  recentProjects: string[]
  trustedProjects: string[]
  provider: Provider
  model: string
  thinkingLevel: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  systemPrompt: string
  projectInstructions: Record<string, string>
  theme: 'dark' | 'light'
  disallowedTools: string[]
  baseUrl: string
  decisionEngine: DecisionEngine
  decisionSetupSeen: boolean
  decisionModel: string
  decisionCloudProjects: string[]
  decisionCloudDeclinedProjects: string[]
  glinerEnabled: boolean
}
export type SessionInfo = { id: string; title: string; lastUpdatedAt: string; active: boolean }
export type AgentEvent = { v: number; event: string; sessionId: string; seq: number; sourceSequence?: number; payload: unknown }
export type FileEntry = { name: string; path: string; directory: boolean; size: number }
export type SkillEntry = { name: string; description: string; content: string }
export type DockerStatus = { ready: boolean; message: string; container?: string }
export type BridgeSessionConfig = { provider: Provider; model: string; baseUrl: string; thinkingLevel: string; systemPrompt: string; disallowedTools: string[] }
export type GitHubStatus = { installed: boolean; authenticated: boolean; account?: string; message: string }
export type GitHubRepository = { nameWithOwner: string; description: string; isPrivate: boolean; url: string }
export type GitHubWorktree = { path: string; branch: string; head: string; current: boolean }
export type GitHubPullRequest = { number: number; title: string; state: string; isDraft: boolean; url: string; headRefName: string; baseRefName: string; reviewDecision?: string; checks?: string }
export type DecisionQuestion = { type: 'choice' | 'noul' | 'score'; instructions: string; criteria?: Record<string, string> | string[] }
export type DecisionBatch = { state: unknown; questions: Record<string, DecisionQuestion>; sourceRefs?: string[] }
export type DecisionResult = { engine: 'jev' | 'laya'; model: string; answers: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number }; durationMs: number }
export type DecisionStatus = { engine: DecisionEngine; available: boolean; message: string; glinerAvailable: boolean }

export interface DesktopAPI {
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  saveKey(provider: string, key: string): Promise<void>
  hasKey(provider: string): Promise<boolean>
  codexStatus(): Promise<{ available: boolean; message: string }>
  discoverModels(provider: Provider, baseUrl: string): Promise<string[]>
  githubStatus(): Promise<GitHubStatus>
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
  createSession(config: BridgeSessionConfig): Promise<{ sessionId: string }>
  openSession(sessionId: string): Promise<void>
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
