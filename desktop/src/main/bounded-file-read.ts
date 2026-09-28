import { promises as fs, openSync, readSync, fstatSync, closeSync } from 'node:fs'

// Stat alone is not a byte limit: another process can grow a file before it
// is read. Keep the allocation bounded by the actual bytes returned.
export async function readBoundedRegularFile(path: string, limit: number): Promise<Buffer> {
  const handle = await fs.open(path, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > limit) throw new Error('Only regular files within the size limit can be read')
    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let length = 0
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, limit + 1 - length), null)
      if (!bytesRead) break
      length += bytesRead
      if (length > limit) throw new Error('File grew beyond the size limit while reading')
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new Error('File changed while reading; retry')
    return Buffer.concat(chunks, length)
  } finally { await handle.close() }
}

export function readBoundedRegularFileSync(path: string, limit: number): Buffer {
  const descriptor = openSync(path, 'r')
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size > limit) throw new Error('Only regular files within the size limit can be read')
    const chunks: Buffer[] = [], buffer = Buffer.allocUnsafe(64 * 1024)
    let length = 0
    for (;;) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, limit + 1 - length), null)
      if (!count) break
      length += count
      if (length > limit) throw new Error('File grew beyond the size limit while reading')
      chunks.push(Buffer.from(buffer.subarray(0, count)))
    }
    const after = fstatSync(descriptor)
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new Error('File changed while reading; retry')
    return Buffer.concat(chunks, length)
  } finally { closeSync(descriptor) }
}

export async function readBoundedJSON<T>(path: string, limit: number): Promise<T> {
  try { return JSON.parse((await readBoundedRegularFile(path, limit)).toString('utf8')) as T }
  catch (error) { if (error instanceof Error && /size limit/.test(error.message)) throw new Error('Saved metadata exceeds its safe size limit; the original file is preserved', { cause: error }); throw error }
}

export function readBoundedJSONSync<T>(path: string, limit: number): T {
  try { return JSON.parse(readBoundedRegularFileSync(path, limit).toString('utf8')) as T }
  catch (error) { if (error instanceof Error && /size limit/.test(error.message)) throw new Error('Saved metadata exceeds its safe size limit; the original file is preserved', { cause: error }); throw error }
}
