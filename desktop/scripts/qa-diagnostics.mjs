import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root = mkdtempSync(join(tmpdir(), 'unrealcode-diagnostics-')), project = join(root, 'project')
mkdirSync(project); writeFileSync(join(project, 'sample.txt'), 'before\n')
const git = args => execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'ignore' })
git(['init']); git(['add', '.']); git(['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Fixture'])
const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'diagnostic-fixture' }] })); return }
  let body = ''; for await (const chunk of req) body += chunk
  const request = JSON.parse(body), messages = request.messages || []
  const health = messages.some(message => message.content === 'Reply with OK.')
  const done = messages.some(message => message.role === 'tool')
  const message = health ? { role: 'assistant', content: 'OK' } : done ? { role: 'assistant', content: 'Updated sample.txt to after. Verification passed.' } : { role: 'assistant', tool_calls: [{ id: 'edit', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: "printf 'after\\n' > sample.txt" }) } }] }
  res.end(JSON.stringify({ id: 'fixture', choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 30, completion_tokens: 8 } }))
})
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
const packaged = process.argv.includes('--packaged'), live = process.argv.includes('--live-decisions')
const app = await electron.launch({ executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe')), args: packaged ? [] : ['.'], cwd: process.cwd(), env: { ...process.env, UNREAL_DESKTOP_USER_DATA: join(root, 'data') } })
const report = { root, errors: [] }
let traceSession = ''
try {
  const page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message))
  await page.getByRole('button', { name: 'Set up later' }).click()
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
  const endpoint = `http://localhost:${server.address().port}/v1`
  await page.evaluate(baseUrl => window.unreal.updateSettings({ provider: 'openai-compatible', baseUrl, executionMode: 'agent', taskIsolation: false, model: 'diagnostic-fixture', theme: 'dark' }), endpoint)
  await page.evaluate(path => window.unreal.openProject(path, true), project)
  const health = await page.evaluate(endpoint => window.unreal.modelHealth('openai-compatible', endpoint, 'diagnostic-fixture', true), endpoint)
  assert.equal(health.response, 'OK'); assert.equal(health.inputTokens, 30); assert.equal(health.contextLimit, undefined)
  if (live) {
    await page.evaluate(async () => { await window.unreal.updateSettings({ decisionEngine: 'jev', decisionModel: 'jev-latest' }); await window.unreal.decisionConsent() })
    const status = await page.evaluate(() => window.unreal.decisionStatus()); assert(status.available, 'TypeSafe key unavailable')
    const id = await page.evaluate(() => window.unreal.evaluationStart({ tasks: [{ prompt: 'Change sample.txt to after and verify the file.', criteria: 'sample.txt contains after followed by a newline', testCommand: 'test "$(cat sample.txt)" = after' }], runLimit: 2, timeoutMinutes: 2 }))
    let result; const end = Date.now() + 240000
    while (Date.now() < end) { result = (await page.evaluate(() => window.unreal.evaluations())).find(value => value.id === id); if (result.state !== 'running') break; await new Promise(resolve => setTimeout(resolve, 300)) }
    report.evaluation = result
    assert.equal(result.state, 'completed', JSON.stringify(result))
    assert(result.arms.every(arm => arm.tests.exitCode === 0 && !arm.worktree))
    assert.equal(result.arms[0].usage.decisionCalls, 0)
    assert(result.arms[1].usage.decisionCalls >= 2)
    assert.equal(readFileSync(join(project, 'sample.txt'), 'utf8'), 'before\n')
    assert.equal((await page.evaluate(() => window.unreal.usageSnapshot())).sessions.length, 0)
    traceSession = (await page.evaluate(() => window.unreal.createSession())).sessionId
    await page.evaluate(id => window.unreal.sendMessage(id, 'Change sample.txt to after and verify the file.', crypto.randomUUID()), traceSession)
    const traceDeadline = Date.now() + 60000
    while (Date.now() < traceDeadline) { if ((await page.evaluate(id => window.unreal.decisionTraces(id), traceSession)).length >= 2) break; await new Promise(resolve => setTimeout(resolve, 100)) }
    assert((await page.evaluate(id => window.unreal.decisionTraces(id), traceSession)).length >= 2)
  }
  await page.reload(); await page.getByRole('button', { name: 'Diagnostics', exact: true }).click()
  await page.getByRole('heading', { name: 'Diagnostics', exact: true }).waitFor()
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.view-frame')).opacity) > 0.99)
  await page.getByRole('button', { name: 'Run small response test', exact: true }).click()
  await page.getByText('Small response test completed; latency includes model loading if needed.').waitFor()
  await page.screenshot({ path: join(root, 'diagnostics-dark.png') })
  if (traceSession) {
    await page.getByRole('tab', { name: 'Decision trace', exact: true }).click()
    await page.getByLabel('Decision trace session').selectOption(traceSession)
    await page.getByRole('button', { name: 'Load decision trace', exact: true }).click()
    await page.getByText('Post-change semantic verification', { exact: true }).waitFor()
    await page.getByLabel('Recorded user override').first().fill('Reviewed the fixture evidence independently.')
    await page.getByRole('button', { name: 'Save override note', exact: true }).first().click()
    await page.waitForTimeout(150)
    const traces = await page.evaluate(id => window.unreal.decisionTraces(id), traceSession)
    assert(traces.some(trace => trace.override === 'Reviewed the fixture evidence independently.'))
    report.traceOverrides = true
    await page.screenshot({ path: join(root, 'decision-trace.png') })
  }
  await page.getByRole('tab', { name: 'Evaluations', exact: true }).click()
  await page.getByRole('heading', { name: 'Compare decisions with the main model alone' }).waitFor()
  await page.evaluate(() => window.unreal.updateSettings({ theme: 'light' })); await page.reload()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click()
  await page.getByRole('heading', { name: 'Diagnostics', exact: true }).waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.screenshot({ path: join(root, 'diagnostics-light.png') })
  assert.deepEqual(report.errors, []); report.health = health
  console.log(JSON.stringify(report))
} finally { await app.close().catch(() => {}); server.close() }
