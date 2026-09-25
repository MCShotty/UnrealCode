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
import { credentialFor, getSettings, migrateLegacySettings, saveKey, setDecisionConsent, updateSettings } from './settings'

let temp = ''
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); temp = '' })

describe('settings migration and consent', () => {
  it('moves legacy project preferences while preserving the old files', async () => {
    temp = await mkdtemp(join(tmpdir(), 'unrealcode-settings-'))
    appData = join(temp, 'appdata'); userData = join(temp, 'new')
    const old = join(appData, 'unreal-agent-desktop')
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'settings.json'), JSON.stringify({ recentProjects: ['I:\\UnrealGUI'], trustedProjects: ['I:\\UnrealGUI'], projectInstructions: { 'I:\\UnrealGUI': 'instructions' }, theme: 'light' }))
    migrateLegacySettings()
    expect(getSettings().recentProjects).toEqual(['I:\\UnrealCode'])
    expect(getSettings().projectInstructions['I:\\UnrealCode']).toBe('instructions')
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
})
