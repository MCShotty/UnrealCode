import { it,expect,vi } from 'vitest'
import {promises as fs} from 'node:fs'
import { mkdtemp,readFile,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicMetadata,replaceMetadata,drainMetadata } from './atomic-metadata'
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
it('settles other metadata writes before reporting one failed write at shutdown',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-metadata-drain-')),write=fs.writeFile
 let fail!:()=>void,release!:()=>void,settled=false
 const spy=vi.spyOn(fs,'writeFile').mockImplementation((async(path:any,...args:any[])=>{
  if(String(path).includes('failed.json')){await new Promise<void>(resolve=>fail=resolve);throw Error('Fixture disk failure')}
  if(String(path).includes('slow.json'))await new Promise<void>(resolve=>release=resolve)
  return (write as any)(path,...args)
 }) as any)
 const broken=atomicMetadata(join(root,'failed.json'),'failed').catch(()=>{}),slow=atomicMetadata(join(root,'slow.json'),'durable')
 let failure:unknown
 try{
  await vi.waitFor(()=>{expect(fail).toBeTypeOf('function');expect(release).toBeTypeOf('function')})
  const drained=drainMetadata().then(()=>{settled=true},error=>{failure=error;settled=true})
  fail();await broken;await new Promise(resolve=>setImmediate(resolve))
  try{expect(settled).toBe(false)}finally{release();await slow;await drained}
  expect(String(failure)).toContain('Fixture disk failure');expect(await readFile(join(root,'slow.json'),'utf8')).toBe('durable')
 }finally{spy.mockRestore();await fs.rm(root,{recursive:true,force:true})}
})
