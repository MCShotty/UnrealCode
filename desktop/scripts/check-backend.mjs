import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const child = spawn('docker', ['run', '--rm', '-i', process.argv[2] || 'unrealcode-ci'], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] })
let buffer = ''
let verified = false
const timer = setTimeout(() => { child.kill(); process.exitCode = 1 }, 30000)
child.stdout.on('data', chunk => {
  buffer += chunk
  for (;;) {
    const end = buffer.indexOf('\n'); if (end < 0) break
    const line = buffer.slice(0,end); buffer = buffer.slice(end+1)
    const value = JSON.parse(line)
    if (value.id !== 'compatibility') continue
    assert.equal(value.ok, true); assert.equal(value.result.version, 1)
    for (const name of ['permissions.v1', 'files.v1', 'sessions.v1', 'mcp.v1', 'context.v1', 'teams.v1', 'verification.v1', 'history.latest.v1']) assert(value.result.capabilities.includes(name))
    verified = true; clearTimeout(timer); console.log('Bridge protocol and required capabilities verified'); child.stdin.end()
  }
})
child.on('error', error => { clearTimeout(timer); throw error })
child.on('exit', code => { clearTimeout(timer); if (code || !verified) process.exitCode = code || 1 })
child.stdin.write(JSON.stringify({ v: 1, id: 'compatibility', method: 'health', params: {} }) + '\n')
