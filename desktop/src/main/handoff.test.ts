import { expect, it } from 'vitest'
import { handoffSummary } from './handoff'
import type { AgentEvent } from '../shared/api'

it('builds editable textual continuity without copying provider tool-call history', () => {
  const events: AgentEvent[] = [
    { v: 1, sessionId: 'source', seq: 1, event: 'session.item', payload: { Kind: 'input', Data: { Kind: 'external', Payload: { Prompt: 'Fix search\n<unrealcode_context>private attachment' } } } },
    { v: 1, sessionId: 'source', seq: 2, event: 'session.item', payload: { Kind: 'model_response', Data: { Response: { Output: [{ Type: 'message', Data: { Text: 'Implemented search\n- [ ] Verify Unicode' } }, { Type: 'tool_call', Data: { id: 'provider-specific-id' } }] } } } },
    { v: 1, sessionId: 'source', seq: 3, event: 'operation.update', payload: { Status: 'completed', State: { Input: { Command: 'npm test' }, Result: 'Passed' } } }
  ]
  const summary = handoffSummary(events, ['src/search.ts'])
  expect(summary).toContain('Fix search')
  expect(summary).toContain('- [ ] Verify Unicode')
  expect(summary).toContain('src/search.ts')
  expect(summary).toContain('npm test')
  expect(summary).not.toContain('private attachment')
  expect(summary).not.toContain('provider-specific-id')
})
it('does not call an unavailable Git status a clean working tree',()=>{
  expect(handoffSummary([],null)).toContain('Git changes unavailable')
  expect(handoffSummary([],null)).not.toContain('No current Git changes.')
})
