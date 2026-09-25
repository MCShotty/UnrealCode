import { describe, expect, it } from 'vitest'
import { parseCodexAuth } from './codex-auth'

describe('Codex subscription credentials', () => {
  it('accepts only an existing ChatGPT token and account pair', () => {
    expect(parseCodexAuth({ auth_mode: 'chatgpt', tokens: { access_token: 'token', account_id: 'account' } })).toEqual({ accessToken: 'token', accountId: 'account' })
    expect(() => parseCodexAuth({ auth_mode: 'apikey', tokens: { access_token: 'token', account_id: 'account' } })).toThrow(/ChatGPT subscription/)
    expect(() => parseCodexAuth({ auth_mode: 'chatgpt', tokens: { access_token: 'token' } })).toThrow(/incomplete/)
  })
})
