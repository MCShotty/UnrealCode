import type { AgentEvent, SessionInfo } from '../shared/api'
import { historyCache } from './history-cache'
export { searchableText } from './legacy-conversation-index'
export class ConversationIndex {
  readonly cache: ReturnType<typeof historyCache>
  constructor(readonly project: string, readonly directory: string, profile = directory) { this.cache = historyCache(profile) }
  flush() { return this.cache.flush() }
  cursor(session: string) { return this.cache.cursor(this.project, session) }
  ingest(event: AgentEvent) { return this.cache.ingest(this.project, event) }
  addFiles(session: string, seq: number, paths: string[]) { return this.cache.addFiles(this.project,session,seq,paths) }
  search(query: string, session?: string) { return this.cache.search([this.project], query, session) }
  sessions() { return this.cache.sessions(this.project) }
  putSessions(sessions: SessionInfo[]) { return this.cache.putSessions(this.project, sessions) }
}
