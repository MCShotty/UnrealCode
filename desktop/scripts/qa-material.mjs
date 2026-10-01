// Browser plugin is unavailable for Electron. Exercise the real packaged/dev
// renderer offscreen, using a disposable project and a deterministic provider.
import { _electron as electron } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { checkExpressiveMotion } from './qa-expressive-checks.mjs'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-material-'))
const project = join(root, 'fieldnotes'), profile = join(root, 'profile')
mkdirSync(project); mkdirSync(profile)
writeFileSync(join(project, 'README.md'), '# Fieldnotes\nA small workspace for collecting ideas.\n')
for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Fixture']]) execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'ignore' })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ decisionSetupSeen: true, theme: 'dark' }))
let calls = 0
const provider = createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'material-fixture' }] })); return }
  for await (const _chunk of req) { /* consume request without retaining project text */ }
  const tool = calls++ === 0
  const message = tool ? { role: 'assistant', tool_calls: [{ id: 'read-project', type: 'function', function: { name: 'ReadFile', arguments: JSON.stringify({ path: 'README.md' }) } }] } : { role: 'assistant', content: '## A clear starting point\n\nI inspected the project’s README. **Fieldnotes** is a small workspace for collecting ideas.\n\n### Suggested next steps\n\n1. Build a searchable collection of notes.\n2. Add tags and a focused writing view.\n3. Verify keyboard navigation and offline storage.\n\nNo project files were changed. Ready when you are.' }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: randomUUID(), choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 120, completion_tokens: 80 } }))
})
await new Promise(resolve => provider.listen(0, '0.0.0.0', resolve))
const packaged = process.argv.includes('--packaged')
const app = await electron.launch({ executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE || (packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe')), args: packaged ? [] : ['.'], env: { ...process.env, UNREAL_DESKTOP_BACKGROUND_CHECK: '1', UNREAL_DESKTOP_USER_DATA: profile } })
const page = await app.firstWindow(), report = { root, packaged, checks: [], errors: [], accessibility: [] }
page.on('pageerror', error => report.errors.push(error.message))
const api = (method, ...args) => page.evaluate(({ method, args }) => window.unreal[method](...args), { method, args })
const settleView = () => page.waitForFunction(() => !document.querySelector('.view-frame') || getComputedStyle(document.querySelector('.view-frame')).opacity === '1')
async function shot(name) {
  await settleView()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  // Playwright's Electron screenshot clips to CSS pixels after page zoom.
  // Capture the complete offscreen window at its native size for zoom evidence.
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(root, `${name}.png`), Buffer.from(png, 'base64'))
}
async function audit(name) { const result = await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); report.accessibility.push({ name, violations: result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })) }) }
async function size(width, height, zoom = 1) { await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setContentSize(width, height); win.webContents.setZoomFactor(zoom) }, { width, height, zoom }) }
try {
  await page.getByRole('heading', { name: 'Open a workspace' }).waitFor(); await shot('welcome-dark')
  await api('updateSettings', { decisionEngine: 'off', provider: 'openai-compatible', model: 'material-fixture', baseUrl: `http://localhost:${provider.address().port}/v1`, executionMode: 'plan', taskIsolation: false })
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); dialog.showMessageBoxSync = () => 1 })
  await api('openProject', project, true); await page.reload(); await page.getByRole('heading', { name: 'What are we building?' }).waitFor()
  await shot('empty-chat-dark')
  await page.getByRole('button', { name: 'Explore this project', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message UnrealCode' })
  assert((await composer.inputValue()).includes('Do not change any files'))
  assert(await composer.evaluate(element => element === document.activeElement))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('heading', { name: 'A clear starting point' }).waitFor({ timeout: 90000 })
  const sessions = await api('listSessions'), id = sessions[0].id
  await api('rebuildHistoryCache')
  assert((await api('historyPage', id, { limit: 1000 })).events.length > 0, 'Online cache rebuild must replay the current session')
  report.checks.push('Online history rebuild replays its session before reporting completion')
  await api('command', { name: 'rename', args: 'Explore the Fieldnotes workspace', sessionId: id })
  await composer.fill('Keep this draft while I inspect the workspace.')
  await shot('chat-dark'); await audit('chat-dark')
  const work = page.locator('.work-section').first()
  if (await work.locator('.work-disclosure').getAttribute('aria-expanded') === 'false') await work.locator('.work-disclosure').click()
  await page.locator('.compact-work-event').first().click()
  await page.getByRole('dialog', { name: 'Tool Activity' }).waitFor()
  await page.getByRole('button', { name: 'Close tool activity' }).click()
  await page.locator('.model-picker > summary').click(); await page.getByPlaceholder('Search models').fill('future-model'); await page.locator('.model-picker-panel select').first().focus(); await page.keyboard.press('Escape')
  assert.equal(await page.locator('.model-picker').getAttribute('open'), null)
  assert.equal((await api('sessionConfig', id)).model, 'material-fixture')
  await page.keyboard.press('Control+k'); await page.getByRole('textbox', { name: 'Search commands' }).fill('Go to Hooks'); await page.keyboard.press('Enter'); await page.getByRole('heading', { name: 'Project hooks' }).waitFor()
  await page.getByRole('button', { name: 'Chat', exact: true }).click(); await composer.waitFor(); assert.equal(await composer.inputValue(), 'Keep this draft while I inspect the workspace.')
  report.checks.push('Suggestion creates an editable draft, real read tool, tool expansion, model picker boundaries, command palette and draft preservation')
  for(const density of ['compact','cozy']){await api('updateSettings',{density});
  for (const label of ['Sessions', 'Files', 'Review', 'Workflow', 'Task controls', 'Browser','Computer','Documents','Fieldnotes', 'Terminal', 'GitHub', 'Context', 'Abilities', 'Memory', 'Hooks', 'Projects', 'Usage', 'Diagnostics', 'Settings', 'Chat']) {
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label, exact: true }).click()
    if (label === 'Chat') await composer.waitFor()
    else await page.getByRole('heading', { name: { Context: 'Context inspector', Memory: 'App-wide memory', Hooks: 'Project hooks' }[label] || label, exact: true }).waitFor()
    await settleView()
    if (label === 'Files') {
      await page.locator('.file-row').filter({ hasText: 'README.md' }).click()
      await page.locator('.monaco-editor').first().waitFor()
      const matches = await page.locator('.monaco-editor').first().evaluate(element => {
        const expected = document.createElement('span'); expected.style.backgroundColor = 'var(--panel)'; document.body.append(expected)
        const same = getComputedStyle(element).backgroundColor === getComputedStyle(expected).backgroundColor
        expected.remove(); return same
      })
      assert(matches, 'Monaco must use the shared surface token'); await shot('editor-dark')
    }
    if (label === 'Terminal') { await page.locator('.xterm-screen').waitFor(); await shot('terminal-dark') }
    if (label === 'Abilities') {
      const skills = page.getByRole('tab', { name: /Skills/ })
      const mcps = page.getByRole('tab', { name: /MCPs/ })
      assert.equal(await skills.getAttribute('aria-selected'), 'true')
      await skills.focus(); await page.keyboard.press('ArrowRight')
      assert.equal(await mcps.getAttribute('aria-selected'), 'true')
      await page.getByRole('heading', { name: 'MCP servers', exact: true }).waitFor()
      assert.equal(await page.locator('.nav-item[aria-current="page"]').getAttribute('aria-label'), 'Abilities')
      await page.keyboard.press('ArrowLeft')
      assert.equal(await skills.getAttribute('aria-selected'), 'true')
    }
    await page.waitForFunction(label => document.querySelector('.nav-item[aria-current="page"]')?.getAttribute('aria-label') === label, label)
  }
  }report.checks.push('All 20 navigation destinations render in both density presets; Skills and MCPs share Abilities')
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  const appearanceTab = page.getByRole('tab', { name: 'Appearance', exact: true })
  await appearanceTab.click()
  assert.equal(await appearanceTab.getAttribute('aria-selected'), 'true')
  await page.getByRole('tabpanel', { name: 'Appearance' }).getByRole('heading', { name: 'Appearance' }).waitFor()
  await page.getByLabel('Theme', { exact: true }).selectOption('light'); await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.getByRole('button', { name: 'Chat', exact: true }).click(); await composer.waitFor(); await shot('chat-light'); await audit('chat-light')
  await page.getByRole('button', { name: 'Focus layout' }).click(); assert(await page.locator('.app-shell').evaluate(el => el.classList.contains('focus-layout')))
  await page.getByRole('button', { name: 'Focus layout' }).click()
  await size(780, 740); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Toggle session pane' }).click(); await page.getByRole('dialog', { name: 'Sessions', exact: true }).waitFor()
  await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Sessions', exact: true }).waitFor({ state: 'detached' })
  assert(await page.getByRole('button', { name: 'Toggle session pane' }).evaluate(el => el === document.activeElement))
  await page.getByRole('button', { name: 'Toggle activity rail' }).click(); await page.getByRole('dialog', { name: 'Activity', exact: true }).waitFor(); await audit('compact-activity'); await shot('compact-activity'); await page.keyboard.press('Escape')
  await shot('chat-compact'); assert(await composer.isVisible())
  report.checks.push('Focus layout, compact pane dialogs, Escape, focus restoration and reduced motion')
  for (const [width, height, zoom] of [[1200, 800, 1.5], [1200, 800, 2], [540, 720, 1]]) {
    await size(width, height, zoom)
    await page.getByRole('button', { name: 'Send', exact: true }).scrollIntoViewIfNeeded()
    await shot(`chat-${width}-${zoom}`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Document overflow at ${width}/${zoom}`)
    const box = await composer.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= await page.evaluate(() => innerWidth) + 1, 'Composer must fit')
    const send = await page.getByRole('button', { name: 'Send', exact: true }).boundingBox()
    assert(send && send.y >= 0 && send.y + send.height <= await page.evaluate(() => innerHeight) + 1, 'Send must remain in the viewport')
  }
  report.checks.push('Compact through expanded sizing and 150–200% scaling')
  await size(1500, 940); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor(); await shot('settings-light')
  await appearanceTab.click(); await page.getByLabel('Theme', { exact: true }).selectOption('system'); await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  report.checks.push('Light/dark and Follow Windows, in-page settings navigation')
  await page.emulateMedia({ forcedColors: 'active' })
  await page.getByRole('button', { name: 'Chat', exact: true }).focus()
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
  assert(await page.getByRole('button', { name: 'Chat', exact: true }).evaluate(el => el === document.activeElement))
  assert(await page.getByRole('button', { name: 'Chat', exact: true }).evaluate(el => getComputedStyle(el).outlineStyle !== 'none'))
  await shot('forced-colors'); await page.emulateMedia({ forcedColors: 'none' })
  report.checks.push('Visible keyboard focus in Windows forced-colors mode')
  if (process.argv.includes('--motion')) await checkExpressiveMotion(app, page, id, report)
  assert.deepEqual(report.errors, []); assert(report.accessibility.every(item => !item.violations.length), 'Axe violations require inspection')
} catch (error) { report.failure = String(error); await shot('failure').catch(() => {}); throw error }
finally { writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await app.close(); provider.close() }
