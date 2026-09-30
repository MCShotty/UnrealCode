import {afterEach,expect,it,vi} from 'vitest'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {ComputerManager} from './computer'
import {assertReviewedComputerDestination,routineComputerAction,validComputerAction} from './computer-policy'
import type {ComputerObservation,ComputerOwner,ComputerWindow} from '../shared/computer'
const cleanup:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close()})
const window:ComputerWindow={id:'window',handle:'1',processId:2,started:'3',title:'Fixture',process:'fixture',bounds:{x:0,y:0,width:100,height:100},dpi:96,desktop:'fixture'}
const owner:ComputerOwner={project:'source',workspace:'worktree',sessionId:randomUUID(),workspaceId:'workspace',destination:'fixture/model'}
it('binds reviewed access to the model destination actually shown to the user',()=>{
 expect(()=>assertReviewedComputerDestination(owner,owner.destination)).not.toThrow()
 expect(()=>assertReviewedComputerDestination({...owner,destination:'replacement/model'},owner.destination)).toThrow('destination changed')
 expect(()=>assertReviewedComputerDestination(owner,undefined as any)).toThrow('Review computer access')
})
const view=():ComputerObservation=>({id:randomUUID(),window,elements:[{id:'edit',name:'Document',role:'Edit',enabled:true,password:false,bounds:{x:0,y:0,width:80,height:40}},{id:'tab',name:'Preview',role:'TabItem',enabled:true,password:false,bounds:{x:0,y:0,width:80,height:40}}],created:new Date().toISOString(),width:100,height:100})
async function fixture(){const root=await mkdtemp(join(tmpdir(),'unrealcode-computer-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const manager=new ComputerManager(root,root,{register:()=>true,unregister:()=>{}});await manager.status();const internals=manager as any;internals.settings.enabled=true;internals.state='active';internals.generation='generation';internals.grant={...owner,id:randomUUID(),windows:[window],control:true,generation:'generation',createdAt:new Date().toISOString()};cleanup.push(()=>manager.close());return {manager,internals,root}}
it('keeps unknown and consequential controls outside the routine allowlist',()=>{const v=view();expect(routineComputerAction({kind:'click',elementId:'tab'},v)).toBe(true);for(const action of [{kind:'type',elementId:'edit',text:'hello'},{kind:'click-point',x:1,y:1},{kind:'key',key:'Enter'},{kind:'key',key:'s',modifiers:['ctrl']},{kind:'click',elementId:'absent'}] as const)expect(routineComputerAction(action as any,v)).toBe(false);expect(()=>validComputerAction({kind:'type',text:'x'.repeat(4097)})).toThrow();expect(()=>validComputerAction({kind:'key',modifiers:['win']})).toThrow()})
it('discards a delayed observation when access is withdrawn or handed back',async()=>{const {manager,internals}=await fixture();let release!:(v:any)=>void;vi.spyOn(internals,'request').mockImplementation(()=>new Promise(r=>{release=r}));const pending=manager.call(owner,{type:'observe',windowId:window.id},randomUUID(),new AbortController().signal);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await manager.pause();release(view());await expect(pending).rejects.toThrow('Hand back');expect(manager.latest()).toBeNull()})
it('returns opaque image refs and expires them on takeover, without writing pixels',async()=>{const {manager,internals,root}=await fixture();const raw='data:image/png;base64,iVBORw0KGgo=';vi.spyOn(internals,'request').mockResolvedValue({...view(),image:raw});const response=await manager.call(owner,{type:'observe',windowId:window.id,image:true},randomUUID(),new AbortController().signal) as ComputerObservation;expect(JSON.stringify(response)).not.toContain('base64');expect(response.imageRef).toBeTruthy();expect(manager.resolveImage(owner,response.imageRef!)).toBe(raw);expect(manager.resolveImage({...owner,destination:'different/provider'},response.imageRef!)).toBe('');await manager.pause();expect(manager.resolveImage(owner,response.imageRef!)).toBe('');await expect(readFile(join(root,'computer-settings','dispatches.json'))).rejects.toMatchObject({code:'ENOENT'})})
it('deduplicates attempted input across concurrent calls and manager restart',async()=>{const {manager,internals,root}=await fixture();const snapshot=view();internals.views.set(snapshot.id,snapshot);const dispatch=vi.spyOn(internals,'request').mockResolvedValue({status:'dispatched',outcomeVerified:false});const call={type:'act' as const,observationId:snapshot.id,action:{kind:'click' as const,elementId:'tab'}},id=randomUUID();const both=await Promise.allSettled([manager.call(owner,call,id,new AbortController().signal),manager.call(owner,call,id,new AbortController().signal)]);expect(both.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(dispatch).toHaveBeenCalledTimes(1);const journal=await readFile(join(root,'computer-settings','dispatches.json'),'utf8');expect(journal).not.toContain('Document');expect(journal).toContain('finished');const restored=new ComputerManager(root,root,{register:()=>true,unregister:()=>{}});await restored.status();expect((await restored.status()).grant).toBeUndefined();expect((await restored.status()).state).not.toBe('active');await restored.close()})
it('rejects another session, changed model destination and observation-only input',async()=>{const {manager,internals}=await fixture();const signal=new AbortController().signal;await expect(manager.call({...owner,sessionId:randomUUID()},{type:'observe',windowId:window.id},randomUUID(),signal)).rejects.toThrow('Another task');await expect(manager.call({...owner,destination:'new/model'},{type:'focus',windowId:window.id},randomUUID(),signal)).rejects.toThrow('Another task');internals.grant.control=false;await expect(manager.call(owner,{type:'focus',windowId:window.id},randomUUID(),signal)).rejects.toThrow('observation access');expect((await manager.status()).waiting.length).toBe(2)})

it('does not expose another task window titles or source paths through agent status',async()=>{const {manager}=await fixture();const status=await manager.call({...owner,sessionId:randomUUID()},{type:'status'},randomUUID(),new AbortController().signal);expect(JSON.stringify(status)).not.toContain('Fixture');expect(status).not.toHaveProperty('grant');expect(status).not.toHaveProperty('windows');expect(status).not.toHaveProperty('waiting');expect(status).toMatchObject({ownsAccess:false})})

it('does not disclose another task through the wait result',async()=>{
 const {manager,internals}=await fixture()
 internals.waiting.set('other',{sessionId:randomUUID(),project:'PRIVATE_OTHER_PROJECT'})
 const result=await manager.call(owner,{type:'wait'},randomUUID(),new AbortController().signal)
 expect(JSON.stringify(result)).not.toContain('PRIVATE_OTHER_PROJECT');expect(result).not.toHaveProperty('waiting');expect(result).not.toHaveProperty('grant')
})
it('redacts credential-shaped window titles in every model-visible listing',async()=>{
 const {manager,internals}=await fixture(),fake='sk-'+'x'.repeat(52)
 internals.grant.windows=[{...window,title:'Private '+fake}]
 for(const type of ['status','windows'] as const){const result=await manager.call(owner,{type},randomUUID(),new AbortController().signal);expect(JSON.stringify(result)).not.toContain(fake)}
})
