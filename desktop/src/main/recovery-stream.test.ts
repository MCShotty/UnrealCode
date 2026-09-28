import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { receiveVolumeFiles, sendVolumeFiles } from './recovery-stream'

let root = ''
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }) })
const record = (value: object) => Buffer.from(JSON.stringify(value) + '\n')
const start = { type: 'start', version: 1 }, complete = { type: 'complete' }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
async function fixture() { root = await fs.mkdtemp(join(tmpdir(), 'unrealcode-stream-')); return join(root, 'received') }

it('streams binary, Unicode, empty files and directories across fragmented records', async () => {
  const target = await fixture(), source = join(root, 'source'), bytes = randomBytes(200003)
  await fs.mkdir(join(source, 'sessions', 'empty'), { recursive: true })
  await fs.writeFile(join(source, 'sessions', '日本語.bin'), bytes)
  await fs.writeFile(join(source, 'sessions', 'zero'), '')
  await fs.writeFile(join(source, '.unrealcode-migrated'), 'marker')
  const chunks: Buffer[] = []; for await (const chunk of sendVolumeFiles(source)) chunks.push(chunk)
  const wire = Buffer.concat(chunks)
  async function* fragmented() { for (let at = 0; at < wire.length; at += 997) yield wire.subarray(at, at + 997) }
  await receiveVolumeFiles(fragmented(), target)
  expect(await fs.readFile(join(target, 'sessions', '日本語.bin'))).toEqual(bytes)
  expect((await fs.stat(join(target, 'sessions', 'zero'))).size).toBe(0)
  expect(await fs.readdir(join(target, 'sessions', 'empty'))).toEqual([])
  expect(await fs.readFile(join(target, '.unrealcode-migrated'), 'utf8')).toBe('marker')
})

it.each(['../outside', 'sessions/../../outside', 'sessions\\outside', 'secrets.json', 'sessions/CON', '/sessions/a', 'sessions/a.'])('rejects unsafe or non-durable paths: %s', async path => {
  const target = await fixture()
  await expect(receiveVolumeFiles(Readable.from([record(start), record({ type: 'directory', path }), record(complete)]), target)).rejects.toThrow()
  expect(await fs.readdir(root)).toEqual(['received'])
})

it.each([
  [start, { type: 'file', path: '.unrealcode-migrated', bytes: 1 }, { type: 'chunk', data: 'YQ==' }],
  [start, { type: 'file', path: '.unrealcode-migrated', bytes: 2 }, { type: 'chunk', data: 'YQ==' }, { type: 'file-end', sha256: digest('a') }, complete],
  [start, { type: 'file', path: '.unrealcode-migrated', bytes: 1 }, { type: 'chunk', data: 'Yg==' }, { type: 'file-end', sha256: digest('a') }, complete],
  [start, { type: 'file', path: '.unrealcode-migrated', bytes: 1 }, { type: 'chunk', data: 'YQ===' }, complete],
  [start, { type: 'file', path: '.unrealcode-migrated', bytes: 50 * 1024 ** 3 + 1 }, complete],
  [start, { type: 'file', path: '.unrealcode-migrated', bytes: -1 }, complete],
  [start, { type: 'directory', path: 'sessions' }, { type: 'directory', path: 'sessions' }, complete],
  [start, { type: 'directory', path: 'sessions' }, { type: 'file', path: 'sessions/A', bytes: 0 }, { type: 'file-end', sha256: digest('') }, { type: 'file', path: 'sessions/a', bytes: 0 }, complete],
  [start, complete, { type: 'directory', path: 'sessions' }],
  [{ type: 'start', version: 2 }, complete],
])('rejects incomplete, corrupt, duplicate or oversized streams %#', async (...items) => {
  await expect(receiveVolumeFiles(Readable.from(items.map(record)), await fixture())).rejects.toThrow()
})

it('bounds header buffering and requires a completion marker and final newline', async () => {
  const target = await fixture()
  await expect(receiveVolumeFiles(Readable.from([Buffer.alloc(128 * 1024 + 1, 97)]), target)).rejects.toThrow('too large')
  await expect(receiveVolumeFiles(Readable.from([record(start)]), target)).rejects.toThrow('Incomplete')
  await expect(receiveVolumeFiles(Readable.from([record(start), Buffer.from(JSON.stringify(complete))]), target)).rejects.toThrow('Incomplete')
})

it('does not overwrite existing destinations or follow source directory links', async () => {
  const target = await fixture(); await fs.mkdir(target); await fs.writeFile(join(target, 'keep'), 'untouched')
  await expect(receiveVolumeFiles(Readable.from([record(start), record(complete)]), target)).rejects.toThrow('empty directory')
  expect(await fs.readFile(join(target, 'keep'), 'utf8')).toBe('untouched')
  const source = join(root, 'source'); await fs.mkdir(source)
  await fs.symlink(target, join(source, 'sessions'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(async () => { for await (const _ of sendVolumeFiles(source)) {} }).rejects.toThrow('link')
})
