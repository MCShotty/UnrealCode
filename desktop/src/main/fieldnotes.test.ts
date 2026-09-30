import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Fieldnotes, type NoteMemory } from './fieldnotes'
import { HistoryCache } from './history-cache'
import type { Fieldnote, FieldnoteInput } from '../shared/fieldnotes'
const cleanup:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close()})
async function setup(memory?:NoteMemory){
 const root=await mkdtemp(join(tmpdir(),'unrealcode-fieldnotes-'));cleanup.push(()=>rm(root,{recursive:true,force:true}))
 const cache=new HistoryCache(root);cleanup.push(()=>cache.close())
 const notes=new Fieldnotes(root,cache,memory);cleanup.push(()=>notes.close())
 const project=await notes.registerProject('C:\\fixture-project','Fixture'),sessionId=randomUUID()
 const input:FieldnoteInput={title:'Database guidance',body:'Prefer SQLite for the local cache. Verify migrations before changing storage.',pointer:{projectId:project.id,projectPath:project.path,projectName:project.name},enabled:true,indexing:true}
 return {root,cache,notes,input,sessionId}
}
it('saves offline, searches across projects on actual workers, and preserves attribution',async()=>{
 const {root,cache,notes,input,sessionId}=await setup()
 const note=await notes.save(input),result=await notes.suggestions('SQLite','C:\\other-project',sessionId)
 expect(result.notes.map(n=>n.id)).toContain(note.id)
 const receipt=await notes.prepare('C:\\other-project','C:\\other-worktree',sessionId,randomUUID(),'SQLite')
 expect(receipt.notes[0]).toMatchObject({id:note.id,revision:1,pointer:input.pointer})
 expect((await cache.health() as any[]).filter(w=>w.reader)).toHaveLength(2)
 const version=JSON.parse(await readFile(join(root,'data-version.json'),'utf8'))
 expect(version.schema).toBe(2);expect(JSON.parse(await readFile(join(version.backup,'manifest.json'),'utf8')).feature).toBe('fieldnotes-and-computer')
 expect((await readdir(join(notes.directory,'notes')))[0]).toMatch(/^\d{4}-\d{2}-\d{2}_/)
})
it('rejects concurrent stale edits, retains drafts and tombstones, and rebuilds derived cache only',async()=>{
 const {root,cache,notes,input}=await setup(),note=await notes.save(input)
 const changes=await Promise.allSettled(['first','second'].map(body=>notes.save({...input,id:note.id,expectedRevision:1,body})))
 expect(changes.filter(r=>r.status==='fulfilled')).toHaveLength(1)
 await notes.draft('new',{...input,title:'Unfinished draft'})
 const current=await notes.get(note.id);await notes.remove(current.id,current.revision)
 expect((await notes.list()).notes).toEqual([])
 await expect(notes.save({...input,id:note.id,expectedRevision:3})).rejects.toThrow('changed')
 await notes.close()
 const reloaded=new Fieldnotes(root,cache);cleanup.push(()=>reloaded.close());await reloaded.load()
 expect((await reloaded.savedDrafts())[0].value.title).toBe('Unfinished draft')
 expect((await reloaded.get(note.id)).deletedAt).toBeTruthy()
})
it('preserves accepted receipts without reviving withdrawn notes on transport retries',async()=>{
 const {notes,input,sessionId}=await setup(),note=await notes.save(input),messageId=randomUUID()
 const receipt=await notes.prepare(input.pointer.projectPath,input.pointer.projectPath,sessionId,messageId,'Please inspect',{include:[note.id],exclude:[]})
 await notes.accepted(messageId)
 await notes.save({...input,id:note.id,expectedRevision:1,enabled:false})
 const retried=await notes.prepare(input.pointer.projectPath,input.pointer.projectPath,sessionId,messageId,'Please inspect',{include:[note.id],exclude:[]})
 expect(retried.notes).toEqual([])
 expect((await notes.receiptPage(input.pointer.projectPath,sessionId))[0]).toMatchObject({state:'accepted',notes:receipt.notes})
})
it('enforces whole-note budgets and does not index discarded drafts',async()=>{
 const memory:NoteMemory={available:async()=>({enabled:false,generation:0}),analyse:vi.fn(),retain:vi.fn(),withdraw:vi.fn(),state:async()=> 'pending'}
 const {notes,input,sessionId}=await setup(memory)
 await notes.draft('private',{...input,body:'Not saved'})
 expect((await notes.list()).notes).toHaveLength(0)
 const a=await notes.save({...input,body:'a'.repeat(10000)}),b=await notes.save({...input,title:'Second',body:'b'.repeat(10000)})
 await expect(notes.prepare('other','other',sessionId,randomUUID(),'',{include:[a.id,b.id],exclude:[]})).rejects.toThrow('16 KiB')
 expect(memory.analyse).not.toHaveBeenCalled()
})
it('discards obsolete analysis and validates quoted evidence before memory retention',async()=>{
 let release!:(value:any)=>void,first=true;const retained:Fieldnote[]=[]
 const memory:NoteMemory={available:async()=>({enabled:true,generation:1}),analyse:vi.fn(async()=>first?(first=false,await new Promise<any>(resolve=>{release=resolve})):{text:JSON.stringify({summary:'New',topics:['cache'],applicability:'Local storage',quotes:['New guidance']}),provider:'fixture',model:'fixture',generation:1}),retain:async note=>{retained.push(note)},withdraw:async()=>{},state:async()=> 'retained'}
 const {notes,input}=await setup(memory),note=await notes.save(input)
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 await notes.save({...input,id:note.id,expectedRevision:1,body:'New guidance'})
 release({text:JSON.stringify({summary:'Old',topics:['storage'],applicability:'Old',quotes:['Prefer SQLite']}),provider:'fixture',model:'fixture',generation:1})
 await vi.waitFor(()=>expect(retained).toHaveLength(1),{timeout:5000})
 expect(retained[0]).toMatchObject({revision:2,body:'New guidance'})
 const invalid=await notes.save({...input,title:'Invalid quotes'})
 await vi.waitFor(async()=>expect((await notes.get(invalid.id)).sync.state).toBe('failed'),{timeout:5000})
 expect(retained).toHaveLength(1)
})

