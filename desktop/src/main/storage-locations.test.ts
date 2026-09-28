import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readLocations, storageLocation, writeLocations, type LocationRegistry } from './storage-locations'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'unrealcode-location-registry-')); roots.push(root); return root }
const original: LocationRegistry = { version: 1, locations: [{ kind: 'workspaces', key: 'first', path: 'workspaces/2026-09-28_01-00-00.000Z', createdAt: '2026-09-28T01:00:00Z' }] }

it('promotes a complete interrupted successor before allocating another location', async () => {
  const root = await fixture(), target = join(root, 'storage-locations.json')
  writeLocations(root, original)
  const successor: LocationRegistry = { version: 1, locations: [...original.locations, { kind: 'workspaces', key: 'second', path: 'workspaces/2026-09-28_01-01-00.000Z', createdAt: '2026-09-28T01:01:00Z' }] }
  await writeFile(target + '.pending', JSON.stringify(successor))
  expect(storageLocation(root, 'workspaces', 'second')).toBe(resolve(root, successor.locations[1].path))
  expect(readLocations(root)).toEqual(successor)
  expect(await readFile(target, 'utf8')).toBe(JSON.stringify(successor))
  expect((await readdir(root)).includes('storage-locations.json.pending')).toBe(false)
})

it('recovers a pending first registry and discards an older subset after commit', async () => {
  const root = await fixture(), target = join(root, 'storage-locations.json')
  await writeFile(target + '.pending', JSON.stringify(original))
  expect(readLocations(root)).toEqual(original)
  expect(await readFile(target, 'utf8')).toBe(JSON.stringify(original))
  const newer: LocationRegistry = { version: 1, locations: [...original.locations, { kind: 'workspaces', key: 'later', path: 'workspaces/later', createdAt: '2026-09-28T02:00:00Z' }] }
  writeLocations(root, newer)
  await writeFile(target + '.pending', JSON.stringify(original))
  expect(readLocations(root)).toEqual(newer)
  expect((await readdir(root)).includes('storage-locations.json.pending')).toBe(false)
})

it('keeps both conflicting registries for recovery instead of guessing', async () => {
  const root = await fixture(), target = join(root, 'storage-locations.json')
  writeLocations(root, original)
  const conflict: LocationRegistry = { version: 1, locations: [{ ...original.locations[0], path: 'workspaces/different' }] }
  await writeFile(target + '.pending', JSON.stringify(conflict))
  expect(() => readLocations(root)).toThrow('conflicts with an interrupted write')
  expect(await readFile(target, 'utf8')).toBe(JSON.stringify(original))
  expect(await readFile(target + '.pending', 'utf8')).toBe(JSON.stringify(conflict))
})

it('preserves a damaged pending copy while using a valid committed registry', async () => {
  const root = await fixture(), target = join(root, 'storage-locations.json')
  writeLocations(root, original)
  await writeFile(target + '.pending', '{incomplete')
  expect(readLocations(root)).toEqual(original)
  const names = await readdir(root)
  expect(names).toContain('storage-locations.json')
  expect(names.some(name => name.endsWith('.damaged'))).toBe(true)
  expect(names).not.toContain('storage-locations.json.pending')
})

it('rejects malformed or oversized authoritative metadata without replacing it', async () => {
  const root = await fixture(), target = join(root, 'storage-locations.json')
  await writeFile(target, JSON.stringify({ version: 1, locations: [null] }))
  expect(() => readLocations(root)).toThrow('Invalid storage location registry')
  await writeFile(target, JSON.stringify({ version: 1, locations: [], padding: 'x'.repeat(16 * 1024 * 1024) }))
  expect(() => readLocations(root)).toThrow('safe size limit')
  expect((await readFile(target)).length).toBeGreaterThan(16 * 1024 * 1024)
})
