import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-queued-isolation-'))
const project = join(root, 'project')
mkdirSync(project)
writeFileSync(join(project, 'README.md'), '# Queue fixture\n')
const git = (...args) => execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'ignore' })
git('init')
git('add', '.')
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Base')

let modelRequests = 0
const server = createServer(async (request, response) => {
  let body = ''
  for await (const part of request) body += part
  const messages = JSON.parse(body).messages || []
  modelRequests++
  const usedTool = messages.some(message => message.role === 'tool')
  const message = usedTool
    ? { role: 'assistant', content: 'The file was created in the isolated task workspace.' }
    : { role: 'assistant', tool_calls: [{ id: 'write-file', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 'printf "queued isolation verified\\n" > generated.txt' }) } }] }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ id: `fixture-${modelRequests}`, choices: [{ index: 0, finish_reason: usedTool ? 'stop' : 'tool_calls', message }], usage: { prompt_tokens: 20, completion_tokens: 8 } }))
})
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: ['.'], cwd: process.cwd(),
  env: { ...process.env, UNREAL_DESKTOP_BACKGROUND_CHECK: '1', UNREAL_DESKTOP_USER_DATA: join(root, 'data') }
})
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'Set up later' }).click()
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
  await page.evaluate(baseUrl => window.unreal.updateSettings({ provider: 'openai-compatible', model: 'fixture-model', baseUrl, executionMode: 'agent', taskIsolation: true }), `http://localhost:${server.address().port}/v1`)
  await page.evaluate(path => window.unreal.openProject(path, true), project)
  const queued = await page.evaluate(async () => { const added = await window.unreal.queueAdd('Create generated.txt in the isolated workspace'); await window.unreal.queuePause(false); return added.tasks[0] })
  const deadline = Date.now() + 120_000
  let task
  while (Date.now() < deadline) {
    task = (await page.evaluate(() => window.unreal.queueSnapshot())).tasks[0]
    if (task.sessionId && ['completed', 'waiting_review', 'failed', 'interrupted'].includes(task.state)) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert(task, 'Queue task did not load')
  assert(['completed', 'waiting_review'].includes(task.state), `Unexpected queued outcome: ${task.state} ${task.message || ''}`)
  assert.equal(task.id, queued.id)
  assert.equal(task.sessionId, task.id, 'A queued session must use its stable attempt identity')
  assert.equal(task.workspaceChoice, 'isolated')
  const workspaces = await page.evaluate(() => window.unreal.taskWorkspaces())
  const workspace = workspaces.find(item => item.id === task.id)
  assert(workspace, 'The queue did not retain its isolated workspace')
  assert.equal(workspace.sessionId, task.sessionId)
  assert.equal(readFileSync(join(workspace.path, 'generated.txt'), 'utf8'), 'queued isolation verified\n')
  assert(modelRequests >= 2)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, root, sessionId: task.sessionId, workspace: workspace.path, state: task.state, modelRequests }))
} finally {
  await app.close().catch(() => {})
  server.close()
}
