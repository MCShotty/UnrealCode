import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
vi.mock('electron', () => ({ app: { isPackaged: false } }))
import { HindsightRuntime, HINDSIGHT_IMAGE, MEMORY_POSTGRES_IMAGE } from './hindsight-runtime'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function directory() { const root = await mkdtemp(join(tmpdir(), 'unrealcode-hindsight-runtime-')); roots.push(root); return root }

it('refuses oversized or malformed runtime metadata before opening Docker', async () => {
  const root = await directory(), path = join(root, 'runtime.json')
  await writeFile(path, JSON.stringify({ generation: 'x'.repeat(1024 * 1024) }))
  expect(() => new HindsightRuntime(root)).toThrow('safe size limit')
  await writeFile(path, '[]')
  expect(() => new HindsightRuntime(root)).toThrow('Invalid memory runtime metadata')
})

it('uses the persisted volume identity across alternate path spellings', async () => {
  const root = await directory(), identity = '0123456789abcdef'
  await writeFile(join(root, 'runtime.json'), JSON.stringify({ version: 1, image: HINDSIGHT_IMAGE, postgres: MEMORY_POSTGRES_IMAGE, volume: `unrealcode-memory-${identity}`, cache: `unrealcode-memory-models-${identity}`, generation: '' }))
  const first = new HindsightRuntime(root), alias = new HindsightRuntime(root + sep)
  expect(first.volume).toBe(`unrealcode-memory-${identity}`)
  expect(alias.volume).toBe(first.volume)
  expect(alias.database).toBe(first.database)
})

it('does not mistake an unavailable Docker daemon for an empty memory database', async () => {
  const root = await directory(), identity = '0123456789abcdef', path = join(root, 'runtime.json')
  const manifest = { version: 1, image: HINDSIGHT_IMAGE, postgres: MEMORY_POSTGRES_IMAGE, volume: `unrealcode-memory-${identity}`, cache: `unrealcode-memory-models-${identity}`, generation: '' }
  await writeFile(path, JSON.stringify(manifest))
  const runtime = new HindsightRuntime(root)
  vi.spyOn(runtime as any, 'docker').mockRejectedValue(new Error('Docker daemon unavailable'))
  await expect(runtime.snapshot()).rejects.toThrow('Docker daemon unavailable')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(manifest)
})

it('blocks backup if the runtime manifest is missing while its Docker volume still exists', async () => {
  const root = await directory(), owned = join(root, 'memory')
  await mkdir(owned)
  const runtime = new HindsightRuntime(owned)
  vi.spyOn(runtime as any, 'docker').mockResolvedValue({ stdout: `${runtime.volume}\n`, stderr: '' })
  await expect(runtime.snapshot()).rejects.toThrow('runtime manifest is missing')
})

