// Disposable, offscreen renderer regressions. Delayed IPC replies model real
// latency; no provider requests or user profile data are used.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import assert from 'node:assert/strict'

const root=mkdtempSync(join(tmpdir(),'unrealcode-ui-races-')),profile=join(root,'profile')
mkdirSync(profile);mkdirSync(join(root,'project'));const project=realpathSync.native(join(root,'project'))
const sessionA='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',sessionB='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const stamp='2026-09-27_18-42-10.123Z',database=join(profile,'history-cache',stamp+'.sqlite')
mkdirSync(join(profile,'history-cache'))
writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,theme:'dark',recentProjects:[project],trustedProjects:[project]}))
writeFileSync(join(profile,'storage-locations.json'),JSON.stringify({version:1,locations:[{kind:'history-cache',key:'history',path:`history-cache/${stamp}.sqlite`,createdAt:new Date().toISOString()}]}))
const seed=new Worker(resolve('out/main/history-worker.cjs'),{workerData:{path:database,reader:false}}),jobs=new Map();let next=0
await new Promise((resolve,reject)=>{seed.once('error',reject);seed.on('message',message=>{if(message.ready)resolve();else{const job=jobs.get(message.id);jobs.delete(message.id);message.ok?job?.resolve(message.value):job?.reject(new Error(message.error.message))}})})
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next;jobs.set(id,{resolve,reject});seed.postMessage({id,method,params})})
await request('sessions.put',{project,sessions:[sessionA,sessionB].map((id,i)=>({id,title:`Session ${i?'B':'A'}`,lastUpdatedAt:new Date().toISOString(),active:false}))})
await request('ingest',{batch:[sessionA,sessionB].map((sessionId,i)=>({project,event:{v:1,event:'session.item',sessionId,seq:1001,payload:{Kind:'input',Data:{Kind:'external',Payload:{Prompt:`Current history ${i?'B':'A'}`}}}}}))})
await request('close',{});await seed.terminate()
const packaged=process.argv.includes('--packaged')
const app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,DOCKER_CONTEXT:'',DOCKER_HOST:'npipe:////./pipe/unrealcode-ui-race-fixture',UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
const report={root,packaged,checks:[],failures:[]},errors=[]
const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message))
try{
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
  await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
  await page.evaluate(project=>window.unreal.openProject(project,true),project);await page.reload()
  await page.getByRole('button',{name:/Session A/}).waitFor()
  if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click()
  await app.evaluate(({ipcMain})=>{
    const original=ipcMain._invokeHandlers.get('session:latest');let calls=0
    globalThis.uiRace={historyReady:false,historyReturned:false,sendReady:false}
    ipcMain.removeHandler('session:latest')
    ipcMain.handle('session:latest',async(event,...args)=>{
      const first=++calls===1,result=await original(event,...args)
      if(first){globalThis.uiRace.historyReady=true;await new Promise(resolve=>{globalThis.uiRace.releaseHistory=resolve});result.value=[{...result.value[0],seq:1,payload:{Kind:'input',Data:{Kind:'external',Payload:{Prompt:'STALE SELECTION MARKER'}}}}];globalThis.uiRace.historyReturned=true}
      return result
    })
  })
  await page.getByRole('button',{name:/Session A/}).click()
  for(let i=0;i<100&&!await app.evaluate(()=>globalThis.uiRace.historyReady);i++)await page.waitForTimeout(25)
  assert(await app.evaluate(()=>globalThis.uiRace.historyReady),'First history request was not captured')
  await page.getByRole('button',{name:/Session B/}).click();await page.getByText('Current history B',{exact:true}).waitFor()
  await page.getByRole('button',{name:/Session A/}).click();await page.getByText('Current history A',{exact:true}).waitFor()
  await app.evaluate(()=>globalThis.uiRace.releaseHistory());await page.waitForTimeout(250)
  assert(await app.evaluate(()=>globalThis.uiRace.historyReturned))
  if(await page.getByText('STALE SELECTION MARKER',{exact:true}).count())report.failures.push('Earlier A selection overwrote the later A selection')
  else report.checks.push('A-B-A navigation discards earlier selection reply')

  await app.evaluate(({ipcMain})=>{
    globalThis.uiRace.originalWork=ipcMain._invokeHandlers.get('work:view');globalThis.uiRace.workReads=0
    ipcMain.removeHandler('work:view');ipcMain.handle('work:view',async(...args)=>{globalThis.uiRace.workReads++;const result=await globalThis.uiRace.originalWork(...args);await new Promise(resolve=>setTimeout(resolve,2500));return result})
  })
  await page.getByRole('button',{name:/Session B/}).click();await page.getByText('Current history B',{exact:true}).waitFor()
  await page.waitForTimeout(6600)
  if(await page.locator('[data-work-ready="true"]').count())report.checks.push('Slow work-view replies settle without being superseded by polling')
  else report.failures.push('Two-second polling starved every 2.5-second work-view reply')
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('work:view');ipcMain.handle('work:view',globalThis.uiRace.originalWork)})
  await page.getByRole('button',{name:/Session A/}).click();await page.getByText('Current history A',{exact:true}).waitFor()

  // Simulate an accepted, delayed send. Auxiliary reads are isolated fixtures so
  // this test cannot execute a backend operation, even if Docker is available.
  await app.evaluate(({ipcMain,BrowserWindow})=>{
    const fixture=(channel,value)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>({unrealResult:true,ok:true,value}))}
    fixture('session:config',{mode:'ask',provider:'openai',model:'fixture'})
    fixture('permission:list',[]);fixture('host:approvals',[]);fixture('context:view',{files:[],selection:{pinned:[],excluded:[],attached:[]},instructions:''})
    fixture('team:view',null);fixture('files:changes',[]);fixture('docker:status',{ready:true,message:'Isolated IPC fixture'})
    ipcMain.removeHandler('session:send');ipcMain.handle('session:send',async()=>{globalThis.uiRace.sendReady=true;await new Promise(resolve=>{globalThis.uiRace.releaseSend=resolve});return {unrealResult:true,ok:true}})
    BrowserWindow.getAllWindows()[0].webContents.send('docker:status-changed',{ready:true,message:'Isolated IPC fixture'})
  })
  const composer=page.getByRole('textbox',{name:'Message UnrealCode'})
  await composer.fill('First submitted draft');await composer.press('Enter')
  for(let i=0;i<100&&!await app.evaluate(()=>globalThis.uiRace.sendReady);i++)await page.waitForTimeout(25)
  assert(await app.evaluate(()=>globalThis.uiRace.sendReady),'Send request was not captured')
  await composer.fill('Next draft written while send was pending')
  await app.evaluate(()=>globalThis.uiRace.releaseSend());await page.getByRole('button',{name:'Send',exact:true}).waitFor()
  if(await composer.inputValue()!=='Next draft written while send was pending')report.failures.push('Successful send erased a newer composer draft')
  else report.checks.push('Send acknowledgment preserves newer draft')
  // A delayed repository read must not replace the next project's changes.
  await app.evaluate(({ipcMain,BrowserWindow})=>{
    let calls=0;globalThis.uiRace.gitReady=false
    ipcMain.removeHandler('files:changes');ipcMain.handle('files:changes',async()=>{
      if(++calls===1){globalThis.uiRace.gitReady=true;await new Promise(resolve=>{globalThis.uiRace.releaseGit=resolve});return {unrealResult:true,ok:true,value:[' M STALE_PROJECT_A.txt']}}
      return {unrealResult:true,ok:true,value:[' M CURRENT_PROJECT_B.txt']}
    })
    BrowserWindow.getAllWindows()[0].webContents.send('docker:status-changed',{ready:false,message:'Fixture reconnect'})
  })
  await page.waitForTimeout(100)
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('docker:status-changed',{ready:true,message:'Fixture connected'}))
  await page.waitForFunction(()=>document.querySelector('.container-status-control')?.textContent.includes('running'))
  for(let i=0;i<100&&!await app.evaluate(()=>globalThis.uiRace.gitReady);i++)await page.waitForTimeout(25)
  assert(await app.evaluate(()=>globalThis.uiRace.gitReady),'First Git read was not captured')
  await app.evaluate(({BrowserWindow},project)=>BrowserWindow.getAllWindows()[0].webContents.send('app:navigate',{project:project+'-other'}),project)
  await page.locator('.workspace-picker button').filter({hasText:'project-other'}).waitFor()
  await page.waitForTimeout(100)
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('docker:status-changed',{ready:true,message:'Fixture connected'}))
  await page.locator('.context-card > summary').filter({hasText:'Workspace changes'}).click();await page.getByText('CURRENT_PROJECT_B.txt',{exact:true}).waitFor()
  await app.evaluate(()=>globalThis.uiRace.releaseGit());await page.waitForTimeout(250)
  if(await page.getByText('STALE_PROJECT_A.txt',{exact:true}).count())report.failures.push('Earlier project Git result replaced the current project changes')
  else report.checks.push('Project switching discards an earlier repository read')
  report.errors=errors;await page.screenshot({path:join(root,'ui-races.png')})
  writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
  assert.deepEqual(report.failures,[]);assert.deepEqual(errors,[])
}catch(error){report.error=String(error);report.errors=errors;writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));throw error}
finally{await app.close()}
