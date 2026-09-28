import {backendEnvironment} from './child-environment'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { AccountUsage, UsageTotals, UsageWindow } from '../shared/api'
import { codexStatus, getAdminKey } from './settings'

type Source = AccountUsage['source']
type Page = { data?: Array<{ results?: Record<string, unknown>[] }>; has_more?: boolean; next_page?: string | null }
type Fetcher = typeof fetch

export function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0, calls: 0, decisionInput: 0, decisionOutput: 0, decisionCalls: 0, latestInput: 0 }
}
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0 }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }

export function addOpenAIPage(totals: UsageTotals, page: Page): void {
  for (const bucket of page.data || []) for (const row of bucket.results || []) {
    totals.input += number(row.input_tokens)
    totals.output += number(row.output_tokens)
    totals.cached += number(row.input_cached_tokens)
    totals.calls += number(row.num_model_requests)
  }
}

export function addAnthropicPage(totals: UsageTotals, page: Page): void {
  for (const bucket of page.data || []) for (const row of bucket.results || []) {
    const cacheCreation = object(row.cache_creation)
    const written = number(cacheCreation.ephemeral_5m_input_tokens) + number(cacheCreation.ephemeral_1h_input_tokens)
    const cached = number(row.cache_read_input_tokens)
    totals.input += number(row.uncached_input_tokens) + written + cached
    totals.output += number(row.output_tokens)
    totals.cached += cached
    totals.cacheWrite += written
  }
}

async function report(source: 'openai' | 'anthropic', key: string, fetcher: Fetcher, now: number): Promise<UsageTotals> {
  const totals = emptyTotals()
  const end = new Date(now)
  const start = new Date(now - 7 * 86400000)
  const url = source === 'openai'
    ? new URL('https://api.openai.com/v1/organization/usage/completions')
    : new URL('https://api.anthropic.com/v1/organizations/usage_report/messages')
  if (source === 'openai') {
    url.searchParams.set('start_time', String(Math.floor(start.getTime() / 1000)))
    url.searchParams.set('end_time', String(Math.floor(end.getTime() / 1000)))
    url.searchParams.set('bucket_width', '1d')
    url.searchParams.set('limit', '7')
  } else {
    url.searchParams.set('starting_at', start.toISOString())
    url.searchParams.set('ending_at', end.toISOString())
    url.searchParams.set('bucket_width', '1d')
    url.searchParams.set('limit', '7')
  }
  const seen = new Set<string>()
  for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
    const response = await fetcher(url, {
      headers: source === 'openai' ? { Authorization: `Bearer ${key}` } : { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'UnrealCode/0.3.0' },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`${source} usage report returned HTTP ${response.status}`)
    const body = await response.json() as Page
    if (!Array.isArray(body.data)) throw new Error(`${source} usage report had an invalid response`)
    if (source === 'openai') addOpenAIPage(totals, body)
    else addAnthropicPage(totals, body)
    if (!body.has_more) return totals
    if (!body.next_page || seen.has(body.next_page)) throw new Error(`${source} usage report pagination failed`)
    seen.add(body.next_page)
    url.searchParams.set('page', body.next_page)
  }
  throw new Error(`${source} usage report exceeded 50 pages`)
}

