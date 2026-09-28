// Offscreen packaged/development UI fixture. GitHub responses are intercepted
// in Electron main; links are captured instead of opening visible windows.
import {_electron as electron} from 'playwright'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-release-notice-')),profile=join(root,'profile');mkdirSync(profile)
writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,theme:'dark',systemPrompt:'Preserved upgrade fixture instructions',provider:'ollama',model:'legacy-fixture'}))
writeFileSync(join(profile,'data-version.json'),JSON.stringify({schema:1,version:'1.0.0'}))
const packaged=process.argv.includes('--packaged'),executablePath=resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe'))
const launch=()=>electron.launch({executablePath,args:packaged?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'},cwd:process.cwd()})
// Resizing an offscreen surface can briefly invalidate Chromium's copy target.
// Wait for rendered frames and retry only that transient capture failure.
async function captureSettled(app,page){
 for(let attempt=0;attempt<3;attempt++){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  try{return await app.evaluate(async({BrowserWindow})=>{const image=await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true});if(image.isEmpty())throw Error('Empty screenshot');return image.toPNG().toString('base64')})}
  catch(error){if(!String(error).includes('UnknownVizError')||attempt===2)throw error;await page.waitForTimeout(100*(attempt+1))}
 }
}
let app=await launch();const report={root,packaged,checks:[],errors:[]}
try{
 let page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 assert.match(await page.title(),/UnrealCode/);assert.equal(await page.locator('vite-error-overlay').count(),0)
 await app.evaluate(({shell})=>{
  globalThis.__releaseCalls=[];globalThis.__openedRelease=[];shell.openExternal=async url=>{globalThis.__openedRelease.push(url)}
  globalThis.fetch=async(url,options)=>{if(!String(url).startsWith('https://api.github.com/repos/MCShotty/UnrealCode/releases?'))throw Error('Unexpected fixture URL');globalThis.__releaseCalls.push({url,auth:new Headers(options.headers).has('authorization')});const v='9.9.9';return new Response(JSON.stringify([{draft:false,prerelease:false,tag_name:'v'+v,html_url:`https://github.com/MCShotty/UnrealCode/releases/tag/v${v}`,assets:[`UnrealCode-Setup-${v}.exe`,'SHA256SUMS'].map(name=>({name,state:'uploaded',size:12,browser_download_url:`https://github.com/MCShotty/UnrealCode/releases/download/v${v}/${name}`}))}]),{headers:{etag:'"fixture"','content-type':'application/json'}})}
 })
 assert.deepEqual(await page.evaluate(async()=>{const s=await window.unreal.getSettings();return {provider:s.provider,model:s.model,prompt:s.systemPrompt,automatic:s.automaticUpdateChecks}}),{provider:'ollama',model:'legacy-fixture',prompt:'Preserved upgrade fixture instructions',automatic:true})
 await page.getByRole('button',{name:'Provider settings',exact:true}).click();await page.getByRole('tab',{name:'Recovery',exact:true}).click()
 const toggle=page.getByLabel('Check automatically after startup and once daily');await toggle.uncheck();await page.waitForFunction(async()=>!(await window.unreal.getSettings()).automaticUpdateChecks)
 if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click()
 await page.getByRole('button',{name:'Check for updates',exact:true}).click();const notice=page.getByRole('complementary',{name:'New UnrealCode release'});await notice.waitFor();assert.equal(await notice.evaluate(el=>el.contains(document.activeElement)),false)
 await notice.getByRole('button',{name:'View release & changelog',exact:true}).click();assert.deepEqual(await app.evaluate(()=>globalThis.__openedRelease),['https://github.com/MCShotty/UnrealCode/releases/tag/v9.9.9'])
 assert.equal(await page.getByRole('button',{name:'Restart and install',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Download 9.9.9',exact:true}).count(),0)
 assert.equal(await page.evaluate(async()=>{try{await window.unreal.updateDownload();return false}catch{return true}}),true)
 assert.equal(await page.evaluate(async()=>{try{await window.unreal.updateInstall();return false}catch{return true}}),true)
 if(await page.getByRole('button',{name:'Dismiss issue'}).count())await page.getByRole('button',{name:'Dismiss issue'}).click()
 for(const theme of ['dark','light']){
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.getByLabel('Theme',{exact:true}).selectOption(theme);const save=page.getByRole('button',{name:'Save settings',exact:true});if(await save.isVisible())await save.click();await page.getByRole('tab',{name:'Recovery',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(400,400);w.setSize(1200,900);w.webContents.setZoomFactor(1.5)})
  await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme)
  assert(await notice.evaluate(el=>{const b=el.getBoundingClientRect();return b.right<=innerWidth&&b.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth+1}))
  writeFileSync(join(root,`notice-${theme}.png`),Buffer.from(await captureSettled(app,page),'base64'))
 }
 await notice.getByRole('button',{name:'Dismiss',exact:true}).focus();await page.keyboard.press('Enter');await notice.waitFor({state:'detached'})
 await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.getByLabel('Theme',{exact:true}).selectOption('dark');await page.getByRole('button',{name:'Save settings',exact:true}).click()
 assert.equal(await page.evaluate(async()=>(await window.unreal.getSettings()).automaticUpdateChecks),false)
 report.checks.push('legacy settings preserved; automatic preference defaults and opt-out','manual check while automatic disabled','nonmodal notice preserves focus and wraps at 150 percent','dark/light/reduced motion','owned release URL opened without credentials','unsigned download/install refused','provider form save preserves update opt-out')
 assert.deepEqual(await app.evaluate(()=>globalThis.__releaseCalls.map(row=>row.auth)),[false]);await app.close();app=await launch();page=await app.firstWindow();await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 await page.waitForFunction(async()=>{const s=await window.unreal.updateStatus();return s.version==='9.9.9'&&s.dismissed})
 assert.equal(await page.getByRole('complementary',{name:'New UnrealCode release'}).count(),0);assert.equal(await page.evaluate(async()=>(await window.unreal.getSettings()).automaticUpdateChecks),false)
 report.checks.push('dismissal and opt-out persist after restart');assert.deepEqual(report.errors,[]);writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(error){report.failure=String(error);writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));throw error}finally{await app.close().catch(()=>{})}
