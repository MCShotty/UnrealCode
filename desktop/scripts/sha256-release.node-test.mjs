import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyReleaseChecksum, writeReleaseChecksum } from './sha256-release.mjs'

test('release checksum detects a changed installer or manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unrealcode-checksum-'))
  try {
    const installer = join(directory, 'UnrealCode-Setup-1.0.0.exe')
    const manifest = join(directory, 'SHA256SUMS')
    await writeFile(installer, 'candidate bytes')
    const line = await writeReleaseChecksum(installer, manifest)
    assert.match(line, /^[a-f0-9]{64}  UnrealCode-Setup-1\.0\.0\.exe\n$/)
    assert.equal(await readFile(manifest, 'utf8'), line)
    assert.equal(await verifyReleaseChecksum(installer, manifest), line)
    await writeFile(installer, 'changed bytes')
    await assert.rejects(verifyReleaseChecksum(installer, manifest), /does not match/)
    await writeFile(installer, 'candidate bytes')
    await writeFile(manifest, line.replace('  ', ' *'))
    await assert.rejects(verifyReleaseChecksum(installer, manifest), /does not match/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('release checksum refuses an unexpected filename', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unrealcode-checksum-'))
  try {
    await assert.rejects(writeReleaseChecksum(join(directory, 'other.exe'), join(directory, 'SHA256SUMS')), /Unexpected/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
