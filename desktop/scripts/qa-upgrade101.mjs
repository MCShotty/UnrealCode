// Exercise one disposable profile with a real local 1.0.0 package, then 1.0.1.
// No installer execution, user profile, or live model provider is involved.
import {_electron as electron} from 'playwright'
import {createServer} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
const old=process.env.UNREALCODE_LEGACY_EXECUTABLE,current=process.env.UNREALCODE_QA_EXECUTABLE
if(!old||!current)throw Error('Supply the explicit legacy 1.0.0 and candidate executable paths')
const root=mkdtempSync(join(tmpdir(),'unrealcode-upgrade101-')),profile=join(root,'profile'),project=join(root,'project');mkdirSync(project);writeFileSync(join(project,'README.md'),'Synthetic upgrade fixture.')
const server=createServer(async(req,res)=>{for await(const chunk of req){};res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Upgrade fixture reply retained in canonical session storage.'}}],usage:{prompt_tokens:7,completion_tokens:5}}))});await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve))
const launch=path=>electron.launch({executablePath:resolve(path),args:[],env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
let app;const report={root,checks:[]}
try{
 app=await launch(old);let page=await app.firstWindow();await page.waitForFunction(()=>!!window.unreal);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0})})
 const api=(name,...args)=>page.evaluate(({name,args})=>window.unreal[name](...args),{name,args})
 assert.equal(await api('appVersion'),'1.0.0');await api('updateSettings',{decisionSetupSeen:true,decisionEngine:'off',theme:'light',systemPrompt:'Keep these existing instructions.',provider:'openai-compatible',model:'upgrade-fixture',baseUrl:`http://localhost:${server.address().port}/v1`,executionMode:'agent',taskIsolation:false,notifications:false});await api('openProject',project,true)
 const session=await api('createSession',{},undefined),messageId=randomUUID();await api('sendMessage',session.sessionId,'UPGRADE_HISTORY_SENTINEL',messageId)
 const deadline=Date.now()+180000;let found
 while(Date.now()<deadline){found=(await api('listSessions')).find(row=>row.id===session.sessionId);if(found?.state==='completed')break;await new Promise(resolve=>setTimeout(resolve,100))}assert.equal(found?.state,'completed')
 const original=await api('getEvents',session.sessionId,0);assert(JSON.stringify(original).includes('UPGRADE_HISTORY_SENTINEL'));report.checks.push('1.0.0 creates a canonical session with fixture model')
 await app.close();app=await launch(current);page=await app.firstWindow();await page.waitForFunction(()=>!!window.unreal);assert.equal(await api('appVersion'),'1.0.1');await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0})});await api('openProject',project,true)
 const settings=await api('getSettings');assert.equal(settings.theme,'light');assert.equal(settings.systemPrompt,'Keep these existing instructions.');assert.equal(settings.model,'upgrade-fixture');assert.equal(settings.automaticUpdateChecks,true)
 const migrated=(await api('listSessions')).find(row=>row.id===session.sessionId);assert(migrated);assert.equal(migrated.title,found.title)
 const after=await api('getEvents',session.sessionId,0);assert.deepEqual(after.filter(event=>event.seq<=original.at(-1).seq),original);assert(JSON.stringify(after).includes('Upgrade fixture reply retained'))
 report.checks.push('1.0.1 preserves instructions, theme, provider and model','session ID, title and canonical event sequence unchanged','new release preferences default compatibly');writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(error){report.failure=String(error);writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));throw error}finally{await app?.close().catch(()=>{});server.closeAllConnections();server.close()}
