export type RepositoryHit = { path: string; line: number; endLine: number; text: string; revision: string; reason: string; relevance?: unknown }
export type RepositoryStatus = { files: number; bytes: number; refreshedAt?: string; omitted: number; refreshing: boolean }
export type RepositorySearch = { query: string; hits: RepositoryHit[]; status: RepositoryStatus; decision?: { engine: string; model: string; durationMs: number; usage?: unknown; unavailable?: string } }
export type ContextSummary = { id: string; sessionId: string; createdAt: string; text: string; sourceSequence: number; prefixItems: number; prefixHash: string; provider: string; model: string; active: boolean; usage?: { input: number; output: number } }
