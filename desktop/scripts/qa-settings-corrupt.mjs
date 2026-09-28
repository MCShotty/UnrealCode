import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root=mkdtempSync(join(tmpdir(),'unrealcode-settings-corrupt-')),profile=join(root,'profile')
mkdirSync(profile)
const path=join(profile,'settings.json'),original=JSON.stringify({provider:'unknown',model:'fixture',decisionSetupSeen:true})
writeFileSync(path,original)
writeFileSync(join(profile,'data-version.json'),JSON.stringify({schema:1}))
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
try{
 const page=await app.firstWindow()
 await page.getByRole('heading',{name:'Recover UnrealCode',exact:true}).waitFor()
 assert.equal(readFileSync(path,'utf8'),original,'Invalid settings must be preserved for recovery')
 assert(await page.getByText('Invalid provider').count(),'Recovery screen should explain the invalid saved setting')
 console.log(JSON.stringify({passed:true,profile:root}))
}finally{await app.close()}
