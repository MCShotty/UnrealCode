import { afterEach, expect, it } from 'vitest'
import { composerAction, isWorkRunning, sendsOnEnter } from './composer-action'
import { appliedPolicy, editTaskOptions, commitTaskOptions } from './task-options'
import { defaultTeamOptions } from '../shared/teams'
import { addImageAttachments, clearImageAttachments, imageAttachments, resetImageDrafts, subscribeImages } from './image-drafts'

const action = (patch: Partial<Parameters<typeof composerAction>[0]> = {}) => composerAction({ draft: false, running: false, online: true, localCommand: false, ...patch })
it('sends steering drafts while running and offers Stop only with no draft', () => {
  expect(action()).toMatchObject({ kind: 'send', disabled: true })
  expect(action({ running: true })).toMatchObject({ kind: 'stop', disabled: false })
  expect(action({ running: true, draft: true })).toMatchObject({ kind: 'send', disabled: false })
  expect(action({ running: true, draft: true, pending: 'stop' })).toMatchObject({ kind: 'stop', label: 'Stopping…', disabled: true })
  expect(action({ pending: 'send' })).toMatchObject({ label: 'Sending…', disabled: true })
})
it('keeps execution unavailable offline while retaining local slash commands', () => {
  expect(action({ running: true, online: false }).disabled).toBe(true)
  expect(action({ draft: true, online: false }).disabled).toBe(true)
  expect(action({ draft: true, online: false, localCommand: true }).disabled).toBe(false)
  expect(action({ draft: true, unavailable: true }).disabled).toBe(true)
})
it('does not equate a settled coordinator with active work', () => {
  for (const state of ['completed', 'failed', 'stopped', 'interrupted', 'idle', undefined]) expect(isWorkRunning(state)).toBe(false)
  for (const state of ['running', 'waiting_input', 'waiting_approval', 'cancelling']) expect(isWorkRunning(state)).toBe(true)
})
it('never maps empty Enter, composition or Shift+Enter to cancellation or submission', () => {
  const key = { key: 'Enter', shiftKey: false, isComposing: false }
  expect(sendsOnEnter(key, action({ draft: true }))).toBe(true)
  expect(sendsOnEnter(key, action({ running: true }))).toBe(false)
  expect(sendsOnEnter(key, action())).toBe(false)
  expect(sendsOnEnter({ ...key, isComposing: true }, action({ draft: true }))).toBe(false)
  expect(sendsOnEnter({ ...key, keyCode: 229 }, action({ draft: true }))).toBe(false)
  expect(sendsOnEnter({ ...key, shiftKey: true }, action({ draft: true }))).toBe(false)
})
it('round trips unlimited and inherited legacy options without broadening delegation', () => {
  expect(commitTaskOptions(editTaskOptions(defaultTeamOptions))).toEqual({ ...defaultTeamOptions, policy: 'off' })
  expect(appliedPolicy({ ...defaultTeamOptions, allowSpecialists: true })).toBe('automatic')
  expect(editTaskOptions(defaultTeamOptions).tokenLimit).toBe('')
  const options = { ...defaultTeamOptions, allowSpecialists: true, policy: 'manual' as const, modelRequestLimit: 11, elapsedMinutes: 20, tokenLimit: 8000 }
  expect(commitTaskOptions(editTaskOptions(options))).toEqual(options)
  expect(commitTaskOptions({ ...editTaskOptions(options), policy: 'off' })).toMatchObject({ allowSpecialists: false, policy: 'off', concurrency: 2, workerLimit: 4 })
})
it.each(['-1', '1.5', 'NaN', '1e2', '1000000001'])('rejects invalid token limit %s before submission', value => {
  expect(() => commitTaskOptions({ ...editTaskOptions(defaultTeamOptions), tokenLimit: value })).toThrow()
})
it('rejects absent required capacity and limits outside the existing bounds', () => {
  expect(() => commitTaskOptions({ ...editTaskOptions(defaultTeamOptions), concurrency: '' })).toThrow()
  expect(() => commitTaskOptions({ ...editTaskOptions(defaultTeamOptions), concurrency: '5' })).toThrow()
})
afterEach(resetImageDrafts)
it('notifies composer subscribers for image-only additions, removal, and project reset', () => {
  let updates = 0; const dispose = subscribeImages(() => updates++)
  const empty = imageAttachments('a'); expect(imageAttachments('a')).toBe(empty)
  addImageAttachments('a', [{ id: 'image', name: 'example.png', width: 1, height: 1 }])
  expect(updates).toBe(1); expect(imageAttachments('a')).toHaveLength(1); expect(imageAttachments('b')).toHaveLength(0)
  clearImageAttachments('a', ['image']); expect(updates).toBe(2); expect(imageAttachments('a')).toHaveLength(0)
  addImageAttachments(null, [{ id: 'draft', name: 'draft.png', width: 1, height: 1 }])
  expect(resetImageDrafts()).toEqual(['draft']); expect(updates).toBe(4); expect(imageAttachments(null)).toHaveLength(0)
  dispose(); addImageAttachments('b', []); expect(updates).toBe(4)
})
