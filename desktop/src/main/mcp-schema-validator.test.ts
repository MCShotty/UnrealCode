import { expect, it } from 'vitest'
import { McpSchemaValidator } from './mcp-schema-validator'

const pathological = { type: 'object', properties: { text: { type: 'string', pattern: '^(a+)+$' } }, required: ['text'] }
const ordinary = { type: 'object', properties: { text: { type: 'string', pattern: '^ok$' } }, required: ['text'] }

it('keeps Electron responsive while a server regex stalls and preserves independent schema calls', async () => {
  const validator = new McpSchemaValidator(undefined, 2, 1000)
  try {
    const stalled = validator.validate('pathological', pathological, { text: 'a'.repeat(100) + '!' }).then(() => null, error => error as Error)
    let timerRan = false
    await new Promise<void>(resolve => setTimeout(() => { timerRan = true; resolve() }, 20))
    expect(timerRan).toBe(true)
    expect(await validator.validate('ordinary', ordinary, { text: 'ok' })).toBe(true)
    expect(await validator.validate('ordinary', ordinary, { text: 'wrong' })).toBe(false)
    expect((await stalled)?.message).toContain('timed out')
    await expect(validator.validate('pathological', pathological, { text: 'a'.repeat(100) + '!' })).rejects.toThrow('previously timed out')
    expect(await validator.validate('ordinary', ordinary, { text: 'ok' })).toBe(true)
  } finally { await validator.close() }
}, 8000)

it('cancels a schema check without disabling later validation', async () => {
  const validator = new McpSchemaValidator(undefined, 1, 1000)
  const controller = new AbortController()
  try {
    const stalled = validator.validate('pathological', pathological, { text: 'a'.repeat(100) + '!' }, controller.signal)
    controller.abort()
    await expect(stalled).rejects.toThrow('cancelled')
    expect(await validator.validate('ordinary', ordinary, { text: 'ok' })).toBe(true)
  } finally { await validator.close() }
})

it('cancels a queued validation before the occupied worker becomes free', async () => {
  const validator = new McpSchemaValidator(undefined, 1, 500)
  try {
    const stalled = validator.validate('pathological', pathological, { text: 'a'.repeat(100) + '!' }).then(() => null, error => error as Error)
    const controller = new AbortController()
    const queued = validator.validate('queued', ordinary, { text: 'ok' }, controller.signal)
    controller.abort()
    await expect(queued).rejects.toThrow('cancelled')
    expect((await stalled)?.message).toContain('timed out')
    expect(await validator.validate('ordinary', ordinary, { text: 'ok' })).toBe(true)
  } finally { await validator.close() }
}, 5000)
