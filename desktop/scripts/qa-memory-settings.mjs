import { _electron as electron } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-memory-settings-'))
const packaged = Boolean(process.env.UNREALCODE_QA_EXECUTABLE)
writeFileSync(join(root, 'settings.json'), JSON.stringify({
  decisionSetupSeen: true,
  provider: 'ollama',
  model: 'qa-local-model',
  theme: 'dark'
}))
const app = await electron.launch({
  executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE || 'node_modules/electron/dist/electron.exe'),
  args: packaged ? [] : ['.'],
  env: { ...process.env, UNREAL_DESKTOP_BACKGROUND_CHECK: '1', UNREAL_DESKTOP_USER_DATA: root }
})

try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: 'Open a workspace' }).waitFor()
  await page.getByRole('button', { name: 'Provider settings' }).click()
  const manual=page.locator('#settings-panel-provider .model-selector details')
  if(!await manual.evaluate(element=>element.open))await manual.locator('summary').click()
  await manual.getByLabel('Model ID').fill('unsaved-chat-model')
  await page.getByRole('tab', { name: 'Provider', exact: true }).focus()
  await page.getByRole('tab', { name: 'Provider', exact: true }).press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'Memory', exact: true }).getAttribute('aria-selected'), 'true', 'Memory must be reachable by keyboard as a Settings tab')
  const panel = page.getByRole('tabpanel', { name: 'Memory' })
  await panel.getByRole('heading', { name: 'Memory model' }).waitFor()
  await panel.getByRole('heading', { name: 'Credentials' }).waitFor()
  await panel.getByRole('heading', { name: 'Automatic memory' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).count(), 0)
  assert.equal(await panel.getByRole('button', { name: 'Save, test & turn on' }).count(), 1)
  assert(await panel.getByText('Matches your chat model').isVisible())
  assert.equal(await panel.getByRole('combobox', { name: 'Memory model provider' }).inputValue(), 'ollama')
  const memoryManual=panel.locator('.model-selector details')
  if(!await memoryManual.evaluate(element=>element.open))await memoryManual.locator('summary').click()
  const memoryModel=memoryManual.getByLabel('Model ID')
  assert.equal(await memoryModel.inputValue(), 'qa-local-model')
  await memoryModel.fill('edited-model')
  assert(await panel.getByText('Separate memory model').isVisible())
  await panel.getByRole('button', { name: 'Use chat model' }).click()
  assert.equal(await memoryModel.inputValue(), 'qa-local-model', 'Copy chat model must use saved settings, not an unsaved Provider draft')
  assert(await panel.getByRole('button', { name: 'Use chat model' }).isDisabled())
  await panel.getByRole('combobox', { name: 'Memory model provider' }).selectOption('openai-compatible')
  assert.equal(await panel.getByLabel('Memory model endpoint').inputValue(), '', 'Changing providers must clear the old local endpoint')
  await panel.getByLabel('API key (optional)').fill('fixture-key-not-saved')
  assert.equal(await panel.getByRole('button', { name: 'Save API key' }).count(), 1, 'Memory credentials must be editable in their own tab')
  await panel.getByRole('button', { name: 'Use chat model' }).click()
  assert.equal(await panel.getByLabel('API key (optional)').count(), 0, 'Switching providers must clear the unsaved key field')
  assert(await panel.getByRole('button', { name: 'Discover models' }).isEnabled(), 'Ollama discovery should use its default local URL')
  const darkAudit = await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(darkAudit.violations.map(item => item.id), [], 'Dark Memory Settings must have no axe violations')
  await page.screenshot({ path: join(root, 'memory-dark.png') })

  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByLabel('Theme', { exact: true }).selectOption('light')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.getByRole('tab', { name: 'Memory', exact: true }).click()
  const lightAudit = await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(lightAudit.violations.map(item => item.id), [], 'Light Memory Settings must have no axe violations')
  await page.screenshot({ path: join(root, 'memory-light.png') })

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setMinimumSize(0, 0)
    win.setContentSize(640, 520)
  })
  await panel.getByRole('heading', { name: 'Automatic memory' }).scrollIntoViewIfNeeded()
  assert(await panel.getByRole('heading', { name: 'Automatic memory' }).isVisible(), 'App-wide memory controls must be reachable in a short window')
  await page.screenshot({ path: join(root, 'memory-compact.png') })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1200, 800)
    win.webContents.setZoomFactor(2)
  })
  await panel.getByRole('heading', { name: 'Automatic memory' }).scrollIntoViewIfNeeded()
  assert(await panel.getByRole('heading', { name: 'Automatic memory' }).isVisible(), 'App-wide controls must remain reachable at 200% scaling')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Memory Settings must not overflow horizontally at 200% scaling')
  assert.deepEqual(errors, [], 'Memory Settings must not throw renderer errors')
  console.log(JSON.stringify({ passed: true, packaged, screenshots: ['memory-dark.png', 'memory-light.png', 'memory-compact.png'].map(name => join(root, name)) }, null, 2))
} finally {
  await app.close()
}
