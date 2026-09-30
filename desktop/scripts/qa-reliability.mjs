// Real renderer regression with deterministic delayed IPC; never uses an owner profile.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-reliability-')),profile=join(root,'profile'),project=join(root,'project')
mkdirSync(profile);mkdirSync(project)
writeFileSync(join(profile,'settings.json'),JSON.stringify({decisionSetupSeen:true,decisionEngine:'off',theme:'dark'}))
const packaged=process.argv.includes('--packaged')||!!process.env.UNREALCODE_QA_EXECUTABLE
const app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
try {
 const page=await app.firstWindow();page.setDefaultTimeout(10000)
 await page.getByRole('heading',{name:'Open a workspace'}).waitFor()
 await app.evaluate(({ipcMain},project)=>{
  const q=globalThis.__qa={project,skills:new Map(),reads:0,pending:[],rows:[],mode:'normal'}
  const h=(name,fn)=>{ipcMain.removeHandler(name);ipcMain.handle(name,fn)}
  h('project:path',()=>q.project);h('docker:status',()=>({ready:false,state:'stopped',message:'Isolated fixture'}))
  h('workspace:active',()=>({project:q.project,path:q.project,workspaceId:'fixture'}))
  h('skills:list',()=>[...q.skills.values()])
  h('skills:save',(_e,name,content)=>{const saved={name,content,description:'Fixture',source:'project',revision:'a'.repeat(64),workspace:q.project};q.skills.set(name,saved);return saved})
  h('files:list',()=>[{name:'fixture.txt',path:'fixture.txt',directory:false}]);h('files:changes',()=>[]);h('editor:base',()=> 'disk version')
  h('editor:read',(_e,path)=>{const file={path,workspace:q.project,content:'disk version',revision:'fixture-r1'};if(++q.reads===1)return file;return new Promise(resolve=>{q.releaseRead=()=>resolve(file)})})
  h('editor:save',(_e,path,_revision,content,workspace)=>({path,workspace,content,revision:'fixture-r2'}))
  h('session:list',()=>{if(q.mode==='fail')throw Error('Fixture list unavailable');return q.mode==='hold'?new Promise(resolve=>q.pending.push(resolve)):q.rows})
 },project)
 await page.reload()
 const nav=page.getByRole('navigation',{name:'Main navigation'});await nav.waitFor()
 await nav.getByRole('button',{name:'Abilities',exact:true}).click()
 for(const name of ['alpha','beta']){
  await page.getByRole('button',{name:'New skill',exact:true}).click()
  await page.getByRole('textbox',{name:'Skill folder name'}).fill(name)
  await page.getByRole('textbox',{name:'Skill content'}).fill(`---\nname: ${name}\ndescription: Fixture\n---\n${name}`)
  await page.locator('.skill-editor').getByRole('button',{name:'Save',exact:true}).click()
  await page.getByText('Saved. Start or resume a session to load the updated skill.').waitFor()
 }
 assert.deepEqual(await app.evaluate(()=>[...globalThis.__qa.skills.keys()]),['alpha','beta'])
 await nav.getByRole('button',{name:'Files',exact:true}).click()
 await page.getByRole('button',{name:'fixture.txt',exact:true}).click()
 const editor=page.getByRole('textbox',{name:'Edit fixture.txt'});await editor.waitFor()
 await page.getByRole('button',{name:'Reload',exact:true}).click()
 await editor.focus();await page.keyboard.press('Control+a');await page.keyboard.type('my new unsaved work')
 await page.getByRole('tab',{name:'● fixture.txt',exact:true}).waitFor()
 await app.evaluate(()=>globalThis.__qa.releaseRead())
 await page.getByText('The buffer changed while Reload was pending.',{exact:false}).waitFor()
 assert.equal((await page.locator('.view-lines').innerText()).replaceAll('\u00a0',' '),'my new unsaved work')
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('tab',{name:'fixture.txt',exact:true}).waitFor()
 await nav.getByRole('button',{name:'Sessions',exact:true}).click();await page.getByRole('heading',{name:'Sessions',exact:true}).waitFor()
 await app.evaluate(({BrowserWindow})=>{const q=globalThis.__qa;q.mode='hold';const w=BrowserWindow.getAllWindows()[0];w.webContents.send('workflow:changed',q.project);w.webContents.send('workflow:changed',q.project)})
 for(let i=0;i<100;i++){if(await app.evaluate(()=>globalThis.__qa.pending.length>=2))break;await new Promise(resolve=>setTimeout(resolve,20))}
 const row=title=>({id:'11111111-1111-4111-8111-111111111111',title,lastUpdatedAt:new Date().toISOString(),status:'idle'})
 await app.evaluate((_e,row)=>{const q=globalThis.__qa;q.rows=[row];q.mode='normal';q.pending[1]([row])},row('Newest session result'))
 await page.locator('.session-table').getByText('Newest session result').waitFor()
 await app.evaluate((_e,row)=>globalThis.__qa.pending[0]([row]),row('Older session result'))
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 assert.equal(await page.locator('.session-table').getByText('Older session result').count(),0)
 await app.evaluate(({BrowserWindow})=>{const q=globalThis.__qa;q.project+='-other';q.mode='fail';BrowserWindow.getAllWindows()[0].webContents.send('app:navigate',{project:q.project,sessionId:'22222222-2222-4222-8222-222222222222'})})
 await nav.getByRole('button',{name:'Sessions',exact:true}).click()
 await page.getByText('Sessions could not refresh.',{exact:false}).waitFor()
 assert.equal(await page.locator('.session-table').getByText('Newest session result').count(),0)
 console.log('PASS: separate skill creation, reload protection, ordered session refresh, and failed project isolation. Artifacts: '+root)
}finally{await app.close()}
