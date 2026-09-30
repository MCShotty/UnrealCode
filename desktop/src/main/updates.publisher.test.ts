import {afterEach,expect,it,vi} from 'vitest'
import {join,isAbsolute} from 'node:path'
const native=vi.hoisted(()=>({execFile:vi.fn()}))
vi.mock('node:child_process',()=>{
 Object.defineProperty(native.execFile,Symbol.for('nodejs.util.promisify.custom'),{value:(...args:unknown[])=>new Promise((resolve,reject)=>native.execFile(...args,(error:Error|null,stdout:string,stderr:string)=>error?reject(error):resolve({stdout,stderr})))})
 return {execFile:native.execFile}
})
vi.mock('electron',()=>({app:{isPackaged:false}}))
vi.mock('electron-updater',()=>({NsisUpdater:class{}}))
import {verifyPublisher} from './updates'
afterEach(()=>{native.execFile.mockReset();vi.unstubAllEnvs()})
function reply(value:unknown){native.execFile.mockImplementation((_file,_args,_options,done)=>done(null,JSON.stringify(value),'') )}
it('pins the Windows verifier and built-in module while treating the filename literally',async()=>{
 const system=process.env.SystemRoot||process.env.WINDIR||'C:\\Windows',root=join(system,'System32','WindowsPowerShell','v1.0')
 vi.stubEnv('PSModulePath','UNTRUSTED_MODULES');reply({status:0,publisher:'Fixture publisher'})
 const file=join(root,"a'; Write-Output injected; '.exe")
 await verifyPublisher(file,['Fixture publisher'])
 const [executable,args,options]=native.execFile.mock.calls[0]
 expect(executable).toBe(join(root,'powershell.exe'));if(process.platform==='win32')expect(isAbsolute(executable)).toBe(true)
 expect(options.env.PSModulePath).toBe(join(root,'Modules'));expect(options.env.UNREAL_VERIFY_FILE).toBe(file)
 expect(args.at(-1)).not.toContain(file);expect(args.at(-1)).toContain("Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security")
 expect(args.at(-1)).toContain("$ErrorActionPreference='Stop'")
})
it.each([{status:1,publisher:'Fixture publisher'},{status:0,publisher:'Other publisher'},{status:'0',publisher:'Fixture publisher'}])('rejects untrusted signature result %j',async result=>{
 reply(result);await expect(verifyPublisher('fixture.exe',['Fixture publisher'])).rejects.toThrow('Windows signature is invalid')
})
it('fails closed when the verifier or its module cannot run',async()=>{
 native.execFile.mockImplementation((_file,_args,_options,done)=>done(Error('Module could not be loaded')))
 await expect(verifyPublisher('fixture.exe',['Fixture publisher'])).rejects.toThrow('Windows signature could not be verified')
})
