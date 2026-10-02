import {afterEach,expect,it,vi} from 'vitest'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
vi.mock('./hindsight-runtime',()=>({HindsightRuntime:class{state='ready';message='Fixture';request=vi.fn(async()=>({results:[]}));start=vi.fn(async()=>{this.state='ready'});stop=vi.fn(async()=>{this.state='disabled'});snapshot=vi.fn(async()=>{})}}))
vi.mock('./memory-inference',()=>({MemoryInference:class{token='fixture-token';start=vi.fn(async()=> 'http://127.0.0.1:1234/v1');close=vi.fn(()=>{})}}))
vi.mock('./docker',()=>({DockerBridge:class{}}))
vi.mock('./settings',()=>({credentialFor:()=>({}),getKey:vi.fn(()=> 'old-key'),saveKey:vi.fn(),clearKey:vi.fn()}))
import {HindsightMemory} from './hindsight-memory'
import {getKey,saveKey} from './settings'
import type {Fieldnote} from '../shared/fieldnotes'
const roots:string[]=[]
const memories:HindsightMemory[]=[]
afterEach(async()=>{for(const memory of memories.splice(0))await memory.stop();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function setup(){const root=await mkdtemp(join(tmpdir(),'unrealcode-memory-unit-'));roots.push(root);const memory=new HindsightMemory(root);memories.push(memory);await memory.status('project');(memory as any).value.settings={version:1,enabled:true,projects:['project']};return memory}
const record={sessionId:'session',turnId:'turn',workspace:'project',content:'Verified test report',sourceRefs:['event:4'],createdAt:new Date().toISOString()}
const profile={provider:'ollama' as const,model:'fixture',baseUrl:'',thinkingLevel:'low',requestLimit:20,tokenLimit:10000}
const fieldnote=(project='new-project',revision=1):Fieldnote=>({id:'11111111-1111-4111-8111-111111111111',revision,title:'Authored guidance',body:'Keep verified outcomes.',pointer:{projectId:'22222222-2222-4222-8222-222222222222',projectPath:project,projectName:project},enabled:true,indexing:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sync:{state:'retaining',attempts:1}})
it('persists the first Fieldnote in a project without prior memory records',async()=>{
 const memory=await setup();(memory as any).value.settings={version:2,enabled:true,globalConsent:true,projects:[]};memory.fieldnoteValidity=()=>true
 const note=fieldnote();await memory.retainFieldnote(note)
 expect((await memory.status('')).records).toHaveLength(1)
 await vi.waitFor(async()=>expect(await memory.fieldnoteState(note.id,1)).toBe('retained'))
})
it('moves Fieldnote attribution without leaving two conflicting outbox records',async()=>{
 const memory=await setup();(memory as any).value.settings={version:2,enabled:true,globalConsent:true,projects:[]};memory.fieldnoteValidity=()=>true
 const original=fieldnote('project');await memory.retainFieldnote(original)
 await vi.waitFor(async()=>expect(await memory.fieldnoteState(original.id,1)).toBe('retained'))
 await memory.retainFieldnote(fieldnote('other-project',2))
 const records=(await memory.status('')).records
 expect(records).toHaveLength(1);expect(records[0]).toMatchObject({sourceProject:'other-project',fieldnote:{id:original.id,revision:2}})
 await vi.waitFor(async()=>expect(await memory.fieldnoteState(original.id,2)).toBe('retained'))
})
it('keeps the usable memory profile when a proposed destination fails verification or startup',async()=>{
 const memory=await setup(),value=(memory as any).value
 value.settings={version:2,enabled:true,globalConsent:true,projects:[],profile,verifiedProfile:(memory as any).fingerprint(profile)}
 const proposed={...profile,model:'replacement'}
 const probe=vi.spyOn(memory as any,'probeProfile').mockRejectedValueOnce(Error('model unavailable'))
 await expect(memory.switchVerified(proposed)).rejects.toThrow('model unavailable')
 expect((await memory.status('')).settings).toMatchObject({profile,enabled:true,globalConsent:true})
 probe.mockResolvedValue(undefined)
 vi.spyOn(memory,'stop').mockResolvedValue()
 const start=vi.spyOn(memory,'start').mockRejectedValueOnce(Error('service unavailable')).mockResolvedValue()
 await expect(memory.switchVerified(proposed)).rejects.toThrow('previous profile and knowledge were restored')
 expect((await memory.status('')).settings).toMatchObject({profile,enabled:true,globalConsent:true})
 expect(start).toHaveBeenCalledTimes(2)
})
it('stages a replacement provider key and restores the old key if service startup fails',async()=>{
 const memory=await setup(),value=(memory as any).value,old={...profile,provider:'openai' as const}
 value.settings={version:2,enabled:true,globalConsent:true,projects:[],profile:old,verifiedProfile:(memory as any).fingerprint(old)}
 vi.spyOn(memory as any,'probeProfile').mockResolvedValue(undefined)
 vi.spyOn(memory,'stop').mockResolvedValue();vi.spyOn(memory,'start').mockRejectedValueOnce(Error('offline')).mockResolvedValue()
 await expect(memory.switchVerified({...old,model:'new-model'},'candidate-key')).rejects.toThrow('previous profile and knowledge were restored')
 expect(vi.mocked(saveKey).mock.calls.slice(-2)).toEqual([['openai','candidate-key'],['openai','old-key']])
 expect(vi.mocked(getKey)).toHaveBeenCalledWith('openai')
 expect((await memory.status('')).settings.profile).toEqual(old)
})
it('discards queued timeline inference before dispatch when memory is disabled',async()=>{
 const memory=await setup(),value=(memory as any).value
 value.settings={version:2,enabled:true,globalConsent:true,projects:[],profile,verifiedProfile:(memory as any).fingerprint(profile)}
 let release!:(value:any)=>void;const request=vi.fn(async()=>({Output:[],Usage:{}}))
 vi.spyOn(memory as any,'inferenceBridge').mockImplementation(()=>new Promise(resolve=>release=resolve))
 const result=memory.analyse('synthetic evidence');const rejected=expect(result).rejects.toThrow('configuration changed')
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await memory.enable('',false);release({request});await rejected
 expect(request).not.toHaveBeenCalled()
})
it('reingests promoted worker knowledge when its private-bank save finishes late',async()=>{
 const memory=await setup(),value=(memory as any).value;value.settings={version:2,enabled:true,globalConsent:true,projects:[]}
 let release!:()=>void
 vi.mocked(memory.runtime.request).mockImplementationOnce(async()=>{await new Promise<void>(resolve=>release=resolve);return {}})
 await memory.record('project',{...record,workspace:'worker-workspace',scope:'task'})
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 await memory.promoteWorkspace('worker-workspace');release()
 await vi.waitFor(async()=>expect((await memory.status('')).records[0]).toMatchObject({state:'retained',scope:'shared'}))
 const saves=vi.mocked(memory.runtime.request).mock.calls.filter(call=>call[0]==='POST')
 expect(saves).toHaveLength(2);expect(saves[1][1]).not.toBe(saves[0][1])
 expect((saves[1][3] as any).items[0].metadata.scope).toBe('shared')
})
it('rejects corrections to forgotten sources even while remote deletion is pending',async()=>{
 const memory=await setup(),value=(memory as any).value
 value.records.project=[{...record,id:'forgotten',content:'',state:'forgotten',attempts:3,deletionPending:true,revision:2}]
 await expect(memory.correct('project','forgotten','Restore removed content')).rejects.toThrow('Forgotten memory')
 expect((await memory.readRecord('project','forgotten'))).toMatchObject({content:'',state:'forgotten',deletionPending:true,revision:2})
 expect(memory.runtime.request).not.toHaveBeenCalled()
})
it('requires each project to enable a replacement memory profile independently',async()=>{
 const memory=await setup();(memory as any).value.settings.projects=['project','other']
 vi.spyOn(memory,'stop').mockResolvedValue();vi.spyOn(memory,'start').mockResolvedValue()
 await memory.configure(profile);(memory as any).value.settings.verifiedProfile=(memory as any).fingerprint(profile)
 await memory.enable('project',true)
 expect((await memory.status('other')).settings.projects).toEqual(['project'])
})
it('reflects only over a fresh bank of eligible source contents and removes that bank afterwards',async()=>{
 const memory=await setup(),value=(memory as any).value;value.settings.profile=profile
 value.records.project=[{...record,id:'safe',state:'retained',attempts:0},{...record,id:'forgotten',content:'PRIVATE_DELETED',state:'forgotten',attempts:3,deletionPending:true},{...record,id:'worker',content:'PRIVATE_WORKER',workspace:'worker',state:'retained',attempts:0}]
 vi.mocked(memory.runtime.request).mockImplementation(async(_method,_bank,suffix)=>suffix==='/memories/recall'?{results:[{document_id:'safe'},{document_id:'forgotten'},{document_id:'worker'}]}:suffix==='/reflect'?{text:'Safe result'}:{})
 const result=await memory.reflect('project','Summarize','project')
 const retain=vi.mocked(memory.runtime.request).mock.calls.find(call=>call[2]==='/memories')!
 expect(JSON.stringify(retain[3])).toContain('Verified test report');expect(JSON.stringify(retain[3])).not.toContain('PRIVATE')
 expect(retain[1]).toMatch(/-reflect-[a-f0-9]{32}$/)
 expect(vi.mocked(memory.runtime.request).mock.calls.at(-1)).toEqual(['DELETE',retain[1],''])
 expect(result.text).toBe('Safe result')
})
it('discards reflection if a source is forgotten during generation',async()=>{
 const memory=await setup(),value=(memory as any).value;value.settings.profile=profile;value.records.project=[{...record,id:'safe',state:'retained',attempts:0}]
 vi.mocked(memory.runtime.request).mockImplementation(async(_method,_bank,suffix)=>{if(suffix==='/memories/recall')return {results:[{document_id:'safe'}]};if(suffix==='/reflect'){value.records.project[0].state='forgotten';return {text:'stale'}};return {}})
 await expect(memory.reflect('project','Summarize')).rejects.toThrow('discarded')
 expect(vi.mocked(memory.runtime.request).mock.calls.at(-1)?.[0]).toBe('DELETE')
})
it('reconciles a reflection bank already removed before its cleanup journal was saved',async()=>{
 const memory=await setup(),value=(memory as any).value;value.settings.profile=profile;value.reflectionBanks=['project-test-reflect-'+'a'.repeat(32)]
 vi.mocked(memory.runtime.request).mockImplementation(async(method)=>{if(method==='DELETE')throw Error('Hindsight HTTP 404');return {results:[]}})
 await memory.reflect('project','Check cleanup')
 expect(value.reflectionBanks).toEqual([])
})
it('deduplicates canonical turns and never recalls forgotten, foreign or unregistered sources',async()=>{
 const memory=await setup();const scoped={...record,workspace:'worker-workspace'};await memory.record('project',scoped);await vi.waitFor(async()=>expect((await memory.status('project')).records[0].state).toBe('retained'))
 await memory.record('project',scoped);const id=(await memory.status('project')).records[0].id
 vi.mocked(memory.runtime.request).mockResolvedValue({results:[{document_id:id,text:'retained'},{document_id:'foreign',text:'reject'}]})
 expect((await memory.recall('project','test','worker-workspace') as any).results).toHaveLength(1)
 expect((await memory.recall('project','test','other-workspace') as any).results).toHaveLength(0)
 await memory.forget('project',id)
 expect((await memory.recall('project','test','project') as any).results).toHaveLength(0)
 expect((await memory.status('project')).records).toHaveLength(1)
})
it('does not reject committed memory when its renderer notification fails',async()=>{
 const memory=await setup()
 memory.onChanged=()=>{throw Error('renderer closed')}
 await memory.record('project',record)
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0].state).toBe('retained'))
 expect((await memory.status('project')).records).toHaveLength(1)
})
it('discards a recall that crosses a correction and verifies returned source revisions',async()=>{
 const memory=await setup()
 await memory.record('project',record)
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0].state).toBe('retained'))
 const id=(await memory.status('project')).records[0].id
 let release!:(value:unknown)=>void
 vi.mocked(memory.runtime.request).mockImplementation(async(_method,_bank,path)=>path==='/memories/recall'?await new Promise(resolve=>{release=resolve}):{})
 const pending=memory.recall('project','test','project')
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 await memory.correct('project',id,'Corrected evidence')
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0]).toMatchObject({state:'retained',revision:1}))
 release({results:[{document_id:id,text:'Old advice',metadata:{revision:'0'}}]})
 expect((await pending as any).results).toEqual([])
 vi.mocked(memory.runtime.request).mockResolvedValue({results:[{document_id:id,text:'Old advice',metadata:{revision:'0'}}]})
 expect((await memory.recall('project','test','project') as any).results).toEqual([])
 vi.mocked(memory.runtime.request).mockResolvedValue({results:[{document_id:id,text:'Unverifiable generated advice'}]})
 expect((await memory.recall('project','test','project') as any).results[0].text).toBe('Corrected evidence')
})
it('reconciles a deletion made while retention is in flight',async()=>{
 const memory=await setup();let release!:()=>void
 vi.mocked(memory.runtime.request).mockImplementation(async(method)=>{if(method==='POST')await new Promise<void>(resolve=>release=resolve);return {}})
 await memory.record('project',record);await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 const id=(await memory.status('project')).records[0].id;await memory.forget('project',id);release()
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0]).toMatchObject({state:'forgotten',deletionPending:false,content:''}))
 expect(vi.mocked(memory.runtime.request).mock.calls.map(call=>call[0])).toEqual(['POST','DELETE'])
})
it('retains the latest correction when an older request finishes afterwards',async()=>{
 const memory=await setup();let release!:()=>void
 vi.mocked(memory.runtime.request).mockImplementationOnce(async()=>{await new Promise<void>(resolve=>release=resolve);return {}})
 await memory.record('project',record);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const id=(await memory.status('project')).records[0].id
 await memory.correct('project',id,'Corrected evidence');release()
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0]).toMatchObject({state:'retained',content:'Corrected evidence',revision:1}))
 expect((vi.mocked(memory.runtime.request).mock.calls.at(-1)![3] as any).items[0].content).toBe('Corrected evidence')
})
it('marks recalled evidence stale when its captured source file changes',async()=>{
 const memory=await setup(),workspace=roots.at(-1)!,path=join(workspace,'source.txt');await writeFile(path,'before')
 await memory.record('project',{...record,workspace,sourceFiles:[{path:'source.txt',sha256:createHash('sha256').update('before').digest('hex')}]})
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0].state).toBe('retained'));const id=(await memory.status('project')).records[0].id
 vi.mocked(memory.runtime.request).mockResolvedValue({results:[{document_id:id,text:'Historical evidence'}]})
 expect((await memory.recall('project','evidence',workspace) as any).results[0].freshness).toBe('captured-files-unchanged')
 await writeFile(path,'later edit');expect((await memory.recall('project','evidence',workspace) as any).results[0]).toMatchObject({freshness:'stale',changedSources:['source.txt']})
})
it('retries only an enabled, verified project without resetting its records',async()=>{
 const memory=await setup(),profile={provider:'ollama',model:'fixture-model',baseUrl:'',thinkingLevel:'low',requestLimit:10,tokenLimit:1000}
 const value=(memory as any).value;value.settings.profile=profile;value.settings.verifiedProfile=(memory as any).fingerprint(profile)
 const start=vi.spyOn(memory,'start').mockResolvedValue()
 await expect(memory.retry('other-project')).rejects.toThrow('Enable memory for this project')
 expect(start).not.toHaveBeenCalled()
 await memory.retry('project')
 expect(start).toHaveBeenCalledTimes(1)
 expect(value.settings.projects).toEqual(['project'])
})
it('does not let a failed deletion block retention of a later turn',async()=>{
 const memory=await setup()
 await memory.record('project',record)
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0].state).toBe('retained'))
 const id=(await memory.status('project')).records[0].id
 vi.mocked(memory.runtime.request).mockImplementation(async(method)=>{if(method==='DELETE')throw Error('Hindsight HTTP 503');return {}})
 await memory.forget('project',id)
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0].attempts).toBeGreaterThan(0))
 await memory.record('project',{...record,turnId:'later-turn'})
 await vi.waitFor(async()=>expect((await memory.status('project')).records.find(row=>row.turnId==='later-turn')?.state).toBe('retained'))
 const forgotten=(await memory.status('project')).records.find(row=>row.id===id)!
 expect(forgotten).toMatchObject({state:'forgotten',deletionPending:true})
 expect(forgotten.error).toContain('HTTP 503')
 expect(forgotten.attempts).toBeLessThanOrEqual(3)
})
it('leaves an exhausted tombstone visible while processing new records',async()=>{
 const memory=await setup(),value=(memory as any).value
 value.records.project=[{...record,id:'turn-old',state:'forgotten',content:'',attempts:3,deletionPending:true,revision:1,error:'Previous delete failed'}]
 await memory.record('project',{...record,turnId:'new-turn'})
 await vi.waitFor(async()=>expect((await memory.status('project')).records.find(row=>row.turnId==='new-turn')?.state).toBe('retained'))
 expect(vi.mocked(memory.runtime.request).mock.calls.some(call=>call[0]==='DELETE')).toBe(false)
 expect((await memory.status('project')).records[0].deletionPending).toBe(true)
})
it('drains a persisted outbox after automatic runtime startup',async()=>{
 const memory=await setup(),profile={provider:'ollama',model:'fixture-model',baseUrl:'',thinkingLevel:'low',requestLimit:10,tokenLimit:1000}
 const value=(memory as any).value;value.settings.profile=profile;value.settings.verifiedProfile=(memory as any).fingerprint(profile)
 memory.runtime.state='disabled'
 await memory.record('project',record)
 expect((await memory.status('project')).records[0].state).toBe('pending')
 await memory.start()
 await vi.waitFor(async()=>expect((await memory.status('project')).records[0].state).toBe('retained'))
})
it('waits for an in-flight outbox write before stopping',async()=>{
 const memory=await setup();let release!:()=>void
 vi.mocked(memory.runtime.request).mockImplementationOnce(async()=>{await new Promise<void>(resolve=>release=resolve);return {}})
 await memory.record('project',record)
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 let settled=false;const stopped=memory.stop().then(()=>{settled=true})
 await Promise.resolve();expect(settled).toBe(false)
 release();await stopped
 expect((await memory.status('project')).records[0].state).toBe('retained')
})
it('keeps an outbox item retryable when the memory runtime stops mid-request',async()=>{
 const memory=await setup()
 vi.mocked(memory.runtime.request).mockImplementationOnce(async()=>{memory.runtime.state='disabled';throw Error('Memory runtime stopped before the request completed')})
 await memory.record('project',record)
 await (memory as any).drainTask
 expect((await memory.status('project')).records[0]).toMatchObject({state:'pending',attempts:0})
})
it('bounds status payloads while paging every older project record by stable ID',async()=>{
 const memory=await setup(),rows=Array.from({length:125},(_,index)=>({...record,id:`turn-${index}`,turnId:`turn-${index}`,content:'x'.repeat(1000),state:'retained' as const,attempts:0}))
 ;(memory as any).value.records.project=rows
 const status=await memory.status('project')
 expect(status.totalRecords).toBe(125)
 expect(status.records).toHaveLength(50)
 expect(status.records[0].id).toBe('turn-75')
 expect((await memory.status('project',0)).records).toEqual([])
 const middle=await memory.recordsPage('project',status.records[0].id)
 expect(middle.records.map(row=>row.id)).toEqual(rows.slice(25,75).map(row=>row.id))
 expect(middle.olderCursor).toBe('turn-25')
 const oldest=await memory.recordsPage('project',middle.olderCursor)
 expect(oldest.records.map(row=>row.id)).toEqual(rows.slice(0,25).map(row=>row.id))
 expect(oldest.olderCursor).toBeUndefined()
 expect((await memory.readRecord('project','turn-0')).content).toHaveLength(1000)
 await expect(memory.readRecord('other-project','turn-0')).rejects.toThrow('unavailable in this project')
 await expect(memory.recordsPage('project','missing')).rejects.toThrow('cursor is stale')
 await expect(memory.status('project',101)).rejects.toThrow('0 to 100')
})

