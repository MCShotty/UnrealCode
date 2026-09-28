import {afterEach,expect,it} from 'vitest'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {projectBytes,projectWrite,projectDelete,confinedRemoveTree,openConfinedStream,storageCopy,storageHash} from './project-fs'
let root=''
afterEach(async()=>{if(root)await fs.rm(root,{recursive:true,force:true})})
async function fixture(){root=await fs.mkdtemp(join(tmpdir(),'unrealcode-confined-'));const project=join(root,'project'),outside=join(root,'outside');await fs.mkdir(project);await fs.mkdir(outside);await fs.writeFile(join(outside,'private.txt'),'private');return {project,outside}}
it('rejects Windows junction traversal at the actual read, write, delete and backup boundaries',async()=>{
 const {project,outside}=await fixture();await fs.symlink(outside,join(project,'link'),process.platform==='win32'?'junction':'dir')
 await expect(projectBytes(project,'link/private.txt',1024)).rejects.toThrow()
 await expect(projectWrite(project,'link/private.txt',Buffer.from('changed'))).rejects.toThrow()
 await expect(projectDelete(project,'link/private.txt')).rejects.toThrow()
 await expect(storageHash(project,'link/private.txt')).rejects.toThrow()
 await expect(storageCopy(project,'link/private.txt',project,'stolen.txt')).rejects.toThrow()
 await expect(openConfinedStream(project,'link/private.txt')).rejects.toThrow()
 await expect(openConfinedStream(project,'link/new.txt',true)).rejects.toThrow()
 await confinedRemoveTree(project,'link')
 expect(await fs.readFile(join(outside,'private.txt'),'utf8')).toBe('private')
 expect(await fs.readdir(outside)).toEqual(['private.txt'])
})
it('keeps an open recovery stream on its original file after a junction replaces its parent',async()=>{
 const {project,outside}=await fixture(),parent=join(project,'folder');await fs.mkdir(parent);await fs.writeFile(join(parent,'private.txt'),'safe')
 const stream=await openConfinedStream(project,'folder/private.txt')
 try{let moved=false;try{await fs.rename(parent,join(project,'moved'));moved=true}catch(error){if(process.platform!=='win32'||(error as NodeJS.ErrnoException).code!=='EPERM')throw error}if(moved)await fs.symlink(outside,parent,process.platform==='win32'?'junction':'dir');const bytes=Buffer.alloc(32),result=await stream.read(bytes,0,32,null);expect(bytes.subarray(0,result.bytesRead).toString()).toBe('safe')}finally{await stream.close()}
})
it('streams binary recovery data and copies private Git metadata without enabling project .git edits',async()=>{
 const {project,outside}=await fixture();await fs.mkdir(join(project,'.git'));const bytes=Buffer.alloc(150000,137),stream=await openConfinedStream(project,'.git/index',true)
 try{await stream.write(bytes,0,65000);await stream.write(bytes,65000,bytes.length-65000)}finally{await stream.close()}
 await storageCopy(project,'.git/index',outside,'backup/index')
 expect(await fs.readFile(join(outside,'backup/index'))).toEqual(bytes)
 expect(await storageHash(outside,'backup/index')).toBe(createHash('sha256').update(bytes).digest('hex'))
 await expect(projectWrite(project,'.git/config',Buffer.from('unsafe'))).rejects.toThrow()
 await expect(storageCopy(project,'.git/index',outside,'backup/index')).rejects.toThrow('already exists')
})
