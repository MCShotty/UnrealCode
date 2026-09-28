import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function writeReleaseChecksum(installer, manifest) {
  const name = basename(installer)
  if (!/^UnrealCode-Setup-\d+\.\d+\.\d+\.exe$/.test(name)) throw new Error('Unexpected release installer name')
  const line = `${await sha256(installer)}  ${name}\n`
  await writeFile(manifest, line, { encoding: 'utf8' })
  return line
}

export async function verifyReleaseChecksum(installer, manifest) {
  const name = basename(installer)
  if (!/^UnrealCode-Setup-\d+\.\d+\.\d+\.exe$/.test(name)) throw new Error('Unexpected release installer name')
  const expected = `${await sha256(installer)}  ${name}\n`
  if (await readFile(manifest, 'utf8') !== expected) throw new Error('Release SHA-256 manifest does not match the installer')
  return expected
}

async function main() {
  if (!['--write', '--verify'].includes(process.argv[2]) || process.argv.length !== 3) throw new Error('Use --write or --verify')
  const desktop = resolve(import.meta.dirname, '..')
  const { version } = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release checksums require a stable package version')
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Release tag and package version differ')
  const output = resolve(desktop, process.env.UNREALCODE_RELEASE_OUTPUT || 'dist')
  const installer = join(output, `UnrealCode-Setup-${version}.exe`)
  const manifest = join(output, 'SHA256SUMS')
  const line = process.argv[2] === '--write' ? await writeReleaseChecksum(installer, manifest) : await verifyReleaseChecksum(installer, manifest)
  process.stdout.write(line)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
