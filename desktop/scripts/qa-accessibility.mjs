import {_electron as electron} from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-accessibility-')),packaged=process.argv.includes('--packaged'),app=await electron.launch({executablePath:resolve(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe'),args:packaged?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:join(root,'data'),UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}}),page=await app.firstWindow(),report={root,errors:[],checks:[]}
page.on('pageerror',error=>report.errors.push(error.message))
// Electron does not implement Target.createTarget for the analyzer's blank page.
// Its supported legacy mode analyzes this renderer directly (there are no frames).
async function inspect(name){await page.waitForFunction(()=>[...document.querySelectorAll('.setup-overlay')].every(element=>getComputedStyle(element).opacity==='1'));const result=await new AxeBuilder({page}).setLegacyMode(true).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();report.checks.push({name,violations:result.violations.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}))})}
try{
 await page.getByRole('button',{name:'Set up later'}).waitFor();await inspect('first-run');await page.getByRole('button',{name:'Set up later'}).click();await inspect('workspace-setup');await page.evaluate(()=>window.unreal.updateSettings({theme:'dark'}));await page.reload()
 await page.getByRole('button',{name:'Provider settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();await inspect('dark-settings')
 await page.getByRole('heading',{name:'Updates and recovery'}).scrollIntoViewIfNeeded();await page.screenshot({path:join(root,'recovery-dark.png'),animations:'disabled'})
 await page.evaluate(()=>window.unreal.updateSettings({theme:'light'}));await page.reload();await page.getByRole('button',{name:'Provider settings',exact:true}).click();await inspect('light-settings');await page.getByRole('heading',{name:'Updates and recovery'}).scrollIntoViewIfNeeded();await page.screenshot({path:join(root,'recovery-light.png'),animations:'disabled'})
 await page.emulateMedia({reducedMotion:'reduce'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5));assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));await inspect('light-150-percent-reduced-motion')
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);report.scalingOverflow=overflow;assert(!overflow,'Page overflows horizontally at 150% scaling')
 await page.getByRole('button',{name:'Close settings'}).focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Open a workspace'}).waitFor();await page.getByRole('dialog',{name:'Settings',exact:true}).waitFor({state:'detached'});report.keyboardClose=true;assert.equal(await page.getByRole('button',{name:'Provider settings',exact:true}).evaluate(element=>element===document.activeElement),true);report.focusRestored=true
 assert.deepEqual(report.errors,[]);writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));assert(report.checks.every(check=>check.violations.length===0),'Accessibility violations require review')
}catch(error){report.failure=String(error);writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));throw error}finally{await app.close().catch(()=>{})}
