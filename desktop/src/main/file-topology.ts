import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

// Never recursively remove a directory to make room for a file. An unexpected
// child is somebody's work, even if it was created after the preview.
export async function prepareFileDestination(target: string): Promise<void> {
  try { if ((await fs.lstat(target)).isDirectory()) await fs.rmdir(target) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

export async function removeEmptyParents(root: string, target: string): Promise<void> {
  // Match the canonical targets returned by editor/checkpoint path checks,
  // including Windows short-name aliases in temporary profile locations.
  root = await fs.realpath(root)
  for (let directory = dirname(resolve(target)); ; directory = dirname(directory)) {
    const displacement = relative(root, directory)
    if (!displacement || displacement.startsWith('..') || isAbsolute(displacement)) return
    try { await fs.rmdir(directory) }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return
      throw error
    }
  }
}
