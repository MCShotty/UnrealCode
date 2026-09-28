import type { AgentEvent, SessionInfo } from './api'
import type { AppFailure } from './failure'
export type CacheStatus = { state: 'ready' | 'syncing' | 'partial' | 'offline' | 'unavailable'; lastSyncedAt?: string; cursor: number; latest: number; failure?: AppFailure }
export type HistoryPage = { events: AgentEvent[]; before?: number; hasOlder: boolean; cache: CacheStatus }
export type CachedSession = SessionInfo & { workspace: string; project: string }
