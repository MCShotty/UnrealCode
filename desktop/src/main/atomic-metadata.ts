import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname,resolve } from 'node:path'

const pending = new Map<string,Promise<void>>()
export async function drainMetadata():Promise<void>{while(pending.size)await Promise.all([...pending.values()])}
// Windows readers and antivirus can briefly deny replacement. Keep the prior
// metadata intact and retry only sharing-related failures; never delete it first.
export async function replaceMetadata(source:string,target:string,rename=fs.rename):Promise<void> {
  for(let attempt=0;;attempt++) {
    try { await rename(source,target); return }
    catch(error) {
      if(!['EPERM','EACCES','EBUSY'].includes(String((error as NodeJS.ErrnoException).code))||attempt>=7)throw error
      await new Promise(resolve=>setTimeout(resolve,Math.min(20*2**attempt,160)))
    }
  }
}
export function atomicMetadata(path:string,text:string):Promise<void> {
  const key=process.platform==='win32'?resolve(path).toLowerCase():resolve(path)
  const run=(pending.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
    await fs.mkdir(dirname(path),{recursive:true})
    const temporary=`${path}.${randomUUID()}.tmp`
    try {await fs.writeFile(temporary,text,{flag:'wx',mode:0o600});await replaceMetadata(temporary,path)}
    finally {await fs.unlink(temporary).catch(()=>{})}
  })
  pending.set(key,run)
  void run.finally(()=>{if(pending.get(key)===run)pending.delete(key)}).catch(()=>{})
  return run
}
