import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let appData = ''
let userData = ''
vi.mock('electron', () => ({
  app: { getPath: (name: string) => name === 'appData' ? appData : userData },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`encrypted:${value}`), decryptString: (value: Buffer) => value.toString().slice(10) }
}))
import { credentialFor, defaultSettings, getSettings, migrateLegacySettings, saveKey, setDecisionConsent, updateSettings, saveAdminKey, getAdminKey, clearAdminKey } from './settings'
import { settingsFields, settingsLayoutFields } from '../shared/api'

let temp = ''
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); temp = '' })

describe('settings migration and consent', () => {
  it('defaults new installations to Windows theme and preserves saved themes and bounded layouts', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-theme-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    expect(getSettings().theme).toBe('system')
    updateSettings({ theme: 'dark' })
    expect(getSettings().theme).toBe('dark')
    updateSettings({ baseUrl: 'http://localhost:1234/v1' })
    expect(getSettings().baseUrl).toBe('http://localhost:1234/v1')
    updateSettings({ layout: { sessionWidth: 900, activityWidth: 10, sessions: false, activity: true, focus: true } })
    expect(getSettings().layout).toEqual({ sessionWidth: 420, activityWidth: 260, sessions: false, activity: true, focus: true })
    expect(() => updateSettings({ theme: 'invalid' as never })).toThrow('Invalid theme')
  })
  it('rejects malformed provider and instruction settings before changing the saved profile', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-settings-validation-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    updateSettings({ provider: 'ollama', model: 'fixture-model' })
    const path = join(userData, 'settings.json'), before = readFileSync(path, 'utf8')
    expect(() => updateSettings({ provider: 'unknown' as never })).toThrow('Invalid provider')
    expect(() => updateSettings({ thinkingLevel: 'unlimited' as never })).toThrow('Invalid reasoning level')
    expect(() => updateSettings({ projectInstructions: { project: 42 } as never })).toThrow('Invalid project instructions')
    expect(() => updateSettings({ disallowedTools: ['Bash', null] as never })).toThrow('Invalid tool restrictions')
    expect(() => updateSettings({ decisionEngine: 'unknown' as never })).toThrow('Invalid decision engine')
    expect(() => updateSettings({ glinerEnabled: 'true' as never })).toThrow('Invalid GLiNER preference')
    expect(() => updateSettings({ baseUrl: 'http://name:password@localhost:1234/v1' })).toThrow('Invalid provider URL')
    expect(() => updateSettings({ baseUrl: 'http://localhost:1234/v1?api_key=fixture-secret' })).toThrow('Invalid provider URL')
    expect(() => updateSettings({ baseUrl: 'http://localhost:1234/v1#fixture-secret' })).toThrow('Invalid provider URL')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
  it('preserves and reports malformed saved settings instead of loading a poisoned provider', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-settings-corrupt-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    mkdirSync(userData, { recursive: true })
    const path = join(userData, 'settings.json'), content = JSON.stringify({ provider: 'unknown', layout: { sessionWidth: 'wide' } })
    writeFileSync(path, content)
    expect(() => getSettings()).toThrow('Invalid provider')
    expect(readFileSync(path, 'utf8')).toBe(content)
  })
  it('keeps unrecognized legacy fields on disk without returning them to the renderer', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-settings-extra-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    mkdirSync(userData, { recursive: true })
    const path = join(userData, 'settings.json'), extra = 'fixture-private-legacy-field'
    writeFileSync(path, JSON.stringify({ provider: 'ollama', model: 'fixture', legacyCredential: extra }))
    expect(JSON.stringify(getSettings())).not.toContain(extra)
    updateSettings({ theme: 'dark' })
    expect(JSON.stringify(getSettings())).not.toContain(extra)
    expect(readFileSync(path, 'utf8')).toContain(extra)
  })
  it('keeps the allowlisted settings and layout fields aligned with defaults', () => {
    expect([...settingsFields].sort()).toEqual(Object.keys(defaultSettings()).sort())
    expect([...settingsLayoutFields].sort()).toEqual(Object.keys(defaultSettings().layout).sort())
  })
  it('does not return unknown nested layout fields', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-layout-extra-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    mkdirSync(userData, { recursive: true })
    const extra = 'fixture-private-layout-field'
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ layout: { sessionWidth: 246, legacyCredential: extra } }))
    expect(JSON.stringify(getSettings())).not.toContain(extra)
    updateSettings({ theme: 'dark' })
    expect(JSON.stringify(getSettings())).not.toContain(extra)
  })
  it('moves legacy project preferences while preserving the old files', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-settings-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    const old = join(appData, 'unreal-agent-desktop')
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'settings.json'), JSON.stringify({ recentProjects: ['I:\\UnrealGUI'], trustedProjects: ['I:\\UnrealGUI'], projectInstructions: { 'I:\\UnrealGUI': 'instructions' }, theme: 'light' }))
    migrateLegacySettings()
    expect(getSettings().recentProjects).toEqual(['I:\\UnrealGUI'])
    expect(getSettings().projectInstructions['I:\\UnrealGUI']).toBe('instructions')
    expect(readFileSync(join(old, 'settings.json'), 'utf8')).toContain('UnrealGUI')
    updateSettings({ decisionCloudProjects: ['I:\\UnrealCode'], decisionEngine: 'jev' })
    expect(getSettings().decisionCloudProjects).toEqual([])
    setDecisionConsent('I:\\UnrealCode', true)
    expect(getSettings().decisionCloudProjects).toEqual(['I:\\UnrealCode'])
  })

  it('keeps Claude keys encrypted and out of session configuration', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-secrets-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    saveKey('anthropic', 'example-secret')
    expect(readFileSync(join(userData, 'secrets.json'), 'utf8')).not.toContain('example-secret')
    expect(credentialFor('anthropic', '')).toEqual({ apiKey: 'example-secret', baseUrl: '' })
    expect(credentialFor('openai-compatible', 'http://localhost:1234')).toEqual({ baseUrl: 'http://host.docker.internal:1234/v1', apiKey: '' })
    expect(() => credentialFor('openai-compatible', 'https://public.example/v1')).toThrow(/private-network/)
  })

  it('keeps organization admin credentials separate from model credentials', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-admin-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    saveAdminKey('openai', 'admin-secret-value')
    expect(getAdminKey('openai')).toBe('admin-secret-value')
    expect(readFileSync(join(userData, 'secrets.json'), 'utf8')).not.toContain('admin-secret-value')
    expect(() => credentialFor('openai', '')).toThrow(/API key is not configured/)
    clearAdminKey('openai')
    expect(getAdminKey('openai')).toBe('')
  })
  it('rejects oversized or multiline credentials without changing saved secrets', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-key-validation-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    saveKey('anthropic', 'fixture-safe-key')
    const path = join(userData, 'secrets.json'), before = readFileSync(path, 'utf8')
    expect(() => saveKey('anthropic', 'x'.repeat(16385))).toThrow('Invalid API key')
    expect(() => saveKey('anthropic', 'line\nbreak')).toThrow('Invalid API key')
    expect(() => saveAdminKey('openai', 'x'.repeat(16385))).toThrow('Invalid admin key')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
  it('preserves and reports a malformed credential store instead of treating keys as absent', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-secrets-corrupt-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    mkdirSync(userData, { recursive: true })
    const path = join(userData, 'secrets.json'), original = '[]'
    writeFileSync(path, original)
    expect(() => credentialFor('anthropic', '')).toThrow('Saved credential store is unreadable')
    expect(readFileSync(path, 'utf8')).toBe(original)
  })
})
