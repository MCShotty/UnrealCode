// Browser plugin not available. Exercise the real Electron renderer offscreen
// with disposable metadata and delayed IPC; never touch an owner profile.
import {_electron as electron} from 'playwright'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-bughunt-')),profile=join(root,'profile'),project=join(root,'project')
mkdirSync(profile);mkdirSync(project);writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,decisionEngine:'off',theme:'dark'}))
const packaged=process.argv.includes('--packaged')||!!process.env.UNREALCODE_QA_EXECUTABLE
const app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
let page;const errors=[]
try{
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 await app.evaluate(({dialog},project)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]})},project)
 const ids=await page.evaluate(async()=>{
  const target=await window.unreal.fieldnotePickProject(),pointer={projectId:target.id,projectPath:target.path,projectName:target.name}
  const a=await window.unreal.fieldnoteSave({title:'Alpha note',body:'Original Alpha guidance',pointer,enabled:true,indexing:false})
  const b=await window.unreal.fieldnoteSave({title:'Beta note',body:'Original Beta guidance',pointer,enabled:true,indexing:false})
  return {a:a.id,b:b.id}
 })
 await page.getByRole('button',{name:'Open Fieldnotes',exact:true}).click()
 await page.locator('.fieldnote-row').filter({hasText:'Alpha note'}).click()
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Edited Alpha draft')
 await page.getByText('Draft saved on this device').waitFor()
 await app.evaluate(({ipcMain},id)=>{
  const original=ipcMain._invokeHandlers.get('fieldnotes:draft')
  ipcMain.removeHandler('fieldnotes:draft')
  ipcMain.handle('fieldnotes:draft',async(event,key,value)=>{
   const result=await original(event,key,value)
   if(key===id&&value===null)await new Promise(resolve=>{globalThis.__releaseDiscard=resolve})
   return result
  })
 },ids.a)
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 for(let i=0;i<100;i++){if(await app.evaluate(()=>typeof globalThis.__releaseDiscard==='function'))break;await new Promise(resolve=>setTimeout(resolve,20))}
 assert(await app.evaluate(()=>typeof globalThis.__releaseDiscard==='function'),'Discard IPC must be pending')
 await page.locator('.fieldnote-row').filter({hasText:'Beta note'}).click()
 await page.waitForFunction(()=>document.querySelector('.fieldnote-detail input')?.value==='Beta note')
 await app.evaluate(()=>globalThis.__releaseDiscard())
 await page.waitForFunction(()=>[...document.querySelectorAll('.fieldnote-footer button')].some(button=>button.textContent==='Cancel'&&!button.disabled))
 assert.equal(await page.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Beta note','Delayed cancellation must not replace the selected note')
 assert.deepEqual(errors,[])
 await page.screenshot({path:join(root,'fieldnotes-stale-cancel.png'),animations:'disabled'})
 console.log('PASS: delayed Fieldnote cancellation preserves a newer selection. '+root)
}catch(error){if(page)await page.screenshot({path:join(root,'failure.png'),animations:'disabled'}).catch(()=>{});console.error('Artifacts: '+root);throw error}finally{await app.close()}