async function globalSetup(){
 const root=await mkdtemp(join(tmpdir(),'unrealcode-global-memory-'));roots.push(root);const memory=new HindsightMemory(root);await memory.status('')
 const state=(memory as any).value;state.settings={version:2,enabled:true,globalConsent:true,projects:[],profile,verifiedProfile:(memory as any).fingerprint(profile)}
 return memory
}
it('shares project knowledge with provenance while isolating unintegrated workers',async()=>{
 const memory=await globalSetup()
 await memory.record('one',{...record,workspace:'one'});await memory.record('two',{...record,workspace:'two',turnId:'second'});await memory.record('one',{...record,workspace:'worker',turnId:'worker'})
 await vi.waitFor(async()=>expect((await memory.status('')).records.every(row=>row.state==='retained')).toBe(true))
 const rows=(await memory.status('')).records
 vi.mocked(memory.runtime.request).mockResolvedValue({results:rows.map(row=>({document_id:row.id,text:row.content}))})
 const result=await memory.recall('two','What worked?','two') as any
 expect(result.results.map((row:any)=>row.source.sourceProject).sort()).toEqual(['one','two'])
 expect(result.results.find((row:any)=>row.source.sourceProject==='one').freshness).toBe('unknown')
 await memory.promoteWorkspace('worker');await vi.waitFor(async()=>expect((await memory.status('')).records.find(row=>row.workspace==='worker')?.state).toBe('retained'))
 expect((await memory.recall('two','What worked?','two') as any).results).toHaveLength(3)
})
it('backs up and journals legacy migration, preserving corrections and tombstones',async()=>{
 const {mkdir,readFile}=await import('node:fs/promises'),root=await mkdtemp(join(tmpdir(),'unrealcode-memory-migrate-'));roots.push(root)
 const memory=new HindsightMemory(root);await mkdir(memory.directory,{recursive:true})
 const old={version:1,settings:{version:1,enabled:true,projects:['one'],profile,verifiedProfile:(memory as any).fingerprint(profile)},banks:{one:'old-bank'},records:{one:[{...record,workspace:'one',id:'old',state:'retained',attempts:0,correction:true,revision:3},{...record,workspace:'one',id:'forgot',state:'forgotten',content:'',attempts:0,deletionPending:true}]},usage:{inputTokens:0,outputTokens:0,requests:0}}
 await writeFile(join(memory.directory,'memory.json'),JSON.stringify(old))
 const migrated=await memory.status('')
 expect(migrated.settings).toMatchObject({version:2,enabled:false,globalConsent:false});expect(JSON.parse(await readFile(migrated.migration!.backup,'utf8'))).toEqual(old)
 vi.spyOn(memory,'start').mockResolvedValue();await memory.enable('',true)
 await vi.waitFor(async()=>expect((await memory.status('')).migration?.state).toBe('complete'))
 expect((await memory.readRecord('','old'))).toMatchObject({id:'old',correction:true,revision:3,sourceProject:'one',state:'retained'})
 expect((await memory.readRecord('','forgot'))).toMatchObject({state:'forgotten',content:'',deletionPending:false})
 const reopened=new HindsightMemory(root);expect((await reopened.status('')).records).toHaveLength(2)
 expect(vi.mocked(memory.runtime.request).mock.calls.some(call=>call[0]==='DELETE'&&call[1]==='old-bank')).toBe(true)
})
it('discards recall when app-wide memory is revoked in flight',async()=>{
 const memory=await globalSetup();await memory.record('one',{...record,workspace:'one'});await vi.waitFor(async()=>expect((await memory.status('')).records[0].state).toBe('retained'))
 let release!:(value:any)=>void;vi.mocked(memory.runtime.request).mockImplementation(()=>new Promise(resolve=>release=resolve))
 const pending=memory.recall('two','Recall','two');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));vi.spyOn(memory,'stop').mockImplementation(async()=>{(memory as any).epoch++});await memory.enable('',false);release({results:[]})
 expect((await pending as any).unavailable).toBe(true)
})
it('preserves global enablement intent and knowledge when changing model destination',async()=>{
 const memory=await globalSetup();vi.spyOn(memory,'stop').mockResolvedValue()
 await memory.record('one',{...record,workspace:'one'});await vi.waitFor(async()=>expect((await memory.status('')).records[0].state).toBe('retained'))
 await memory.configure({...profile,model:'replacement'})
 expect((await memory.status('')).settings).toMatchObject({enabled:true,globalConsent:false,verifiedProfile:undefined})
 expect((await memory.status('')).records).toHaveLength(1)
})
it('bounds background references and withdraws them when their source is forgotten',async()=>{
 const memory=await globalSetup();await memory.record('one',{...record,workspace:'one',content:'Source knowledge '.repeat(1500)})
 await vi.waitFor(async()=>expect((await memory.status('')).records[0].state).toBe('retained'))
 const source=(await memory.status('')).records[0]
 vi.mocked(memory.runtime.request).mockResolvedValue({results:[{document_id:source.id,text:'Arabic knowledge '.repeat(1000),metadata:{revision:String(source.revision||0)}}]})
 const recall=await memory.backgroundRecall('two','Recall','two')
 expect(Buffer.byteLength(recall.text)).toBeLessThan(7000)
 expect(JSON.parse(recall.text).results[0]).toMatchObject({sourceProject:'one',sessionId:record.sessionId})
 expect(await recall.valid()).toBe(true)
 await memory.forget('',source.id);expect(await recall.valid()).toBe(false)
})
