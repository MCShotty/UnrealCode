import { _electron as electron } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root=mkdtempSync(join(tmpdir(),'unrealcode-retained-ui-'))
const profile=join(root,'profile'),rawProject=join(root,'project'),destination=join(root,'private-export')
mkdirSync(profile);mkdirSync(rawProject)
let project=''
const owner=randomUUID(),volume=`unrealcode-restore-${randomUUID()}`
const docker=(...args)=>execFileSync('docker',args,{windowsHide:true,encoding:'utf8',timeout:120000}).trim()
const image=docker('image','ls','--format','{{.Repository}}:{{.Tag}}','unrealcode').split(/\r?\n/).find(value=>/^unrealcode:[\w.-]+$/.test(value))
if(!image)throw Error('Build the UnrealCode backend image first')
docker('volume','create','--label',`ai.unrealcode.restore-owner=${owner}`,volume)
let app
try{
 docker('run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',`type=volume,source=${volume},target=/state`,image,'-c','import os\nfrom pathlib import Path\np=Path("/state/sessions");p.mkdir();(p/"ui-fixture.txt").write_text("retained UI fixture")\nos.chown(p,10001,10001);os.chown(p/"ui-fixture.txt",10001,10001)')
 const area=join(profile,'recovery','2026-09-28_00-00-00.000Z');mkdirSync(area,{recursive:true})
 writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,theme:'dark'}))
 writeFileSync(join(profile,'data-version.json'),JSON.stringify({schema:1}))
 app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
 project=join(dirname(await app.evaluate(({app})=>app.getPath('userData'))),'project')
 const source=`unrealcode-${createHash('sha256').update(project.toLowerCase()).digest('hex').slice(0,20)}`
 writeFileSync(join(area,'volume-imports.json'),JSON.stringify({format:1,backupId:randomUUID(),volumes:[{source,restored:volume,owner,project,isolated:false}]}))
 const page=await app.firstWindow(),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 await page.getByRole('button',{name:'Provider settings'}).click()
 await page.getByRole('tab',{name:'Recovery'}).click()
 assert.equal(await page.getByRole('button',{name:'Save settings'}).count(),0,'Recovery actions must not display an unrelated settings save button')
 await page.getByRole('button',{name:'Inspect retained copies'}).click()
 const card=page.getByRole('article',{name:`Retained volume ${volume}`})
 await card.waitFor()
 assert.match(await card.innerText(),/verified retained sessions/i)
 assert(await card.getByRole('button',{name:`Export session files from ${volume}`}).isEnabled())
 const retainedStatus=(await page.evaluate(()=>window.unreal.retainedVolumes())).items[0]
 assert(await card.getByRole('button',{name:`Reattach ${volume}`}).isEnabled(),`Reattach unavailable: ${retainedStatus.reason}`)
 await card.scrollIntoViewIfNeeded()
 const audit=await new AxeBuilder({page}).setLegacyMode(true).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
 assert.deepEqual(audit.violations.map(item=>item.id),[],'Recovery controls must not introduce WCAG A/AA violations')
 await page.screenshot({path:join(root,'retained-dark.png')})
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})},destination)
 await card.getByRole('button',{name:`Export session files from ${volume}`}).click()
 await page.waitForFunction(()=>{const notice=document.querySelector('.recovery-panel .notice');return !!notice&&!notice.textContent?.includes('Working…')&&!notice.textContent?.includes('Saving and checking')})
 assert.match(await page.locator('.recovery-panel .notice').innerText(),/Exported retained sessions to/)
 assert.equal(readFileSync(join(destination,'volume','sessions','ui-fixture.txt'),'utf8'),'retained UI fixture')
 await card.getByRole('button',{name:`Reattach ${volume}`}).click()
 await page.getByText(`Reattached ${volume}. Trust the original project before opening its sessions.`).waitFor()
 const registry=JSON.parse(readFileSync(join(profile,'state-volumes.json'),'utf8'))
 assert.deepEqual(registry,[{project:realpathSync.native(project),isolated:false,volume}])
 assert.equal((await page.evaluate(()=>window.unreal.retainedVolumes())).items.length,0)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({passed:true,root,volume}))
}finally{
 if(app)await app.close().catch(()=>{})
 docker('volume','rm',volume)
}
