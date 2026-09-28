import { afterEach,it,expect,vi } from 'vitest'
import { mkdtemp,writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import { HostOperations,stableJSON } from './host-operations'

const operation=()=>({requestId:randomUUID(),sessionId:randomUUID(),operationId:randomUUID(),workspaceId:'workspace-a',tool:'mcp_fixture',arguments:{value:'hello'}})
afterEach(()=>vi.restoreAllMocks())
it('binds host approval to project/session/arguments and prevents duplicate external actions',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-host-gate-')),'calls.json'),gate=new HostOperations(path),op=operation();let calls=0
 const pending=gate.run('project-a',op,'server/tool',async()=>{calls++;return{text:'done'}})
 const approval=gate.approvals('project-a',op.sessionId)[0]
 expect(()=>gate.respond('project-b',op.sessionId,approval.id,approval.digest,true)).toThrow('expired')
 expect(()=>gate.respond('project-a',op.sessionId,approval.id,'changed',true)).toThrow('expired')
 gate.respond('project-a',op.sessionId,approval.id,approval.digest,true)
 expect(await pending).toEqual({text:'done'});expect(calls).toBe(1)
 expect(await new HostOperations(path).run('project-a',{...op,requestId:randomUUID()},'server/tool',async()=>{calls++;return{text:'duplicate'}})).toEqual({text:'done'})
 expect(calls).toBe(1)
 await expect(gate.run('project-a',{...op,arguments:{value:'changed'}},'server/tool',async()=>({text:'bad'}))).rejects.toThrow('arguments changed')
})
it('cancels only the selected pending host call and invalidates its approval',async()=>{
 const gate=new HostOperations(join(await mkdtemp(join(tmpdir(),'unrealcode-host-cancel-')),'calls.json')),a=operation(),b=operation()
 const first=gate.run('p',a,'target',async()=>({text:'a'})),second=gate.run('p',b,'target',async()=>({text:'b'}))
 const approval=gate.approvals('p',a.sessionId)[0];gate.cancel('p',a.sessionId,a.operationId)
 expect((await first).error).toBe(true);expect(gate.approvals('p',b.sessionId)).toHaveLength(1)
 expect(()=>gate.respond('p',a.sessionId,approval.id,approval.digest,true)).toThrow()
 gate.cancelAll();expect((await second).error).toBe(true)
})
it('keeps a pending approval valid when the renderer notification throws',async()=>{
 const gate=new HostOperations(join(await mkdtemp(join(tmpdir(),'unrealcode-host-notify-')),'calls.json')),op=operation()
 gate.onChanged=()=>{throw Error('renderer closed')}
 const pending=gate.run('project',op,'server/tool',async()=>({text:'completed'}))
 const approval=gate.approvals('project',op.sessionId)[0]
 expect(approval).toBeDefined()
 gate.respond('project',op.sessionId,approval.id,approval.digest,true)
 expect(await pending).toEqual({text:'completed'})
 expect(gate.approvals('project',op.sessionId)).toEqual([])
})
it('refuses to replay a host action whose outcome was lost on restart',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-host-restart-')),'calls.json'),op=operation(),project='p',target='t'
 const {requestId:_,...identity}=op,digest=createHash('sha256').update(stableJSON({project,...identity,target})).digest('hex')
 await writeFile(path,JSON.stringify({[stableJSON([project,op.sessionId,op.operationId])]:{digest,status:'started'}}))
 await expect(new HostOperations(path).run(project,op,target,async()=>({text:'should not run'}))).rejects.toThrow('may have executed')
})
it('rejects malformed saved host-call records without changing the file',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-host-damaged-')),'calls.json'),original=JSON.stringify({'not-an-operation':{status:'finished',result:{text:'unbound'}}})
 await writeFile(path,original)
 expect(()=>new HostOperations(path)).toThrow('Invalid saved host operation')
 expect(await readFile(path,'utf8')).toBe(original)
})
it('allows a fresh approval after the pre-execution record failed to save',async()=>{
 const gate=new HostOperations(join(await mkdtemp(join(tmpdir(),'unrealcode-host-save-before-')),'calls.json')),op=operation()
 const execute=vi.fn(async()=>({text:'done'}))
 vi.spyOn(gate as any,'save').mockImplementationOnce(()=>{throw Error('disk full')})
 const first=gate.run('project',op,'server/tool',execute)
 let approval=gate.approvals('project',op.sessionId)[0]
 gate.respond('project',op.sessionId,approval.id,approval.digest,true)
 await expect(first).rejects.toThrow('disk full')
 expect(execute).not.toHaveBeenCalled()
 const second=gate.run('project',op,'server/tool',execute)
 void second.catch(()=>{})
 approval=gate.approvals('project',op.sessionId)[0]
 expect(approval).toBeDefined()
 gate.respond('project',op.sessionId,approval.id,approval.digest,true)
 expect(await second).toEqual({text:'done'})
})
it('retains an uncertain started record if saving the external result fails',async()=>{
 const gate=new HostOperations(join(await mkdtemp(join(tmpdir(),'unrealcode-host-save-after-')),'calls.json')),op=operation()
 const original=(gate as any).save.bind(gate)
 vi.spyOn(gate as any,'save').mockImplementationOnce(original).mockImplementationOnce(()=>{throw Error('disk full')})
 const first=gate.run('project',op,'server/tool',async()=>({text:'external result'}))
 const approval=gate.approvals('project',op.sessionId)[0]
 gate.respond('project',op.sessionId,approval.id,approval.digest,true)
 await expect(first).rejects.toThrow('disk full')
 await expect(gate.run('project',op,'server/tool',async()=>({text:'duplicate'}))).rejects.toThrow('may have executed')
})
