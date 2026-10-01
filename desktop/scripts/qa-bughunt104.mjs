// Browser plugin not available. Isolated offscreen Electron fixtures, no real
// provider, user profile, repository mutation or native input.
import {_electron as electron} from 'playwright'
import {Worker} from 'node:worker_threads'
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-bughunt104-')),profile=join(root,'profile');mkdirSync(profile);mkdirSync(join(root,'project'));const project=realpathSync.native(join(root,'project'))
const ids=['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],stamp='2026-10-01_00-00-00.000Z'
mkdirSync(join(profile,'history-cache'));writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,decisionEngine:'off',provider:'ollama',model:'fixture',theme:'dark',automaticUpdateChecks:false,recentProjects:[project],trustedProjects:[project]}))
writeFileSync(join(profile,'storage-locations.json'),JSON.stringify({version:1,locations:[{kind:'history-cache',key:'history',path:`history-cache/${stamp}.sqlite`,createdAt:new Date().toISOString()}]}))
const worker=new Worker(resolve('out/main/history-worker.cjs'),{workerData:{path:join(profile,'history-cache',stamp+'.sqlite'),reader:false}}),pending=new Map();let requestId=0
await new Promise((resolve,reject)=>{worker.once('error',reject);worker.on('message',m=>{if(m.ready)resolve();else{const p=pending.get(m.id);pending.delete(m.id);m.ok?p?.resolve(m.value):p?.reject(Error(m.error.message))}})})
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});worker.postMessage({id,method,params})})
await request('sessions.put',{project,sessions:ids.map((id,index)=>({id,title:'Failed '+(index?'B':'A'),lastUpdatedAt:new Date().toISOString(),active:false,provider:'ollama',model:'fixture',state:'failed'}))})
for(const [index,id]of ids.entries()){
 const at='2026-10-01T00:00:00Z',event=(seq,payload)=>({v:1,event:'session.item',sessionId:id,seq,recordedAt:at,payload})
 await request('ingest',{batch:[event(1,{Kind:'input',Data:{Kind:'external',Payload:{Prompt:'Fixture '+(index?'B':'A')}}}),event(2,{Kind:'model_response',Data:{TurnID:'failed-turn',Response:{Failure:{Code:'server_error',Message:'Fixture response failed',Issue:{category:'transient',retryable:true}}}}}),{v:1,event:'session.idle',sessionId:id,seq:3,recordedAt:at,payload:{outcome:{state:'failed'}}}].map(event=>({project,event}))})
 await request('sync',{project,session:id})
}
await request('close',{});await worker.terminate()
const packaged=process.argv.includes('--packaged'),app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,DOCKER_HOST:'npipe:////./pipe/unrealcode-bughunt104-fixture',DOCKER_CONTEXT:'',UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
const report={root,packaged,checks:[],failures:[],errors:[]};let page
try{
 page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message));await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor();await page.evaluate(project=>window.unreal.openProject(project,true),project);await page.reload();await page.getByRole('button',{name:/Failed A/}).waitFor()
 if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click()
 await app.evaluate(({ipcMain,BrowserWindow})=>{
  const fixture=(channel,value)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>({unrealResult:true,ok:true,value}))}
  fixture('session:config',{mode:'ask',provider:'ollama',model:'fixture'});fixture('docker:status',{ready:true,message:'IPC fixture'});fixture('permission:list',[]);fixture('host:approvals',[]);fixture('team:view',null);fixture('context:view',{files:[],selection:{pinned:[],excluded:[],attached:[]},instructions:''});fixture('files:changes',[])
  globalThis.retryFixture={calls:[],pending:false};ipcMain.removeHandler('session:retry');ipcMain.handle('session:retry',async(_event,...args)=>{globalThis.retryFixture.calls.push(args);if(globalThis.retryFixture.calls.length===1){globalThis.retryFixture.pending=true;await new Promise(resolve=>globalThis.retryFixture.release=resolve);throw Error('RETRY_A_ONLY_ERROR')}return {unrealResult:true,ok:true}})
  BrowserWindow.getAllWindows()[0].webContents.send('docker:status-changed',{ready:true,message:'IPC fixture'})
 })
 await page.getByRole('button',{name:/Failed A/}).click();await page.getByText('Fixture A',{exact:true}).waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('docker:status-changed',{ready:true,message:'IPC fixture'}));if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click();await page.getByRole('button',{name:'Retry response',exact:true}).click();await page.getByRole('button',{name:'Retrying…',exact:true}).waitFor()
 await page.getByRole('button',{name:/Failed B/}).click();await page.getByText('Fixture B',{exact:true}).waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('docker:status-changed',{ready:true,message:'IPC fixture'}));await page.locator('[data-work-ready="true"]').waitFor({state:'attached'})
 const pendingLeak=await page.getByRole('button',{name:/Retry response|Retrying…/,exact:true}).isDisabled();if(pendingLeak)report.failures.push('Retry A disables retry in conversation B');else report.checks.push('Pending retry is scoped to its conversation')
 await app.evaluate(()=>globalThis.retryFixture.release());await page.waitForTimeout(300)
 if((await page.locator('body').innerText()).includes('RETRY_A_ONLY_ERROR'))report.failures.push('Retry A error appears in conversation B');else report.checks.push('Retry failure remains with its originating conversation')
 await page.getByRole('button',{name:'Retry response',exact:true}).click();await page.waitForTimeout(300)
 const calls=await app.evaluate(()=>globalThis.retryFixture.calls);assert.equal(calls[0][0],ids[0]);assert.equal(calls[1][0],ids[1]);if(calls[0][2]===calls[1][2])report.failures.push('Different conversations reused a retry submission ID');else report.checks.push('Retry receipt identities differ across conversations')
 await page.getByRole('button',{name:/Failed A/}).click();await page.getByText('Fixture A',{exact:true}).waitFor()
 report.checks.push('Navigation remounts recovery controls; the backend separately guards concurrent resumption')
 await page.screenshot({path:join(root,'retry-scope.png')});assert.deepEqual(report.failures,[]);assert.deepEqual(report.errors,[])
}catch(error){report.failure=String(error);if(page)report.tail=(await page.locator('body').innerText()).slice(-1800);throw error}
finally{writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await app.close()}
