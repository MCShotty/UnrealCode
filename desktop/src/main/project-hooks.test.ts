import {afterEach,expect,it} from 'vitest'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ProjectHooks} from './project-hooks'
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it('requires renewed trust when a reviewed hook changes on disk',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-hook-'));roots.push(root);const path=join(root,'hooks.json'),store=new ProjectHooks(path)
 await store.save([{id:'verify',event:'beforeTool',tool:'ApplyPatch',enabled:true,command:'printf reviewed',timeoutMs:1000}])
 expect((await store.matching('beforeTool','ReadFile')).hooks).toHaveLength(0)
 expect((await store.matching('beforeTool','ApplyPatch')).hooks).toHaveLength(1)
 const changed=JSON.parse(await readFile(path,'utf8'));changed.hooks[0].command='printf changed';await writeFile(path,JSON.stringify(changed))
 await expect(store.matching('beforeTool','ApplyPatch')).rejects.toThrow('trust')
})
it('preserves oversized hook metadata rather than treating it as an empty configuration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-hook-large-'));roots.push(root);const path=join(root,'hooks.json'),store=new ProjectHooks(path)
 const original=JSON.stringify({version:1,hooks:[],padding:'x'.repeat(2*1024*1024)})
 await writeFile(path,original)
 await expect(store.read()).rejects.toThrow('size limit')
 expect(await readFile(path,'utf8')).toBe(original)
})
