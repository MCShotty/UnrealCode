// Explicit live check using the user's existing, externally managed Codex login.
// No authentication material is copied into test files or exposed to the renderer.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
if (!process.argv.includes('--codex')) throw new Error('Live provider verification requires --codex')
const root = mkdtempSync(join(tmpdir(), 'unrealcode-live-')), project = join(root, 'project')
mkdirSync(project); writeFileSync(join(project, 'sample.txt'), 'UNREALCODE_NATIVE_READ_OK\n')
const app = await electron.launch({ executablePath: resolve('dist/win-unpacked/UnrealCode.exe'), args: [], env: { ...process.env, UNREAL_DESKTOP_USER_DATA: join(root, 'data') } })
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Set up later' }).click()
  const status = await page.evaluate(() => window.unreal.codexStatus())
  if (!status.available) { console.log(JSON.stringify({ available: false, reason: status.message })); process.exitCode = 2 }
  else {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await page.evaluate(() => window.unreal.updateSettings({ provider: 'openai-codex', executionMode: 'plan', taskIsolation: false, thinkingLevel: 'low' }))
    await page.evaluate(path => window.unreal.openProject(path, true), project)
    const { sessionId } = await page.evaluate(() => window.unreal.createSession())
    await page.evaluate(id => window.unreal.sendMessage(id, 'Use ReadFile to read sample.txt. Reply with its exact content. Do not use other tools.', crypto.randomUUID()), sessionId)
    const deadline = Date.now() + 120000
    let events = [], reply = ''
    while (Date.now() < deadline) {
      events = await page.evaluate(id => window.unreal.getEvents(id, 0), sessionId)
      reply = events.flatMap(event => event.payload?.Kind === 'model_response' ? event.payload.Data?.Response?.Output || [] : []).filter(item => item.Type === 'message').map(item => item.Data?.Text || '').join('\n')
      if (reply.includes('UNREALCODE_NATIVE_READ_OK') || events.some(event => event.event === 'session.status' && event.payload.status === 'error')) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert(reply.includes('UNREALCODE_NATIVE_READ_OK'), 'Live Codex response did not complete; reconnect the external login or inspect the provider failure locally')
    assert(events.some(event => JSON.stringify(event.payload).includes('"Name":"ReadFile"')), 'Native ReadFile was not exercised')
    console.log(JSON.stringify({ provider: 'openai-codex', nativeRead: true, reply, sessionId, root }))
  }
} finally { await app.close().catch(() => {}) }
