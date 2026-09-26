import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ app: { getVersion: () => '0.3.0' } }))
import { backendSourceTag } from './docker'

let folder = ''
afterEach(() => { if (folder) rmSync(folder, { recursive: true, force: true }); folder = '' })

describe('packaged backend identity', () => {
  it('changes the Docker tag when bundled backend source changes at the same app version', () => {
    folder = mkdtempSync(join(tmpdir(), 'unrealcode-backend-tag-'))
    for (const name of ['cmd', 'harness', 'internal', 'desktop/worker', 'desktop/third-party-licenses']) mkdirSync(join(folder, name), { recursive: true })
    for (const name of ['Dockerfile.desktop', '.dockerignore', 'LICENSE', 'go.mod', 'go.sum']) writeFileSync(join(folder, name), name)
    const source = join(folder, 'cmd', 'bridge.go')
    writeFileSync(source, 'first')
    const initial = backendSourceTag(folder, '0.3.0')
    writeFileSync(source, 'second')
    expect(backendSourceTag(folder, '0.3.0')).not.toBe(initial)
    expect(backendSourceTag(folder, '0.3.1')).not.toBe(initial)
    const beforeNotice=backendSourceTag(folder,'0.3.0')
    writeFileSync(join(folder,'desktop/third-party-licenses/NOTICE.txt'),'updated license notice')
    expect(backendSourceTag(folder,'0.3.0')).not.toBe(beforeNotice)
  })
})
