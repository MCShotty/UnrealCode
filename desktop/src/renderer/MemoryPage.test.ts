import { expect, it } from 'vitest'
import type { MemoryRecord } from '../shared/memory'
import { mergeRecent } from './MemoryPage'

const row = (id: string, content = id): MemoryRecord => ({ id, sessionId: 'fixture', turnId: id, workspace: 'project', content, sourceRefs: [id], createdAt: '2026-09-28T00:00:00Z', state: 'retained', attempts: 0 })

it('keeps loaded older records while applying current status updates', () => {
  expect(mergeRecent([row('old'), row('middle'), row('latest')], [row('middle', 'corrected'), row('latest'), row('new')])).toEqual([
    row('old'), row('middle', 'corrected'), row('latest'), row('new')
  ])
})

it('restarts from the newest page when a high-volume update leaves a gap', () => {
  expect(mergeRecent([row('old-1'), row('old-2')], [row('new-1'), row('new-2')])).toEqual([row('new-1'), row('new-2')])
})
