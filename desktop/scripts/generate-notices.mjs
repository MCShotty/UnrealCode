import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(path.join(desktop, 'package-lock.json'), 'utf8'))
const allowedLicenses = new Set(['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause'])
const packages = Object.entries(lock.packages)
  .filter(([location, metadata]) => location.startsWith('node_modules/') && !metadata.dev)
  .sort(([a], [b]) => a.localeCompare(b))

const sections = [
  'UnrealCode desktop npm dependency license notices',
  'Generated from desktop/package-lock.json and installed package license files.',
  'Regenerate with npm run licenses:generate before packaging.',
]

for (const [location, metadata] of packages) {
  const playwrightApache=location==='node_modules/playwright-core' && metadata.version==='1.63.0' && metadata.license==='Apache-2.0'
  const apacheElection = location === 'node_modules/dompurify' && metadata.license === '(MPL-2.0 OR Apache-2.0)'
  const argparsePython = location === 'node_modules/argparse' && metadata.version === '2.0.1' && metadata.license === 'Python-2.0'
  const saxBlueOak=location==='node_modules/sax' && metadata.version==='1.6.1' && metadata.license==='BlueOak-1.0.0'
  if (!allowedLicenses.has(metadata.license) && !playwrightApache && !apacheElection && !argparsePython && !saxBlueOak) {
    throw new Error(`Review the license for ${location}: ${metadata.license || 'missing'}`)
  }
  const directory = path.join(desktop, location)
  const licenseFiles = readdirSync(directory)
    .filter((name) => /^(license|licence|copying|notice)([.-]|$)|^thirdparty.?notices/i.test(name))
    .sort()
  const lazyValNotice=location==='node_modules/lazy-val' && metadata.version==='1.0.5' && metadata.license==='MIT'
  if (licenseFiles.length === 0 && !lazyValNotice) throw new Error(`Missing license text for ${location}`)

  sections.push('', `===== ${location.slice('node_modules/'.length)} ${metadata.version} (${metadata.license}) =====`)
  if (apacheElection) sections.push('UnrealCode distributes this dependency under the Apache-2.0 alternative. The bundled LICENSE contains that license text.')
  if (argparsePython) sections.push('The argparse JavaScript port is redistributed without UnrealCode modifications. Its complete Python-derived license and copyright notices follow.')
  if (lazyValNotice) sections.push(readFileSync(path.join(desktop,'third-party-licenses/lazy-val-NOTICE.txt'),'utf8').trimEnd())
  for (const filename of licenseFiles) {
    sections.push(`----- ${filename} -----`, readFileSync(path.join(directory, filename), 'utf8').trimEnd())
  }
}

const destination = path.join(desktop, 'third-party-licenses', 'NPM_NOTICES.txt')
writeFileSync(destination, `${sections.join('\n')}\n`, 'utf8')
console.log(`Wrote ${packages.length} npm package notices to ${destination}`)
