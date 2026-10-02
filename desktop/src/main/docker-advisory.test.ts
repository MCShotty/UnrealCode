import {afterEach,expect,it,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
const mocks=vi.hoisted(()=>({spawn:vi.fn()}))
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),spawn:mocks.spawn}))
vi.mock('electron',()=>({app:{isPackaged:false,getVersion:()=> 'fixture',getPath:()=>tmpdir()}}))
import {DockerBridge} from './docker'
const capabilities=['permissions.v1','files.v1','sessions.v1','mcp.v1','context.v1','teams.v1','verification.v1','history.latest.v1','lifecycle.v1','controls.v1','inference.v1','hooks.v1','goal.usage.v1','questions.v2','provider.issue.v1','plan.progress.v1','decision.browser.v1','response.preview.v1','documents.v1','browser.shared.v1','fieldnotes.v1','computer.v1','async_advisory_v1']
const children:any[]=[],roots:string[]=[]
afterEach(async()=>{for(const child of children.splice(0))child.emit('exit',0);vi.restoreAllMocks();mocks.spawn.mockReset();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
function childFixture(){
 const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.killed=false;child.exitCode=null
 child.kill=()=>{child.killed=true;return true}
 child.sent=[];child.stdin={writable:true,end:()=>{},write:(text:string,done:(error?:Error)=>void)=>{
  const value=JSON.parse(text);child.sent.push(value);const result=value.method==='health'?{version:1,capabilities}:value.method==='decision.status'?{engine:'off',available:false,message:'Choose engine',glinerAvailable:false}:{}
  queueMicrotask(()=>child.stdout.emit('data',Buffer.from(JSON.stringify({v:1,id:value.id,ok:true,result})+'\n')));done?.()
 }}
 children.push(child);return child
}
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'unrealcode-bridge-'));roots.push(root)
 const bridge=new DockerBridge(),boundary=bridge as any
 vi.spyOn(boundary,'docker').mockImplementation(async(...args:unknown[])=>(args[0] as string[])[0]==='info'?'linux':'')
 vi.spyOn(boundary,'ensureImage').mockResolvedValue(undefined)
 vi.spyOn(boundary,'migrateStateVolume').mockResolvedValue(undefined)
 const child=childFixture();mocks.spawn.mockReturnValueOnce(child)
 await bridge.start(root)
 return {bridge,boundary,child,root}
}
it('ignores old stdout and exits after a new backend has taken ownership',async()=>{
 const {bridge,child,root}=await setup(),next=childFixture();mocks.spawn.mockReturnValueOnce(next)
 await bridge.start(root)
 const seen:unknown[]=[];bridge.onEvent=event=>seen.push(event)
 child.stdout.emit('data',Buffer.from(JSON.stringify({event:'session.idle',sessionId:randomUUID(),seq:1})+'\n'));child.emit('exit',1)
 expect(bridge.status().ready).toBe(true);expect(seen).toHaveLength(0)
 await bridge.request('decision.status',{});expect(next.sent.at(-1).method).toBe('decision.status')
 await bridge.stop()
})
it('keeps Arabic text intact when a bridge chunk splits a UTF-8 character',async()=>{
 const {bridge,child}=await setup(),seen:any[]=[];bridge.onEvent=event=>seen.push(event)
 const bytes=Buffer.from(JSON.stringify({v:1,event:'model.response.preview',seq:0,sessionId:randomUUID(),payload:{text:'مرحبا'}})+'\n'),split=bytes.indexOf(Buffer.from('م'))+1
 child.stdout.emit('data',bytes.subarray(0,split));child.stdout.emit('data',bytes.subarray(split))
 expect(seen[0].payload.text).toBe('مرحبا');await bridge.stop()
})
it('withholds keys and reports unavailable advice on an older backend',async()=>{
 const {bridge,boundary,child}=await setup();boundary.advisoryCapability=false
 await bridge.request('decision.configure',{engine:'jev',model:'fixture',apiKey:'fixture-secret'})
 expect(child.sent.at(-1).params).toMatchObject({engine:'off',apiKey:''})
 const status:any=await bridge.request('decision.status',{});expect(status).toMatchObject({available:false,asyncAdvice:'unavailable'});expect(status.message).toContain('rebuilt backend')
 await bridge.stop()
})
