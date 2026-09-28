// Opt-in live TypeSafe regression using only synthetic state and a disposable project.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

if (!process.argv.includes('--live')) throw new Error('Pass --live to make a TypeSafe request')
const root = mkdtempSync(join(tmpdir(), 'unrealcode-decision-live-'))
const project = join(root, 'project')
mkdirSync(project)
writeFileSync(join(project, 'README.md'), 'Synthetic decision regression fixture.\n')
const packaged = process.argv.includes('--packaged')
const executablePath = resolve(process.env.UNREALCODE_QA_EXECUTABLE || (packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe'))
const app = await electron.launch({
  executablePath,
  args: packaged ? [] : ['.'],
  cwd: process.cwd(),
  env: { ...process.env, UNREAL_DESKTOP_USER_DATA: join(root, 'data'), UNREAL_DESKTOP_BACKGROUND_CHECK: '1' }
})
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'Set up later' }).click()
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
  await page.evaluate(() => window.unreal.updateSettings({ decisionEngine: 'jev', decisionModel: 'jev-latest' }))
  await page.evaluate(path => window.unreal.openProject(path, true), project)
  const status = await page.evaluate(() => window.unreal.decisionStatus())
  assert(status.available, `TypeSafe unavailable: ${status.message}`)
  const result = await page.evaluate(() => window.unreal.evaluateDecision({
    state: { implementation: 'A local tracker stores issues in SQLite and exports JSON.' },
    sourceRefs: ['synthetic:README.md'],
    questions: {
      coverage: {
        type: 'noul',
        instructions: 'Does the implementation omit the SQLite storage requirement?',
        criteria: 'The requirement is to store issues in SQLite.'
      }
    }
  }))
  assert.equal(result.engine, 'jev')
  assert.equal(result.answers.coverage.type, 'noul')
  assert.equal(result.sourceRefs[0], 'synthetic:README.md')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ root, engine: result.engine, model: result.model, noul: result.answers.coverage.noul, usage: result.usage, pageErrors: errors.length }))
} finally {
  await app.close().catch(() => {})
}
