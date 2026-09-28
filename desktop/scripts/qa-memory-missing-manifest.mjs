// Packaged, disposable regression: do not omit an existing Memory volume when
// its runtime metadata is missing. The test owns and removes its empty volume.
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executable = process.env.UNREALCODE_QA_EXECUTABLE
if (!executable) throw Error('Set UNREALCODE_QA_EXECUTABLE to the packaged candidate')
const root = mkdtempSync(join(tmpdir(), 'unrealcode-memory-manifest-'))
const profile = join(root, 'profile'), backup = join(root, 'backup'), owner = randomUUID()
mkdirSync(profile)
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ decisionSetupSeen: true }))
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true }).trim()
let volume = '', created = false
const app = await electron.launch({ executablePath: resolve(executable), args: [], env: { ...process.env, UNREAL_DESKTOP_USER_DATA: profile, UNREAL_DESKTOP_BACKGROUND_CHECK: '1' } })
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Open a workspace' }).waitFor()
  await page.evaluate(() => window.unreal.memoryStatus(0))
  const registry = JSON.parse(readFileSync(join(profile, 'storage-locations.json'), 'utf8'))
  const location = registry.locations.find(item => item.kind === 'memory' && item.key === 'hindsight')
  assert(location, 'Memory runtime location must be registered')
  const directory = join(profile, location.path)
  mkdirSync(directory, { recursive: true })
  volume = `unrealcode-memory-${createHash('sha256').update(directory.toLowerCase()).digest('hex').slice(0, 16)}`
  assert.equal(docker('volume', 'ls', '--filter', `name=${volume}`, '--format', '{{.Name}}'), '', 'Fixture volume must not already exist')
  docker('volume', 'create', '--label', `ai.unrealcode.qa-owner=${owner}`, volume)
  created = true
  await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, backup)
  const failure = await page.evaluate(async () => {
    try { await window.unreal.backupExport(); return { message: '' } }
    catch (error) { return { message: String(error), details: error.failure?.details || '', code: error.failure?.code || '' } }
  })
  assert.match(JSON.stringify(failure), /runtime manifest is missing/)
  assert.equal(existsSync(backup), false, 'Failed backup must not be committed')
  assert.equal(existsSync(join(directory, 'runtime.json')), false, 'Backup must not invent missing runtime metadata')
  console.log(JSON.stringify({ passed: true, profile: root, existingVolumePreserved: true }))
} finally {
  await app.close()
  if (created) {
    const info = JSON.parse(docker('volume', 'inspect', volume))[0]
    assert.equal(info.Labels['ai.unrealcode.qa-owner'], owner, 'Only the fixture-owned volume may be removed')
    assert.equal(docker('ps', '-q', '--filter', `volume=${volume}`), '', 'Fixture volume must not be in use')
    docker('volume', 'rm', volume)
  }
}
