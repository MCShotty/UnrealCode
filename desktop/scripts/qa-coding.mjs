import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-coding-')), project = join(root, 'project')
mkdirSync(project); writeFileSync(join(project, 'sample.txt'), 'committed\n')
const git = args => execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'ignore' })
git(['init']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Base'])
writeFileSync(join(project, 'sample.txt'), 'local dirty\n')
const requests = []
const server = createServer(async (req, res) => {
 if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'fixture'}]}));return}
 if(req.method!=='POST'){res.writeHead(404).end();return}
 let text = ''; for await (const chunk of req) text += chunk
 let body;try{body=JSON.parse(text)}catch{res.writeHead(400).end();return}if(!Array.isArray(body.messages)){res.writeHead(400).end();return}requests.push(body)
 const done = body.messages.some(item => item.role === 'tool')
 const plan = body.messages.some(item => typeof item.content === 'string' && item.content.includes('PLAN_FIXTURE'))
 const message = done || plan ? { role: 'assistant', content: 'Fixture complete.' } : { role: 'assistant', tool_calls: [
   { id: 'read', type: 'function', function: { name: 'ReadFile', arguments: JSON.stringify({ path: 'sample.txt' }) } },
   { id: 'patch', type: 'function', function: { name: 'ApplyPatch', arguments: JSON.stringify({ edits: [{ path: 'sample.txt', expectedRevision: createHash('sha256').update('local dirty\n').digest('hex'), content: 'agent edit\n' }] }) } },
   { id: 'command', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 'echo SHOULD_NOT_EXECUTE > forbidden.txt' }) } }
 ] }
 res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: `fixture-${requests.length}`, choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 25, completion_tokens: 10 } }))
})
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
const packaged = process.argv.includes('--packaged')
const app = await electron.launch({ executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe')), args: packaged ? [] : ['.'], cwd: process.cwd(), env: { ...process.env, UNREAL_DESKTOP_USER_DATA: join(root, 'data'),UNREAL_DESKTOP_BACKGROUND_CHECK:'1' } })
const report = { root, errors: [], warnings: [] }
try {
 const page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.warnings.push(message.text()) })
 await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); dialog.showMessageBoxSync = () => 1 })
 const wait = async (predicate, argument, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await page.evaluate(predicate, argument)) return; await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error('Coding workflow state timed out') }
 await page.getByRole('button', { name: 'Set up later' }).click()
 await page.evaluate(baseUrl => window.unreal.updateSettings({ provider: 'openai-compatible', baseUrl, model: 'fixture', executionMode: 'ask', taskIsolation: true, theme: 'dark' }), `http://localhost:${server.address().port}/v1`)
 await page.evaluate(path => window.unreal.openProject(path, true), project)
 const note=await page.evaluate(async()=>{const target=(await window.unreal.fieldnoteTargets())[0];return window.unreal.fieldnoteSave({title:'Fixture guidance',body:'Treat sample.txt as text. Keep the source project unchanged until reviewed integration.',pointer:{projectId:target.id,projectPath:target.path,projectName:target.name},enabled:true,indexing:false})})
 await page.reload(); await page.getByLabel('Message UnrealCode').fill('EDIT_NATIVE fixture')
 await page.getByRole('button', { name: 'Send', exact: true }).click()
 await page.getByText('ApplyPatch needs approval', { exact: true }).waitFor({ timeout: 120000 })
 await page.getByText('Bash needs approval', { exact: true }).waitFor()
 const tasks = await page.evaluate(() => window.unreal.taskWorkspaces()), task = tasks.find(item => item.sessionId)
 assert(task); assert.equal(readFileSync(join(task.path, 'sample.txt'), 'utf8'), 'local dirty\n')
 const events = await page.evaluate(id => window.unreal.getEvents(id, 0), task.sessionId)
 assert(events.some(event => event.event === 'operation.update' && event.payload.Status === 'completed'), 'read did not finish while approvals waited')
 await page.locator('.approval-card').filter({ hasText: 'Bash needs approval' }).getByRole('button', { name: 'Deny', exact: true }).click()
 await page.locator('.approval-card').filter({ hasText: 'ApplyPatch needs approval' }).getByRole('button', { name: 'Allow once', exact: true }).click()
 await wait(async id => (await window.unreal.taskWorkspaces()).find(item => item.id === id)?.state === 'review', task.id)
 assert.equal(readFileSync(join(project, 'sample.txt'), 'utf8'), 'local dirty\n')
 assert.equal(readFileSync(join(task.path, 'sample.txt'), 'utf8'), 'agent edit\n')
 await assert.rejects(async () => readFileSync(join(task.path, 'forbidden.txt')))
 report.approvals = true; report.isolatedSnapshot = true
 assert(requests.some(request=>request.messages.some(message=>typeof message.content==='string'&&message.content.includes('<unrealcode_fieldnotes>')&&message.content.includes(note.body))),'Saved Fieldnote did not reach the provider as structured advisory context')
 const receipts=await page.evaluate(id=>window.unreal.fieldnoteReceipts(id),task.sessionId)
 assert(receipts.some(receipt=>receipt.state==='accepted'&&receipt.notes.some(value=>value.id===note.id&&value.revision===1)),'Accepted guidance receipt missing');report.fieldnoteReceipt=true
 await page.getByRole('button', { name: 'Review', exact: true }).click()
 await page.getByRole('button', { name: /EDIT_NATIVE fixture · review/ }).click()
 await page.locator('.workspace-change input[type="checkbox"]').check()
 await page.getByRole('button', { name: 'Integrate selected files', exact: true }).click()
 await page.getByText(/Integrated selected files/).waitFor()
 assert.equal(readFileSync(join(project, 'sample.txt'), 'utf8'), 'agent edit\n'); report.integration = true
 assert(await page.evaluate(id=>window.unreal.workspaceArchive(id),task.id))
 assert(!existsSync(task.path));await page.evaluate(path=>window.unreal.openProject(path,true),project)
 assert(await page.evaluate(id=>window.unreal.workspaceRestore(id),task.id))
 assert.equal(readFileSync(join(task.path,'sample.txt'),'utf8'),'agent edit\n')
 await page.evaluate(path=>window.unreal.openProject(path,true),project);await page.reload()
 await page.locator('.session-row').filter({hasText:'EDIT_NATIVE fixture'}).click()
 await page.getByLabel('Message UnrealCode').waitFor();report.archiveRestore=true
 await page.getByRole('button', { name: 'Files', exact: true }).click()
 await page.locator('.file-row').filter({ hasText: 'sample.txt' }).click()
 await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 })
 await page.getByRole('button', { name: 'Compare with HEAD', exact: true }).click()
 await page.locator('.monaco-diff-editor').waitFor()
 await page.getByRole('button', { name: 'Editor', exact: true }).click()
 await page.locator('.monaco-diff-editor').waitFor({ state: 'detached' })
 await page.locator('.monaco-editor .view-lines').first().click()
 await page.locator('.monaco-editor textarea').first().focus()
 await page.keyboard.press('Control+End'); await page.keyboard.type('editor change\n')
 report.editorInput = await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 300), text: document.querySelector('.monaco-editor .view-lines')?.textContent, tabs: document.querySelector('.editor-tabs')?.textContent }))
 await page.getByRole('button', { name: 'Save', exact: true }).click()
 await wait(async () => (await window.unreal.editorRead('sample.txt')).content.includes('editor change'))
 report.editor = true
 await page.locator('.monaco-editor textarea').first().focus()
 await page.keyboard.press('Control+f')
 await page.getByRole('textbox', { name: 'Find', exact: true }).fill('agent')
 await page.keyboard.press('Escape')
 report.editorSearch = true
 await page.screenshot({ path: join(root, 'editor-dark.png') })
 await page.locator('.monaco-editor textarea').first().focus(); await page.keyboard.press('Control+End'); await page.keyboard.type('unsaved draft')
 await page.getByRole('button', { name: 'Chat', exact: true }).click()
 await page.getByRole('button', { name: 'Files', exact: true }).click()
 await page.getByRole('tab', { name: /sample.txt/ }).waitFor()
 assert((await page.locator('.editor-tabs').innerText()).includes('●'))
 report.returnedEditor=await page.evaluate(async()=>({active:await window.unreal.activeWorkspace(),read:(await window.unreal.editorRead('sample.txt')).workspace,rendered:document.querySelector('.files-page')?.getAttribute('data-workspace'),tabs:document.querySelector('.editor-tabs')?.textContent}))
 assert.equal(report.returnedEditor.active.path,report.returnedEditor.read);assert.equal(report.returnedEditor.rendered,report.returnedEditor.read)
 writeFileSync(join(task.path, 'sample.txt'), 'external later edit\n')
 await page.getByRole('button', { name: 'Save', exact: true }).click()
 await page.getByRole('alert').filter({ hasText: 'changed on disk' }).waitFor()
 assert.equal(readFileSync(join(task.path, 'sample.txt'), 'utf8'), 'external later edit\n')
 await page.evaluate(() => { window.confirm = () => true })
 await page.getByRole('button', { name: 'Reload', exact: true }).click()
 await wait(() => !document.querySelector('.editor-tabs')?.textContent.includes('●'))
 report.editorConflict = true
 await page.locator('.monaco-editor textarea').first().focus(); await page.keyboard.press('Control+a')
 await page.getByRole('button', { name: 'Attach selection', exact: true }).click()
 await page.getByLabel('Message UnrealCode').waitFor()
 assert((await page.getByLabel('Message UnrealCode').inputValue()).includes('Reference: sample.txt:'))
 report.selectionToChat = true
 await page.getByRole('button', { name: 'Chat', exact: true }).click()
 await page.getByLabel('Execution mode').selectOption('plan')
 await page.evaluate(note=>window.unreal.fieldnoteSave({...note,expectedRevision:note.revision,enabled:false}),note)
 await page.getByLabel('Message UnrealCode').fill('PLAN_FIXTURE inspect only')
 await page.getByRole('button', { name: 'Send', exact: true }).click()
 await wait(async id => (await window.unreal.getEvents(id, 0)).some(event => event.event === 'session.item' && event.payload.Kind === 'input' && JSON.stringify(event.payload).includes('PLAN_FIXTURE')), task.sessionId)
 await wait(async () => (await window.unreal.listSessions()).every(item => item.state !== 'running'))
 const plan = requests.find(request => request.messages.some(item => typeof item.content === 'string' && item.content.includes('PLAN_FIXTURE')))
 assert(plan); assert(!plan.tools.some(tool => ['Bash', 'ApplyPatch'].includes(tool.function.name))); report.plan = true
 assert(!plan.messages.some(message=>typeof message.content==='string'&&message.content.includes('<unrealcode_fieldnotes>')&&message.content.includes(note.body)),'Withdrawn Fieldnote remained active');report.fieldnoteWithdrawal=true
 await page.evaluate(() => window.unreal.updateSettings({ theme: 'light' })); await page.reload(); await page.emulateMedia({ reducedMotion: 'reduce' })
 await page.getByRole('button', { name: 'Files', exact: true }).click(); await page.locator('.file-row').filter({ hasText: 'sample.txt' }).click(); await page.locator('.monaco-editor').first().waitFor()
 assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light')
 await page.screenshot({ path: join(root, 'editor-light.png') })
 assert.deepEqual(report.errors, []); assert(!await page.locator('vite-error-overlay').count())
 console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  try { const page = await app.firstWindow(); report.visibleErrors = await page.locator('.error-inline,.banner-error').allTextContents();report.failureDetails=await page.locator('.failure-notice details').allTextContents();report.failedEditor=await page.evaluate(async()=>({active:await window.unreal.activeWorkspace(),read:(await window.unreal.editorRead('sample.txt')).workspace,rendered:document.querySelector('.files-page')?.getAttribute('data-workspace'),tabs:document.querySelector('.editor-tabs')?.textContent})); await page.screenshot({ path: join(root, 'failure.png') }) } catch {}
  writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); throw error
} finally { await app.close().catch(() => {}); server.close() }
