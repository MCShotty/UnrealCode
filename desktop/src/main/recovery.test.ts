import { afterEach,expect,it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Recovery } from './recovery'
import { Storage } from './storage'
import { copyTree,exists } from './recovery-files'
import { defaultVolume } from './state-volumes'
import { supportDocument,recordFailure } from './support'
let root=''
afterEach(async()=>{if(root)await fs.rm(root,{recursive:true,force:true})})
async function fixture(){root=await fs.mkdtemp(join(tmpdir(),'unrealcode-recovery-test-'));const data=join(root,'profile');await fs.mkdir(data);const volumes=new Map<string,string>(),adapter={existing:async(names:string[])=>names.filter(name=>volumes.has(name)),export:async(name:string,path:string)=>copyTree(volumes.get(name)!,path),import:async(path:string)=>{const name=`unrealcode-restore-${randomUUID()}`,target=join(root,name);await copyTree(path,target);volumes.set(name,target);return name}};return {data,volumes,service:new Recovery(data,'1.0.0-rc.1',adapter)}}
it('backs up settings and durable sessions, excludes credential stores, and resets restored authority',async()=>{
 const {data,volumes,service}=await fixture(),project=join(root,'project'),volume=defaultVolume(project,false),source=join(root,'volume');await fs.mkdir(join(source,'sessions'),{recursive:true});await fs.writeFile(join(source,'sessions','message.json'),'saved history');volumes.set(volume,source)
 await fs.writeFile(join(data,'settings.json'),JSON.stringify({recentProjects:[project],trustedProjects:[project],theme:'light',decisionCloudProjects:[project],executionMode:'agent'}));await fs.writeFile(join(data,'secrets.json'),'private vault');await fs.writeFile(join(data,'connection-secrets.json'),'other private vault')
 await fs.writeFile(join(data,'connections.json'),JSON.stringify({version:1,connections:[{id:'old-server'}],grants:[{hostTrusted:true}],catalog:[{name:'tool'}]}))
 const backup=join(root,'backup');const preview=await service.export(backup);expect(preview.volumes).toBe(1);expect(await exists(join(backup,'metadata','secrets.json'))).toBe(false)
 await fs.writeFile(join(data,'settings.json'),JSON.stringify({recentProjects:[project],theme:'dark'}));await service.restore(backup)
 const settings=JSON.parse(await fs.readFile(join(data,'settings.json'),'utf8'));expect(settings.theme).toBe('light');expect(settings.trustedProjects).toEqual([]);expect(settings.executionMode).toBe('ask');expect(await fs.readFile(join(data,'secrets.json'),'utf8')).toBe('private vault')
 const saved=JSON.parse(await fs.readFile(join(data,'state-volumes.json'),'utf8'));expect(saved[0].volume).not.toBe(volume);expect(await fs.readFile(join(volumes.get(saved[0].volume)!,'sessions','message.json'),'utf8')).toBe('saved history');expect(await fs.readFile(join(source,'sessions','message.json'),'utf8')).toBe('saved history')
 const connections=JSON.parse(await fs.readFile(join(data,'connections.json'),'utf8'));expect(connections.grants).toEqual([]);expect(connections.connections[0].id).not.toBe('old-server')
})
it('refuses modified, unlisted, and traversal backup data before replacing anything',async()=>{
 const {data,service}=await fixture();await fs.writeFile(join(data,'settings.json'),'{}');const backup=join(root,'backup');await service.export(backup)
 await fs.writeFile(join(backup,'metadata','settings.json'),'changed');await expect(service.preview(backup)).rejects.toThrow('integrity');expect(await fs.readFile(join(data,'settings.json'),'utf8')).toBe('{}')
 await fs.writeFile(join(backup,'metadata','settings.json'),'{}');await fs.writeFile(join(backup,'extra'),'unlisted');await expect(service.preview(backup)).rejects.toThrow('unlisted');await fs.unlink(join(backup,'extra'))
 const manifest=JSON.parse(await fs.readFile(join(backup,'manifest.json'),'utf8'));manifest.files[0].path='metadata/../../outside';await fs.writeFile(join(backup,'manifest.json'),JSON.stringify(manifest));await expect(service.preview(backup)).rejects.toThrow('Unsafe')
})
it('rolls back an interrupted replacement without deleting either copy',async()=>{
 const {data,service}=await fixture(),id=randomUUID(),prior=join(data,'recovery',id,'prior');await fs.mkdir(prior,{recursive:true});await fs.writeFile(join(prior,'settings.json'),'old');await fs.writeFile(join(data,'settings.json'),'new');await fs.writeFile(join(data,'recovery-transaction.json'),JSON.stringify({id,roots:[{root:'settings.json',hadOld:true}]}));await service.rollback();expect(await fs.readFile(join(data,'settings.json'),'utf8')).toBe('old');expect(await fs.readFile(join(data,'recovery',id,'failed','settings.json'),'utf8')).toBe('new')
})
it('backs up before migration and does not accept future schema versions',async()=>{
 const {data,service}=await fixture();await fs.writeFile(join(data,'settings.json'),'{}');const backup=await service.migrate();expect(backup).toBeTruthy();expect(await exists(join(backup!,'manifest.json'))).toBe(true);expect(await service.migrate()).toBeUndefined();await fs.writeFile(join(data,'data-version.json'),'{"schema":2}');await expect(service.migrate()).rejects.toThrow('older')
})
it('restores valid settings while preserving a damaged current settings file',async()=>{const {data,service}=await fixture();await fs.writeFile(join(data,'settings.json'),'{"theme":"light"}');const backup=join(root,'backup');await service.export(backup);await fs.writeFile(join(data,'settings.json'),'{damaged');await expect(service.migrate()).rejects.toThrow();const prior=await service.restore(backup);expect(await fs.readFile(join(prior,'metadata','settings.json'),'utf8')).toBe('{damaged');expect(JSON.parse(await fs.readFile(join(data,'settings.json'),'utf8')).theme).toBe('light')})
it('blocks stale cleanup previews and never makes unfinished work removable',async()=>{
 const {data}=await fixture(),index=join(data,'workspaces','p','search');await fs.mkdir(index,{recursive:true});await fs.writeFile(join(index,'a.jsonl'),'old');await fs.mkdir(join(data,'workspaces','p','tasks','worktrees','unfinished'),{recursive:true});const store=new Storage(data),rows=await store.list(),row=rows.find(item=>item.category==='index')!;expect(rows.find(item=>item.category==='worktrees')?.removable).toBe(false);await fs.writeFile(join(index,'a.jsonl'),'later change');await expect(store.remove([row.id])).rejects.toThrow('changed');await store.remove([(await store.list()).find(item=>item.category==='index')!.id]);expect(await exists(index)).toBe(false)
})
it('support output contains failure categories without raw errors or secrets',()=>{recordFailure('provider:connect',new Error('Bearer pretend-secret /private/project'));const document=supportDocument('test',{backendReady:false,openProjects:1,migrationBlocked:false,updateState:'unavailable'});expect(document).toContain('provider:connect');expect(document).not.toContain('pretend-secret');expect(document).not.toContain('/private/project')})
