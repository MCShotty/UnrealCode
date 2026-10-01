// Browser plugin not available. Use the existing offscreen Electron/Playwright
// harness, disposable profiles and cached events. No coding provider is contacted.
import {_electron as electron} from 'playwright'
import {Worker} from 'node:worker_threads'
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-104-')),profile=join(root,'profile')
mkdirSync(profile);mkdirSync(join(root,'project'));const project=realpathSync.native(join(root,'project'))
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',message='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',stamp='2026-09-30_17-00-00.000Z'
mkdirSync(join(profile,'history-cache'));mkdirSync(join(profile,'timeline-records'))
writeFileSync(join(project,'notes.md'),'# Fixture project\nArabic content: مرحبا\n')
writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,provider:'ollama',model:'fixture',theme:'dark',automaticUpdateChecks:false,recentProjects:[project],trustedProjects:[project],layout:{sessionWidth:290,activityWidth:370,sessions:true,activity:true,focus:false}}))
writeFileSync(join(profile,'storage-locations.json'),JSON.stringify({version:1,locations:[{kind:'history-cache',key:'history',path:`history-cache/${stamp}.sqlite`,createdAt:new Date().toISOString()},{kind:'timeline-records',key:`${project}:${id}`.toLowerCase(),path:`timeline-records/${stamp}.json`,createdAt:new Date().toISOString()}]}))
const legacy=join(root,'v103-worker');mkdirSync(legacy);for(const name of ['history-worker.cjs','activity-projection.cjs','timeline-projection.cjs','fieldnotes-projection.cjs'])writeFileSync(join(legacy,name),execFileSync('git',['show','v1.0.3:desktop/src/main/'+name]));
const worker=new Worker(join(legacy,'history-worker.cjs'),{workerData:{path:join(profile,'history-cache',stamp+'.sqlite'),reader:false}}),jobs=new Map();let requestId=0
await new Promise((resolve,reject)=>{worker.once('error',reject);worker.on('message',m=>{if(m.ready)resolve();else{const job=jobs.get(m.id);jobs.delete(m.id);m.ok?job?.resolve(m.value):job?.reject(Error(m.error.message))}})})
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++requestId;jobs.set(id,{resolve,reject});worker.postMessage({id,method,params})})
let seq=0;const events=[],add=(event,payload)=>{events.push({v:1,event,sessionId:id,seq:++seq,recordedAt:new Date(1700000000000+seq*100).toISOString(),payload});return seq}
add('session.item',{Kind:'input',Data:{Kind:'external',ID:message,Payload:{Prompt:'Inspect the fixture project and verify the result.'}}})
const anchors=[]
for(let i=0;i<30;i++){
 if(i===10||i===20)add('session.item',{Kind:'input',Data:{Kind:'external',ID:'steer-'+i,Payload:{Prompt:'Continue fixture '+i}}})
 const turn='turn-'+i,call='read-'+i,op='operation-'+i
 anchors.push(add('session.item',{Kind:'model_response',Data:{TurnID:turn,Response:{Output:[{Type:'tool_call',Data:{CallID:call,Name:'ReadFile',Arguments:JSON.stringify({path:`file-${i}.md`})}}]}}}))
 add('operation.started',{ID:op,Type:'ReadFile',Status:'awaiting'})
 add('operation.update',{ID:op,Type:'ReadFile',Status:'completed',State:{TerminalResult:{output:'Fixture read'}}})
 add('session.item',{Kind:'tool_call_status',Data:{TurnID:turn,CallID:call,Status:{WaitingFor:[op]},Operations:[{ID:op,Type:'ReadFile',Status:'completed'}]}})
}
add('question.updated',{id:'upgrade-question',sessionId:id,workspaceId:project,revision:1,mode:'background',state:'pending',questions:[{id:'q1',title:'Which check should run?'}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})
add('verification.result',{passed:true})
add('session.item',{Kind:'model_response',Data:{TurnID:'final',Response:{Output:[{Type:'message',Data:{Text:'The fixture task is complete.',Phase:'final_answer'}}]}}})
add('session.idle',{messageIds:[message,'steer-10','steer-20'],outcome:{state:'completed',turnId:'final',messageIds:[message,'steer-10','steer-20']}})
await request('sessions.put',{project,sessions:[{id,title:'Timeline fixture',lastUpdatedAt:new Date().toISOString(),active:false,provider:'ollama',model:'fixture'}]})
await request('ingest',{batch:events.map(event=>({project,event}))});await request('sync',{project,session:id})
const work=(await request('work.view',{project,session:id,connected:false})).works.at(-1)
writeFileSync(join(profile,'timeline-records',stamp+'.json'),JSON.stringify({version:2,rows:[{id:'snapshot',workId:work.id,fromSeq:1,toSeq:seq,planRevision:0,summary:'Project verified',phase:'completed',evidence:[anchors[0],seq-2],createdAt:new Date().toISOString(),provider:'fixture',model:'fixture',usage:{inputTokens:10,outputTokens:10},revision:1,stages:[{id:'inspect',title:'Inspect project',detail:'Read the project files.',phase:'completed',evidence:[anchors[0]],source:'inferred'},{id:'verify',title:'Verify results',detail:'Verification evidence is recorded.',phase:'completed',evidence:[seq-2],source:'inferred'}]}]}))
await request('close',{});await worker.terminate()
const workspace=join(profile,'workspaces',createHash('sha256').update(project.toLowerCase()).digest('hex'));mkdirSync(join(workspace,'conversation-ui'),{recursive:true})
writeFileSync(join(workspace,'conversation-ui',id+'.json'),JSON.stringify({expanded:{'older-work':true},drafts:{'upgrade-question':{revision:1,submissionId:'upgrade-draft',answers:[{questionId:'q1',text:'Keep this draft. ملاحظة'}]}}}))
const library=join(profile,'fieldnotes','legacy-library'),noteId='cccccccc-cccc-cccc-cccc-cccccccccccc',projectId='dddddddd-dddd-dddd-dddd-dddddddddddd',pointer={projectId,projectPath:project,projectName:'project'},now=new Date().toISOString()
mkdirSync(join(library,'notes'),{recursive:true});writeFileSync(join(library,'schema.json'),JSON.stringify({version:1}));writeFileSync(join(library,'projects.json'),JSON.stringify([{id:projectId,path:project,name:'project'}]));writeFileSync(join(library,'notes',noteId+'.json'),JSON.stringify({id:noteId,revision:1,title:'Upgrade guidance',body:'Preserve this note. ملاحظة',pointer,enabled:true,indexing:false,createdAt:now,updatedAt:now,sync:{state:'local',attempts:0}}))
const locations=JSON.parse(readFileSync(join(profile,'storage-locations.json'),'utf8'));locations.locations.push({kind:'fieldnotes',key:'library',path:'fieldnotes/legacy-library',createdAt:now});writeFileSync(join(profile,'storage-locations.json'),JSON.stringify(locations))

const packaged=process.argv.includes('--packaged')||!!process.env.UNREALCODE_QA_EXECUTABLE
const app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,DOCKER_HOST:'npipe:////./pipe/unrealcode-104-fixture',DOCKER_CONTEXT:'',UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
const report={root,packaged,checks:[],failures:[],errors:[],matrix:[]};let page
async function shot(name){
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&innerWidth>1000&&(!document.querySelector('.view-frame')||getComputedStyle(document.querySelector('.view-frame')).opacity==='1'))
 await page.waitForTimeout(350)
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const png=await app.evaluate(({BrowserWindow})=>new Promise((resolve,reject)=>{
  const contents=BrowserWindow.getAllWindows()[0].webContents
  const timer=setTimeout(()=>{contents.removeListener('paint',paint);reject(Error('Offscreen paint did not arrive'))},5000)
  let frames=0;const paint=(_event,_rect,image)=>{if(image.isEmpty())return;if(++frames<2){contents.invalidate();return;}clearTimeout(timer);contents.removeListener('paint',paint);resolve(image.toPNG().toString('base64'))}
  contents.on('paint',paint);contents.invalidate()
 }))
 writeFileSync(join(root,name+'.png'),Buffer.from(png,'base64'))
}

