import {_electron as electron} from 'playwright'
import {createServer} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'

function pdf(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>']
 for(let i=0;i<2;i++){const stream=`BT /F1 18 Tf 30 100 Td (Page ${i+1} fixture text) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)}
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
 let out='%PDF-1.4\n';const offsets=[]
 for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${obj}\nendobj\n`}
 const xref=Buffer.byteLength(out);out+=`xref\n0 8\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return out
}
const root=mkdtempSync(join(tmpdir(),'unrealcode-102-')),project=join(root,'project')
mkdirSync(project);writeFileSync(join(project,'pages.pdf'),pdf())
const server=createServer(()=>{/* Deliberately never send headers, so navigation remains pending. */})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const packaged=process.argv.includes('--packaged'),repro=process.argv.includes('--bug-repro'),report={root,failures:[]}
let app
try{
 app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],cwd:process.cwd(),env:{...process.env,UNREAL_DESKTOP_USER_DATA:join(root,'profile'),UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
 const page=await app.firstWindow();await page.getByRole('button',{name:'Set up later'}).click()
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
 await page.evaluate(path=>window.unreal.openProject(path,true),project);await page.reload()
 await page.getByRole('button',{name:'Browser',exact:true}).click()
 await page.getByRole('textbox',{name:'Browser address'}).fill(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('textbox',{name:'Browser address'}).press('Enter')
 await page.getByRole('button',{name:'Stop loading'}).waitFor()
 await page.getByRole('button',{name:'Stop loading'}).click()
 try{await page.waitForFunction(async()=>!(await window.unreal.sharedBrowserState()).tabs.some(tab=>tab.loading),{},{timeout:2000});report.stopLoading=true}catch{report.failures.push('Stop loading did not interrupt navigation')}
 await page.evaluate(async()=>{const state=await window.unreal.sharedBrowserState();for(const tab of state.tabs)await window.unreal.sharedBrowserCommand({type:'stop',tabId:tab.id})})
 await page.getByRole('button',{name:'Documents',exact:true}).click()
 await app.evaluate(({ipcMain})=>{
  const original=ipcMain._invokeHandlers.get('document:page');ipcMain.removeHandler('document:page')
  ipcMain.handle('document:page',async(event,id,page)=>{const result=await original(event,id,page);if(page===1){globalThis.__pageOneStarted=true;await new Promise(resolve=>setTimeout(resolve,900))}return result})
  ipcMain.removeHandler('document:ocr');ipcMain.handle('document:ocr',async()=>{await new Promise(resolve=>setTimeout(resolve,500));return {unrealResult:true,ok:true,value:{page:2,text:'Old page OCR fixture',method:'ocr',truncated:false,language:'eng',confidence:99}}})
 })
 await page.getByLabel('Project PDF path').fill('pages.pdf');await page.getByRole('button',{name:'Open project PDF'}).click()
 for(let i=0;i<100&&!await app.evaluate(()=>globalThis.__pageOneStarted);i++)await page.waitForTimeout(30)
 await page.getByRole('button',{name:'Next page'}).click()
 await page.waitForTimeout(1300)
 const displayed=await page.locator('.document-extracted').first().innerText()
 if(displayed.includes('Page 2 fixture'))report.pageOwnership=true;else report.failures.push('Page 1 text overwrote Page 2')
 await page.getByRole('button',{name:'Run page OCR'}).click();await page.getByRole('button',{name:'Previous page'}).click();await page.waitForTimeout(700)
 if(await page.getByText('Old page OCR fixture',{exact:true}).count())report.failures.push('OCR from Page 2 appeared under Page 1');else report.ocrOwnership=true
 await app.evaluate(({ipcMain})=>{
  const rows=[1,2].map(number=>({number,title:number===1?'First fixture':'Second fixture',headRefName:'fixture',baseRefName:'main',state:'OPEN'}))
  const fixtures={'git:availability':{available:true},'github:status':{installed:true,authenticated:false,message:'Fixture offline login'},'github:branch':'main','github:worktrees':[],'files:changes':[],'github:prs':rows,'github:review-comments':[],'github:checks':[]}
  for(const [channel,value] of Object.entries(fixtures)){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>({unrealResult:true,ok:true,value}))}
  ipcMain.removeHandler('github:pr');ipcMain.handle('github:pr',async(_event,number)=>{if(number===1){globalThis.__firstPrStarted=true;await new Promise(resolve=>setTimeout(resolve,800))}return {unrealResult:true,ok:true,value:{...rows[number-1],body:'Fixture',diff:'Fixture diff'}}})
 })
 await page.getByRole('button',{name:'GitHub',exact:true}).click()
 await page.getByRole('button',{name:/#1 First fixture/}).click()
 for(let i=0;i<50&&!await app.evaluate(()=>globalThis.__firstPrStarted);i++)await page.waitForTimeout(20)
 await page.getByRole('button',{name:/#2 Second fixture/}).click();await page.waitForTimeout(1000)
 if(await page.getByRole('heading',{name:'Review #2',exact:true}).count())report.prOwnership=true;else report.failures.push('Late PR 1 details overwrote selected PR 2')
 if(!repro){
  const emit=async value=>app.evaluate(({BrowserWindow},failure)=>BrowserWindow.getAllWindows()[0].webContents.send('app:failure',failure),value)
  const warning={code:'ENDPOINT_UNAVAILABLE',scope:'decision.error',title:'Fixture warning',message:'Optional decision service unavailable',actions:[],retryable:true,reference:'warning1'}
  await emit(warning);await page.getByRole('button',{name:'Silence warnings'}).click()
  assert.equal((await page.evaluate(()=>window.unreal.getSettings())).warningNotifications,false)
  await emit({...warning,reference:'warning2'});await page.waitForTimeout(100);assert.equal(await page.getByRole('status',{name:'Fixture warning'}).count(),0)
  const failure={...warning,scope:'provider',code:'PROVIDER_TRANSIENT',title:'Fixture task failed',actions:['settings'],reference:'error1'}
  await emit(failure);await page.getByRole('alert',{name:'Fixture task failed'}).waitFor()
  await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('heading',{name:'Model provider',exact:true}).waitFor()
  await page.reload();assert.equal((await page.evaluate(()=>window.unreal.getSettings())).warningNotifications,false)
  await emit(warning);await page.waitForTimeout(100);assert.equal(await page.getByRole('button',{name:'Silence warnings'}).count(),0)
  await page.evaluate(()=>window.unreal.updateSettings({warningNotifications:true}));await emit(warning);await page.getByRole('button',{name:'Silence warnings'}).waitFor()
  report.warningMute=true;report.errorsVisible=true;report.settingsRecovery=true;report.warningPersistence=true
 }
 console.log(JSON.stringify(report));assert.deepEqual(report.failures,[])
}finally{await app?.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
