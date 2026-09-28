import { afterEach,expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat, writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const storage=vi.hoisted(()=>({available:true,decrypted:undefined as string|undefined}))
vi.mock('electron',()=>({safeStorage:{isEncryptionAvailable:()=>storage.available,decryptString:()=>{if(storage.decrypted===undefined)throw new Error('test must not decrypt oversized metadata');return storage.decrypted},encryptString:(value:string)=>Buffer.from(`encrypted:${value}`)}}))
import { ConnectionVault } from './connection-vault'
afterEach(()=>{storage.available=true;storage.decrypted=undefined;vi.restoreAllMocks()})

it('preserves oversized credential metadata and refuses to decrypt it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-vault-large-')),path=join(root,'connection-secrets.json')
 try{
  await writeFile(path,JSON.stringify({server:'x'.repeat(16*1024*1024)}))
  const original=(await stat(path)).size,vault=new ConnectionVault(path)
  expect(()=>vault.get('server')).toThrow('size limit')
  expect(()=>vault.remove('server')).toThrow('size limit')
  expect((await stat(path)).size).toBe(original)
 }finally{await rm(root,{recursive:true,force:true})}
})
it('rejects an array-shaped credential store without overwriting it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-vault-shape-')),path=join(root,'connection-secrets.json')
 try{
  await writeFile(path,'[]')
  const vault=new ConnectionVault(path)
  expect(()=>vault.set('server',{bearer:'synthetic-value'})).toThrow('damaged')
  expect((await stat(path)).size).toBe(2)
 }finally{await rm(root,{recursive:true,force:true})}
})
it('preserves a memory-only credential when an unrelated saved store is damaged',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-vault-memory-')),path=join(root,'connection-secrets.json')
 try{
  storage.available=false
  const vault=new ConnectionVault(path)
  vault.set('server',{bearer:'fixture-memory-secret'})
  await writeFile(path,'[]')
  expect(()=>vault.remove('server')).toThrow('damaged')
  expect(vault.get('server')).toEqual({bearer:'fixture-memory-secret'})
  expect(await readFile(path,'utf8')).toBe('[]')
 }finally{await rm(root,{recursive:true,force:true})}
})
it('clears a memory-only credential without creating a disk vault',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-vault-memory-clear-')),path=join(root,'connection-secrets.json')
 try{
  storage.available=false
  const vault=new ConnectionVault(path)
  vault.set('server',{bearer:'fixture-memory-secret'})
  vault.remove('server')
  expect(vault.get('server')).toEqual({})
  await expect(stat(path)).rejects.toMatchObject({code:'ENOENT'})
 }finally{await rm(root,{recursive:true,force:true})}
})
it('rejects decrypted credential data that is not an object',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-vault-decrypted-')),path=join(root,'connection-secrets.json')
 try{
  storage.decrypted='null'
  await writeFile(path,JSON.stringify({server:Buffer.from('synthetic-ciphertext').toString('base64')}))
  expect(()=>new ConnectionVault(path).get('server')).toThrow('cannot be decrypted')
 }finally{await rm(root,{recursive:true,force:true})}
})
it('rejects non-object and oversized new credentials before creating a vault file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-vault-input-')),path=join(root,'connection-secrets.json')
 try{
  const vault=new ConnectionVault(path)
  expect(()=>vault.set('server',null as never)).toThrow('bounded object')
  expect(()=>vault.set('server',[] as never)).toThrow('bounded object')
  expect(()=>vault.set('server',{bearer:'x'.repeat(1024*1024+1)})).toThrow('bounded object')
  await expect(stat(path)).rejects.toMatchObject({code:'ENOENT'})
 }finally{await rm(root,{recursive:true,force:true})}
})