it('marks a never-created database as empty only after a successful Docker inventory', async () => {
  const root = await directory(), identity = '0123456789abcdef', path = join(root, 'runtime.json')
  await writeFile(path, JSON.stringify({ version: 1, image: HINDSIGHT_IMAGE, postgres: MEMORY_POSTGRES_IMAGE, volume: `unrealcode-memory-${identity}`, cache: `unrealcode-memory-models-${identity}`, generation: '' }))
  const runtime = new HindsightRuntime(root)
  const docker = vi.spyOn(runtime as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' })
  await runtime.snapshot()
  expect(JSON.parse(await readFile(path, 'utf8')).backup).toMatchObject({ empty: true })
  expect(docker.mock.calls.map(call => (call[0] as string[])[0])).toEqual(['volume'])
})

it('preserves a verified prior dump when the restored database volume has not been created', async () => {
  const root = await directory(), identity = '0123456789abcdef', path = join(root, 'runtime.json'), dump = 'verified fixture dump'
  const backup = { sha256: createHash('sha256').update(dump).digest('hex') }
  const manifest = { version: 1, image: HINDSIGHT_IMAGE, postgres: MEMORY_POSTGRES_IMAGE, volume: `unrealcode-memory-${identity}`, cache: `unrealcode-memory-models-${identity}`, generation: randomUUID(), restoreRequired: true, backup }
  await writeFile(path, JSON.stringify(manifest)); await writeFile(join(root, 'database.dump'), dump)
  const runtime = new HindsightRuntime(root)
  vi.spyOn(runtime as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' })
  await runtime.snapshot()
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(manifest)
})

it('blocks backup when a memory volume exists but its database container is missing', async () => {
  const root = await directory(), identity = '0123456789abcdef', path = join(root, 'runtime.json')
  const manifest = { version: 1, image: HINDSIGHT_IMAGE, postgres: MEMORY_POSTGRES_IMAGE, volume: `unrealcode-memory-${identity}`, cache: `unrealcode-memory-models-${identity}`, generation: '' }
  await writeFile(path, JSON.stringify(manifest))
  const runtime = new HindsightRuntime(root)
  vi.spyOn(runtime as any, 'docker').mockImplementation(async (value: unknown) => {
    if ((value as string[])[0] === 'volume') return { stdout: `${runtime.volume}\n`, stderr: '' }
    throw Error('No such database container')
  })
  await expect(runtime.snapshot()).rejects.toThrow('No such database container')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(manifest)
})

it('allocates a new volume for a verified restore and preserves a missing backup blocker', async () => {
  const root = await directory(), identity = '0123456789abcdef'
  const manifest = { version: 1, image: HINDSIGHT_IMAGE, postgres: MEMORY_POSTGRES_IMAGE, volume: `unrealcode-memory-${identity}`, cache: `unrealcode-memory-models-${identity}`, generation: randomUUID(), restoreRequired: true }
  await writeFile(join(root, 'runtime.json'), JSON.stringify(manifest))
  const runtime = new HindsightRuntime(root)
  expect(runtime.volume).not.toBe(manifest.volume)
  vi.spyOn(runtime as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' })
  await expect(runtime.start('http://127.0.0.1:1234/v1', 'fixture-token', 'fixture-model')).rejects.toThrow('verified database dump')
  expect(JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'))).toMatchObject(manifest)
})

it('settles pending memory requests when the runtime stops', async () => {
  const runtime = new HindsightRuntime(await directory())
  const stdin = { write: vi.fn(), end: vi.fn() }
  Object.assign(runtime, { ready: true, process: { stdin } })
  vi.spyOn(runtime as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' })
  const pending = runtime.request('GET', 'project-bank', '/memories/list')
  const rejected = expect(pending).rejects.toThrow('Memory runtime stopped before the request completed')
  await runtime.stop()
  await rejected
  expect((runtime as any).pending.size).toBe(0)
  expect(runtime.state).toBe('disabled')
})

it('cancels startup before launching a container after a slow image check', async () => {
  const runtime = new HindsightRuntime(await directory())
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const image = vi.spyOn(runtime as any, 'image').mockImplementation(() => gate)
  const docker = vi.spyOn(runtime as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' })
  const starting = runtime.start('http://127.0.0.1:1234/v1', 'fixture-token', 'fixture-model')
  const rejected = expect(starting).rejects.toThrow('Memory startup was cancelled')
  await vi.waitFor(() => expect(image).toHaveBeenCalledTimes(2))
  await runtime.stop()
  release()
  await rejected
  expect(runtime.state).toBe('disabled')
  expect(docker.mock.calls.every(call => Array.isArray(call[0]) && call[0][0] === 'stop')).toBe(true)
})

it('cleans up and reports an unavailable runtime after preparation fails', async () => {
  const runtime = new HindsightRuntime(await directory())
  vi.spyOn(runtime as any, 'image').mockRejectedValue(new Error('fixture image pull failed'))
  const docker = vi.spyOn(runtime as any, 'docker').mockResolvedValue({ stdout: '', stderr: '' })
  await expect(runtime.start('http://127.0.0.1:1234/v1', 'fixture-token', 'fixture-model')).rejects.toThrow('fixture image pull failed')
  expect(runtime.state).toBe('unavailable')
  expect(runtime.message).toContain('fixture image pull failed')
  expect(docker.mock.calls.some(call => Array.isArray(call[0]) && call[0][0] === 'stop')).toBe(true)
  const manifest = JSON.parse(await readFile(join((runtime as any).directory, 'runtime.json'), 'utf8'))
  expect(manifest.volume).toBe(runtime.volume)
  expect(new HindsightRuntime((runtime as any).directory + sep).volume).toBe(runtime.volume)
})

it('waits for the final TCP database and safely retries first-initialization shutdown',async()=>{
 const root=await directory(),runtime=new HindsightRuntime(root),calls:string[][]=[];let attempt=0
 vi.spyOn(runtime as any,'docker').mockImplementation(async(raw:unknown)=>{const args=raw as string[];calls.push(args);if(args.includes('pg_isready')&&attempt++===0)throw Error('TCP server not yet started');if(args.includes('psql')&&attempt===2)throw Error('database system is shutting down');return {stdout:'ready',stderr:''}})
 await (runtime as any).waitForDatabase(()=>{})
 expect(calls.length).toBeGreaterThan(2);expect(calls.every(args=>args.includes('-h')&&args.includes('127.0.0.1'))).toBe(true)
})
