import { describe, expect, it, vi } from 'vitest'

const secrets = vi.hoisted(() => ({ openai: 'openai-admin-test', anthropic: 'anthropic-admin-test' }))
vi.mock('./settings', () => ({ getAdminKey: (source: 'openai' | 'anthropic') => secrets[source], codexStatus: () => ({ available: true }) }))
import { AccountUsageService, parseCodexWindows, readCodexWindows } from './account-usage'

describe('provider account usage', () => {
  it('paginates and sums OpenAI and Anthropic reports without merging their scopes', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      calls.push(url.toString())
      if (url.hostname === 'api.openai.com') return new Response(JSON.stringify(url.searchParams.has('page')
        ? { data: [{ results: [{ input_tokens: 8, output_tokens: 4, input_cached_tokens: 3, num_model_requests: 1 }] }], has_more: false }
        : { data: [{ results: [{ input_tokens: 20, output_tokens: 5, input_cached_tokens: 7, num_model_requests: 2 }] }], has_more: true, next_page: 'next-openai' }))
      return new Response(JSON.stringify(url.searchParams.has('page')
        ? { data: [{ results: [{ uncached_input_tokens: 5, cache_read_input_tokens: 2, cache_creation: { ephemeral_5m_input_tokens: 1, ephemeral_1h_input_tokens: 1 }, output_tokens: 3 }] }], has_more: false }
        : { data: [{ results: [{ uncached_input_tokens: 10, cache_read_input_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 0 }, output_tokens: 6 }] }], has_more: true, next_page: 'next-anthropic' }))
    }) as unknown as typeof fetch
    const service = new AccountUsageService(fetcher, async () => [], () => Date.UTC(2026, 8, 25))
    const cards = await service.snapshot()
    expect(cards.find((card) => card.source === 'openai')?.totals).toMatchObject({ input: 28, output: 9, cached: 10, calls: 3 })
    expect(cards.find((card) => card.source === 'anthropic')?.totals).toMatchObject({ input: 25, output: 9, cached: 6, cacheWrite: 4 })
    expect(calls).toHaveLength(4)
    expect(calls.every((url) => new URL(url).searchParams.get('bucket_width') === '1d')).toBe(true)
  })

  it('shows distinct Codex windows and does not invent missing percentages', () => {
    const windows = parseCodexWindows({ rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 100 }, secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: 200 } }, other: { primary: null } } })
    expect(windows).toEqual([
      { id: 'codex:primary', label: 'codex · primary', usedPercent: 23, windowDurationMins: 300, resetsAt: 100 },
      { id: 'codex:secondary', label: 'codex · secondary', usedPercent: 61, windowDurationMins: 10080, resetsAt: 200 }
    ])
    expect(parseCodexWindows({ rateLimits: null })).toEqual([])
  })

  it('reports missing Codex CLI explicitly', async () => {
    await expect(readCodexWindows(null)).rejects.toThrow(/not installed/)
  })

  it('retains a stale report on permission failure and does not refetch before its five-minute cache expires', async () => {
    let now = Date.UTC(2026, 8, 25)
    let allowed = true
    const fetcher = vi.fn(async () => allowed
      ? new Response(JSON.stringify({ data: [{ results: [{ input_tokens: 10 }] }], has_more: false }))
      : new Response('{}', { status: 403 })) as unknown as typeof fetch
    const service = new AccountUsageService(fetcher, async () => [], () => now)
    expect((await service.snapshot())[1].status).toBe('fresh')
    allowed = false
    now += 60_000
    expect((await service.snapshot())[1].status).toBe('fresh')
    expect(fetcher).toHaveBeenCalledTimes(2)
    now += 300_000
    const failed = (await service.snapshot())[1]
    expect(failed.status).toBe('stale')
    expect(failed.message).toMatch(/HTTP 403/)
    expect(JSON.stringify(failed)).not.toContain(secrets.openai)
  })
})
