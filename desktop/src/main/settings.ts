import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Provider, Settings } from '../shared/api'
import { parseCodexAuth } from './codex-auth'

const defaults: Settings = {
  recentProjects: [], trustedProjects: [], provider: 'openai-codex', model: 'gpt-6-astra',
  thinkingLevel: 'high', systemPrompt: '', projectInstructions: {}, theme: 'system', disallowedTools: [], baseUrl: '',
  layout: { sessionWidth: 246, activityWidth: 340, sessions: true, activity: true, focus: false },
  notifications: false,
  decisionEngine: 'off', decisionSetupSeen: false, decisionModel: 'jev-latest', decisionCloudProjects: [], decisionCloudDeclinedProjects: [], glinerEnabled: false
}

type SecretFile = Record<string, string>
const sessionKeys = new Map<string, string>()

function settingsPath(): string { return join(app.getPath('userData'), 'settings.json') }
function secretsPath(): string { return join(app.getPath('userData'), 'secrets.json') }

export function migrateLegacySettings(): void {
  if (process.env.UNREAL_DESKTOP_USER_DATA || existsSync(settingsPath())) return
  const legacy = join(app.getPath('appData'), 'unreal-agent-desktop')
  const previous = join(legacy, 'settings.json')
  if (!existsSync(previous)) return
  const current = readJSON<Partial<Settings>>(previous, {})
  const oldPath = 'I:\\UnrealGUI'
  const newPath = 'I:\\UnrealCode'
  const remap = (value: string): string => value.toLocaleLowerCase() === oldPath.toLocaleLowerCase() ? newPath : value
  current.recentProjects = (current.recentProjects || []).map(remap)
  current.trustedProjects = (current.trustedProjects || []).map(remap)
  const instructions: Record<string, string> = {}
  for (const [key, value] of Object.entries(current.projectInstructions || {})) instructions[remap(key)] = value
  current.projectInstructions = instructions
  writeJSON(settingsPath(), { ...defaults, ...current })
  const oldSecrets = join(legacy, 'secrets.json')
  if (existsSync(oldSecrets) && !existsSync(secretsPath())) copyFileSync(oldSecrets, secretsPath())
}

