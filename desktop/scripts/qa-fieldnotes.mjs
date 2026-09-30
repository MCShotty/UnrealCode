import {_electron as electron} from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-fieldnotes-qa-')),project=join(root,'Source project'),profile=join(root,'profile')
mkdirSync(project);mkdirSync(profile);writeFileSync(join(project,'README.md'),'# Pointer only\n');writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,decisionEngine:'off',theme:'dark'}))
const packaged=process.argv.includes('--packaged')||!!process.env.UNREALCODE_QA_EXECUTABLE
const app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
let page;const errors=[]
try{
 page=await app.firstWindow();page.setDefaultTimeout(15000)
 page.on('pageerror',e=>errors.push(e.message))
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 await app.evaluate(({BrowserWindow,dialog},path)=>{BrowserWindow.getAllWindows()[0].setContentSize(1350,900);dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},project)
 await page.getByRole('button',{name:'Open Fieldnotes',exact:true}).click()
 await page.getByRole('heading',{name:'Fieldnotes',exact:true}).waitFor()
 await page.getByRole('button',{name:'New note',exact:true}).click()
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Storage convention')
 await page.getByRole('textbox',{name:'Guidance Markdown supported'}).fill('Prefer SQLite for local caches. Verify migrations. ملاحظات المشروع')
 await page.getByRole('button',{name:'Choose another folder / repair pointer'}).click()
 await page.getByRole('button',{name:'Save note',exact:true}).click()
 await page.getByText('Saved locally. Guidance is available immediately.').waitFor()
 assert.equal(await page.evaluate(()=>window.unreal.projectPath()),null,'A pointer must not open or trust the project')
 let notes=await page.evaluate(()=>window.unreal.fieldnoteList({includeDisabled:true}))
 assert.equal(notes.notes.length,1);assert.equal(notes.notes[0].pointer.projectPath,realpathSync.native(project))
 const noteId=notes.notes[0].id
 await page.getByRole('textbox',{name:'Search Fieldnotes'}).fill('SQLite')
 await page.locator('.fieldnote-row').waitFor();assert.equal(await page.locator('.fieldnote-row').count(),1)
 await page.getByRole('textbox',{name:'Guidance Markdown supported'}).fill('Unfinished change kept across navigation')
 await page.getByText('Draft saved on this device').waitFor()
 await page.getByRole('button',{name:'Back to workspaces'}).click()
 await page.getByRole('button',{name:'Open Fieldnotes',exact:true}).click()
 await page.locator('.fieldnote-row').filter({hasText:'Storage convention'}).click()
 assert.equal(await page.getByRole('textbox',{name:'Guidance Markdown supported'}).inputValue(),'Unfinished change kept across navigation')
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await page.getByRole('textbox',{name:'Guidance Markdown supported'}).waitFor()
 assert.match(await page.getByRole('textbox',{name:'Guidance Markdown supported'}).inputValue(),/Prefer SQLite/)
 for(const theme of ['dark','ice-dark','light']){
  await page.evaluate(theme=>window.unreal.updateSettings({theme}),theme)
  await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme)
  await page.screenshot({path:join(root,`fieldnotes-${theme}.png`),animations:'disabled'})
 }
 const audit=await new AxeBuilder({page}).setLegacyMode(true).include('.fieldnotes-page').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
 assert.deepEqual(audit.violations.map(x=>x.id),[])
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(0,0);win.setContentSize(800,650);win.webContents.setZoomFactor(1.5)})
 assert(await page.locator('.fieldnotes-page').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'No horizontal overflow at 150%')
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.getByRole('button',{name:'Library',exact:true}).click()
 await page.getByRole('button',{name:'New note',exact:true}).click()
 assert.equal(await page.locator('.fresh-note').count(),0)
 await page.screenshot({path:join(root,'fieldnotes-compact.png'),animations:'disabled'})
 const saved=await page.evaluate(id=>window.unreal.fieldnoteGet(id),noteId)
 assert.match(saved.body,/Prefer SQLite/)
 assert.deepEqual(errors,[])
 console.log('PASS: offline library, attribution without project access, draft recovery/cancel, themes, scaling, reduced motion and accessibility. '+root)
}catch(error){console.error('Renderer errors:',errors);console.error('Visible text:',await page?.locator('body').innerText().catch(()=>''));throw error}finally{await app.close()}
