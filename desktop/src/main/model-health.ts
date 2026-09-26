import type { Provider } from '../shared/api'
import type { ModelHealth } from '../shared/diagnostics'
import { discoverModels, localURL } from './models'
import { getKey } from './settings'

export async function modelHealth(provider: Provider, baseUrl: string, model: string, test: boolean): Promise<ModelHealth> {
  if (!['ollama', 'openai-compatible'].includes(provider)) throw new Error('Select Ollama or a local compatible provider')
  if (typeof model !== 'string' || model.length > 200 || typeof test !== 'boolean') throw new Error('Invalid health request')
  const url = localURL(baseUrl, provider), started = performance.now()
  const result: ModelHealth = { checkedAt: new Date().toISOString(), connected: false, models: [], model, capabilities: [], latencyMs: 0, message: '' }
  const key = provider === 'openai-compatible' ? getKey(provider) : ''
  const request = async (path: string, body?: unknown): Promise<Record<string, any>> => {
    const target = new URL(url); target.pathname = path
    const response = await fetch(target, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, redirect: 'error', signal: AbortSignal.timeout(test ? 60000 : 8000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}: check the endpoint, model name, and local server credentials`)
    const reader = response.body?.getReader(); if (!reader) throw new Error('Server returned no body')
    let size = 0; const chunks: Uint8Array[] = []
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Server response exceeds 1 MB') }; chunks.push(next.value) }
    return JSON.parse(Buffer.concat(chunks).toString())
  }
  try {
    result.models = await discoverModels(provider, baseUrl); result.connected = true
    result.message = 'Endpoint reachable. Capabilities and limits are unknown unless reported by the runtime.'
    if (model && provider === 'ollama') {
      const details = await request('/api/show', { model })
      result.capabilities = Array.isArray(details.capabilities) ? details.capabilities.filter((item: unknown) => typeof item === 'string') : []
      const info = details.model_info || {}, limit = info[`${info['general.architecture']}.context_length`]
      if (Number.isSafeInteger(limit) && limit > 0) { result.contextLimit = limit; result.contextSource = 'Ollama model metadata (not the active session allocation)' }
    }
    if (test) {
      if (!model.trim()) throw new Error('Choose a model before running the response test')
      const start = performance.now()
      const response = provider === 'ollama'
        ? await request('/api/generate', { model, prompt: 'Reply with OK.', stream: false, options: { num_predict: 16 } })
        : await request(`${url.pathname.replace(/\/$/, '') || '/v1'}/chat/completions`, { model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16, stream: false })
      result.latencyMs = performance.now() - start
      result.response = String(response.response ?? response.choices?.[0]?.message?.content ?? '').slice(0, 1000)
      result.inputTokens = response.prompt_eval_count ?? response.usage?.prompt_tokens
      result.outputTokens = response.eval_count ?? response.usage?.completion_tokens
      result.message = result.response ? 'Small response test completed; latency includes model loading if needed.' : 'Server returned no text; inspect model capability and reasoning settings.'
    } else result.latencyMs = performance.now() - started
  } catch (error) {
    const message = (error as Error).message
    result.message = message.startsWith('HTTP ') || message.startsWith('Server ') || message.startsWith('Choose ') ? message : 'Connection or response failed. Start the local server and check its URL and model installation.'
    result.latencyMs = performance.now() - started
  }
  return result
}
