import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-workflow-'))
const projects = ['a', 'b'].map(name => { const path = join(root, name); mkdirSync(path); writeFileSync(join(path, 'reference.txt'), 'FOCUSED_REFERENCE'); writeFileSync(join(path, 'excluded.txt'), 'EXCLUDED_CONTENT'); return path })
const requests = []
const server = createServer(async (req, res) => {
 let body = ''; for await (const chunk of req) body += chunk
 const request = JSON.parse(body); requests.push(request)
 const messages = request.messages || [], initial = messages.find(item => item.role === 'user')?.content || ''
 const toolResults = messages.filter(item => item.role === 'tool')
 let message = { role: 'assistant', content: 'Completed workflow test. Verification recorded.' }
 if (!toolResults.length && initial.includes('WAIT_FOR_INPUT')) message = { role: 'assistant', tool_calls: [{ id: 'question', type: 'function', function: { name: 'RequestInput', arguments: JSON.stringify({ question: 'Choose the target', choices: ['Alpha', 'Beta'] }) } }] }
 else if (!toolResults.length && initial.includes('SLOW_TASK')) message = { role: 'assistant', tool_calls: [{ id: 'slow', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 'sleep 5; echo VERIFIED_TOOL_OUTPUT' }) } }] }
 res.writeHead(200, { 'content-type': 'application/json' })
 res.end(JSON.stringify({ id: `fake-${requests.length}`, choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 30, completion_tokens: 12 } }))
})
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
const packaged = process.argv.includes('--packaged')
const app = await electron.launch({ executablePath: resolve(packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : ['.'], cwd: process.cwd(), env: { ...process.env, UNREAL_DESKTOP_USER_DATA: join(root, 'data') } })
const report = { root, errors: [] }
try {
 const page = await app.firstWindow()
 page.on('pageerror', error => report.errors.push(error.message))
 await page.getByRole('button', { name: 'Set up later' }).click()
 await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
 await app.evaluate(({ Notification }) => { globalThis.__qaNotifications = []; Notification.prototype.show = function () { globalThis.__qaNotifications.push(this) } })
 const endpoint = `http://localhost:${server.address().port}/v1`
 await page.evaluate(baseUrl => window.unreal.updateSettings({ provider: 'openai-compatible', baseUrl, executionMode: 'agent', taskIsolation: false, model: 'fake-workflow', theme: 'dark', notifications: true }), endpoint)
 const wait = async fn => { const end = Date.now() + 120000; while (Date.now() < end) { if (await page.evaluate(fn)) return; await new Promise(resolve => setTimeout(resolve, 100)) } throw Error('Workflow state timed out') }
 await page.evaluate(path => window.unreal.openProject(path, true), projects[0])
 await page.evaluate(async () => { await window.unreal.updateContext('draft', { pinned: ['reference.txt', 'excluded.txt'], excluded: ['excluded.txt'] }); await window.unreal.queueAdd('SLOW_TASK first'); await window.unreal.queueAdd('second queue task'); await window.unreal.queuePause(false) })
 await wait(async () => (await window.unreal.queueSnapshot()).tasks[0].state === 'running')
 await page.evaluate(path => window.unreal.openProject(path, true), projects[1])
 await page.evaluate(async () => { await window.unreal.queueAdd('independent project task'); await window.unreal.queuePause(false) })
 await wait(async () => (await window.unreal.queueSnapshot()).tasks[0].state === 'completed')
 report.independentProject = true
 await page.evaluate(path => window.unreal.openProject(path, true), projects[0])
 await wait(async () => (await window.unreal.queueSnapshot()).tasks.every(task => task.state === 'completed'))
 const queue = await page.evaluate(() => window.unreal.queueSnapshot())
 assert.equal(queue.tasks.length, 2)
 assert(requests.some(request => JSON.stringify(request).includes('FOCUSED_REFERENCE')))
 assert(!requests.some(request => JSON.stringify(request).includes('EXCLUDED_CONTENT')))
 const hits = await page.evaluate(() => window.unreal.searchHistory('VERIFIED_TOOL_OUTPUT'))
 assert(hits.length > 0)
 const source = queue.tasks[0].sessionId
 const continuation = await page.evaluate(async ({ source, endpoint }) => { const preview = await window.unreal.handoffPreview(source); return window.unreal.handoffStart(source, preview.summary, { provider: 'openai-compatible', model: 'alternate-model', baseUrl: endpoint, thinkingLevel: 'low' }) }, { source, endpoint })
 await wait(async () => (await window.unreal.checkpoints()).filter(item => item.state === 'complete').length >= 3)
 const linked = await page.evaluate(() => window.unreal.listSessions())
 assert.equal(linked.find(item => item.id === continuation.sessionId).parentSessionId, source)
 await page.evaluate(async () => { await window.unreal.queueAdd('WAIT_FOR_INPUT'); await window.unreal.queueAdd('must wait'); await window.unreal.queuePause(false) })
 await wait(async () => (await window.unreal.queueSnapshot()).tasks.some(task => task.state === 'waiting_input'))
 const waiting = await page.evaluate(() => window.unreal.queueSnapshot())
 assert(waiting.paused)
 assert.equal(waiting.tasks.at(-1).state, 'pending')
 const awaitingSession = waiting.tasks.find(task => task.state === 'waiting_input').sessionId
 await page.evaluate(id => window.unreal.sendMessage(id, 'Alpha', crypto.randomUUID()), awaitingSession)
 await wait(async () => !(await window.unreal.queueSnapshot()).tasks.some(task => task.state === 'waiting_input'))
 assert((await page.evaluate(() => window.unreal.queueSnapshot())).paused)
 await page.evaluate(() => window.unreal.queuePause(false))
 await wait(async () => (await window.unreal.queueSnapshot()).tasks.every(task => task.state === 'completed'))
 await page.evaluate(path => window.unreal.openProject(path, true), projects[1])
 const notifications = await app.evaluate(() => { const values = globalThis.__qaNotifications; const notification = values.find(value => value.body === 'a'); if (notification) notification.emit('click'); return values.length })
 assert(notifications > 0)
 await wait(async () => (await window.unreal.projectPath()).endsWith('\\a'))
 report.notificationRouting = true
 await page.reload()
 await page.getByRole('button', { name: 'Workflow', exact: true }).click()
 await page.getByRole('heading', { name: 'Workflow', exact: true }).waitFor()
 await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.view-frame')).opacity) > 0.99)
 await page.screenshot({ path: join(root, 'workflow-dark.png') })
 assert.deepEqual(report.errors, [])
 report.requests = requests.length; report.queue = true; report.handoff = true; report.context = true; report.search = true; report.requiredInput = true
 console.log(JSON.stringify(report))
} finally { await app.close().catch(() => {}); server.close() }
