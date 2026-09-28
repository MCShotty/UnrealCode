import type { BridgeSessionConfig } from './api'
export type QueueTask = { id: string; attemptId?: string; workspaceChoice?: 'project' | 'isolated'; prompt: string; config: BridgeSessionConfig; createdAt: string; state: 'pending' | 'starting' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'waiting_review'; sessionId?: string; message?: string; source?: import('./github-workflow').GitHubTaskSource; teamOptions?:import('./teams').TeamOptions }
export type QueueSnapshot = { version: 1; paused: boolean; tasks: QueueTask[] }
export type ContextSelection = { pinned: string[]; attached: string[]; excluded: string[]; summary: string }
export type ContextFile = { path: string; kind: 'pinned' | 'attached' | 'instructions'; included: boolean; bytes: number; reason?: string }
export type PreparedContext = { selection: ContextSelection; files: ContextFile[]; text: string; estimatedTokens: number }
export type ContextView = PreparedContext & { instructions: string; latestInput?: number; contextLimit?: number }
export type SearchHit = { project: string; sessionId: string; seq: number; kind: string; recordedAt?: string; snippet: string }
export type HandoffPreview = { summary: string; config: BridgeSessionConfig; parentSessionId: string }
