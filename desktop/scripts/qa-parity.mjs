// Browser plugin not available for Electron. Use an isolated offscreen profile.
import {_electron as electron} from 'playwright'
import {createServer} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-parity-')),project=join(root,'project');mkdirSync(project);writeFileSync(join(project,'sample.txt'),'fixture source\n')
for(const args of [['init'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Fixture']])execFileSync('git',['-C',project,...args],{windowsHide:true,stdio:'ignore'})
const counts=new Map(),requests=[]
const provider=createServer(async(req,res)=>{if(req.method==='GET'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[]}));return}let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);requests.push(input);const text=JSON.stringify(input.messages||[]),marker=['PLAN_PARITY','RETRY_PARITY','GOAL_PARITY','HOOK_PARITY'].find(x=>text.includes(x))||'OTHER',index=counts.get(marker)||0;counts.set(marker,index+1)
 let call
 if(marker==='PLAN_PARITY'&&index===0)call=['PlanUpdate',{objective:'Fixture plan',body:'Read the source and verify it.',acceptance:['Source inspected'],milestones:['Inspect source']}]
 if(marker==='RETRY_PARITY'){if(index===0||index===2)call=['Bash',{command:'test -f recovered.txt && cat recovered.txt'}];if(index===1)call=['ApplyPatch',{edits:[{path:'recovered.txt',expectedRevision:'missing',content:'Recovered\n'}]}]}
 if(marker==='GOAL_PARITY'&&index===0)call=['GoalComplete',{evidence:['The synthetic acceptance condition has been verified by the fixture.']}]
 if(marker==='HOOK_PARITY'&&index===0)call=['ReadFile',{path:'sample.txt'}]
 const message=call?{role:'assistant',tool_calls:[{id:`${marker}-${index}`,type:'function',function:{name:call[0],arguments:JSON.stringify(call[1])}}]}:{role:'assistant',content:'Fixture complete; evidence recorded.'}
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:randomUUID(),choices:[{index:0,finish_reason:call?'tool_calls':'stop',message}],usage:{prompt_tokens:50,completion_tokens:12}}))
})
await new Promise(resolve=>provider.listen(0,'0.0.0.0',resolve))
const packaged=process.argv.includes('--packaged'),exe=resolve(packaged?(process.env.UNREAL_QA_EXECUTABLE||'dist/win-unpacked/UnrealCode.exe'):'node_modules/electron/dist/electron.exe')
const app=await electron.launch({executablePath:exe,args:packaged?[]:['.'],cwd:process.cwd(),env:{...process.env,UNREAL_DESKTOP_BACKGROUND_CHECK:'1',UNREAL_DESKTOP_USER_DATA:join(root,'data')}})
const report={root,checks:[],errors:[]};let page
try{
 page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await page.waitForFunction(()=>!!window.unreal)
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});dialog.showMessageBoxSync=()=>1})
 const api=(method,...args)=>page.evaluate(async({method,args})=>{try{return await window.unreal[method](...args)}catch(error){throw Error(`${method}: ${error.failure?.details||error.message}`)}},{method,args})
 const wait=async(check,timeout=30000)=>{const until=Date.now()+timeout;for(;;){if(await check())return;if(Date.now()>until)throw Error('Parity fixture timed out');await new Promise(resolve=>setTimeout(resolve,100))}}
 await api('updateSettings',{decisionSetupSeen:true,decisionEngine:'off',provider:'openai-compatible',model:'parity-fixture',baseUrl:`http://localhost:${provider.address().port}/v1`,executionMode:'agent',taskIsolation:false})
 await api('openProject',project,true);await page.reload();await page.waitForFunction(()=>!!window.unreal)
 const create=async()=>{const result=await api('createSession',{});await api('selectSession',result.sessionId);return result.sessionId}
 const settled=async(id)=>wait(async()=>{const sessions=await api('listSessions');return sessions.some(session=>session.id===id&&['completed','completed_with_warnings','failed'].includes(session.state))&&!(await api('checkpoints')).some(item=>item.sessionId===id&&['running','capturing'].includes(item.state))},60000)
 const planId=await create();await api('command',{name:'plan',args:'',sessionId:planId});await api('sendMessage',planId,'PLAN_PARITY',randomUUID());await settled(planId)
 const plan=await api('planning',planId);assert.equal(plan.plan.objective,'Fixture plan');assert.equal(plan.plan.revision,1);report.checks.push('model-authored plan revisions')
 await api('planSave',planId,{objective:'Edited objective',body:'Updated plan',acceptance:['Expected result'],milestones:[]});await assert.rejects(api('planImplement',planId,1,'ask'));report.checks.push('stale plan approval rejected')
 const id=await create();await api('sendMessage',id,'RETRY_PARITY',randomUUID());await settled(id);assert.equal((await api('listSessions')).find(x=>x.id===id).state,'completed');assert.equal(readFileSync(join(project,'recovered.txt'),'utf8'),'Recovered\n');assert((await api('getEvents',id,0)).some(event=>event.event==='operation.update'&&event.payload.State?.Result?.ExitCode===1));report.checks.push('failed tool followed by exact successful retry')
 await api('command',{name:'rename',args:'Readable title',sessionId:id});assert.equal((await api('listSessions')).find(x=>x.id===id).title,'Readable title')
 await assert.rejects(api('command',{name:'fast',args:'on',sessionId:id}));report.checks.push('rename and unsupported speed control')
 const goalId=await create();await api('goalSave',goalId,{objective:'GOAL_PARITY',requestLimit:5,tokenLimit:10000,elapsedMinutes:2});await api('goalAction',goalId,'resume');await wait(async()=>(await api('planning',goalId)).goal.state==='completed');await settled(goalId);report.checks.push('bounded goal explicit completion')
 const job=await api('backgroundStart',id,'printf background-proof',10000);await wait(async()=>(await api('backgroundJobs',id)).find(x=>x.id===job.id)?.state==='completed');assert((await api('backgroundJobs',id)).find(x=>x.id===job.id).output.includes('background-proof'))
 const sleeping=await api('backgroundStart',id,'sleep 60',120000);await wait(async()=>(await api('backgroundJobs',id)).find(x=>x.id===sleeping.id)?.state==='running');await new Promise(resolve=>setTimeout(resolve,1500));assert.equal((await api('backgroundJobs',id)).find(x=>x.id===sleeping.id)?.state,'running');await api('sessionMode',id,'plan');assert.equal((await api('sessionConfig',id)).pendingMode,'plan');await api('backgroundStop',id,sleeping.id);await wait(async()=>(await api('sessionConfig',id)).mode==='plan');await api('sessionMode',id,'agent');report.checks.push('background completion and owned group cancellation')
 await api('hooksSave',[{id:'fixture-hook',event:'beforeTool',tool:'ReadFile',command:'printf hook-proof > hook-proof.txt',timeoutMs:10000,enabled:true}]);const hookId=await create();await api('sendMessage',hookId,'HOOK_PARITY',randomUUID());await settled(hookId);assert.equal(readFileSync(join(project,'hook-proof.txt'),'utf8'),'hook-proof');await api('stopSession',hookId);await api('hooksSave',[]);report.checks.push('trusted before-tool hook')
 await app.evaluate(({BrowserWindow},target)=>BrowserWindow.getAllWindows()[0].webContents.send('app:navigate',target),{project,sessionId:id});await page.locator('.user-bubble').first().waitFor()
 for(const label of ['Task controls','Memory','Browser','Hooks']){await page.getByRole('button',{name:label,exact:true}).first().click();await page.getByRole('heading',{name:label==='Memory'?'Project memory':label==='Browser'?'Dedicated browser':label==='Hooks'?'Project hooks':label,exact:true}).waitFor();await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.view-frame')).opacity)===1)}
 await page.screenshot({path:join(root,'parity-ui.png')});assert.equal(report.errors.length,0);report.checks.push('new navigation renders without page errors')
 if(process.argv.includes('--browser')){
  const web=createServer((_req,res)=>res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><html><head><title>Parity preview</title></head><body><h1>Browser fixture</h1><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Try action</button></body></html>'))
  await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));try{const origin=`http://127.0.0.1:${web.address().port}`;await api('browserConfigure',id,{enabled:true,origins:[origin],interactOrigins:[origin],ports:[]});await api('browserInstall',id);const tab=await api('browserAction',id,{type:'navigate',url:origin});await api('browserAction',id,{type:'click',tabId:tab.tabId,selector:'button'});const snapshot=await api('browserAction',id,{type:'snapshot',tabId:tab.tabId});assert(snapshot.snapshot.includes('Clicked'));const screenshot=await api('browserAction',id,{type:'screenshot',tabId:tab.tabId});assert(screenshot.image.length>100);await assert.rejects(api('browserAction',id,{type:'navigate',url:'http://ungranted.example'}));report.checks.push('isolated Chromium navigation, action, snapshot, screenshot and origin rejection')}finally{web.close()}
 }
 for(const name of ['agents','tasks','permissions','status','usage','context','review','diff','checkpoint','rewind','skills','mcp','memory','browser','hooks','model','goal','help'])assert((await api('command',{name,args:'',sessionId:id})).view);report.checks.push('validated local command navigation registry');
 console.log(JSON.stringify(report,null,2))
}catch(error){report.failure=String(error);if(page)await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});console.log(JSON.stringify(report,null,2));throw error}
finally{await app.close();provider.close()}