it('keeps concurrent duplicate receipts identical and validates project-session attribution',async()=>{
 const {notes,input,sessionId}=await setup(),first=await notes.save(input),second=await notes.save({...input,title:'Second'}),messageId=randomUUID()
 const results=await Promise.all([first,second].map(note=>notes.prepare('project','workspace',sessionId,messageId,'',{include:[note.id],exclude:[]})))
 expect(results[0]).toEqual(results[1])
 await expect(notes.save({...input,pointer:{...input.pointer,sessionId:randomUUID()}})).rejects.toThrow('belonging')
 await notes.accepted(messageId);const inherited=await notes.inherit('project','workspace',sessionId,randomUUID(),sessionId)
 expect(inherited.notes.map(n=>n.id)).toEqual(results[0].notes.map(n=>n.id));expect(inherited.notes[0].reason).toBe('Retained for task continuation')
})

it('normalizes canonical Go receipts whose empty arrays were omitted',async()=>{
 const {notes,cache,input,sessionId}=await setup(),note=await notes.save(input),project=input.pointer.projectPath
 const receipt=await notes.prepare(project,project,sessionId,randomUUID(),'SQLite')
 await cache.putFieldnoteReceipt({...receipt,state:'accepted',omitted:undefined} as any)
 const rows=await notes.receiptPage(project,sessionId)
 expect(rows[0]).toMatchObject({state:'accepted',omitted:[]});expect(rows[0].notes[0].id).toBe(note.id)
 await cache.putFieldnoteReceipt({...receipt,messageId:randomUUID(),notes:undefined,omitted:undefined} as any)
 expect((await notes.receiptPage(project,sessionId)).every(row=>Array.isArray(row.notes)&&Array.isArray(row.omitted))).toBe(true)
})

it('returns one canonical inherited receipt and rejects reuse by another task',async()=>{
 const {notes,input,sessionId}=await setup(),note=await notes.save(input),messageId=randomUUID()
 const parent=await notes.prepare('project','workspace',sessionId,randomUUID(),'',{include:[note.id],exclude:[]});await notes.accepted(parent.messageId)
 const first=await notes.inherit('project','workspace',sessionId,messageId,sessionId)
 await notes.save({...input,id:note.id,expectedRevision:1,enabled:false})
 const again=await notes.inherit('project','workspace',sessionId,messageId,sessionId)
 expect(again).toMatchObject({createdAt:first.createdAt,notes:[]})
 await expect(notes.inherit('project','other-workspace',randomUUID(),messageId,sessionId)).rejects.toThrow('another task')
})

