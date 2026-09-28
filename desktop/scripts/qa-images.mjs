// Offscreen image attachment workflow using a disposable project and profile.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = mkdtempSync(join(tmpdir(), 'unrealcode-images-'))
const profile = join(root, 'profile'); let project = join(root, 'project')
mkdirSync(profile); mkdirSync(project)
project = realpathSync.native(project)
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ decisionSetupSeen: true, theme: 'dark', recentProjects: [], trustedProjects: [project] }))
const valid = resolve('assets/unrealcode-icon.png'), invalid = join(root, 'invalid.png')
writeFileSync(invalid, 'not an image')
const oversized = join(root, 'oversized.png'), header = Buffer.from(readFileSync(valid))
header.writeUInt32BE(8193, 16); writeFileSync(oversized, header)
const packaged = process.argv.includes('--packaged')
const app = await electron.launch({ executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE || (packaged ? 'dist/win-unpacked/UnrealCode.exe' : 'node_modules/electron/dist/electron.exe')), args: packaged ? [] : ['.'], env: { ...process.env, UNREAL_DESKTOP_USER_DATA: profile, UNREAL_DESKTOP_BACKGROUND_CHECK: '1' } })
const page = await app.firstWindow(), errors = []
page.on('pageerror', error => errors.push(error.message))
const select = async paths => app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, paths)
try {
  await page.getByRole('heading', { name: 'Open a workspace' }).waitFor()
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
  await page.evaluate(path => window.unreal.openProject(path, true), project)
  const variants = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
    return { jpeg: canvas.toDataURL('image/jpeg'), webp: canvas.toDataURL('image/webp') }
  }, readFileSync(valid).toString('base64'))
  for (const [kind, data] of Object.entries(variants)) {
    assert(data.startsWith(`data:image/${kind};base64,`))
    const file = join(root, `valid.${kind}`); writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
    await select([file]); const picked = await page.evaluate(async () => { try { return { images: await window.unreal.pickImages() } } catch (error) { return { failure: error.failure } } })
    assert(picked.images, `${kind} attachment failed: ${JSON.stringify(picked.failure)}`)
    const images = picked.images
    assert.equal(images.length, 1); await page.evaluate(id => window.unreal.discardImages([id]), images[0].id)
  }
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  await select([valid])
  const first = await page.evaluate(() => window.unreal.pickImages())
  assert.equal(first.length, 1)
  await select([valid, invalid])
  await assert.rejects(page.evaluate(() => window.unreal.pickImages()), /Choose a valid still PNG, JPEG, or WebP/)
  await select([oversized])
  await assert.rejects(page.evaluate(() => window.unreal.pickImages()), /16 megapixels/)
  await select([valid, valid])
  await assert.rejects(page.evaluate(() => window.unreal.pickImages(1)), /Remove an image or choose fewer/)
  await select([valid])
  for (let i = 0; i < 29; i++) {
    const images = await page.evaluate(() => window.unreal.pickImages())
    assert.equal(images.length, 1)
    assert(images[0].width > 0 && images[0].height > 0)
  }
  await assert.rejects(page.evaluate(() => window.unreal.pickImages()), /Remove an image or choose fewer/)
  await page.evaluate(id => window.unreal.discardImages([id]), first[0].id)
  assert.equal((await page.evaluate(() => window.unreal.pickImages())).length, 1)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ root, packaged, jpegWebpDecoded: true, invalidBatchWasAtomic: true, oversizedHeaderRejected: true, boundedPendingImages: true, discardReleasesCapacity: true, errors }))
} finally { await app.close() }
