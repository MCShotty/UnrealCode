import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEditableFile, saveEditableFile, editorPath } from './editor-files'

describe('editor conflict handling', () => {
  it('retains subsequent edits and checks concurrent saves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unrealcode-editor-')), data = await mkdtemp(join(tmpdir(), 'unrealcode-recovery-'))
    await writeFile(join(root, 'a.txt'), 'before\r\n')
    const before = await readEditableFile(root, 'a.txt')
    await writeFile(join(root, 'a.txt'), 'external')
    await expect(saveEditableFile(root, 'a.txt', before.revision, 'after', data)).rejects.toThrow('changed on disk')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('external')
    const fresh = await readEditableFile(root, 'a.txt')
    const results = await Promise.allSettled(['one', 'two'].map(content => saveEditableFile(root, 'a.txt', fresh.revision, content, data)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    await saveEditableFile(root, 'new/file.txt', 'missing', 'new', data)
    expect((await readEditableFile(root, 'new/file.txt')).content).toBe('new')
    const copies=await readdir(join(data,'editor-recovery'))
    expect(copies).toHaveLength(2)
    for(const name of copies)expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}Z(?:-\d+)?$/)
  })
  it('rejects protected and escaping paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unrealcode-editor-'))
    for (const path of ['../secret', '.git/config', 'a/../../b', 'C:/secret', 'file:stream', '.. /secret', '.git./config', 'folder./file', 'NUL', 'COM1.txt']) await expect(editorPath(root, path)).rejects.toThrow()
  })
  it('does not load a file that exceeded the editor limit after a stale size check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unrealcode-editor-growth-')), file = join(root, 'growth.txt')
    await writeFile(file, 'x'.repeat(1024 * 1024 + 100))
    const actual = await fs.stat(file)
    const stale = vi.spyOn(fs, 'stat').mockResolvedValue({ ...actual, size: 1 } as never)
    try { await expect(readEditableFile(root, 'growth.txt')).rejects.toThrow(/size limit/) }
    finally { stale.mockRestore() }
  })
})
