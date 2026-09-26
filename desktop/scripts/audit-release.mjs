// Release gate: report locations and rule names only, never credential values.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secretPatterns } from './secret-patterns.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const paths = new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean).map((path) => join(root, path)))
const resources = join(root, 'desktop/dist/win-unpacked/resources')
if (!existsSync(join(resources, 'app.asar'))) throw new Error('Build the Windows package before auditing')
for (const path of ['backend/LICENSE', 'licenses/NPM_NOTICES.txt', 'licenses/openai-openapi-LICENSE.txt', 'licenses/microsoft-terminal-LICENSE.txt', '../LICENSE.electron.txt', '../LICENSES.chromium.html']) {
  if (!existsSync(join(resources, path))) throw new Error(`Missing packaged license notice: ${path}`)
}
const lock = JSON.parse(readFileSync(join(root, 'desktop/package-lock.json'), 'utf8'))
const notices = readFileSync(join(resources, 'licenses/NPM_NOTICES.txt'), 'utf8')
let reviewedPackages = 0
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location.startsWith('node_modules/') || metadata.dev) continue
  const apacheElection = location === 'node_modules/dompurify' && metadata.license === '(MPL-2.0 OR Apache-2.0)'
  if (!['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause'].includes(metadata.license) && !apacheElection) throw new Error(`Unreviewed license: ${location}`)
  if (!notices.includes(`===== ${location.slice('node_modules/'.length)} ${metadata.version} (${metadata.license}) =====`)) throw new Error(`Missing npm notice: ${location}`)
  reviewedPackages++
}
const visit = (path) => {
  const stat = statSync(path)
  if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name))
  else paths.add(path)
}
// Scan the entire unpacked installer payload, including native dependencies.
visit(join(resources, '..'))
const known = []
const collect = (value, field = '') => {
  if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) collect(item, name)
  else if (typeof value === 'string' && value.length > 30 && /token|secret/i.test(field)) known.push(Buffer.from(value))
}
for (const path of new Set([join(homedir(), '.codex/auth.json'), ...(process.env.CODEX_HOME ? [join(process.env.CODEX_HOME, 'auth.json')] : [])])) {
  if (existsSync(path)) collect(JSON.parse(readFileSync(path, 'utf8')))
}
for (const [name, value] of Object.entries(process.env)) if (value && value.length > 30 && /(_API_KEY|_TOKEN)$/.test(name)) known.push(Buffer.from(value))
// A long-running desktop host may not inherit newly configured user variables.
// Capture only named credential sources in private pipes; never print values.
if (process.platform === 'win32') {
  try {
    const script = "$values=@{}; foreach($name in @('TYPESAFE_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY','FIREWORKS_API_KEY','GH_TOKEN','GITHUB_TOKEN')) { $value=[Environment]::GetEnvironmentVariable($name,'User'); if($value){$values[$name]=$value} }; $values | ConvertTo-Json -Compress"
    const values = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide:true, stdio:['ignore','pipe','ignore'], timeout:10000 }).toString())
    for(const value of Object.values(values))if(typeof value==='string'&&value.length>16)known.push(Buffer.from(value))
  } catch { throw new Error('Could not securely inspect named user-environment credentials') }
}
try {
  const token=execFileSync('gh',['auth','token'],{windowsHide:true,stdio:['ignore','pipe','ignore'],timeout:10000}).toString().trim()
  if(token.length>16)known.push(Buffer.from(token))
} catch { /* No accessible GitHub CLI token; pattern scanning still applies. */ }
const hits = []
let scanned = 0
for (const path of paths) {
  if (!existsSync(path) || !statSync(path).isFile()) continue
  const bytes = readFileSync(path); scanned++
  if (known.some((value) => bytes.includes(value))) hits.push({ path, rule: 'exact-local-credential' })
  if (!bytes.subarray(0, 2048).includes(0) || path.endsWith('.asar')) {
    const text = bytes.toString('utf8')
    for (const [rule, pattern] of secretPatterns) if (pattern.test(text)) hits.push({ path, rule })
  }
}
console.log(JSON.stringify({ scanned, reviewedPackages, localCredentialValuesCompared: known.length, hits }))
if (hits.length) process.exitCode = 1
