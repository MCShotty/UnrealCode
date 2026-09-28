import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
vi.mock('electron',()=>({app:{isPackaged:false,getVersion:()=> 'test'}}))
import { WorkspaceRuntime } from './workspace-runtime'
import { closeHistoryCaches } from './history-cache'
import type { AgentEvent } from '../shared/api'
import {defaultTeamOptions} from '../shared/teams'

const roots:string[]=[]
afterEach(async()=>{await closeHistoryCaches();vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})})
async function teamFixture(){
 const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-team-commit-'));roots.push(root);const project=join(root,'project');await fs.mkdir(project)
 const runtime=new WorkspaceRuntime(project,join(root,'profile'),{event:()=>{},changed:()=>{},notify:()=>{},configure:async()=>{},hasTerminal:()=>false}),id=randomUUID()
 vi.spyOn(runtime.tasks,'available').mockResolvedValue(true);vi.spyOn(runtime,'owner').mockResolvedValue(runtime)
 await runtime.teams.configure(id,{...defaultTeamOptions,allowSpecialists:false,policy:'off'})
 return {runtime,id,enabled:{...defaultTeamOptions,allowSpecialists:true,policy:'manual' as const}}
}
it('does not publish specialist opt-in when its backend config write is rejected',async()=>{
 const {runtime,id,enabled}=await teamFixture()
 vi.spyOn(runtime.bridge,'request').mockImplementation(async method=>{if(method==='project.idle')return true as any;if(method==='session.config')return {teamEnabled:false,teamManaged:false} as any;throw Error('Backend config disk full')})
 await expect(runtime.configureTeam(id,enabled)).rejects.toThrow('disk full')
 expect(runtime.teams.options(id).allowSpecialists).toBe(false)
})
it('restores backend flags when the local specialist settings commit fails',async()=>{
 const {runtime,id,enabled}=await teamFixture(),changes:unknown[]=[]
 vi.spyOn(runtime.bridge,'request').mockImplementation(async(method,params)=>{if(method==='project.idle')return true as any;if(method==='session.config')return {teamEnabled:false,teamManaged:false} as any;if(method==='session.team'){changes.push(params);return undefined as any}throw Error('Unexpected request')})
 vi.spyOn(runtime.teams,'configure').mockRejectedValueOnce(Error('Local config disk full'))
 await expect(runtime.configureTeam(id,enabled)).rejects.toThrow('disk full')
 expect(changes).toEqual([{sessionId:id,enabled:true,managed:true},{sessionId:id,enabled:false,managed:false}])
 expect(runtime.teams.options(id).allowSpecialists).toBe(false)
})
it('keeps host permissions unchanged when restoring backend flags also fails',async()=>{
 const {runtime,id,enabled}=await teamFixture();let writes=0
 vi.spyOn(runtime.bridge,'request').mockImplementation(async method=>{if(method==='project.idle')return true as any;if(method==='session.config')return {teamEnabled:false,teamManaged:false} as any;if(method==='session.team'&&writes++===0)return undefined as any;throw Error('Backend unavailable')})
 vi.spyOn(runtime.teams,'configure').mockRejectedValueOnce(Error('Local config disk full'))
 await expect(runtime.configureTeam(id,enabled)).rejects.toThrow('Host permissions remain unchanged')
 expect(runtime.teams.options(id).allowSpecialists).toBe(false)
})
it('retries only queued session creation with the same durable attempt identity',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-runtime-create-'));roots.push(root)
  const project=join(root,'project');await fs.mkdir(project)
  const runtime=new WorkspaceRuntime(project,join(root,'profile'),{event:()=>{},changed:()=>{},notify:()=>{},configure:async()=>{},hasTerminal:()=>false})
  const key=randomUUID(),config={provider:'ollama' as const,model:'fixture',baseUrl:'',thinkingLevel:'low',systemPrompt:'',disallowedTools:[],workspace:'project' as const}
  vi.spyOn(runtime.bridge,'status').mockReturnValue({ready:true,message:'Fixture'})
  const request=vi.spyOn(runtime.bridge,'request').mockRejectedValueOnce(Error('reply lost')).mockResolvedValueOnce({sessionId:key})
  expect(await runtime.create(config,false,{taskId:key,attemptId:key,workspaceChoice:'project'})).toBe(key)
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.map(call=>(call[1] as {queueTaskId:string}).queueTaskId)).toEqual([key,key])
  request.mockClear();request.mockRejectedValueOnce(Error('ordinary failure'))
  await expect(runtime.create(config,false)).rejects.toThrow('ordinary failure')
  expect(request).toHaveBeenCalledTimes(1)
})
it('rebuilds changed-filename search anchors from persisted checkpoints without live events',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-runtime-hunt-'));roots.push(root)
  const project=join(root,'project');await fs.mkdir(project)
  const runtime=new WorkspaceRuntime(project,join(root,'profile'),{event:()=>{},changed:()=>{},notify:()=>{},configure:async()=>{},hasTerminal:()=>false})
  const id=randomUUID(),messageId=randomUUID(),at=new Date().toISOString()
  const events:AgentEvent[]=[
    {v:1,event:'session.item',sessionId:id,seq:1,recordedAt:at,payload:{Kind:'input',Data:{ID:messageId,Kind:'external',Payload:{Prompt:'Generate the files'}}}},
    {v:1,event:'session.idle',sessionId:id,seq:2,recordedAt:at,payload:{messageIds:[messageId]}},
    {v:1,event:'session.item',sessionId:id,seq:3,recordedAt:at,payload:{Kind:'input',Data:{ID:'later',Kind:'external',Payload:{Prompt:'Unrelated later task'}}}}
  ]
  vi.spyOn(runtime.bridge,'status').mockReturnValue({ready:true,message:'Fixture'})
  vi.spyOn(runtime.bridge,'request').mockImplementation(async(method,params:any)=>{
    if(method==='session.list')return [{id,title:'Original title',lastUpdatedAt:at,active:false}] as any
    if(method==='session.events')return events.filter(event=>event.seq>params.after) as any
    throw new Error(`Unexpected fixture request ${method}`)
  })
  vi.spyOn(runtime.checkpoints.store,'list').mockResolvedValue([{id:randomUUID(),sessionId:id,messageIds:[messageId],createdAt:at,title:'Original turn',state:'complete',durationMs:100,files:[{path:'src/generated-name.ts',change:'added'}]}])
  await runtime.syncIndex()
  const hits=await runtime.index.search('src/generated-name.ts')
  expect(hits).toHaveLength(1);expect(hits[0].seq).toBe(2)
})
it('lists a newly forked session immediately even when background backfill has not run',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-runtime-fork-'));roots.push(root)
  const project=join(root,'project');await fs.mkdir(project)
  const runtime=new WorkspaceRuntime(project,join(root,'profile'),{event:()=>{},changed:()=>{},notify:()=>{},configure:async()=>{},hasTerminal:()=>false})
  const id=randomUUID(),fork=randomUUID(),at=new Date().toISOString(),original={id,title:'Original',lastUpdatedAt:at,active:false}
  await runtime.index.putSessions([original])
  vi.spyOn(runtime.bridge,'status').mockReturnValue({ready:true,message:'Fixture'})
  vi.spyOn(runtime,'syncIndex').mockResolvedValue()
  vi.spyOn(runtime,'credential').mockResolvedValue({})
  vi.spyOn(runtime,'liveSessions').mockResolvedValue([original,{...original,id:fork,title:'Fork',parentSessionId:id}])
  vi.spyOn(runtime.bridge,'request').mockResolvedValue({sessionId:fork})
  await runtime.fork(id)
  expect((await runtime.sessions()).find(item=>item.id===fork)?.parentSessionId).toBe(id)
})
it('closes browser, jobs and bridge even if specialist metadata shutdown fails',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-runtime-stop-'));roots.push(root)
  const project=join(root,'project');await fs.mkdir(project)
  const runtime=new WorkspaceRuntime(project,join(root,'profile'),{event:()=>{},changed:()=>{},notify:()=>{},configure:async()=>{},hasTerminal:()=>false})
  vi.spyOn(runtime.teams,'shutdown').mockRejectedValue(new Error('team metadata unavailable'))
  const browser=vi.spyOn(runtime.browser,'close').mockResolvedValue()
  const jobs=vi.spyOn(runtime.jobs,'close').mockResolvedValue()
  const bridge=vi.spyOn(runtime.bridge,'stop').mockResolvedValue()
  const repository=vi.spyOn(runtime.repository,'close').mockImplementation(()=>{})
  await expect(runtime.stopAll()).rejects.toThrow('Workspace shutdown was incomplete')
  for(const closed of [browser,jobs,bridge,repository])expect(closed).toHaveBeenCalledTimes(1)
})
