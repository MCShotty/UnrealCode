// Isolated, offscreen desktop checks. No provider credentials or real profile.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-history-ui-')),profile=join(root,'profile');let project=join(root,'project')
mkdirSync(profile);mkdirSync(project);project=realpathSync.native(project);mkdirSync(join(profile,'history-cache'))
const stamp='2026-09-27_18-42-10.123Z',database=join(profile,'history-cache',stamp+'.sqlite'),session='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,theme:'dark',recentProjects:[project],trustedProjects:[project]}))
writeFileSync(join(profile,'storage-locations.json'),JSON.stringify({version:1,locations:[{kind:'history-cache',key:'history',path:`history-cache/${stamp}.sqlite`,createdAt:new Date().toISOString()}]}))
const seed=new Worker(resolve('out/main/history-worker.cjs'),{workerData:{path:database,reader:false}}),jobs=new Map();let next=0
await new Promise((resolve,reject)=>{seed.once('error',reject);seed.on('message',message=>{if(message.ready)resolve();else{const callback=jobs.get(message.id);jobs.delete(message.id);message.ok?callback?.resolve(message.value):callback?.reject(new Error(message.error.message))}})})
const send=(method,params)=>new Promise((resolve,reject)=>{const id=++next;jobs.set(id,{resolve,reject});seed.postMessage({id,method,params})})
await send('sessions.put',{project,sessions:[{id:session,title:'Original session title',lastUpdatedAt:'2026-09-27T18:42:10Z',active:false}]})
await send('ingest',{batch:Array.from({length:1100},(_,i)=>({project,event:{v:1,event:'session.item',sessionId:session,seq:i+1,recordedAt:'2026-09-27T18:42:10Z',payload:{Kind:'input',Data:{Kind:'external',Payload:{Prompt:`Recorded message ${i+1}`}}}}}))})
await send('sync',{project,session});await send('close',{});await seed.terminate()
const packaged=process.argv.includes('--packaged'),app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,DOCKER_CONTEXT:'',DOCKER_HOST:'npipe:////./pipe/unrealcode-missing-linux-engine-fixture',UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
const page=await app.firstWindow(),errors=[],consoleIssues=[],report={root,packaged,checks:[]};page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))consoleIssues.push({level:message.type(),text:message.text()})})
try{
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor();assert.match(await page.title(),/UnrealCode/);assert.match(page.url(),/^file:/);assert.equal(await page.locator('vite-error-overlay').count(),0)
 const recovery=await page.evaluate(()=>window.unreal.recoveryStatus());assert(recovery.waitingForDependency);assert(!recovery.migrationError);assert(!existsSync(join(profile,'data-version.json')))
 await page.getByRole('alert',{name:'Waiting for Docker'}).waitFor();assert(!(await page.locator('.failure-notice > p').innerText()).includes('npipe:'));report.checks.push('missing-pipe-is-dependency-not-corruption')
 await page.getByRole('button',{name:'Dismiss issue'}).click()
 await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setMinimumSize(600,400);window.setContentSize(1000,600)})
 await page.screenshot({path:join(root,'welcome-scrollbar.png')})
 for(const theme of ['dark','light','system']){
  await page.evaluate(theme=>window.unreal.updateSettings({theme}),theme);await page.reload();await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
  if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click()
  for(const scale of [1,1.5,2]){
   await app.evaluate(({BrowserWindow},scale)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale),scale)
   const metrics=await page.locator('.welcome-main').evaluate(element=>{element.scrollTop=element.scrollHeight;return {client:element.clientHeight,scroll:element.scrollHeight,top:element.scrollTop,width:getComputedStyle(element,'::-webkit-scrollbar').width}})
   assert(metrics.scroll>metrics.client);assert(metrics.top>0);assert.equal(metrics.width,'12px')
   await page.getByRole('button',{name:'Provider settings',exact:true}).focus();assert(await page.getByRole('button',{name:'Provider settings',exact:true}).isVisible())
  }
  await page.screenshot({path:join(root,`welcome-${theme}.png`)});report.checks.push(`${theme}-scroll-100-150-200-percent`)
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));await page.emulateMedia({reducedMotion:'reduce'})
 await page.evaluate(project=>window.unreal.openProject(project,true),project);await page.reload();await page.getByText('Original session title',{exact:true}).first().click()
 await page.getByText('Recorded message 1100',{exact:true}).waitFor();await page.getByText('Offline · cached history',{exact:false}).waitFor()
 if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click();await page.getByRole('button',{name:'Load older',exact:true}).click();await page.getByText('Recorded message 1',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isEnabled(),false)
 const hits=await page.evaluate(()=>window.unreal.searchHistory('message 777'));assert(hits.some(hit=>hit.seq===777))
 await page.locator('.history-navigation').getByRole('button',{name:'Jump to latest'}).click()
 const scroll=page.locator('.chat-scroll');await scroll.evaluate(element=>{element.scrollTop=100});await page.waitForTimeout(100)
 const position=await scroll.evaluate(element=>element.scrollTop)
 await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].webContents.send('agent:event',{v:1,event:'desktop.history',sessionId:id,seq:-1,payload:{after:1100}}),session)
 await page.locator('.history-navigation').getByRole('button',{name:'Jump to latest'}).waitFor();assert(Math.abs(await scroll.evaluate(element=>element.scrollTop)-position)<2)
 const failure=await page.evaluate(async id=>{try{await window.unreal.sendMessage(id,'Fixture must remain offline','fixture-input');return null}catch(error){return error.failure}},session)
 assert.equal(failure.code,'DOCKER_UNAVAILABLE');assert(failure.actions.includes('docker-open'));report.checks.push('scroll-preserved-during-refresh','structured-error-survives-preload')
 const cachedBefore=await page.evaluate(id=>window.unreal.historyPage(id,{limit:1}),session)
 const rebuildFailure=await page.evaluate(async()=>{try{await window.unreal.rebuildHistoryCache();return null}catch(error){return error.failure}},session)
 assert.equal(rebuildFailure?.code,'DOCKER_UNAVAILABLE','Rebuild must wait for Docker before replacing the only offline history cache')
 const cachedAfter=await page.evaluate(id=>window.unreal.historyPage(id,{limit:1}),session)
 assert.deepEqual(cachedAfter.events,cachedBefore.events,'Failed rebuild must preserve cached conversation events')
 report.checks.push('offline-rebuild-preserves-cached-history')
 report.checks.push('offline-history-worker-loading-search-and-pagination');report.errors=errors;report.consoleIssues=consoleIssues;assert.deepEqual(errors,[]);assert.deepEqual(consoleIssues.filter(item=>item.level==='error'),[])
 await page.screenshot({path:join(root,'offline-history.png')});writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(error){report.error=String(error);report.errors=errors;writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});console.log(JSON.stringify(report));throw error}
finally{await app.close()}
