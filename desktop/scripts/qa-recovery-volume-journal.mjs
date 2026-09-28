import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root=mkdtempSync(join(tmpdir(),'unrealcode-restore-journal-')),profile=join(root,'profile')
const older=join(profile,'recovery','2026-09-28_00-00-00.000Z'),newer=join(profile,'recovery','2026-09-28_00-01-00.000Z')
const restored=`unrealcode-restore-${randomUUID()}`
mkdirSync(older,{recursive:true});mkdirSync(newer,{recursive:true})
writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true}))
writeFileSync(join(profile,'data-version.json'),JSON.stringify({schema:1}))
writeFileSync(join(older,'volume-imports.json'),JSON.stringify({format:1,backupId:randomUUID(),volumes:[{source:'unrealcode-'+'a'.repeat(20),restored}]}))
writeFileSync(join(older,'complete.json'),'{}');writeFileSync(join(newer,'complete.json'),'{}')
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
try{
 const page=await app.firstWindow()
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 await page.getByRole('button',{name:'Provider settings'}).click()
 await page.getByRole('tab',{name:'Recovery'}).click()
 await page.getByRole('button',{name:'Inspect storage'}).click()
 const row=page.locator('.storage-list label').filter({hasText:restored})
 await row.waitFor()
 assert.match(await row.innerText(),/recovery-volume · size unknown/)
 assert.match(await row.innerText(),/may be recoverable/)
 assert(await row.locator('input[type="checkbox"]').isDisabled(),'Unregistered restore volume must not be removable')
 const saved=await page.evaluate(()=>window.unreal.storageList())
 assert.equal(saved.find(item=>item.path===restored)?.removable,false)
 assert.equal(saved.find(item=>item.path===older)?.removable,false,'Recovery folder containing an unregistered volume must remain protected')
 await page.getByRole('button',{name:'Inspect retained copies'}).click()
 const retained=page.getByRole('article',{name:`Retained volume ${restored}`})
 await retained.waitFor()
 assert.match(await retained.innerText(),/planned|unavailable/)
 assert(await retained.getByRole('button',{name:`Export session files from ${restored}`}).isDisabled())
 assert(await retained.getByRole('button',{name:`Reattach ${restored}`}).isDisabled())
 const retry=await page.evaluate(()=>window.unreal.recoveryAction('retry'))
 assert.equal(typeof retry?.ready,'boolean','Recovery checks must have a registered IPC handler')
 const rebuild=await page.evaluate(async()=>{try{await window.unreal.recoveryAction('cache-rebuild');return 'unexpected success'}catch(error){return error?.failure?.code||String(error)}})
 assert.notEqual(rebuild,'unexpected success','Cache rebuild needs an open connected project')
 assert(!String(rebuild).includes('No handler registered'),'Recovery actions must use a real IPC handler')
 await app.evaluate(({shell})=>{globalThis.__recoveryActionCalls=[];shell.openPath=async path=>{globalThis.__recoveryActionCalls.push(['path',path]);return ''};shell.openExternal=async url=>{globalThis.__recoveryActionCalls.push(['url',url])}})
 const localDocker=join(process.env.LOCALAPPDATA||'', 'Programs','DockerDesktop','Docker Desktop.exe')
 if(existsSync(localDocker))await page.evaluate(()=>window.unreal.recoveryAction('docker-open'))
 await page.evaluate(()=>window.unreal.recoveryAction('docker-help'))
 const calls=await app.evaluate(()=>globalThis.__recoveryActionCalls)
 if(existsSync(localDocker))assert(calls.some(([kind,path])=>kind==='path'&&path===localDocker),'Open Docker Desktop must resolve the installed per-user executable')
 assert(calls.some(([kind,url])=>kind==='url'&&url==='https://docs.docker.com/desktop/setup/install/windows-install/'),'Docker setup help must open the official guide')
 console.log(JSON.stringify({passed:true,profile:root}))
}finally{await app.close()}
