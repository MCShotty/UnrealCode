import { it,expect,vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VerificationWorkflows } from './verification-workflows'
import { defaultWorkflowPresets } from '../shared/verification'
const profile={id:'unit',name:'Unit checks',command:'fixture command',timeoutSeconds:10}
it('does not roll back saved verification settings when the renderer notification fails',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-workflows-notify-')),'workflows.json')
 const runner={verify:vi.fn(),repair:vi.fn()}
 const service=new VerificationWorkflows(path,runner)
 service.onChanged=()=>{throw Error('renderer closed')}
 await service.update({...defaultWorkflowPresets,profiles:[profile]})
 expect(service.settings().profiles[0].id).toBe('unit')
 expect(new VerificationWorkflows(path,runner).settings().profiles[0].id).toBe('unit')
})
it('keeps the reviewed command fixed and stops after two unsuccessful repair attempts',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-workflows-')),'workflows.json')
 const verify=vi.fn(async(_session,selected,id)=>({id,command:selected.command,exitCode:1,output:'failure',durationMs:5,cancelled:false})),repair=vi.fn(async()=>{})
 const service=new VerificationWorkflows(path,{verify,repair});await service.update({...defaultWorkflowPresets,profiles:[profile]})
 const reviewed=service.snapshot('unit','fix',2);await service.update({...defaultWorkflowPresets,profiles:[{...profile,command:'changed after preview'}]})
 await service.start('session',reviewed);await vi.waitFor(()=>expect(service.busy).toBe(false))
 expect(verify).toHaveBeenCalledTimes(3);expect(repair).toHaveBeenCalledTimes(2);expect(verify.mock.calls.every(call=>call[1].command==='fixture command')).toBe(true)
 expect(service.list()[0]).toMatchObject({state:'failed',repairsStarted:2});expect(service.list()[0].attempts).toHaveLength(3)
})
it('requires opt-in for repairs and restores interrupted runs without executing',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'unrealcode-workflows-restart-')),'workflows.json');let finish!:()=>void
 const repair=vi.fn(async()=>{}),verify=vi.fn(async(_session,selected,id)=>{await new Promise<void>(resolve=>{finish=resolve});return{id,command:selected.command,exitCode:1,output:'remaining failure',durationMs:1,cancelled:false}})
 const service=new VerificationWorkflows(path,{verify,repair});await service.update({...defaultWorkflowPresets,profiles:[profile]});await service.start('session',service.snapshot('unit',undefined,2));await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 const restored=new VerificationWorkflows(path,{verify,repair});expect(restored.list()[0].state).toBe('interrupted');expect(verify).toHaveBeenCalledOnce();finish();await vi.waitFor(()=>expect(service.busy).toBe(false));expect(repair).not.toHaveBeenCalled()
})
