import { afterEach,expect,it,vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
vi.mock('electron',()=>({app:{isPackaged:false}}))
vi.mock('electron-updater',()=>({NsisUpdater:class{}}))
import { Updates,requireUpdateHashes,verifyPublisher,verifyUpdateHash } from './updates'
let root=''
afterEach(async()=>{if(root)await fs.rm(root,{recursive:true,force:true})})
it('requires checksums and rechecks the file before installation',async()=>{root=await fs.mkdtemp(join(tmpdir(),'unrealcode-update-'));const path=join(root,'fixture.exe');await fs.writeFile(path,'original');const hash=createHash('sha512').update('original').digest('base64');await verifyUpdateHash(path,hash);await fs.writeFile(path,'modified');await expect(verifyUpdateHash(path,hash)).rejects.toThrow('checksum');expect(()=>requireUpdateHashes([])).toThrow('checksum');expect(()=>requireUpdateHashes([{sha512:'missing'}])).toThrow('checksum')})
it('refuses a missing publisher and never accepts an unsigned Windows executable',async()=>{root=await fs.mkdtemp(join(tmpdir(),'unrealcode-signature-'));const path=join(root,'unsigned.exe');await fs.writeFile(path,'not signed');await expect(verifyPublisher(path,[])).rejects.toThrow('publisher');if(process.platform==='win32')await expect(verifyPublisher(path,['Fixture publisher'])).rejects.toThrow(/Windows signature is invalid|Windows signature could not be verified/)},30000)
it('does not install after an interrupted download or in an unsigned build',async()=>{const updates=new Updates();await updates.initialize();expect(updates.view().state).toBe('unavailable');await expect(updates.install()).rejects.toThrow('verified');const install=vi.fn();Object.assign(updates,{value:{channel:'stable',state:'available',message:''},updater:{downloadUpdate:async()=>{throw Error('connection interrupted')},quitAndInstall:install}});expect((await updates.download()).state).toBe('error');await expect(updates.install()).rejects.toThrow('verified');expect(install).not.toHaveBeenCalled()})