export function codexExecutable(): string | null {
  const local = process.env.LOCALAPPDATA
  if (local) {
    const folder = join(local, 'OpenAI', 'Codex', 'bin')
    try {
      for (const version of readdirSync(folder).sort().reverse()) {
        const candidate = join(folder, version, 'codex.exe')
        if (existsSync(candidate)) return candidate
      }
    } catch { /* Codex desktop is not installed here. */ }
  }
  for (const entry of (process.env.PATH || '').split(delimiter)) {
    const folder = entry.trim().replace(/^"|"$/g, '')
    if (!isAbsolute(folder)) continue
    const candidate = join(folder, 'codex.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function parseCodexWindows(value: unknown): UsageWindow[] {
  const result = object(value)
  const byID = object(result.rateLimitsByLimitId)
  const buckets = Object.keys(byID).length ? Object.entries(byID) : [['codex', result.rateLimits]]
  const windows: UsageWindow[] = []
  for (const [key, raw] of buckets) {
    const bucket = object(raw)
    if (!Object.keys(bucket).length) continue
    for (const part of ['primary', 'secondary']) {
      const window = object(bucket[part])
      if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue
      const id = String(bucket.limitId || key)
      const name = typeof bucket.limitName === 'string' && bucket.limitName ? bucket.limitName : id
      windows.push({ id: `${id}:${part}`, label: `${name} · ${part}`, usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
        windowDurationMins: typeof window.windowDurationMins === 'number' ? window.windowDurationMins : null,
        resetsAt: typeof window.resetsAt === 'number' ? window.resetsAt : null })
    }
  }
  return windows
}

export async function readCodexWindows(binary = codexExecutable()): Promise<UsageWindow[]> {
  if (!binary) throw new Error('Codex CLI is not installed. Install Codex and sign in to see subscription limits.')
  if (!codexStatus().available) throw new Error('Sign in with Codex to see subscription limits.')
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],env:backendEnvironment() })
    const reader = createInterface({ input: child.stdout })
    let settled = false
    const timer = setTimeout(() => finish(new Error('Codex usage request timed out')), 15000)
    function finish(error?: Error, windows?: UsageWindow[]): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reader.close()
      child.kill()
      if (error) reject(error)
      else resolve(windows || [])
    }
    child.on('error', () => finish(new Error('Could not start Codex CLI')))
    child.on('exit', () => finish(new Error('Codex CLI closed before returning limits')))
    reader.on('line', (line) => {
      let message: Record<string, unknown>
      try { message = JSON.parse(line) as Record<string, unknown> } catch { return }
      if (message.id === 1) {
        if (message.error) { finish(new Error('Codex app-server initialization failed')); return }
        try {
          child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
          child.stdin.write(JSON.stringify({ method: 'account/rateLimits/read', id: 2 }) + '\n')
        } catch { finish(new Error('Codex CLI connection closed')) }
      } else if (message.id === 2) {
        if (message.error) { finish(new Error('Codex subscription limits are unavailable. Reconnect your Codex login.')); return }
        const windows = parseCodexWindows(message.result)
        if (!windows.length) finish(new Error('Codex returned no subscription limit windows'))
        else finish(undefined, windows)
      }
    })
    child.stdin.on('error', () => finish(new Error('Codex CLI connection closed')))
    try { child.stdin.write(JSON.stringify({ method: 'initialize', id: 1, params: { clientInfo: { name: 'unrealcode', title: 'UnrealCode', version: '0.3.0' } } }) + '\n') }
    catch { finish(new Error('Codex CLI connection closed')) }
  })
}

type CacheEntry = { value: AccountUsage; expiresAt: number }
export class AccountUsageService {
  private cache = new Map<Source, CacheEntry>()
  private inflight = new Map<Source, Promise<AccountUsage>>()
  constructor(private fetcher: Fetcher = fetch, private codexReader: () => Promise<UsageWindow[]> = () => readCodexWindows(), private clock: () => number = Date.now) {}

  invalidate(source: Source): void { this.cache.delete(source) }

  async snapshot(force = false): Promise<AccountUsage[]> {
    return Promise.all((['codex', 'openai', 'anthropic'] as const).map((source) => this.read(source, force)))
  }

  private async read(source: Source, force: boolean): Promise<AccountUsage> {
    const key = source === 'codex' ? '' : getAdminKey(source)
    if (source !== 'codex' && !key) return { source, scope: 'Organization · last 7 days', status: 'unavailable', message: 'Add an organization admin key in Settings to enable account-wide reporting.' }
    const cached = this.cache.get(source)
    if (cached && cached.expiresAt > this.clock()) return cached.value
    const pending = this.inflight.get(source)
    if (pending) return pending
    const run = (async (): Promise<AccountUsage> => {
      try {
        const now = this.clock()
        const observedAt = new Date(now).toISOString()
        const value: AccountUsage = source === 'codex'
          ? { source, scope: 'ChatGPT account', status: 'fresh', observedAt, windows: await this.codexReader() }
          : { source, scope: 'Organization · last 7 days', status: 'fresh', observedAt, totals: await report(source, key, this.fetcher, now) }
        this.cache.set(source, { value, expiresAt: now + (source === 'codex' ? 60000 : 300000) })
        return value
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Usage unavailable'
        return cached ? { ...cached.value, status: 'stale', message } : { source, scope: source === 'codex' ? 'ChatGPT account' : 'Organization · last 7 days', status: 'unavailable', message }
      }
    })()
    this.inflight.set(source, run)
    try { return await run } finally { this.inflight.delete(source) }
  }
}