function readJSON<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback }
}
function writeJSON(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export function getSettings(): Settings {
  const stored = readJSON<Partial<Settings>>(settingsPath(), {})
  return { ...defaults, ...stored, layout: { ...defaults.layout, ...stored.layout } }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const allowed: (keyof Settings)[] = ['provider', 'model', 'thinkingLevel', 'systemPrompt', 'projectInstructions', 'theme', 'disallowedTools', 'baseUrl', 'decisionEngine', 'decisionSetupSeen', 'decisionModel', 'glinerEnabled']
  const next = getSettings()
  if (patch.notifications !== undefined) { if (typeof patch.notifications !== 'boolean') throw new Error('Invalid notification preference'); next.notifications = patch.notifications }
  if (patch.theme !== undefined && !['dark', 'light', 'system'].includes(patch.theme)) throw new Error('Invalid theme')
  if (patch.layout) {
    const value = patch.layout
    if (![value.sessionWidth, value.activityWidth].every(Number.isFinite) ||
        ![value.sessions, value.activity, value.focus].every((item) => typeof item === 'boolean')) throw new Error('Invalid layout')
    next.layout = { ...value, sessionWidth: Math.max(190, Math.min(420, value.sessionWidth)), activityWidth: Math.max(260, Math.min(520, value.activityWidth)) }
  }
  for (const key of allowed) {
    if (Object.hasOwn(patch, key)) (next as unknown as Record<string, unknown>)[key] = patch[key]
  }
  writeJSON(settingsPath(), next)
  return next
}

export function rememberProject(path: string): void {
  const current = getSettings()
  current.trustedProjects = [...new Set([...current.trustedProjects, path])]
  current.recentProjects = [path, ...current.recentProjects.filter((item) => item !== path)].slice(0, 10)
  writeJSON(settingsPath(), current)
}

export function setDecisionConsent(path: string, allowed: boolean): void {
  const current = getSettings()
  current.decisionCloudProjects = allowed ? [...new Set([...current.decisionCloudProjects, path])] : current.decisionCloudProjects.filter((item) => item !== path)
  current.decisionCloudDeclinedProjects = allowed ? current.decisionCloudDeclinedProjects.filter((item) => item !== path) : [...new Set([...current.decisionCloudDeclinedProjects, path])]
  writeJSON(settingsPath(), current)
}

export function saveKey(provider: string, key: string): void {
  if (!['openai', 'anthropic', 'openrouter', 'fireworks', 'openai-compatible'].includes(provider)) throw new Error('Unsupported API-key provider')
  if (!key.trim()) throw new Error('API key is empty')
  if (safeStorage.isEncryptionAvailable()) {
    const secrets = readJSON<SecretFile>(secretsPath(), {})
    secrets[provider] = safeStorage.encryptString(key.trim()).toString('base64')
    writeJSON(secretsPath(), secrets)
  } else {
    sessionKeys.set(provider, key.trim())
  }
}

export function getKey(provider: string): string {
  if (sessionKeys.has(provider)) return sessionKeys.get(provider) ?? ''
  const encoded = readJSON<SecretFile>(secretsPath(), {})[provider]
  if (!encoded || !safeStorage.isEncryptionAvailable()) return ''
  try { return safeStorage.decryptString(Buffer.from(encoded, 'base64')) } catch { return '' }
}

export function hasKey(provider: string): boolean { return !!getKey(provider) }

function adminName(provider: 'openai' | 'anthropic'): string {
  if (provider !== 'openai' && provider !== 'anthropic') throw new Error('Unsupported admin provider')
  return `admin:${provider}`
}

export function saveAdminKey(provider: 'openai' | 'anthropic', key: string): void {
  if (!key.trim()) throw new Error('Admin key is empty')
  const name = adminName(provider)
  if (safeStorage.isEncryptionAvailable()) {
    const secrets = readJSON<SecretFile>(secretsPath(), {})
    secrets[name] = safeStorage.encryptString(key.trim()).toString('base64')
    writeJSON(secretsPath(), secrets)
  } else sessionKeys.set(name, key.trim())
}

export function getAdminKey(provider: 'openai' | 'anthropic'): string {
  const name = adminName(provider)
  if (sessionKeys.has(name)) return sessionKeys.get(name) || ''
  const encoded = readJSON<SecretFile>(secretsPath(), {})[name]
  if (!encoded || !safeStorage.isEncryptionAvailable()) return ''
  try { return safeStorage.decryptString(Buffer.from(encoded, 'base64')) } catch { return '' }
}

export function hasAdminKey(provider: 'openai' | 'anthropic'): boolean { return !!getAdminKey(provider) }

export function clearAdminKey(provider: 'openai' | 'anthropic'): void {
  const name = adminName(provider)
  sessionKeys.delete(name)
  const secrets = readJSON<SecretFile>(secretsPath(), {})
  if (Object.hasOwn(secrets, name)) { delete secrets[name]; writeJSON(secretsPath(), secrets) }
}

function codexAuthPath(): string { return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json') }

export function codexCredential(): { accessToken: string; accountId: string } {
  const path = codexAuthPath()
  if (!existsSync(path)) throw new Error('No Codex login found. Sign in with Codex, then reconnect.')
  return parseCodexAuth(readJSON<unknown>(path, {}))
}

export function codexStatus(): { available: boolean; message: string } {
  try { codexCredential(); return { available: true, message: 'Existing Codex login found' } }
  catch (error) { return { available: false, message: error instanceof Error ? error.message : 'Codex login unavailable' } }
}

export function credentialFor(provider: Provider, baseUrl: string): Record<string, string> {
  if (provider === 'openai-codex') return { ...codexCredential(), baseUrl: '' }
  const dockerURL = baseUrl.replace(/^(https?):\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i, '$1://host.docker.internal')
  if (provider === 'ollama' || provider === 'openai-compatible') {
    if (provider === 'openai-compatible' && !dockerURL.trim()) throw new Error('Enter a local model server URL')
    const endpoint = new URL(dockerURL || (provider === 'ollama' ? 'http://host.docker.internal:11434/v1' : ''))
    const host = endpoint.hostname.toLowerCase()
    const octets = host.split('.').map(Number)
    const privateIPv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168))
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      (!['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(host) && !privateIPv4)) throw new Error('Choose a local or private-network model server URL')
    if (endpoint.pathname === '/') endpoint.pathname = '/v1'
    return provider === 'ollama' ? { baseUrl: endpoint.toString().replace(/\/$/, '') } : { baseUrl: endpoint.toString().replace(/\/$/, ''), apiKey: getKey(provider) }
  }
  const apiKey = getKey(provider)
  if (!apiKey) throw new Error(`${provider} API key is not configured. Add it in Settings.`)
  return { apiKey, baseUrl: '' }
}
