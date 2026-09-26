// Release gate: report locations and rule names only, never credential values.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  if (!['MIT', 'ISC', '0BSD'].includes(metadata.license)) throw new Error(`Unreviewed license: ${location}`)
  if (!notices.includes(`===== ${location.slice('node_modules/'.length)} ${metadata.version} (${metadata.license}) =====`)) throw new Error(`Missing npm notice: ${location}`)
  reviewedPackages++
}
const visit = (path) => {
  const stat = statSync(path)
  if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name))
  else paths.add(path)
}
visit(join(resources, 'backend')); visit(join(resources, 'licenses')); paths.add(join(resources, 'app.asar'))
const known = []
const collect = (value, field = '') => {
  if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) collect(item, name)
  else if (typeof value === 'string' && value.length > 30 && /token|secret/i.test(field)) known.push(Buffer.from(value))
}
for (const path of new Set([join(homedir(), '.codex/auth.json'), ...(process.env.CODEX_HOME ? [join(process.env.CODEX_HOME, 'auth.json')] : [])])) {
  if (existsSync(path)) collect(JSON.parse(readFileSync(path, 'utf8')))
}
for (const [name, value] of Object.entries(process.env)) if (value && value.length > 30 && /(_API_KEY|_TOKEN)$/.test(name)) known.push(Buffer.from(value))
const patterns = [
  ['provider-key', /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['private-key', /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/],
  ['credential-json', /"(?:access_token|refresh_token|id_token|api_key|apiKey)"\s*:\s*"[^"\r\n]{24,}"/i],
]
const hits = []
let scanned = 0
for (const path of paths) {
  if (!existsSync(path) || !statSync(path).isFile()) continue
  const bytes = readFileSync(path); scanned++
  if (known.some((value) => bytes.includes(value))) hits.push({ path, rule: 'exact-local-credential' })
  if (!bytes.subarray(0, 2048).includes(0) || path.endsWith('.asar')) {
    const text = bytes.toString('utf8')
    for (const [rule, pattern] of patterns) if (pattern.test(text)) hits.push({ path, rule })
  }
}
console.log(JSON.stringify({ scanned, reviewedPackages, localCredentialValuesCompared: known.length, hits }))
if (hits.length) process.exitCode = 1
