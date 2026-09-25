import type { Provider } from '../shared/api'
import { getKey } from './settings'

// https://developers.openai.com/api/docs/models/gpt-6-astra verifies this limit.
// Subscription and compatible endpoints
// may impose different limits, so only the native OpenAI API uses it.
const openAIModelCards: Record<string, number> = { 'gpt-6-astra': 1_050_000 }
export class ContextLimitService {
  private cache = new Map<string, { limit: number | null; expiresAt: number }>()
  private inflight = new Map<string, Promise<number | null>>()
  constructor(private fetcher: typeof fetch = fetch) {}

  async read(provider: Provider, model: string): Promise<{ limit: number; source: string } | null> {
    if (provider === 'openai' && openAIModelCards[model]) return { limit: openAIModelCards[model], source: 'OpenAI model card' }
    if (provider !== 'anthropic' || !model || !getKey('anthropic')) return null
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(model)) return null
    const cached = this.cache.get(model)
    if (cached && cached.expiresAt > Date.now()) return cached.limit ? { limit: cached.limit, source: 'Anthropic Models API' } : null
    let pending = this.inflight.get(model)
    if (!pending) {
      pending = this.fetchAnthropic(model)
      this.inflight.set(model, pending)
    }
    try {
      const limit = await pending
      this.cache.set(model, { limit, expiresAt: Date.now() + (limit ? 3600000 : 300000) })
      return limit ? { limit, source: 'Anthropic Models API' } : null
    } finally { this.inflight.delete(model) }
  }

  private async fetchAnthropic(model: string): Promise<number | null> {
    try {
      const response = await this.fetcher(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
        headers: { 'x-api-key': getKey('anthropic'), 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) return null
      const payload = await response.json() as { max_input_tokens?: unknown }
      const limit = payload.max_input_tokens
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) return null
      return limit
    } catch { return null }
  }
}
