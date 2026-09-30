import {it,expect} from 'vitest'
import {execFileSync} from 'node:child_process'
import {mkdtemp,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {ComputerManager} from './computer'
import type {ComputerObservation,ComputerOwner} from '../shared/computer'
it.skipIf(process.env.UNREAL_COMPUTER_NATIVE!=='1')('operates only the disposable desktop-2 fixture and verifies an artifact',async()=>{
 const desktop=execFileSync('powershell.exe',['-NoProfile','-Command',"$d=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops';$c=[BitConverter]::ToString($d.CurrentVirtualDesktop);$v=$d.VirtualDesktopIDs;for($i=0;$i -lt $v.Length;$i+=16){if([BitConverter]::ToString($v[$i..($i+15)]) -eq $c){Write-Output ($i/16+1)}}"],{windowsHide:true}).toString().trim();expect(desktop,'Visible acceptance must be on desktop 2').toBe('2')
 const root=await mkdtemp(join(tmpdir(),'unrealcode-native-')),manager=new ComputerManager(root,resolve('generated/computer-host'),{register:()=>true,unregister:()=>{}}),owner:ComputerOwner={project:root,workspace:root,workspaceId:'fixture',sessionId:randomUUID(),destination:'local acceptance fixture; no provider'},signal=new AbortController().signal
 const call=(value:any)=>manager.call(owner,value,randomUUID(),signal)
 try{
  const start=performance.now();await manager.enable(true);const windows=await manager.windows(),candidates=windows.filter(w=>w.title==='UnrealCode disposable computer fixture');expect(candidates).toHaveLength(1);const window=candidates[0];expect(window.blocked).toBeUndefined()
  await manager.grantWindows(owner,[window.id],true)
  await call({type:'focus',windowId:window.id})
  const view=await call({type:'observe',windowId:window.id,image:true}) as ComputerObservation
  expect(JSON.stringify(view)).not.toContain('fixture-only-password');expect(view.elements.some(e=>e.password)).toBe(true);expect(view.imageRef).toBeTruthy()
  const edit=view.elements.find(e=>e.name==='Draft note');expect(edit).toBeTruthy()
  const text='Fieldnotes and selected-window control verified.'
  const typed=await call({type:'act',observationId:view.id,action:{kind:'type',elementId:edit!.id,text,clearFirst:true}}) as any;expect(typed.status).toBe('dispatched')
  const fresh=await call({type:'observe',windowId:window.id}) as ComputerObservation,save=fresh.elements.find(e=>e.name==='Save fixture artifact');expect(save).toBeTruthy()
  expect(manager.review(owner,{type:'act',observationId:fresh.id,action:{kind:'click',elementId:save!.id}})).toBe(true)
  // Exact fixture artifact write is authorized by this opt-in test, not by a screen label.
  await call({type:'act',observationId:fresh.id,action:{kind:'click',elementId:save!.id}})
  const verified=await call({type:'observe',windowId:window.id}) as ComputerObservation
  expect(verified.elements.some(e=>e.name.includes('Artifact saved and verified'))).toBe(true)
  expect(await readFile(resolve('../.cache/computer-fixture/result.txt'),'utf8')).toBe(text)
  await manager.pause();await expect(call({type:'observe',windowId:window.id})).rejects.toThrow('Hand back');await manager.resume();await expect(call({type:'act',observationId:view.id,action:{kind:'click',elementId:save!.id}})).rejects.toThrow('fresh observation')
  await manager.stop();expect((await manager.status()).grant).toBeUndefined();console.log('COMPUTER_NATIVE '+JSON.stringify({root,elapsedMs:performance.now()-start,artifact:resolve('../.cache/computer-fixture/result.txt'),steps:'grant, focus, UIA, redacted capture, type, action review, save, verify, takeover, explicit handback, stale rejection, stop'}))
 }finally{await manager.close()}
},120000)
