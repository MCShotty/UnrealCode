import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

// node-pty's Windows path lookup can miss a command in the final PATH entry.
// Resolve Docker before handing it to the PTY, using the same environment as
// other Docker child processes.
export function terminalDockerExecutable(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (platform !== 'win32') return 'docker'
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  for (const entry of path.split(';')) {
    const directory = entry.trim().replace(/^"|"$/g, '')
    if (!directory || !isAbsolute(directory)) continue
    const candidate = join(directory, 'docker.exe')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('Docker CLI executable was not found on PATH')
}
