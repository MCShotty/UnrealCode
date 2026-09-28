import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-terminal-'))
const project = join(root, 'project')
mkdirSync(project)
writeFileSync(join(project, 'README.md'), 'Disposable terminal regression project.\n')
const packaged = process.argv.includes('--packaged')
const executablePath = resolve(process.env.UNREALCODE_QA_EXECUTABLE || (packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe'))
const launchEnv = { ...process.env, UNREAL_DESKTOP_USER_DATA: join(root, 'data'), UNREAL_DESKTOP_BACKGROUND_CHECK: '1' }
if (process.argv.includes('--docker-path-last')) {
  const dockerExe = execFileSync('where.exe', ['docker.exe'], { windowsHide: true }).toString().split(/\r?\n/).find(Boolean)
  if (!dockerExe) throw new Error('Docker CLI unavailable for PATH regression')
  for (const key of Object.keys(launchEnv)) if (key.toLowerCase() === 'path') delete launchEnv[key]
  launchEnv.Path = `${process.env.SystemRoot || 'C:\\Windows'}\\System32;${dirname(dockerExe)}`
}
const app = await electron.launch({
  executablePath,
  args: packaged ? [] : ['.'],
  cwd: process.cwd(),
  env: launchEnv
})

let terminalId
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'Set up later' }).click()
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
  await page.evaluate(path => window.unreal.openProject(path, true), project)

  const output = await page.evaluate(async () => {
    let text = ''
    const unsubscribe = window.unreal.onTerminalData(value => { text += value.data })
    try {
      const id = await window.unreal.terminalStart()
      window.__qaTerminalId = id
      // The echoed command contains only octal escapes; the marker must come
      // from the shell's output rather than from terminal input echo.
      await window.unreal.terminalWrite(id, "printf '\\125\\103\\137\\124\\105\\122\\115\\111\\116\\101\\114\\137\\117\\113\\n'\n")
      const deadline = Date.now() + 15000
      while (Date.now() < deadline && !text.includes('UC_TERMINAL_OK')) await new Promise(resolve => setTimeout(resolve, 50))
      return text
    } finally { unsubscribe() }
  })
  terminalId = await page.evaluate(() => window.__qaTerminalId)
  assert(output.includes('UC_TERMINAL_OK'), 'Container terminal produced no response')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ root, terminalStarted: true, outputReceived: true, pageErrors: errors.length }))
} finally {
  if (terminalId) await app.firstWindow().then(page => page.evaluate(id => window.unreal.terminalStop(id), terminalId)).catch(() => {})
  await app.close().catch(() => {})
}
