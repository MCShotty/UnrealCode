import { describe, expect, it, vi } from 'vitest'
vi.mock('./settings', () => ({ getKey: () => 'test-key' }))
import { ContextLimitService } from './context-limits'

describe('verified context limits', () => {
  it('uses only the documented native OpenAI API limit for Astra', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const service = new ContextLimitService(fetcher)
    expect(await service.read('openai', 'gpt-6-astra')).toEqual({ limit: 1_050_000, source: 'OpenAI model card' })
    expect(await service.read('openai-codex', 'gpt-6-astra')).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('accepts Anthropic model metadata and leaves unknown models unlabeled', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ max_input_tokens: 200000 }))) as unknown as typeof fetch
    const service = new ContextLimitService(fetcher)
    expect(await service.read('anthropic', 'claude-test')).toEqual({ limit: 200000, source: 'Anthropic Models API' })
    expect(await service.read('anthropic', 'claude-test')).toEqual({ limit: 200000, source: 'Anthropic Models API' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(await service.read('ollama', 'unknown')).toBeNull()
  })

  it('deduplicates concurrent metadata requests and briefly caches an unavailable model', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch
    const service = new ContextLimitService(fetcher)
    expect(await Promise.all([service.read('anthropic', 'missing-model'), service.read('anthropic', 'missing-model')])).toEqual([null, null])
    expect(await service.read('anthropic', 'missing-model')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
