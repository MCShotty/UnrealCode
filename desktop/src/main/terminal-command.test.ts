import { expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { terminalDockerExecutable } from './terminal-command'

it('resolves Docker in the final Windows PATH entry for node-pty', () => {
  const root = mkdtempSync(join(tmpdir(), 'unrealcode-terminal-path-'))
  try {
    const first = join(root, 'first')
    const dockerDir = join(root, 'Docker Desktop')
    mkdirSync(first)
    mkdirSync(dockerDir)
    writeFileSync(join(dockerDir, 'docker.exe'), '')
    expect(isAbsolute(dockerDir)).toBe(true)
    expect(existsSync(join(dockerDir, 'docker.exe'))).toBe(true)
    const fixturePath = `${first};"${dockerDir}"`
    expect(fixturePath.split(';').at(-1)?.trim().replace(/^"|"$/g, '')).toBe(dockerDir)
    expect(terminalDockerExecutable({ Path: fixturePath }, 'win32')).toBe(join(dockerDir, 'docker.exe'))
    expect(() => terminalDockerExecutable({ PATH: first }, 'win32')).toThrow(/Docker CLI executable was not found/)
    expect(terminalDockerExecutable({}, 'linux')).toBe('docker')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