try{
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message))
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 await page.getByRole('button',{name:'Provider settings',exact:true}).click();await page.getByRole('tab',{name:'Memory',exact:true}).click()
 await page.getByRole('button',{name:'Browse app-wide memories',exact:true}).click()
 await page.waitForTimeout(250)
 if(await page.locator('.memory-page').count())report.checks.push('Memory browsing works without an open project')
 else report.failures.push('Memory browse button does not open the app-wide page before a project is opened')
 if(await page.getByRole('button',{name:'Close settings'}).count())await page.getByRole('button',{name:'Close settings'}).click()
 await page.evaluate(project=>window.unreal.openProject(project,true),project);await page.reload()
 await page.getByRole('button',{name:/Timeline fixture/}).waitFor()
 if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click()
 await page.getByRole('button',{name:/Timeline fixture/}).click()
 await page.getByText('The fixture task is complete.',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.density),'compact')
 assert.equal((await page.evaluate(()=>window.unreal.getSettings())).layout.sessionWidth,290)
 assert.equal(await page.locator('.agent-ready,.context-status').count(),0)
 assert.equal(await page.locator('.container-status-control').count(),1)
 await page.getByText('Inspect project',{exact:true}).waitFor();assert.equal(await page.locator('.timeline-summary').count(),0)
 report.checks.push('Cached interpreted stages, Compact upgrade default, retained pane widths and single top-right status')
 const upgradedUI=await page.evaluate(id=>window.unreal.conversationUI(id),id);assert(upgradedUI.expanded['older-work']);assert.equal(upgradedUI.drafts['upgrade-question'].answers[0].text,'Keep this draft. ملاحظة')
 assert.equal((await page.evaluate(id=>window.unreal.workView(id),id)).questions.find(q=>q.id==='upgrade-question')?.revision,1)
 assert.equal((await page.evaluate(()=>window.unreal.fieldnoteList({includeDisabled:true}))).notes.find(note=>note.id==='cccccccc-cccc-cccc-cccc-cccccccccccc')?.body,'Preserve this note. ملاحظة')
 report.checks.push('Actual v1.0.3 worker profile upgrade retains Fieldnotes, question drafts, question revision and manual disclosure choices')

 await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('timeline:view');globalThis.__timelineReads=0;ipcMain.removeHandler('timeline:view');ipcMain.handle('timeline:view',(...args)=>{globalThis.__timelineReads++;return original(...args)})})
 await page.waitForTimeout(6300);const polls=await app.evaluate(()=>globalThis.__timelineReads);assert(polls>=2&&polls<=3)
 await page.evaluate(()=>{window.__timelineHidden=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__timelineHidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'))})
 const paused=await app.evaluate(()=>globalThis.__timelineReads);await page.waitForTimeout(6100);assert.equal(await app.evaluate(()=>globalThis.__timelineReads),paused)
 await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))})
 report.checks.push('Three-second cached polling, hidden-page suppression and no observer inference from polling')

 for(const button of await page.locator('.work-disclosure').all())await button.click()
 assert.equal(await page.locator('.compact-work-event').count(),4);assert.equal(await page.locator('.work-faded-peek').count(),1)
 await page.getByRole('button',{name:'Show all',exact:true}).click();assert.equal(await page.locator('.compact-work-event').count(),20)
 await page.getByRole('button',{name:'Show 20 earlier entries',exact:true}).click();assert.equal(await page.locator('.compact-work-event').count(),30)
 await page.getByRole('button',{name:'Show recent activity',exact:true}).click()
 await page.getByRole('button',{name:`Open evidence event ${anchors[0]} for Inspect project`,exact:true}).click()
 await page.waitForTimeout(250);assert.equal(await page.locator('.compact-work-event').count(),30)
 report.checks.push('Chronological steering, global twenty-entry pagination, four-entry cutoff, decorative peek, Show all and evidence revealing hidden work')
 for(const button of await page.locator('.work-disclosure').all())await button.click()
 assert.equal(await page.locator('.work-content[hidden]').count(),0)
 await page.waitForTimeout(250);assert.equal(await page.locator('.work-content').count(),0)
 report.checks.push('Disclosure fades before removal')
 await page.locator('.container-status-control > summary').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.container-status-control[open]').count(),0)
 report.checks.push('Container status Escape dismissal')
 // Presentation-only IPC values expose connected composer surfaces without
 // authorizing any send, edit or backend execution in this disposable profile.
 await app.evaluate(({ipcMain,BrowserWindow})=>{
  for(const [channel,value]of [['team:view',null],['permission:list',[]],['host:approvals',[]],['context:view',{files:[],selection:{pinned:[],excluded:[],attached:[]},instructions:''}],['session:config',{mode:'ask',provider:'ollama',model:'fixture'}],['files:changes',[]]]){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>({unrealResult:true,ok:true,value}))}
  BrowserWindow.getAllWindows()[0].webContents.send('docker:status-changed',{ready:true,message:'Presentation fixture'})
 })

 if(!process.argv.includes('--capture-only'))for(const theme of ['dark','ice-dark','light','system'])for(const density of ['compact','cozy'])for(const zoom of [1,1.5,2]){
  await page.evaluate(({theme,density})=>window.unreal.updateSettings({theme,density}),{theme,density})
  await app.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),zoom)
  await page.waitForTimeout(80)
  const bounds=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,headerHeight:document.querySelector('.app-topbar').getBoundingClientRect().height,density:document.documentElement.dataset.density}))
  assert(!bounds.overflow,`${theme}/${density}/${zoom}: horizontal overflow`);assert.equal(bounds.density,density)
  const nav=page.getByRole('navigation',{name:'Main navigation'});await nav.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor()
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`${theme}/${density}/${zoom}: Settings overflow`)
  await nav.getByRole('button',{name:'Chat',exact:true}).click();await page.getByLabel('Message UnrealCode').waitFor()
  for(const trigger of [page.getByRole('button',{name:/Files & skills/}),page.locator('.task-options-trigger')]){
   if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click();
   await trigger.click();const surface=page.getByRole('dialog').last();await surface.waitFor()
   await page.waitForFunction(()=>{const e=[...document.querySelectorAll('dialog[open],[role="dialog"]')].at(-1),b=e?.getBoundingClientRect();return b&&b.left>=-1&&b.top>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1})
   assert(!(await surface.evaluate(e=>e.scrollWidth>e.clientWidth+1)),`${theme}/${density}/${zoom}: picker overflow`)
   await page.keyboard.press('Escape');await surface.waitFor({state:'detached'})
  }
  report.matrix.push({theme,density,zoom,...bounds,settings:true,pickers:true})

 }
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1400,900);w.webContents.setZoomFactor(1)})
 await page.evaluate(()=>window.unreal.updateSettings({theme:'dark',density:'compact'}));await shot('compact-timeline')
 await page.evaluate(()=>window.unreal.updateSettings({density:'cozy'}));await shot('cozy-timeline')
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.work-disclosure').first().click();assert.equal(await page.locator('[data-playing="true"]').count(),0)
 report.checks.push(process.argv.includes('--capture-only')?'Cinder Dark captures and reduced motion':'All four themes, both densities, 100/150/200 percent zoom and reduced motion')
 await app.evaluate(({ipcMain})=>{
  const original=ipcMain._invokeHandlers.get('work:view');globalThis.__selectionWorkOpen=true
  ipcMain.removeHandler('work:view');ipcMain.handle('work:view',async(...args)=>{const result=await original(...args),work=result.value.works.at(-1);work.id='selection-fixture';work.open=globalThis.__selectionWorkOpen;work.state=work.open?'running':'completed';return result})
 })
 const held=page.locator('[data-work-id="selection-fixture"]').last();await held.locator('.compact-work-event').first().waitFor()
 await page.getByLabel('Message UnrealCode').focus()
 await held.evaluate(root=>{const text=root.querySelector('.compact-event-text').firstChild,range=document.createRange();range.selectNodeContents(text);window.getSelection().removeAllRanges();window.getSelection().addRange(range);const scroll=root.closest('.chat-scroll');scroll.scrollTop=scroll.scrollHeight})
 await app.evaluate(()=>{globalThis.__selectionWorkOpen=false});await page.waitForTimeout(2400)
 assert.equal(await held.locator('.work-disclosure').getAttribute('aria-expanded'),'true');assert((await page.evaluate(()=>window.getSelection().toString())).length>0)
 report.checks.push('Automatic completion preserves selected work text at the bottom of the chat')

 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failures,[])
}catch(error){report.failure=String(error);if(page){await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});report.tail=(await page.locator('body').innerText()).slice(-2500)}throw error}
finally{writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await app.close()}
