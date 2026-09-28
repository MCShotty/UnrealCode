import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultVolume, resolveVolume, volumeRecords } from './state-volumes'

let root = ''
async function profile() {
  root = await fs.mkdtemp(join(tmpdir(), 'unrealcode-volume-registry-'))
  const data = join(root, 'profile')
  await fs.mkdir(data)
  return data
}
afterEach(async () => {
  if (root) {
    if (!resolve(root).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())) throw Error('Fixture cleanup left the temporary directory')
    await fs.rm(root, { recursive: true, force: true })
    root = ''
  }
})

it('rejects duplicate project or volume ownership without rewriting the registry', async () => {
  const data = await profile(), a = join(root, 'project-a'), b = join(root, 'project-b')
  const first = { project: a, isolated: false, volume: defaultVolume(a, false) }
  const file = join(data, 'state-volumes.json')
  const duplicateProject = JSON.stringify([first, { project: a.toUpperCase(), isolated: false, volume: defaultVolume(b, false) }])
  await fs.writeFile(file, duplicateProject)
  expect(() => volumeRecords(data)).toThrow('Conflicting')
  expect(await fs.readFile(file, 'utf8')).toBe(duplicateProject)
  const duplicateVolume = JSON.stringify([first, { project: b, isolated: false, volume: first.volume }])
  await fs.writeFile(file, duplicateVolume)
  expect(() => volumeRecords(data)).toThrow('Conflicting')
  expect(await fs.readFile(file, 'utf8')).toBe(duplicateVolume)
})

it('blocks allocation when another project already owns the computed volume', async () => {
  const data = await profile(), a = join(root, 'project-a'), b = join(root, 'project-b')
  const file = join(data, 'state-volumes.json')
  const original = JSON.stringify([{ project: a, isolated: false, volume: defaultVolume(b, false) }])
  await fs.writeFile(file, original)
  await expect(resolveVolume(data, b, false)).rejects.toThrow('collides')
  expect(await fs.readFile(file, 'utf8')).toBe(original)
})

it('rejects an oversized or malformed registry before parsing it', async () => {
  const data = await profile(), file = join(data, 'state-volumes.json')
  await fs.writeFile(file, ' '.repeat(16 * 1024 * 1024 + 1))
  expect(() => volumeRecords(data)).toThrow('safe size limit')
  await fs.writeFile(file, JSON.stringify([{ project: '../relative', isolated: false, volume: defaultVolume('relative', false) }]))
  expect(() => volumeRecords(data)).toThrow('Invalid saved state volume registry')
})
