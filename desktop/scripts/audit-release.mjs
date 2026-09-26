// Release gate: report locations and rule names only, never credential values.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { secretPatterns } from './secret-patterns.mjs'
import { localCredentials } from './local-credentials.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const paths = new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean).map((path) => join(root, path)))
const resources = join(root, 'desktop/dist/win-unpacked/resources')
if (!existsSync(join(resources, 'app.asar'))) throw new Error('Build the Windows package before auditing')
const entries=createRequire(import.meta.url)('@electron/asar').listPackage(join(resources,'app.asar')).map(path=>path.replaceAll('\\','/'))
for(const name of ['@axe-core','axe-core','playwright','playwright-core','electron-builder','vitest'])if(entries.some(path=>path.includes(`/node_modules/${name}/`)))throw new Error(`Development-only dependency was packaged: ${name}`)
for (const path of ['backend/LICENSE', 'licenses/NPM_NOTICES.txt', 'licenses/openai-openapi-LICENSE.txt', 'licenses/microsoft-terminal-LICENSE.txt', '../LICENSE.electron.txt', '../LICENSES.chromium.html']) {
  if (!existsSync(join(resources, path))) throw new Error(`Missing packaged license notice: ${path}`)
}
const lock = JSON.parse(readFileSync(join(root, 'desktop/package-lock.json'), 'utf8'))
const notices = readFileSync(join(resources, 'licenses/NPM_NOTICES.txt'), 'utf8')
let reviewedPackages = 0
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location.startsWith('node_modules/') || metadata.dev) continue
  const apacheElection = location === 'node_modules/dompurify' && metadata.license === '(MPL-2.0 OR Apache-2.0)'
  const argparsePython = location === 'node_modules/argparse' && metadata.version === '2.0.1' && metadata.license === 'Python-2.0'
  const saxBlueOak=location==='node_modules/sax' && metadata.version==='1.6.1' && metadata.license==='BlueOak-1.0.0'
  if (!['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause'].includes(metadata.license) && !apacheElection && !argparsePython && !saxBlueOak) throw new Error(`Unreviewed license: ${location}`)
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
const known=localCredentials()
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
