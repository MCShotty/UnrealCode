import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(path.join(desktop, 'package-lock.json'), 'utf8'))
const allowedLicenses = new Set(['MIT', 'ISC', '0BSD'])
const packages = Object.entries(lock.packages)
  .filter(([location, metadata]) => location.startsWith('node_modules/') && !metadata.dev)
  .sort(([a], [b]) => a.localeCompare(b))

const sections = [
  'UnrealCode desktop npm dependency license notices',
  'Generated from desktop/package-lock.json and installed package license files.',
  'Regenerate with npm run licenses:generate before packaging.',
]

for (const [location, metadata] of packages) {
  if (!allowedLicenses.has(metadata.license)) {
    throw new Error(`Review the license for ${location}: ${metadata.license || 'missing'}`)
  }
  const directory = path.join(desktop, location)
  const licenseFiles = readdirSync(directory)
    .filter((name) => /^(license|licence|copying|notice)(\.|$)/i.test(name))
    .sort()
  if (licenseFiles.length === 0) throw new Error(`Missing license text for ${location}`)

  sections.push('', `===== ${location.slice('node_modules/'.length)} ${metadata.version} (${metadata.license}) =====`)
  for (const filename of licenseFiles) {
    sections.push(`----- ${filename} -----`, readFileSync(path.join(directory, filename), 'utf8').trimEnd())
  }
}

const destination = path.join(desktop, 'third-party-licenses', 'NPM_NOTICES.txt')
writeFileSync(destination, `${sections.join('\n')}\n`, 'utf8')
console.log(`Wrote ${packages.length} npm package notices to ${destination}`)
