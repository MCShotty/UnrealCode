// Regression for the former copied-profile false alarm. Only synthetic keys
// and disposable profiles are used; never read or clone a user's secret store.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-credential-context-'))
const packaged = process.argv.includes('--packaged')
const launch = profile => electron.launch({
  executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE || (packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe')),
  args: packaged ? [] : ['.'],
  env: { ...process.env, UNREAL_DESKTOP_USER_DATA: profile, UNREAL_DESKTOP_BACKGROUND_CHECK: '1' }
})
function profile(name) {
  const path = join(root, name); mkdirSync(path)
  writeFileSync(join(path, 'settings.json'), JSON.stringify({ decisionSetupSeen: true, recentProjects: [], trustedProjects: [] }))
  return path
}
let app
try {
  const original = profile('original'); app = await launch(original)
  let page = await app.firstWindow(); await page.getByRole('heading', { name: 'Open a workspace' }).waitFor()
  await page.evaluate(key => window.unreal.saveKey('openrouter', key), `fixture-${randomUUID()}`)
  assert(await page.evaluate(() => window.unreal.hasKey('openrouter')))
  await app.close(); app = undefined
  assert(existsSync(join(original, 'Local State')))
  const results = {}
  for (const preserveContext of [false, true]) {
    const target = profile(preserveContext ? 'matching-context' : 'missing-context')
    copyFileSync(join(original, 'secrets.json'), join(target, 'secrets.json'))
    if (preserveContext) copyFileSync(join(original, 'Local State'), join(target, 'Local State'))
    app = await launch(target); page = await app.firstWindow()
    await page.getByRole('heading', { name: 'Open a workspace' }).waitFor()
    const available = await page.evaluate(() => window.unreal.hasKey('openrouter'))
    assert.equal(available, preserveContext)
    results[preserveContext ? 'matchingContextDecrypts' : 'missingContextRejected'] = preserveContext ? available : !available
    await app.close(); app = undefined
  }
  console.log(JSON.stringify({ packaged, ...results, realCredentialsUsed: false }))
} finally {
  await app?.close().catch(() => {})
  // root is created by this process and never accepts a user-supplied path.
  rmSync(root, { recursive: true, force: true })
}