it('inherits accepted guidance when the rebuildable receipt cache is unavailable',async()=>{
 const {notes,cache,input,sessionId}=await setup(),note=await notes.save(input)
 const parent=await notes.prepare('project','workspace',sessionId,randomUUID(),'',{include:[note.id],exclude:[]});await notes.accepted(parent.messageId)
 vi.spyOn(cache,'fieldnoteReceipts').mockRejectedValue(Error('database is unavailable'))
 const receipt=await notes.inherit('project','workspace',randomUUID(),randomUUID(),sessionId)
 expect(receipt.notes.map(row=>row.id)).toEqual([note.id])
})

it('restores the library search projection after a cache rebuild without restarting',async()=>{
 const {notes,cache,input}=await setup(),note=await notes.save(input)
 await cache.rebuild()
 expect((await notes.list()).notes.map(row=>row.id)).toContain(note.id)
})
it('does not let a partially updated cache drop the latest accepted receipt',async()=>{
 const {notes,cache,input,sessionId}=await setup(),a=await notes.save(input),b=await notes.save({...input,title:'Second'})
 const first=await notes.prepare('project','workspace',sessionId,randomUUID(),'',{include:[a.id],exclude:[b.id]});await notes.accepted(first.messageId)
 vi.spyOn(cache,'putFieldnoteReceipt').mockRejectedValue(Error('Fixture cache lock'))
 const second=await notes.prepare('project','workspace',sessionId,randomUUID(),'',{include:[b.id],exclude:[a.id]});await notes.accepted(second.messageId)
 expect((await notes.receiptPage('project',sessionId))[0]).toMatchObject({messageId:second.messageId,state:'accepted'})
 expect((await notes.inherit('project','workspace',sessionId,randomUUID(),sessionId)).notes[0].id).toBe(b.id)
})
it('repairs a missed projection after a transient writer failure',async()=>{
 const {notes,cache,input}=await setup()
 vi.spyOn(cache,'putFieldnotes').mockRejectedValueOnce(Error('Fixture cache lock'))
 const note=await notes.save(input)
 expect((await notes.list()).notes.map(row=>row.id)).toContain(note.id)
})
it('repairs a failed initial batch even if a later projection batch succeeded',async()=>{
 const {root,cache,notes,input}=await setup()
 for(let i=0;i<33;i++)await notes.save({...input,title:'Guidance '+i,indexing:false})
 await notes.close();vi.spyOn(cache,'putFieldnotes').mockRejectedValueOnce(Error('Fixture initial cache lock'))
 const reopened=new Fieldnotes(root,cache);cleanup.push(()=>reopened.close());await reopened.load()
 expect((await reopened.list()).total).toBe(33)
})
it('redacts credentials in metadata as well as note bodies before model use',async()=>{
 const fake='sk-'+'x'.repeat(52)
 const analyse=vi.fn(async()=>({text:JSON.stringify({summary:'Guidance',topics:[],applicability:'Storage',quotes:['Use local storage.']}),provider:'fixture',model:'fixture',generation:1}))
 const memory:NoteMemory={available:async()=>({enabled:true,generation:1}),analyse,retain:async()=>{},withdraw:async()=>{},state:async()=> 'retained'}
 const {notes,input,sessionId}=await setup(memory),project=await notes.registerProject('C:\\fixture-'+fake,'Private '+fake)
 const note=await notes.save({...input,title:'Guidance '+fake,body:'Use local storage.',pointer:{projectId:project.id,projectPath:project.path,projectName:project.name}})
 const receipt=await notes.prepare('project','workspace',sessionId,randomUUID(),'',{include:[note.id],exclude:[]})
 expect(JSON.stringify(receipt.notes)).not.toContain(fake)
 await vi.waitFor(()=>expect(analyse).toHaveBeenCalled())
 expect(analyse.mock.calls[0].join(' ')).not.toContain(fake)
 expect((await notes.get(note.id)).title).toContain(fake)
})
