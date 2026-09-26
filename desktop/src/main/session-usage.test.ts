import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../shared/api'
import { emptyTotals } from './account-usage'
import { consumeUsage, executionFromEvents } from './session-usage'

const event = (seq: number, name: string, payload: unknown, recordedAt?: string): AgentEvent => ({ v: 1, seq, event: name, sessionId: 's1', payload, recordedAt })
const at = (ms: number): string => new Date(1_000_000 + ms).toISOString()

describe('session usage and execution', () => {
  it('excludes approval waits and denied operations from execution overlap', () => {
    const summary = executionFromEvents('s1', [
      event(1, 'operation.started', { ID: 'a', Type: 'shell', Status: 'ready' }, at(0)),
      event(2, 'permission.requested', { id: 'grant-a', operationId: 'a' }, at(0)),
      event(3, 'operation.started', { ID: 'denied', Type: 'shell', Status: 'ready' }, at(10)),
      event(4, 'permission.requested', { id: 'grant-denied', operationId: 'denied' }, at(10)),
      event(5, 'operation.started', { ID: 'b', Type: 'read', Status: 'ready' }, at(100)),
      event(6, 'operation.dispatched', { ID: 'b' }, at(100)),
      event(7, 'operation.update', { ID: 'b', Status: 'completed' }, at(250)),
      event(8, 'operation.dispatched', { ID: 'a' }, at(300)),
      event(9, 'permission.resolved', { id: 'grant-a' }, at(300)),
      event(10, 'permission.resolved', { id: 'grant-denied' }, at(400)),
      event(11, 'operation.update', { ID: 'denied', Status: 'canceled' }, at(400)),
      event(12, 'operation.update', { ID: 'a', Status: 'completed' }, at(500))
    ], 1_000_500)
    expect(summary).toMatchObject({ toolWallMs: 350, toolOverlapMs: 0, approvalWaitMs: 400 })
    expect(summary.operations.find(item => item.id === 'denied')?.durationMs).toBe(0)
  })
  it('counts provider usage once and resets inherited response totals at the fork boundary', () => {
    const totals = emptyTotals()
    const response = (input: number) => event(1, 'session.item', { Kind: 'model_response', Data: { Response: { Usage: { InputTokens: input, OutputTokens: 4, CachedInputTokens: 3, CacheWriteInputTokens: 1, ReasoningTokens: 2 } } } })
    consumeUsage(totals, response(10))
    consumeUsage(totals, event(2, 'session.item', { Kind: 'fork' }))
    consumeUsage(totals, response(20))
    consumeUsage(totals, event(4, 'decision.result', { usage: { input_tokens: 5, output_tokens: 1 } }))
    expect(totals).toMatchObject({ input: 20, output: 4, cached: 3, cacheWrite: 1, reasoning: 2, calls: 1, latestInput: 20, decisionCalls: 1, decisionInput: 5 })
  })

  it('shows two overlapping tools and computes union wall time instead of adding both durations', () => {
    const summary = executionFromEvents('s1', [
      event(1, 'model.request.started', { id: 'm1' }, at(0)),
      event(2, 'model.request.completed', { id: 'm1' }, at(100)),
      event(3, 'operation.started', { ID: 'a', Type: 'shell', Status: 'ready' }, at(100)),
      event(4, 'operation.started', { ID: 'b', Type: 'shell', Status: 'ready' }, at(150)),
      event(5, 'operation.update', { ID: 'a', Type: 'shell', Status: 'completed' }, at(300)),
      event(6, 'operation.update', { ID: 'b', Type: 'shell', Status: 'completed' }, at(350))
    ], 1_000_500)
    expect(summary).toMatchObject({ modelMs: 100, modelCalls: 1, toolWallMs: 250, toolOverlapMs: 150 })
    expect(summary.operations).toHaveLength(2)
    expect(summary.operations[0].durationMs).toBe(200)
  })

  it('keeps older events without timestamps visible but does not invent durations', () => {
    const summary = executionFromEvents('s1', [event(1, 'operation.update', { ID: 'old', Type: 'shell', Status: 'completed' })])
    expect(summary.operations[0].durationMs).toBeUndefined()
    expect(summary.toolWallMs).toBe(0)
  })
})
