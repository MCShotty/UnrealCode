import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash,randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-teams-qa-')),project=join(root,'project'),data=join(root,'data');mkdirSync(project)
const git=args=>execFileSync('git',['-C',project,...args],{windowsHide:true,stdio:'ignore'})
git(['init']);writeFileSync(join(project,'a.txt'),'original\n');writeFileSync(join(project,'b.txt'),'original\n');git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Base'])
const requests=[]
const model=createServer(async(req,res)=>{
 let text='';for await(const part of req)text+=part;const body=JSON.parse(text);requests.push(body)
 const messages=body.messages||[],content=messages.map(item=>typeof item.content==='string'?item.content:JSON.stringify(item.content)).join('\n'),done=messages.some(item=>item.role==='tool')
 const call=(name,args)=>({id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}})
 let message={role:'assistant',content:'Parent task ready for review.'}
 if(content.includes('LIMIT_FIXTURE'))message={role:'assistant',content:'Limit fixture response'}
 else if(content.includes('Assignment: WORKER_A'))message=done?{role:'assistant',content:'WORKER_A complete. Changed a.txt; native patch verified.'}:{role:'assistant',tool_calls:[call('ApplyPatch',{edits:[{path:'a.txt',expectedRevision:createHash('sha256').update('original\n').digest('hex'),content:'specialist A\n'}]})]}
 else if(content.includes('Assignment: WORKER_B'))message=done?{role:'assistant',content:'WORKER_B done'}:{role:'assistant',tool_calls:[call('ReadFile',{path:'b.txt'}),call('Bash',{command:'echo MUST_REQUIRE_APPROVAL'})]}
 else if(content.includes('QUEUE_CANCEL_FIXTURE')&&!done)message={role:'assistant',tool_calls:[call('TeamDispatch',{role:'implementer',assignment:'WORKER_B: inspect b.txt and verify',ownership:['b.txt']})]}
 else if(!done)message={role:'assistant',tool_calls:[call('TeamDispatch',{role:'implementer',assignment:'WORKER_A: update a.txt',ownership:['a.txt']}),call('TeamDispatch',{role:'implementer',assignment:'WORKER_B: inspect b.txt and verify',ownership:['b.txt']})]}
 res.writeHead(200,{'content-type':'application/json'});res.write(JSON.stringify({id:randomUUID(),choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage:{prompt_tokens:30,completion_tokens:8}}));res.end()
});await new Promise(resolve=>model.listen(0,'0.0.0.0',resolve))
const packaged=process.argv.includes('--packaged'),launch=()=>electron.launch({executablePath:resolve(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe'),args:packaged?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:data,UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
let app=await launch(),page=await app.firstWindow(),parent='';const report={root,errors:[]}
const wait=async(predicate,arg,timeout=90000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await page.evaluate(predicate,arg))return;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('Team fixture timed out')}
try{
 page.on('pageerror',error=>report.errors.push(error.message));await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})});await page.getByRole('button',{name:'Set up later'}).click()
 await page.evaluate(baseUrl=>window.unreal.updateSettings({provider:'openai-compatible',baseUrl,model:'team-fixture',executionMode:'agent',taskIsolation:false,theme:'dark',disallowedTools:['EntityExtract']}),`http://localhost:${model.address().port}/v1`)
 await page.evaluate(path=>window.unreal.openProject(path,true),project);await page.reload()
 const options={allowSpecialists:true,concurrency:2,workerLimit:4,modelRequestLimit:20,elapsedMinutes:5,tokenLimit:2000}
 parent=(await page.evaluate(options=>window.unreal.createSession({},options),options)).sessionId
 await page.evaluate(async id=>{await window.unreal.updateContext(id,{excluded:['private']});await window.unreal.sendMessage(id,'TEAM_FIXTURE: use the two assigned specialists',crypto.randomUUID())},parent)
 await wait(async id=>{const team=await window.unreal.teamView(id);const failed=team?.workers.find(worker=>worker.state==='failed');if(failed)throw Error(failed.message||'Specialist failed');return team?.workers.length===2&&team.workers.some(worker=>worker.state==='review')&&team.workers.some(worker=>worker.state==='waiting_input')},parent,180000)
 let team=await page.evaluate(id=>window.unreal.teamView(id),parent),a=team.workers.find(worker=>worker.assignment.startsWith('WORKER_A')),b=team.workers.find(worker=>worker.assignment.startsWith('WORKER_B'))
 assert(a?.sessionId&&b?.sessionId);assert.equal(readFileSync(join(project,'a.txt'),'utf8'),'original\n');assert.equal(readFileSync(join(a.path,'a.txt'),'utf8'),'specialist A\n');assert(a.snapshot.endsWith(':before'));assert.notEqual(a.path,b.path)
 const childConfig=await page.evaluate(id=>window.unreal.sessionConfig(id),a.sessionId);assert(childConfig.specialist);assert(!childConfig.teamEnabled);assert(childConfig.disallowedTools.includes('EntityExtract'))
 assert((await page.evaluate(id=>window.unreal.contextView(id),a.sessionId)).selection.excluded.includes('private'))
 const approvals=await page.evaluate(id=>window.unreal.approvals(id),b.sessionId);assert(approvals.some(item=>item.tool==='Bash'))
 await assert.rejects(page.evaluate(({id,options})=>window.unreal.teamConfigure(id,options),{id:a.sessionId,options}),/inherited|nested/)
 await page.evaluate(({parent,id})=>window.unreal.teamWorkerAction(parent,id,'cancel'),{parent,id:b.id})
 await wait(async({parent,id})=>(await window.unreal.teamView(parent)).workers.find(worker=>worker.id===id)?.state==='cancelled',{parent,id:b.id})
 writeFileSync(join(project,'a.txt'),'later user edit\n');assert((await page.evaluate(({parent,id})=>window.unreal.teamPreview(parent,id),{parent,id:a.id})).changes[0].conflict)
 await assert.rejects(page.evaluate(({parent,id})=>window.unreal.teamIntegrate(parent,id,['a.txt']),{parent,id:a.id}),/conflict/)
 writeFileSync(join(project,'a.txt'),'original\n');await page.evaluate(({parent,id})=>window.unreal.teamIntegrate(parent,id,['a.txt']),{parent,id:a.id});assert.equal(readFileSync(join(project,'a.txt'),'utf8'),'specialist A\n')
 await page.evaluate(({parent,id})=>window.unreal.teamWorkerAction(parent,id,'retain'),{parent,id:b.id})
 team=await page.evaluate(id=>window.unreal.teamView(id),parent);assert.equal(team.totalUsage.input,team.parentUsage.input+team.workerUsage.input);assert(team.workerUsage.calls>0);report.parallelWorkers=true;report.inheritedRestrictions=true;report.individualCancellation=true;report.conflictAndIntegration=true;report.usage=team.totalUsage
 await app.evaluate(({BrowserWindow},target)=>BrowserWindow.getAllWindows()[0].webContents.send('app:navigate',target),{project,sessionId:parent});await page.getByRole('region',{name:'Task team'}).waitFor();await page.getByLabel('Message UnrealCode').waitFor();await page.locator('.user-bubble').first().waitFor();assert((await page.locator('.tool-card .tool-status').allTextContents()).every(status=>!/(running|started)/i.test(status)));await page.screenshot({path:join(root,'teams-dark.png'),animations:'disabled'})
 const queued=await page.evaluate(options=>window.unreal.queueAdd('QUEUE_CANCEL_FIXTURE',options),options),queueId=queued.tasks.at(-1).id
 await page.evaluate(()=>window.unreal.queueAdd('LIMIT_FIXTURE next queue task'));await page.evaluate(()=>window.unreal.queuePause(false))
 await wait(async id=>{const task=(await window.unreal.queueSnapshot()).tasks.find(task=>task.id===id);if(!task?.sessionId)return false;return (await window.unreal.teamView(task.sessionId))?.workers.some(worker=>worker.state==='waiting_input')},queueId)
 const queuedParent=(await page.evaluate(()=>window.unreal.queueSnapshot())).tasks.find(task=>task.id===queueId).sessionId
 await page.evaluate(id=>window.unreal.queueAction(id,'cancel'),queueId)
 await wait(async id=>(await window.unreal.teamView(id)).workers.every(worker=>worker.state==='cancelled'),queuedParent)
 await assert.rejects(page.evaluate(id=>window.unreal.queueAction(id,'retry'),queueId),/specialists/i)
 assert.equal((await page.evaluate(()=>window.unreal.queueSnapshot())).tasks[1].state,'pending')
 const queuedWorker=(await page.evaluate(id=>window.unreal.teamView(id),queuedParent)).workers[0];await page.evaluate(({parent,id})=>window.unreal.teamWorkerAction(parent,id,'retain'),{parent:queuedParent,id:queuedWorker.id})
 await page.evaluate(()=>window.unreal.queuePause(false));await wait(async()=>(await window.unreal.queueSnapshot()).tasks[1].state==='completed');report.queueCancellation=true
 const beforeRestart=requests.length;await app.close();app=await launch();page=await app.firstWindow();await page.evaluate(path=>window.unreal.openProject(path,true),project)
 const restored=await page.evaluate(id=>window.unreal.teamView(id),parent);assert(restored.paused);assert.equal(restored.totalUsage.input,team.totalUsage.input);assert.equal(requests.length,beforeRestart);report.restart=true
 const limited=(await page.evaluate(options=>window.unreal.createSession({},options),{...options,allowSpecialists:false,modelRequestLimit:1})).sessionId
 await page.evaluate(id=>window.unreal.sendMessage(id,'LIMIT_FIXTURE',crypto.randomUUID()),limited);await wait(async id=>(await window.unreal.getEvents(id,0)).some(event=>event.event==='session.idle'),limited)
 const count=requests.length;await page.evaluate(id=>window.unreal.sendMessage(id,'LIMIT_FIXTURE second request',crypto.randomUUID()),limited);await wait(async id=>(await window.unreal.getEvents(id,0)).some(event=>event.event==='session.status'&&event.payload.status==='error'),limited);assert.equal(requests.length,count);report.requestLimit=true;assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report))
}catch(error){report.failure=String(error);if(parent){report.team=await page.evaluate(id=>window.unreal.teamView(id),parent).catch(()=>null);writeFileSync(join(root,'events.json'),JSON.stringify(await page.evaluate(id=>window.unreal.getEvents(id,0),parent).catch(()=>[]),null,2))}writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));writeFileSync(join(root,'requests.json'),JSON.stringify(requests,null,2));console.log(JSON.stringify(report));await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});throw error}
finally{await app.close().catch(()=>{});model.closeAllConnections();model.close()}
