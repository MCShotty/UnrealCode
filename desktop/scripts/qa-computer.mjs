import {_electron as electron} from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-computer-ui-')),profile=join(root,'profile');mkdirSync(profile);writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,decisionEngine:'off',theme:'dark'}))
const packaged=process.argv.includes('--packaged'),app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}}),errors=[]
try{
 const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor();await page.getByRole('button',{name:'Open Computer',exact:true}).click();await page.getByRole('heading',{name:'Computer',exact:true}).waitFor()
 await page.getByText('Computer is off',{exact:true}).waitFor()
 // Actual bundled process protocol and minimal environment; no window capture or native input.
 await page.getByRole('button',{name:'Enable Computer',exact:true}).click();await page.getByText('Ready when you are',{exact:true}).waitFor({timeout:25000})
 assert.equal((await page.evaluate(()=>window.unreal.computerStatus())).grant,undefined)
 const shortcut=await app.evaluate(({globalShortcut})=>{const key='Control+Alt+Shift+.';const ok=globalShortcut.register(key,()=>{});globalShortcut.unregister(key);return ok});assert(shortcut,'Emergency shortcut must register before input is granted')
 await page.getByRole('button',{name:'Turn off Computer',exact:true}).click();await page.getByText('Computer is off',{exact:true}).waitFor()
 for(const theme of ['dark','ice-dark','light']){await page.evaluate(theme=>window.unreal.updateSettings({theme}),theme);await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);await page.screenshot({path:join(root,`computer-${theme}.png`),animations:'disabled'})}
 const audit=await new AxeBuilder({page}).setLegacyMode(true).include('.computer-page').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(audit.violations.map(v=>v.id),[])
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(0,0);win.setContentSize(800,650);win.webContents.setZoomFactor(2)})
 await page.emulateMedia({reducedMotion:'reduce'});assert(await page.locator('.computer-page').evaluate(element=>element.scrollWidth<=element.clientWidth+1));await page.screenshot({path:join(root,'computer-200-percent.png'),animations:'disabled'})
 await app.evaluate(({ipcMain,BrowserWindow})=>{
  const status={enabled:true,state:'active',message:'Fixture task has selected-window access.',generation:'fixture',shortcut:true,waiting:[],legacyConnections:[],grant:{id:'fixture',sessionId:'11111111-1111-4111-8111-111111111111',windows:[{id:'fixture',title:'A deliberately long fixture window title '.repeat(12),process:'fixture'}],control:true}}
  for(const name of ['computer:status','computer:control','computer:latest'])ipcMain.removeHandler(name)
  ipcMain.handle('computer:status',()=>status);ipcMain.handle('computer:latest',()=>null);ipcMain.handle('computer:control',(_event,action)=>{status.state=action==='pause'?'paused':action==='resume'?'active':'ready';if(action==='stop')status.grant=undefined;BrowserWindow.getAllWindows()[0].webContents.send('computer:changed');return status})
  BrowserWindow.getAllWindows()[0].webContents.send('computer:changed')
 })
 await page.getByRole('button',{name:'Take over',exact:true}).click();await page.getByText('You have control',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Hand back',exact:true}).click();await page.getByText('Task has access',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByText('Ready when you are',{exact:true}).waitFor()
 assert(await page.locator('.computer-page').evaluate(element=>element.scrollWidth<=element.clientWidth+1))
 await page.getByRole('button',{name:'Back to workspaces'}).click();assert.deepEqual(errors,[])
 console.log('PASS: Computer standalone navigation, real bundled helper startup/stop, emergency shortcut, disabled-by-default grants, themes, accessibility, 200% scaling and reduced motion. '+root)
}catch(error){console.error('Computer UI failure:',errors);const page=await app.firstWindow();console.error(await page.locator('.computer-page').innerText());console.error(await page.evaluate(()=>window.unreal.computerStatus()));throw error}finally{await app.close()}
