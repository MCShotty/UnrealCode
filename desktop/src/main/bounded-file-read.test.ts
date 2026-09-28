import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedJSON, readBoundedJSONSync, readBoundedRegularFileSync } from './bounded-file-read'

it('loads small metadata and refuses oversized files in async and sync readers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unrealcode-bounded-json-'))
  try {
  const small = join(directory, 'small.json'), large = join(directory, 'large.json')
  await writeFile(small, JSON.stringify({ version: 1, task: 'fixture' }))
  await writeFile(large, JSON.stringify({ value: 'x'.repeat(2048) }))
  expect(await readBoundedJSON(small, 1024)).toEqual({ version: 1, task: 'fixture' })
  expect(readBoundedJSONSync(small, 1024)).toEqual({ version: 1, task: 'fixture' })
  expect(readBoundedRegularFileSync(small, 1024).toString('utf8')).toContain('fixture')
  await expect(readBoundedJSON(large, 1024)).rejects.toThrow('size limit')
  expect(() => readBoundedJSONSync(large, 1024)).toThrow('size limit')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
