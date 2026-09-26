import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { secretPatterns } from './secret-patterns.mjs'

test('detects real PEM material and escaped material without flagging header-only parser literals', () => {
  const rule = secretPatterns.find(([name]) => name === 'private-key')[1]
  const { privateKey } = generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  assert(rule.test(pem))
  assert(rule.test(JSON.stringify({ key: pem })))
  assert(rule.test(pem.replace('BEGIN PRIVATE', 'BEGIN ENCRYPTED PRIVATE')))
  assert(!rule.test('if (value.startsWith("-----BEGIN PRIVATE KEY-----")) parse(value)'))
})
