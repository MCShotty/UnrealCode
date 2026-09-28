import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-settings-navigation-'))
writeFileSync(join(root, 'settings.json'), JSON.stringify({ decisionSetupSeen: true }))
const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: ['.'],
  env: { ...process.env, UNREAL_DESKTOP_BACKGROUND_CHECK: '1', UNREAL_DESKTOP_USER_DATA: root }
})

try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Open a workspace' }).waitFor()
  await page.getByRole('button', { name: 'Provider settings' }).click()
  const provider = page.getByRole('tab', { name: 'Provider', exact: true })
  const memory = page.getByRole('tab', { name: 'Memory', exact: true })
  await provider.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await memory.getAttribute('aria-selected'), 'true', 'ArrowRight from Provider must select Memory')
  assert(await memory.evaluate(node => node === document.activeElement), 'ArrowRight must move focus to Memory')
  await page.getByRole('heading', { name: 'Memory model' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).count(), 0, 'Memory uses its own save and verification action')
  await page.getByRole('button', { name: 'Save & test model' }).waitFor()
  await page.getByText('Open a trusted project').waitFor()
  await page.keyboard.press('End')
  assert.equal(await page.getByRole('tab', { name: 'Recovery' }).getAttribute('aria-selected'), 'true', 'End must select the last tab')
  await page.keyboard.press('Home')
  assert.equal(await provider.getAttribute('aria-selected'), 'true', 'Home must select the first tab')
  console.log(JSON.stringify({ passed: true, profile: root }, null, 2))
} finally {
  await app.close()
}
