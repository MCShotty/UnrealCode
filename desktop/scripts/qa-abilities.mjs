// Offscreen navigation and theme regression for the shared Abilities page.
import { _electron as electron } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-abilities-'))
const project = join(root, 'project'), profile = join(root, 'profile')
mkdirSync(project); mkdirSync(profile)
writeFileSync(join(project, 'README.md'), '# Abilities fixture\n')
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ decisionSetupSeen: true, theme: 'dark' }))
const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'],
  env: { ...process.env, UNREAL_DESKTOP_BACKGROUND_CHECK: '1', UNREAL_DESKTOP_USER_DATA: profile }
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.getByRole('heading', { name: 'Open a workspace' }).waitFor()
  await page.evaluate(() => window.unreal.updateSettings({ decisionEngine: 'off', theme: 'dark' }))
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); dialog.showMessageBoxSync = () => 1 })
  await page.evaluate(path => window.unreal.openProject(path, true), project)
  await page.reload()
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor()
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1400, 900) })
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const visitAnimated = async label => {
    await page.evaluate(() => {
      const samples = []
      let active = true
      const sample = () => {
        samples.push([...document.querySelectorAll('.view-frame')].map(node => Number(getComputedStyle(node).opacity)))
        if (active) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      window.__viewMotion = { samples, stop: () => { active = false; return samples } }
    })
    await nav.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('heading', { name: label, exact: true }).waitFor()
    if (label === 'Files') await page.getByText('Loading files…', { exact: true }).waitFor({ state: 'hidden' })
    if (label === 'Sessions') await page.getByText('Loading sessions…', { exact: true }).waitFor({ state: 'hidden' })
    await page.waitForTimeout(300)
    const samples = await page.evaluate(() => window.__viewMotion.stop())
    assert(samples.some(frame => frame.some(opacity => opacity > .02 && opacity < .98)), `${label} must fade in or out`)
    assert(samples.every(frame => frame.length <= 1), `${label} must not overlap another page`)
  }
  await visitAnimated('Files')
  await visitAnimated('Sessions')
  await visitAnimated('Files')
  assert.equal(await nav.getByRole('button', { name: 'Abilities', exact: true }).count(), 1)
  assert.equal(await nav.getByRole('button', { name: 'Connections', exact: true }).count(), 0)
  await nav.getByRole('button', { name: 'Abilities', exact: true }).click()
  await page.getByRole('heading', { name: 'Abilities', exact: true }).waitFor()
  const skills = page.getByRole('tab', { name: /Skills/ }), mcps = page.getByRole('tab', { name: /MCPs/ })
  assert.equal(await skills.getAttribute('aria-selected'), 'true')
  await page.getByRole('button', { name: 'New skill' }).click()
  const editor = page.getByRole('textbox', { name: 'Skill content' })
  await editor.fill('Unsaved skill draft stays put while switching sections.')
  await skills.focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await mcps.getAttribute('aria-selected'), 'true')
  await page.getByRole('heading', { name: 'MCP servers', exact: true }).waitFor()
  assert.equal(await nav.getByRole('button', { name: 'Abilities' }).getAttribute('aria-current'), 'page')
  await page.keyboard.press('ArrowLeft')
  assert.equal(await skills.getAttribute('aria-selected'), 'true')
  assert.equal(await editor.inputValue(), 'Unsaved skill draft stays put while switching sections.')
  await page.screenshot({ path: join(root, 'abilities-skills-dark.png'), animations: 'disabled' })
  assert.equal((await page.evaluate(() => window.unreal.command({ name: 'mcp', args: '' }))).view, 'connections')
  assert.equal((await page.evaluate(() => window.unreal.command({ name: 'skills', args: '' }))).view, 'skills')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('unrealcode:navigate-view', { detail: 'connections' })))
  await page.waitForFunction(() => document.querySelector('#abilities-tab-connections')?.getAttribute('aria-selected') === 'true')
  assert.equal(await mcps.getAttribute('aria-selected'), 'true')
  await page.screenshot({ path: join(root, 'abilities-mcps-dark.png'), animations: 'disabled' })
  const accessibility = await new AxeBuilder({ page }).setLegacyMode(true).include('.abilities-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(accessibility.violations.map(item => item.id), [], 'Abilities needs no automated accessibility violations')

  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setContentSize(700, 520); win.webContents.setZoomFactor(1.5) })
  assert(await page.locator('.abilities-page').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Abilities must not overflow at 150% scaling')
  await page.screenshot({ path: join(root, 'abilities-compact-dark.png'), animations: 'disabled' })
  const colors = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement)
    return { surface: css.getPropertyValue('--md-sys-color-surface').trim(), primary: css.getPropertyValue('--md-sys-color-primary').trim(), onPrimary: css.getPropertyValue('--md-sys-color-on-primary').trim(), filled: css.getPropertyValue('--md-comp-filled-button-container').trim() }
  })
  assert.equal(colors.surface, '#151514')
  assert.equal(colors.primary, '#ffb695')
  assert.equal(colors.filled, colors.primary)
  const luminance = color => {
    const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
  }
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
  assert(contrast(colors.primary, colors.onPrimary) >= 4.5, 'Filled button text must meet normal text contrast')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert(await mcps.evaluate(node => parseFloat(getComputedStyle(node).transitionDuration) < .001), 'Reduced motion removes visible transitions')
  await page.evaluate(() => window.unreal.updateSettings({ theme: 'light' }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim()), '#0027cc')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, root, colors }))
} finally {
  await app.close()
}
