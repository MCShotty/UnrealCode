import {afterEach,expect,it,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import {PassThrough,Writable} from 'node:stream'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
const native=vi.hoisted(()=>({spawn:vi.fn()}))
vi.mock('node:child_process',()=>({spawn:native.spawn}))
import {ComputerManager} from './computer'
const cleanup:Array<()=>Promise<unknown>>=[]
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanup.splice(0).reverse())await close();native.spawn.mockReset()})
function child(ready=true){
 const process=new EventEmitter() as any;process.exitCode=null;process.stdout=new PassThrough();process.stderr=new PassThrough()
 process.kill=vi.fn(()=>{if(process.exitCode===null){process.exitCode=0;process.emit('exit',0)}})
 process.stdin=new Writable({write(chunk,_encoding,done){const call=JSON.parse(chunk.toString());queueMicrotask(()=>process.stdout.emit('data',Buffer.from(JSON.stringify({id:call.id,result:{state:'ready'}})+'\n')));done()}})
 if(ready)setImmediate(()=>process.stdout.emit('data',Buffer.from(JSON.stringify({event:'ready',protocol:1,generation:'fixture',inputMonitor:true,desktopReady:true,elevated:false})+'\n')))
 return process
}
async function fixture(){
 const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-computer-life-'));cleanup.push(()=>fs.rm(root,{recursive:true,force:true}))
 const bytes=Buffer.from('fixture executable');await fs.writeFile(join(root,'UnrealCode.ComputerHost.exe'),bytes);await fs.writeFile(join(root,'manifest.json'),JSON.stringify({protocol:1,sha256:createHash('sha256').update(bytes).digest('hex')}))
 const manager=new ComputerManager(root,root,{register:()=>true,unregister:()=>{}});cleanup.push(()=>manager.close());await manager.status();return {manager,root,bytes}
}
it('does not launch a late helper after Computer has been disabled',async()=>{
 const {manager,bytes}=await fixture();let release!:(value:Buffer)=>void;const read=fs.readFile
 vi.spyOn(fs,'readFile').mockImplementation(((path:any,...args:any[])=>String(path).endsWith('ComputerHost.exe')?new Promise(resolve=>release=resolve):(read as any)(path,...args)) as any)
 native.spawn.mockImplementation(()=>child())
 const enabling=manager.enable(true),rejected=expect(enabling).rejects.toThrow(/cancelled|disabled/i)
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 const disabling=manager.enable(false);await vi.waitFor(async()=>expect((await manager.status()).enabled).toBe(false))
 release(bytes);await rejected;await disabling
 expect(native.spawn).not.toHaveBeenCalled();expect(await manager.status()).toMatchObject({state:'disabled',enabled:false})
})
it('closes a spawned helper that has not sent its ready event',async()=>{
 const {manager}=await fixture(),process=child(false);native.spawn.mockReturnValue(process)
 const enabling=manager.enable(true),rejected=expect(enabling).rejects.toThrow()
 await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalled())
 await expect(manager.enable(false)).resolves.toMatchObject({state:'disabled'})
 await rejected;expect(process.kill).toHaveBeenCalled()
})
