import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const profile=mkdtempSync(join(tmpdir(),'unrealcode-settings-boundary-'))
const settings=join(profile,'settings.json')
const extra='fixture-private-legacy-field'
writeFileSync(settings,JSON.stringify({decisionSetupSeen:true,provider:'ollama',model:'fixture',legacyCredential:extra,layout:{sessionWidth:246,legacyCredential:extra}}))
writeFileSync(join(profile,'data-version.json'),JSON.stringify({schema:1}))
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
try{
 const page=await app.firstWindow()
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 const projected=await page.evaluate(()=>window.unreal.getSettings())
 assert.equal(projected.provider,'ollama')
 assert.equal(JSON.stringify(projected).includes(extra),false,'Unknown settings must not cross preload into the renderer')
 assert.equal(readFileSync(settings,'utf8').includes(extra),true,'Live legacy settings must remain intact')
 console.log(JSON.stringify({passed:true,profile}))
}finally{await app.close()}
