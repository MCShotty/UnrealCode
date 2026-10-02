import {afterEach,expect,it,vi} from 'vitest'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
vi.mock('electron',()=>({app:{isPackaged:false,getVersion:()=> 'test'}}))
vi.mock('./settings',()=>({getSettings:()=>({autoCompaction:false}),credentialFor:async()=>({})}))
import {WorkspaceRuntime} from './workspace-runtime'
import {closeHistoryCaches} from './history-cache'
import type {MemoryRecall,AdvisoryBinding} from '../shared/advisory'
const roots:string[]=[],owners:WorkspaceRuntime[]=[]
afterEach(async()=>{for(const owner of owners.splice(0))await owner.stopAll().catch(()=>{});await closeHistoryCaches();vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}}
async function fixture(recall:()=>Promise<MemoryRecall>){
 const root=await mkdtemp(join(tmpdir(),'unrealcode-async-'));roots.push(root);const project=join(root,'project');await mkdir(project)
 const owner=new WorkspaceRuntime(project,join(root,'profile'),{event:()=>{},changed:()=>{},notify:()=>{},configure:async()=>{},hasTerminal:()=>false,recall});owners.push(owner)
 const session=randomUUID(),run=randomUUID();let generation=0
 vi.spyOn(owner,'owner').mockResolvedValue(owner)
 vi.spyOn(owner,'credential').mockResolvedValue({})
 vi.spyOn(owner.context,'prepare').mockResolvedValue({files:[],text:''} as any)
 vi.spyOn(owner.checkpoints,'send').mockImplementation(async(_s,_m,_p,send)=>{await send();return undefined as any})
 const requests=vi.spyOn(owner.bridge,'request').mockImplementation(async(method,params)=>{
  if(method==='session.send'){const p=params as {messageId:string};const binding:AdvisoryBinding={projectId:project,workspaceId:project,sessionId:session,runId:run,sourceInputId:p.messageId,requestGeneration:++generation,decisionGeneration:1,contextRevision:1};return {messageId:p.messageId,advisoryBinding:binding} as any}
  return undefined as any
 })
 return {owner,session,requests}
}
it('accepts sends and stop before memory settles; late recall cannot resurrect work',async()=>{
 const gate=deferred<MemoryRecall>(),recall=vi.fn(()=>gate.promise),{owner,session,requests}=await fixture(recall)
 await owner.send(session,'Implement something',randomUUID())
 expect(requests.mock.calls.map(call=>call[0])).toEqual(['session.send'])
 await owner.stop(session);expect(requests.mock.calls.at(-1)?.[0]).toBe('session.stop')
 gate.resolve({text:'late memory',valid:async()=>true});await new Promise(r=>setImmediate(r))
 expect(requests.mock.calls.filter(call=>call[0]==='advisory.deliver')).toHaveLength(0)
})
it('coalesces rapid steering and delivers only the latest valid recall',async()=>{
 const first=deferred<MemoryRecall>(),second=deferred<MemoryRecall>(),recall=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
 const {owner,session,requests}=await fixture(recall),latest=randomUUID()
 await owner.send(session,'First',randomUUID());await owner.send(session,'Replaced pending',randomUUID());await owner.send(session,'Latest',latest)
 expect(recall).toHaveBeenCalledTimes(1)
 first.resolve({text:'stale',valid:async()=>true});await new Promise(r=>setImmediate(r));expect(recall).toHaveBeenCalledTimes(2)
 second.resolve({text:'current reference',valid:async()=>true});await new Promise(r=>setImmediate(r))
 const deliveries=requests.mock.calls.filter(call=>call[0]==='advisory.deliver');expect(deliveries).toHaveLength(1)
 expect((deliveries[0][1] as any).value.binding.sourceInputId).toBe(latest)
})
it('rejects withdrawn recall and never analyses a native-content request',async()=>{
 const gate=deferred<MemoryRecall>(),recall=vi.fn(()=>gate.promise),{owner,session,requests}=await fixture(recall)
 await owner.send(session,'Native request',randomUUID(),false,[],undefined,true);expect(recall).not.toHaveBeenCalled()
 await owner.send(session,'Normal request',randomUUID());gate.resolve({text:'withdrawn',valid:async()=>false});await new Promise(r=>setImmediate(r))
 expect(requests.mock.calls.filter(call=>call[0]==='advisory.deliver')).toHaveLength(0)
})
