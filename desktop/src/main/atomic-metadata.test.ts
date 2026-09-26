import { it,expect,vi } from 'vitest'
import { mkdtemp,readFile,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicMetadata,replaceMetadata } from './atomic-metadata'
it('retries a transient Windows sharing violation without deleting prior metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'unrealcode-metadata-')),source=join(root,'pending'),target=join(root,'record.json')
  await writeFile(source,'new');await writeFile(target,'old')
  let attempts=0
  await replaceMetadata(source,target,async(a,b)=>{attempts++;expect(await readFile(target,'utf8')).toBe('old');if(attempts<3)throw Object.assign(new Error('File in use'),{code:'EPERM'});await import('node:fs/promises').then(fs=>fs.rename(a,b))})
  expect(attempts).toBe(3);expect(await readFile(target,'utf8')).toBe('new')
})
it('serializes metadata replacements and does not retry unrelated failures',async()=>{
  const path=join(await mkdtemp(join(tmpdir(),'unrealcode-metadata-order-')),'record.json')
  await Promise.all([atomicMetadata(path,'first'),atomicMetadata(path,'second')]);expect(await readFile(path,'utf8')).toBe('second')
  const rename=vi.fn().mockRejectedValue(Object.assign(new Error('Missing source'),{code:'ENOENT'}));await expect(replaceMetadata('missing',path,rename)).rejects.toMatchObject({code:'ENOENT'});expect(rename).toHaveBeenCalledTimes(1);expect(await readFile(path,'utf8')).toBe('second')
})
