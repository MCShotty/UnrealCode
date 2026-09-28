import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-memory-pages-'))
const profile = join(root, 'profile'), project = join(root, 'project')
const memoryPath = 'memory/2026-09-28_00-00-00.000Z'
mkdirSync(project); mkdirSync(join(profile, memoryPath), { recursive: true })
const canonicalProject = await realpath(project)
writeFileSync(join(project, 'README.md'), 'Disposable memory page fixture.\n')
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ decisionSetupSeen: true, decisionEngine: 'off', provider: 'ollama', model: 'fixture', theme: 'dark' }))
writeFileSync(join(profile, 'storage-locations.json'), JSON.stringify({ version: 1, locations: [{ kind: 'memory', key: 'hindsight', path: memoryPath, createdAt: '2026-09-28T00:00:00Z' }] }))
const records = Array.from({ length: 125 }, (_, index) => ({
  id: `turn-${index}`, sessionId: `fixture-session-${index}`, turnId: `fixture-turn-${index}`, workspace: canonicalProject,
  content: `Synthetic retained note ${index}`, sourceRefs: [`fixture:${index}`],
  createdAt: new Date(Date.UTC(2026, 8, 28, 0, 0, index)).toISOString(), state: 'retained', attempts: 0
}))
writeFileSync(join(profile, memoryPath, 'memory.json'), JSON.stringify({ version: 1, settings: { version: 1, enabled: false, projects: [] }, banks: {}, records: { [canonicalProject]: records }, usage: { inputTokens: 0, outputTokens: 0, requests: 0 } }))
const packaged = Boolean(process.env.UNREALCODE_QA_EXECUTABLE)
const app = await electron.launch({
  executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE || 'node_modules/electron/dist/electron.exe'),
  args: packaged ? [] : ['.'],
  env: { ...process.env, UNREAL_DESKTOP_BACKGROUND_CHECK: '1', UNREAL_DESKTOP_USER_DATA: profile }
})

try {
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.unreal)
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }) })
  const api = (method, ...args) => page.evaluate(async ({ method, args }) => window.unreal[method](...args), { method, args })
  await api('openProject', project, true)
  await page.reload(); await page.waitForFunction(() => !!window.unreal)
  await page.getByRole('button', { name: 'Memory', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Project memory' }).waitFor()
  const status = await api('memoryStatus')
  assert.equal(status.totalRecords, 125)
  assert.equal(status.records.length, 50)
  assert.equal((await api('memoryStatus', 0)).records.length, 0)
  const cards = page.locator('.memory-record')
  await page.getByRole('button', { name: /Load older records · 50 of 125 shown/ }).waitFor()
  assert.equal(await cards.count(), 50)
  await page.getByRole('button', { name: /Load older records/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.memory-record').length === 100)
  assert.equal(await cards.count(), 100)
  await page.getByRole('button', { name: /Load older records/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.memory-record').length === 125)
  assert.equal(await cards.count(), 125)
  assert.equal(await page.getByRole('button', { name: /Load older records/ }).count(), 0)
  const oldest = cards.filter({ hasText: 'fixture:0' })
  await oldest.locator('summary').click()
  await oldest.getByRole('textbox', { name: 'Memory record turn-0' }).fill('Unsaved sensitive draft')
  await oldest.getByRole('button', { name: 'Forget this record' }).click()
  await page.waitForFunction(() => {
    const first = [...document.querySelectorAll('.memory-record')].find(node => node.textContent?.includes('fixture:0'))
    const field = first?.querySelector('textarea')
    return field?.disabled && field.value === ''
  })
  assert.equal((await api('memoryRecord', 'turn-0')).state, 'forgotten')
  assert.equal((await api('memoryRecord', 'turn-0')).content, '')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, packaged, records: 125, profile }, null, 2))
} finally {
  await app.close()
}
