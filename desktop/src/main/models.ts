import type { Provider } from '../shared/api'
import { getKey } from './settings'

function localURL(value: string, provider: Provider): URL {
  const fallback = provider === 'ollama' ? 'http://localhost:11434/v1' : ''
  if (!value.trim() && !fallback) throw new Error('Enter a local model server URL')
  const url = new URL(value.trim() || fallback)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Model server must use HTTP or HTTPS')
  const host = url.hostname.toLowerCase()
  const octets = host.split('.').map(Number)
  const privateIPv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168))
  if (!['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(host) && !privateIPv4) {
    throw new Error('Choose a local or private-network model server')
  }
  return url
}

export async function discoverModels(provider: Provider, baseUrl: string): Promise<string[]> {
  if (provider !== 'ollama' && provider !== 'openai-compatible') return []
  const url = localURL(baseUrl, provider)
  const base = url.pathname.replace(/\/$/, '') || '/v1'
  url.pathname = provider === 'ollama' ? '/api/tags' : `${base === '/' ? '' : base}/models`
  const key = provider === 'openai-compatible' ? getKey(provider) : ''
  const response = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`Model server returned HTTP ${response.status}`)
  const body = await response.text()
  if (body.length > 1024 * 1024) throw new Error('Model list is too large')
  const decoded = JSON.parse(body) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> }
  const ids = decoded.data?.map((item) => item.id || '') || decoded.models?.map((item) => item.name || '') || []
  return [...new Set(ids.filter(Boolean))].sort()
}
