// Maintained composer/activity regression. Run from desktop; all fault injection,
// projects, profiles, reports and screenshots are isolated from the user's data.
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-controls-')),project=join(root,'project');mkdirSync(project);writeFileSync(join(project,'README.md'),'Fixture project');execFileSync('git',['init'],{cwd:project,stdio:'ignore'});execFileSync('git',['add','README.md'],{cwd:project,stdio:'ignore'});execFileSync('git',['-c','user.name=UI Fixture','-c','user.email=fixture@example.invalid','commit','-m','Fixture baseline'],{cwd:project,stdio:'ignore'})
const requests=[],errors=[],report={root,checks:[],errors}
const server=createServer(async(req,res)=>{
 let data='';for await(const chunk of req)data+=chunk
 if(!data){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'fixture'}]}));return}
 const body=JSON.parse(data);requests.push(body)
 const user=body.messages.find(m=>m.role==='user')?.content||'',priorCall=body.messages.some(m=>m.role==='assistant'&&m.tool_calls?.length)
 const message=user.includes('RUN_CONTROLS')&&!priorCall?{role:'assistant',content:'Inspecting independently while you steer.',tool_calls:['one','two'].map(id=>({id,type:'function',function:{name:'Bash',arguments:JSON.stringify({command:`printf ${id}; sleep 120`})}}))}:{role:'assistant',content:'Steering received. Independent tools can settle.'}
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:crypto.randomUUID(),choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage:{prompt_tokens:30,completion_tokens:12}}))
})
await new Promise(r=>server.listen(0,'0.0.0.0',r))
const app=await electron.launch({executablePath:process.env.UNREALCODE_QA_EXECUTABLE||resolve('node_modules/electron/dist/electron.exe'),args:process.env.UNREALCODE_QA_EXECUTABLE?[]:['.'],cwd:process.cwd(),env:{...process.env,UNREAL_DESKTOP_BACKGROUND_CHECK:'1',UNREAL_DESKTOP_USER_DATA:join(root,'data')}})
let page
const wait=async(fn,label)=>{const until=Date.now()+90000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+label)}
try{
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message))
 await page.getByRole('button',{name:'Set up later'}).click()
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
 const api=(name,...args)=>page.evaluate(({name,args})=>window.unreal[name](...args),{name,args})
 await api('updateSettings',{provider:'openai-compatible',model:'fixture',baseUrl:`http://localhost:${server.address().port}/v1`,executionMode:'agent',taskIsolation:false,notifications:false,theme:'dark'})
 await api('openProject',project,true);await page.reload()
 const smart=page.locator('.composer-smart-action'),composer=page.getByLabel('Message UnrealCode')
 assert(await smart.isDisabled());await composer.press('Enter');assert.equal(requests.length,0)
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},resolve('assets/unrealcode-icon.png'))
 await page.getByRole('button',{name:'Attach image',exact:true}).click();await wait(()=>smart.isEnabled(),'image-only draft enables send')
 await page.getByRole('button',{name:'unrealcode-icon.png ×',exact:true}).click();await wait(()=>smart.isDisabled(),'image removal disables send')
 report.checks.push('image-only draft notifications and empty Enter')
 const openOptions=async()=>{await page.locator('.task-options-trigger').click();await page.getByRole('dialog',{name:'Task options',exact:true}).waitFor();return page.getByRole('dialog',{name:'Task options',exact:true})}
 let dialog=await openOptions();assert(await dialog.getByLabel('Concurrent specialists').isDisabled())
 report.menuBounds=await dialog.evaluate(e=>{const b=e.getBoundingClientRect();return {width:b.width,height:b.height,right:b.right,bottom:b.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight}})
 assert(report.menuBounds.width<=422&&report.menuBounds.height<=502,'desktop task menu stays compact')
 await dialog.getByRole('button',{name:'Manual',exact:true}).click();await dialog.getByLabel('Concurrent specialists').fill('3');await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 dialog=await openOptions();assert.equal(await dialog.getByRole('button',{name:'Off',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await dialog.getByLabel('Concurrent specialists').inputValue(),'2')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(850,650))
 await page.waitForFunction(()=>{const e=document.querySelector('.task-options-dialog'),b=e?.getBoundingClientRect();return b&&!e.classList.contains('sheet')&&b.left>=0&&b.top>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1})
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1500,940))
 await dialog.getByRole('button',{name:'Automatic',exact:true}).click();await dialog.getByRole('button',{name:'Manual',exact:true}).click();await dialog.getByLabel('Concurrent specialists').fill('3');await dialog.getByLabel('Total specialists').fill('6')
 await dialog.getByRole('button',{name:/Task limits/}).click();await dialog.getByLabel('Model request limit').fill('20');assert.equal(await dialog.getByLabel('Active minutes limit').inputValue(),'')
 await wait(async()=>dialog.locator('.task-budget-fields').evaluate(e=>Math.abs(e.getBoundingClientRect().height-e.scrollHeight)<2),'task limit expansion settled')
 report.expandedMenu=await dialog.evaluate(e=>{const b=e.getBoundingClientRect(),body=e.querySelector('.task-options-body'),footer=e.querySelector('footer').getBoundingClientRect();return {width:b.width,height:b.height,bodyHeight:body.clientHeight,bodyScrollHeight:body.scrollHeight,footerBottom:footer.bottom,dialogBottom:b.bottom}})
 assert(report.expandedMenu.height<=502&&report.expandedMenu.bodyHeight>80&&report.expandedMenu.bodyScrollHeight>report.expandedMenu.bodyHeight&&report.expandedMenu.footerBottom<=report.expandedMenu.dialogBottom+1,'expanded limits scroll inside menu with reachable footer')
 await page.screenshot({path:join(root,'task-options-dark.png')});await dialog.getByRole('button',{name:'Apply',exact:true}).click();await page.locator('.task-options-trigger').filter({hasText:'Manual'}).waitFor()
 report.checks.push('new-task options cancel/apply and three delegation policies')
 // Main-process fault injection is limited to this disposable profile.
 await app.evaluate(({ipcMain})=>{globalThis.qaSend=ipcMain._invokeHandlers.get('session:send');globalThis.qaFailures=1;globalThis.qaSendCalls=0;globalThis.qaDelay=350;ipcMain.removeHandler('session:send');ipcMain.handle('session:send',async(...args)=>{globalThis.qaSendCalls++;await new Promise(r=>setTimeout(r,globalThis.qaDelay));if(globalThis.qaFailures-- >0)throw Error('Injected submission failure');return globalThis.qaSend(...args)})})
 await composer.fill('RUN_CONTROLS');await smart.dblclick();await wait(async()=>await smart.getAttribute('aria-label')==='Sending…','sending feedback');assert(await smart.isDisabled())
 await wait(()=>smart.isEnabled(),'failed submission unlock');assert.equal(await composer.inputValue(),'RUN_CONTROLS');await page.getByText('Injected submission failure',{exact:false}).first().waitFor();assert.equal(await app.evaluate(()=>globalThis.qaSendCalls),1)
 await smart.click();await wait(async()=>await smart.getAttribute('aria-label')==='Stop','running no-draft stop')
 const sessions=await api('listSessions'),id=sessions[0].id
 const team=await api('teamView',id);assert.equal(team.options.policy,'manual');assert.equal(team.options.concurrency,3);assert.equal(team.options.modelRequestLimit,20)
 await wait(async()=>(await api('activityPage',id)).executing===2,'parallel tools execute')
 await composer.press('Enter');assert.equal((await api('activityPage',id)).executing,2)
 await composer.fill('Keep both independent tools going.');assert.equal(await smart.getAttribute('aria-label'),'Send')
 const start=Date.now();await smart.click();await wait(async()=>await composer.inputValue()==='','steering accepted');report.steeringUiMs=Date.now()-start
 assert.equal((await api('activityPage',id)).executing,2)
 await page.waitForFunction(()=>!!document.querySelector('.expressive-progress[data-playing="true"]'))
 await page.emulateMedia({reducedMotion:'reduce'});await wait(async()=>await page.locator('.expressive-progress[data-playing="true"]').count()===0,'live reduced motion');await page.emulateMedia({reducedMotion:'no-preference'});await wait(async()=>await page.locator('.expressive-progress[data-playing="true"]').count()>0,'motion resumes')
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))});await wait(async()=>await page.locator('.expressive-progress[data-playing="true"]').count()===0,'hidden document pauses loops');await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))});await wait(async()=>await page.locator('.expressive-progress[data-playing="true"]').count()>0,'visible document resumes loops')
 report.checks.push('active progress reacts immediately to reduced motion and document visibility')

 report.checks.push('failure preserves draft, explicit pending state, live steering while two tools execute')
 dialog=await openOptions();await dialog.getByRole('button',{name:'Automatic',exact:true}).click()
 await app.evaluate(({ipcMain})=>{globalThis.qaConfigure=ipcMain._invokeHandlers.get('team:configure');ipcMain.removeHandler('team:configure');ipcMain.handle('team:configure',async()=>{throw Error('Injected settings failure')})})
 await dialog.getByRole('button',{name:'Apply',exact:true}).click();await dialog.getByText('Injected settings failure',{exact:false}).waitFor();assert.equal((await api('teamView',id)).options.policy,'manual')
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('team:configure');ipcMain.handle('team:configure',globalThis.qaConfigure)})
 await page.locator('.activity-heading').first().click();await page.getByRole('heading',{name:'Tool Activity',exact:true}).waitFor()
 const panel=page.locator('.tool-activity-panel');await panel.getByRole('button').filter({hasText:'Bash'}).first().click();await panel.getByRole('heading',{name:'Arguments',exact:true}).waitFor();await panel.getByLabel('Search tool activity').fill('Bash');await panel.getByLabel('Activity status').selectOption('executing')
 report.alignment=await panel.evaluate(e=>({panelTop:e.getBoundingClientRect().top,headerBottom:document.querySelector('.app-topbar').getBoundingClientRect().bottom,chatWidth:document.querySelector('.workspace-page').getBoundingClientRect().width,compact:e.classList.contains('compact')}))
 assert(!report.alignment.compact);assert(Math.abs(report.alignment.panelTop-report.alignment.headerBottom)<=2);assert(report.alignment.chatWidth>=520)
 await page.screenshot({path:join(root,'activity-aligned-dark.png')})
 await panel.locator('.tool-activity-body').evaluate(e=>e.scrollTop=180);report.scrollBefore=await panel.locator('.tool-activity-body').evaluate(e=>({top:e.scrollTop,height:e.clientHeight,content:e.scrollHeight}));assert(report.scrollBefore.top>0,'wide pane must have scrollable content')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1050,740));await wait(async()=>await panel.evaluate(e=>e.classList.contains('compact')),'compact activity')
 assert.equal(await panel.getByLabel('Search tool activity').inputValue(),'Bash');assert.equal(await panel.getByLabel('Activity status').inputValue(),'executing');await panel.getByRole('heading',{name:'Arguments',exact:true}).waitFor();assert(await panel.locator('.tool-activity-body').evaluate(e=>e.scrollTop>0))
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,1000));await wait(async()=>!(await panel.evaluate(e=>e.classList.contains('compact'))),'wide activity');await panel.getByRole('heading',{name:'Arguments',exact:true}).waitFor()
 await page.getByRole('button',{name:'Close tool activity'}).click()
 report.checks.push('failed settings remain unapplied; activity below toolbar preserves filters/detail/scroll across layout changes')
 await composer.fill('Retain this draft after stopping')
 await app.evaluate(({ipcMain})=>{globalThis.qaStop=ipcMain._invokeHandlers.get('session:stop');ipcMain.removeHandler('session:stop');ipcMain.handle('session:stop',async(...args)=>{await new Promise(r=>setTimeout(r,500));return globalThis.qaStop(...args)})})
 await composer.press('Control+Shift+Period');await wait(async()=>await smart.getAttribute('aria-label')==='Stopping…','stopping feedback');assert(await smart.isDisabled());await wait(async()=>(await api('activityPage',id)).executing===0,'independent tools cancelled')
 await wait(()=>smart.isEnabled(),'stop settled with draft');assert.equal(await composer.inputValue(),'Retain this draft after stopping');assert.equal(await smart.getAttribute('aria-label'),'Send');await composer.fill('');assert(await smart.isDisabled())
 report.checks.push('stop shortcut while draft exists, scoped stopping state, preserved draft and settled idle button')
 await page.getByRole('button',{name:'New session',exact:true}).first().click();await wait(async()=>(await api('listSessions')).length===2,'second conversation')
 await page.locator('.session-row').filter({hasText:'RUN_CONTROLS'}).first().click();await composer.fill('QUICK scoped pending request');await app.evaluate(()=>{globalThis.qaDelay=3000})
 await smart.click();await wait(async()=>await smart.getAttribute('aria-label')==='Sending…','scoped submission')
 await page.locator('.session-row').filter({hasNotText:'RUN_CONTROLS'}).first().click();assert.notEqual(await smart.getAttribute('aria-label'),'Sending…');await composer.fill('Draft edited while another conversation sends')
 await page.locator('.session-row').filter({hasText:'RUN_CONTROLS'}).first().click();assert.equal(await smart.getAttribute('aria-label'),'Sending…');await wait(async()=>await smart.getAttribute('aria-label')!=='Sending…','originating request settled');assert.equal(await composer.inputValue(),'Draft edited while another conversation sends')
 await composer.fill('');report.checks.push('double activation sends once; A to B to A preserves scoped pending state and edited draft')
 for(const theme of ['light','system']){await api('updateSettings',{theme});await page.reload();await page.locator('.session-row').first().click();dialog=await openOptions();await page.screenshot({path:join(root,`task-options-${theme}.png`)});await dialog.getByRole('button',{name:'Cancel',exact:true}).click()}
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1100,800);w.webContents.setZoomFactor(2)})
 await page.emulateMedia({reducedMotion:'reduce'});dialog=await openOptions();await wait(async()=>await dialog.evaluate(e=>e.classList.contains('sheet')),'task-options sheet')
 await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion:reduce)').matches);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 const bounds=await dialog.evaluate(e=>{const b=e.getBoundingClientRect();return {right:b.right,bottom:b.bottom,width:innerWidth,height:innerHeight}});assert(bounds.right<=bounds.width+1&&bounds.bottom<=bounds.height+1);report.sheetBounds=bounds
 assert.equal(await page.locator('.expressive-progress[data-playing="true"]').count(),0)
 writeFileSync(join(root,'task-options-sheet.png'),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')),'base64'))
 await page.keyboard.press('Escape');await wait(async()=>await page.locator('.task-options-trigger').evaluate(e=>e===document.activeElement),'focus restoration')
 report.checks.push('dark/light/system, 200% task sheet, reduced motion and Escape focus restoration')
 assert.equal(errors.length,0);report.requests=requests.length
}catch(error){report.failure=String(error);if(page){await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});report.visible=(await page.locator('body').innerText()).slice(-14000)}throw error}
finally{writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await app.close();server.close()}
