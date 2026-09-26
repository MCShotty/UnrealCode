import { it,expect } from 'vitest'
import { mkdtemp,mkdir,writeFile,unlink,utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RepositoryIndex } from './repository-index'
it('incrementally retrieves current file lines, honors exclusions and forgets deleted content',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-retrieval-')),project=join(root,'project');await mkdir(project)
 let excluded=['private'];await mkdir(join(project,'private'));await writeFile(join(project,'private','hidden.txt'),'needle hidden');await writeFile(join(project,'source.ts'),'line one\nneedle public\nline three');await writeFile(join(project,'asset.bin'),Buffer.from([0,1,2]))
 const index=new RepositoryIndex(project,join(root,'index.json'),()=>excluded),first=await index.search('needle')
 expect(first.hits).toHaveLength(1);expect(first.hits[0]).toMatchObject({path:'source.ts',line:1,endLine:3});expect(first.status.omitted).toBe(1)
 await writeFile(join(project,'source.ts'),'needle changed');expect((await index.search('needle')).hits[0].text).toBe('needle changed')
 excluded=['source.ts'];expect((await index.search('needle')).hits[0].path).toBe('private/hidden.txt')
 await unlink(join(project,'private','hidden.txt'));expect((await index.search('needle')).hits).toEqual([])
 const again=new RepositoryIndex(project,join(root,'index.json'),()=>excluded);expect((await again.search('source',true)).hits).toEqual([]);index.close();again.close()
})
