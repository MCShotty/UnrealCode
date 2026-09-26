import { it,expect } from 'vitest'
import { mkdtemp,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import { HostOperations,stableJSON } from './host-operations'

const operation=()=>({requestId:randomUUID(),sessionId:randomUUID(),operationId:randomUUID(),workspaceId:'workspace-a',tool:'mcp_fixture',arguments:{value:'hello'}})
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
it('refuses to replay a host action whose outcome was lost on restart',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-host-restart-')),'calls.json'),op=operation(),project='p',target='t'
 const {requestId:_,...identity}=op,digest=createHash('sha256').update(stableJSON({project,...identity,target})).digest('hex')
 await writeFile(path,JSON.stringify({[stableJSON([project,op.sessionId,op.operationId])]:{digest,status:'started'}}))
 await expect(new HostOperations(path).run(project,op,target,async()=>({text:'should not run'}))).rejects.toThrow('may have executed')
})
