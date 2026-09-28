import { closeHistoryCaches } from './history-cache'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversationIndex } from './conversation-index'
import type { AgentEvent } from '../shared/api'

let root: string
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'unrealcode-index-')) })
afterEach(async () => { await closeHistoryCaches(); await rm(root, { recursive: true, force: true }) })
const event = (seq: number, text: string): AgentEvent => ({ v: 1, sessionId: id, seq, event: 'session.item', payload: { Kind: 'input', Data: { Kind: 'external', Payload: { Prompt: text } } } })

it('replays out-of-order events without duplicates and preserves changed filenames', async () => {
  const index = new ConversationIndex('project', root)
  await index.ingest(event(2, 'Inspect migration'))
  expect(await index.cursor(id)).toBe(0)
  await index.ingest(event(1, 'Find authorization'))
  await index.ingest(event(2, 'Duplicate must not replace'))
  await index.addFiles(id, 2, ['src/authorization.ts'])
  const recovered = new ConversationIndex('project', root)
  expect(await recovered.cursor(id)).toBe(2)
  expect(await recovered.search('AUTHORIZATION')).toHaveLength(2)
  expect(await recovered.search('Duplicate')).toEqual([])
  expect(await recovered.search('migration', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')).toEqual([])
})

it('recovers a partial final append from canonical events', async () => {
  const index = new ConversationIndex('project', root)
  await index.ingest(event(1, 'first'))
  await appendFile(join(root, `${id}.jsonl`), '{"seq":2')
  const recovered = new ConversationIndex('project', root)
  await recovered.ingest(event(2, 'second'))
  const reopened = new ConversationIndex('project', root)
  expect(await reopened.cursor(id)).toBe(2)
  expect((await reopened.search('second'))[0].seq).toBe(2)
})

it('indexes tool output and rejects unbounded queries', async () => {
  const index = new ConversationIndex('project', root)
  await index.ingest({ v: 1, sessionId: id, seq: 1, event: 'operation.update', payload: { State: { InlineOut: '42 checks passed', Input: { Command: 'npm test' } } } })
  expect((await index.search('checks passed'))[0].kind).toBe('operation.update')
  await expect(index.search('x'.repeat(501))).rejects.toThrow('500')
})
