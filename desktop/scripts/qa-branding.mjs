import { _electron as electron, chromium } from 'playwright'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

// Electron is not a browser tab; exercise its actual renderer with Playwright.
const root = mkdtempSync(join(tmpdir(), 'unrealcode-branding-'))
const packaged = process.argv.includes('--packaged')
const report = { root, errors: [], themes: [] }
const app = await electron.launch({ executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe')), args: packaged ? [] : ['.'], env: { ...process.env, UNREAL_DESKTOP_USER_DATA: join(root, 'data'), UNREAL_DESKTOP_BACKGROUND_CHECK: '1' } })
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.getByRole('button', { name: 'Set up later' }).click()
  for (const theme of ['dark', 'light', 'system']) {
    await page.evaluate(theme => window.unreal.updateSettings({ theme }), theme)
    await page.reload()
    await page.getByRole('heading', { name: 'Open a workspace' }).waitFor()
    const schemes = theme === 'system' ? ['dark', 'light'] : [theme]
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, scheme)
      const marks = await page.locator('.brand-mark').evaluateAll(elements => elements.map(element => ({ width: element.clientWidth, images: [...element.querySelectorAll('img')].filter(img => getComputedStyle(img).display !== 'none').map(img => ({ className: img.className, loaded: img.complete && img.naturalWidth > 0 })), shadow: getComputedStyle(element).boxShadow, filter: getComputedStyle(element).filter })))
      assert(marks.length >= 2)
      assert(marks.every(mark => mark.width > 0 && mark.images.length === 1 && mark.images[0].loaded && mark.images[0].className === `brand-mark-${scheme}` && mark.shadow === 'none' && mark.filter === 'none'))
      report.themes.push({ theme, scheme, marks: marks.length })
      await page.screenshot({ path: join(root, `app-${theme}-${scheme}.png`), animations: 'disabled' })
    }
  }
  assert.deepEqual(report.errors, [])
  if (packaged) assert.deepEqual(readFileSync(join(resolve(process.env.UNREALCODE_QA_EXECUTABLE||'dist/win-unpacked/UnrealCode.exe'),'../resources/assets/unrealcode-icon.png')), readFileSync('assets/unrealcode-icon.png'))
} finally { await app.close() }

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 630 }, deviceScaleFactor: 1 })
  const sections = ['light', 'dark'].map(theme => {
    const svg = readFileSync(`assets/brand/unrealcode-mark-${theme}.svg`, 'utf8')
    assert(!/<(?:filter|linearGradient|radialGradient)|url\(/i.test(svg))
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    return `<section class="${theme}"><header>UNREALCODE <span>${theme.toUpperCase()}</span></header><img class="hero" src="${src}" alt="UC mark"><footer>${[16,24,32,48].map(size => `<div><img src="${src}" width="${size}" height="${size}" alt="${size} pixel mark"><small>${size}px</small></div>`).join('')}</footer></section>`
  }).join('')
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;display:flex;font:15px 'Segoe UI',sans-serif}section{width:560px;height:630px;padding:40px;display:flex;flex-direction:column;align-items:center}header{width:100%;font-weight:650;letter-spacing:2px;display:flex;justify-content:space-between}header span{font-size:11px;letter-spacing:1px}section.light{background:#F3F5FB;color:#122039}section.dark{background:#101726;color:#F5F7FA}.hero{width:320px;height:320px;margin:35px 0}footer{display:flex;gap:42px;align-items:flex-end}footer div{display:flex;flex-direction:column;align-items:center;gap:18px}small{font-size:11px}</style>${sections}`)
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  await page.screenshot({ path: join(root, 'logo-light-dark.png') })
} finally { await browser.close() }
writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
