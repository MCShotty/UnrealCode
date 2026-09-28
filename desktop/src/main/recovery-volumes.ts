import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID,createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { backendEnvironment } from './child-environment'
import { terminalDockerExecutable } from './terminal-command'
import { durableRoots } from './recovery-files'
import { receiveVolumeFiles, sendVolumeFiles, volumeTransferScript } from './recovery-stream'
import type { StorageItem } from '../shared/recovery'
const exec=promisify(execFile)
export interface RecoveryVolumes { existing(names:string[]):Promise<string[]>; inspect(volume:string):Promise<{owner?:string;inUse:boolean}>; export(volume:string,path:string):Promise<void>; import(path:string,requestedVolume?:string,restoreOwner?:string):Promise<string>; }
export class DockerRecoveryVolumes implements RecoveryVolumes {
 async modelStorage(volumes:string[]):Promise<StorageItem[]>{if(!volumes.length)return [];const image=await this.image(),result:StorageItem[]=[];for(const volume of volumes){const raw=await this.docker(['run','--rm','--network','none','--cap-drop=ALL','--entrypoint','python3','--mount',`type=volume,source=${volume},target=/state,readonly`,image,'-c','import os,json,hashlib\np="/state/model-cache"; size=0; h=hashlib.sha256()\nfor root,dirs,files in os.walk(p,followlinks=False):\n for name in sorted(dirs+files):\n  q=os.path.join(root,name);s=os.lstat(q);h.update((q+str(s.st_size)+str(s.st_mtime_ns)).encode());size+=s.st_size if not os.path.isdir(q) else 0\nprint(json.dumps(dict(bytes=size,digest=h.hexdigest())))']);const info=JSON.parse(raw);if(info.bytes)result.push({id:createHash('sha256').update(volume+info.digest).digest('hex'),path:`${volume}:/state/model-cache`,category:'models',bytes:info.bytes,removable:true,reason:'Downloaded model cache; models will download again when needed.'})}return result}
 async removeModelCache(volume:string):Promise<void>{if(!/^unrealcode-(?:eval-|restore-)?[a-f0-9-]{20,36}$/.test(volume))throw new Error('Invalid model-cache volume');await this.idle(volume);await this.docker(['run','--rm','--network','none','--cap-drop=ALL','--entrypoint','python3','--mount',`type=volume,source=${volume},target=/state`,await this.image(),'-c','import os,shutil\np="/state/model-cache"\nif os.path.islink(p): raise Exception("Cache root is a link")\nif os.path.isdir(p): shutil.rmtree(p)'])}
 private async docker(args:string[],timeout=300000):Promise<string>{const environment=backendEnvironment(),{stdout}=await exec(terminalDockerExecutable(environment),args,{windowsHide:true,timeout,maxBuffer:8*1024*1024,env:environment});return stdout.trim()}
 async existing(names:string[]):Promise<string[]>{if(!names.length)return [];if(await this.docker(['info','--format','{{.OSType}}'],15000)!=='linux')throw new Error('Linux engine required; Docker is using Windows containers');const present=new Set((await this.docker(['volume','ls','--format','{{.Name}}'],15000)).split('\n'));return names.filter(name=>present.has(name))}
 async inspect(volume:string):Promise<{owner?:string;inUse:boolean}>{
  if(!/^unrealcode-restore-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(volume))throw Error('Invalid retained recovery volume')
  const [raw,using]=await Promise.all([this.docker(['volume','inspect','--format','{{json .Labels}}',volume],15000),this.docker(['ps','-q','--filter',`volume=${volume}`],15000)])
  const labels=JSON.parse(raw) as Record<string,string>|null
  return {owner:labels?.['ai.unrealcode.restore-owner'],inUse:!!using}
 }
 private async image():Promise<string>{const images=(await this.docker(['image','ls','--format','{{.Repository}}:{{.Tag}}','unrealcode'])).split('\n');const image=images.find(value=>/^unrealcode:[\w.-]+$/.test(value));if(!image)throw new Error('Prepare the UnrealCode Docker backend before backing up or restoring sessions');return image}
 private async idle(volume:string):Promise<void>{if(await this.docker(['ps','-q','--filter',`volume=${volume}`]))throw new Error('A saved-session volume is in use. Close other UnrealCode instances and retry.')}
 async export(volume:string,path:string):Promise<void>{await this.idle(volume);await this.copy(volume,path,false)}
 async import(path:string,requestedVolume?:string,restoreOwner?:string):Promise<string>{
  const volume=requestedVolume||`unrealcode-restore-${randomUUID()}`
  if(!/^unrealcode-restore-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(volume))throw Error('Invalid planned recovery volume identity')
  if(restoreOwner!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(restoreOwner))throw Error('Invalid recovery volume owner identity')
  if((await this.existing([volume])).length)throw Error('Planned recovery volume already exists. Inspect the retained restore journal before retrying.')
  const owner=restoreOwner||randomUUID()
  await this.docker(['volume','create','--label',`ai.unrealcode.restore-owner=${owner}`,volume])
  const details=JSON.parse(await this.docker(['volume','inspect',volume])) as Array<{Labels?:Record<string,string>}>
  if(details[0]?.Labels?.['ai.unrealcode.restore-owner']!==owner)throw Error('Recovery volume ownership changed during creation; retained volume needs inspection')
  try{await this.copy(volume,path,true);return volume}
  catch(error){
   // Never remove a volume that another process replaced after our import began.
   try{const current=JSON.parse(await this.docker(['volume','inspect',volume])) as Array<{Labels?:Record<string,string>}>;if(current[0]?.Labels?.['ai.unrealcode.restore-owner']===owner)await this.docker(['volume','rm',volume])}catch{}
   throw error
  }
 }
 private async copy(volume:string,path:string,restore:boolean):Promise<void>{
  if(!/^unrealcode-(?:eval-|restore-)?[a-f0-9-]{20,36}$/.test(volume))throw new Error('Invalid recovery volume')
  const name=`unrealcode-recovery-${randomUUID()}`,image=await this.image()
  const environment=backendEnvironment()
  const child=spawn(terminalDockerExecutable(environment),['run','--rm','-i','--name',name,'--network','none','--cap-drop=ALL',...(restore?['--cap-add=CHOWN']:[]),'--security-opt=no-new-privileges','--user',restore?'0:0':'10001:10001','--entrypoint','python3','--mount',`type=volume,source=${volume},target=/state${restore?'':',readonly'}`,image,'-c',volumeTransferScript,restore?'import':'export',JSON.stringify(durableRoots)],{windowsHide:true,env:environment,stdio:['pipe','pipe','pipe']})
  let stderr='',timedOut=false
  child.stderr.on('data',(chunk:Buffer)=>{if(stderr.length<65536)stderr+=chunk.toString('utf8').slice(0,65536-stderr.length)})
  const exit=new Promise<void>((resolve,reject)=>{
   child.once('error',reject)
   child.once('close',code=>code===0&&!timedOut?resolve():reject(new Error(timedOut?'Session backup transfer timed out':`Docker recovery transfer failed (${code}): ${stderr.trim()}`)))
  })
  const timer=setTimeout(()=>{timedOut=true;child.kill()},300000)
  try{
   if(restore)child.stdout.resume();else child.stdin.end()
   const transfer=restore?pipeline(Readable.from(sendVolumeFiles(path)),child.stdin):receiveVolumeFiles(child.stdout,path)
   await Promise.all([exit,transfer])
  }catch(error){
   child.kill();child.stdin.destroy();child.stdout.destroy()
   // Killing the CLI alone can leave its container running. Remove only our
   // uniquely named helper before import's failure handler removes its volume.
   await this.docker(['rm','--force',name],15000).catch(()=>{})
   await exit.catch(()=>{})
   throw error
  }finally{clearTimeout(timer)}
 }
}
