import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtempSync,mkdirSync,writeFileSync,copyFileSync,readFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const root=mkdtempSync(join(tmpdir(),'unrealcode-connections-')),project=join(root,'project');mkdirSync(project);copyFileSync('scripts/fixture-mcp.py',join(project,'fixture.py'))
const remote=createServer(async(req,res)=>{if(req.method==='GET'){res.writeHead(405).end();return}if(req.headers.authorization!=='Bearer fixture-secret-not-real'){res.writeHead(401).end();return}let text='';for await(const bytes of req)text+=bytes;const request=JSON.parse(text);if(!('id'in request)){res.writeHead(202).end();return}let result={};if(request.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};if(request.method==='tools/list')result={tools:[{name:'echo',description:'Echo focused fixture text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};if(request.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({text:request.params.arguments.text,scoped:'fixture-secret-not-real'})}]};res.writeHead(200,{'content-type':'application/json'});res.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));res.end()});await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
let requested=0,lastSession='';const modelRequests=[]
const model=createServer(async(req,res)=>{
 if(req.method==='GET'||req.method==='HEAD'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture'}]}));return}
 let text='';for await(const bytes of req)text+=bytes;const body=JSON.parse(text);modelRequests.push(body)
 const calls=body.messages.flatMap(item=>item.tool_calls||[]),tools=body.tools||[]
 let message={role:'assistant',content:'MCP fixture complete.'}
 if(!tools.length)message={role:'assistant',content:'Summary: completed the selected fixture MCP tool. Keep the original task and verification evidence. No outstanding approved actions.'}
 else if(body.messages.some(item=>typeof item.content==='string'&&item.content.includes('CONTINUE_FROM_SUMMARY')))message={role:'assistant',content:'Continued with the recorded context.'}
 else if(!calls.length)message={role:'assistant',tool_calls:[{id:randomUUID(),type:'function',function:{name:'FindTools',arguments:JSON.stringify({query:'echo'})}}]}
 else if(!calls.some(call=>call.function.name.startsWith('mcp_'))){const tool=tools.find(tool=>tool.function.name.startsWith('mcp_'));message=tool?{role:'assistant',tool_calls:[{id:randomUUID(),type:'function',function:{name:tool.function.name,arguments:JSON.stringify({text:'MCP_FIXTURE_OK'})}}]}:{role:'assistant',content:'MCP_SCHEMA_MISSING'}}
 requested++;res.writeHead(200,{'content-type':'application/json'});res.write(JSON.stringify({id:randomUUID(),choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage:{prompt_tokens:22,completion_tokens:7}}));res.end()
})
await new Promise(resolve=>model.listen(0,'0.0.0.0',resolve))
const packaged=process.argv.includes('--packaged'),app=await electron.launch({executablePath:resolve(process.env.UNREALCODE_QA_EXECUTABLE||(packaged?'dist/win-unpacked/UnrealCode.exe':'node_modules/electron/dist/electron.exe')),args:packaged?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:join(root,'data')}}),report={root,errors:[],kinds:[]}
try{
 const page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
 await page.getByRole('button',{name:'Set up later'}).click();await page.evaluate(baseUrl=>window.unreal.updateSettings({provider:'openai-compatible',baseUrl,model:'fixture',executionMode:'ask',taskIsolation:false,theme:'dark'}),`http://localhost:${model.address().port}/v1`)
 await page.evaluate(path=>window.unreal.openProject(path,true),project);await page.reload()
 const wait=async(predicate,arg)=>{const end=Date.now()+30000;while(Date.now()<end){if(await page.evaluate(predicate,arg))return;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('MCP workflow timed out')}
 for(const kind of ['host','container','remote']){
  const id=randomUUID(),config={id,name:`${kind} fixture`,kind,command:kind==='host'?process.execPath:'python3',args:kind==='host'?[resolve('scripts/fixture-mcp.mjs')]:['-u','/workspace/fixture.py'],auth:kind==='remote'?'bearer':'none',url:kind==='remote'?`http://127.0.0.1:${remote.address().port}/mcp`:undefined,timeoutMs:15000}
  await page.evaluate(async config=>{
   const step=async(name,work)=>{try{return await work()}catch(error){throw Error(`${config.kind} ${name}: ${error?.failure?.details||error?.message||error}`)}}
   await step('save',()=>window.unreal.connectionSave(config))
   await step('credential',()=>window.unreal.connectionCredential(config.id,config.kind==='remote'?'fixture-secret-not-real':'',config.kind==='remote'?{}:{FIXTURE_SECRET:'fixture-secret-not-real'}))
   await step('project access',()=>window.unreal.connectionGrant({connectionId:config.id,hostTrusted:config.kind==='host',tools:[],resources:false,prompts:false}))
   await step('connect',()=>window.unreal.connectionConnect(config.id,false))
   const item=(await step('catalog',()=>window.unreal.connections())).find(value=>value.id===config.id),tool=item?.tools.find(value=>value.current&&value.remoteName==='echo')
   if(!tool)throw Error(`${config.kind} echo definition was not advertised`)
   await step('select echo',()=>window.unreal.connectionGrant({connectionId:config.id,hostTrusted:config.kind==='host',tools:['echo'],toolRevisions:{echo:tool.revision},resources:false,prompts:false}))
  },config)
  await page.getByRole('button',{name:'Abilities',exact:true}).click();await page.getByRole('tab',{name:/MCPs/}).click();await page.getByRole('heading',{name:'MCP servers',exact:true}).waitFor()
  assert((await page.locator('.connection-card').allTextContents()).some(text=>text.includes('connected')))
  const card=page.locator('.connection-card').filter({hasText:`${kind} fixture`})
  await card.getByText('Tools, resources and prompts',{exact:true}).click()
  const echo=card.locator('label.connection-tool').filter({hasText:'echo'}).getByRole('checkbox')
  await echo.click();await wait(async id=>!((await window.unreal.connections()).find(item=>item.id===id)?.grant?.tools.includes('echo')),id)
  await echo.click();await wait(async id=>{const item=(await window.unreal.connections()).find(value=>value.id===id),tool=item?.tools.find(value=>value.current&&value.remoteName==='echo');return !!tool&&item?.grant?.toolRevisions?.echo===tool.revision},id)
  await page.screenshot({path:join(root,`${kind}-connections.png`)})
  const {sessionId}=await page.evaluate(()=>window.unreal.createSession({}));lastSession=sessionId;await page.evaluate(async id=>{await window.unreal.selectSession(id);await window.unreal.sendMessage(id,'Call the fixture echo MCP tool',crypto.randomUUID())},sessionId)
  await wait(async id=>(await window.unreal.hostApprovals(id)).length===1,sessionId)
  const approvals=await page.evaluate(id=>window.unreal.hostApprovals(id),sessionId);assert.equal(approvals[0].arguments.text,'MCP_FIXTURE_OK')
  await page.evaluate(async approval=>window.unreal.hostRespond(approval.sessionId,approval.id,approval.digest,true),approvals[0])
  await wait(async id=>(await window.unreal.getEvents(id,0)).some(event=>event.event==='session.idle'),sessionId)
  const events=await page.evaluate(id=>window.unreal.getEvents(id,0),sessionId),encoded=JSON.stringify(events)
  assert(encoded.includes('MCP_FIXTURE_OK'));assert(encoded.includes('[REDACTED]'));assert(!encoded.includes('fixture-secret-not-real'));assert(!encoded.includes('MCP_SCHEMA_MISSING'))
  assert(!readFileSync(join(root,'data','connection-secrets.json'),'utf8').includes('fixture-secret-not-real'))
  await page.evaluate(async id=>{await window.unreal.connectionRevoke(id);await window.unreal.connectionRemove(id)},id);report.kinds.push(kind)
 }
 const original=await page.evaluate(id=>window.unreal.getEvents(id,0),lastSession)
 const summary=await page.evaluate(id=>window.unreal.contextCompact(id),lastSession);assert(summary.active);assert(summary.usage.input>0)
 const versions=await page.evaluate(id=>window.unreal.contextSummaries(id),lastSession);assert.equal(versions.length,1)
 await page.evaluate(async id=>{await window.unreal.sendMessage(id,'CONTINUE_FROM_SUMMARY',crypto.randomUUID())},lastSession)
 await wait(async id=>(await window.unreal.getEvents(id,0)).some(event=>event.event==='session.item'&&JSON.stringify(event.payload).includes('Continued with the recorded context.')),lastSession)
 assert(modelRequests.at(-1).messages.some(item=>typeof item.content==='string'&&item.content.includes('<unrealcode_history_summary>')))
 await page.evaluate(id=>window.unreal.contextSummarySelect(id,''),lastSession);assert(!(await page.evaluate(id=>window.unreal.contextSummaries(id),lastSession)).some(item=>item.active))
 assert((await page.evaluate(id=>window.unreal.getEvents(id,0),lastSession)).length>original.length);report.compaction=true
 writeFileSync(join(project,'included.txt'),'INDEXED_REFERENCE\nverification evidence');mkdirSync(join(project,'private'));writeFileSync(join(project,'private','hidden.txt'),'INDEXED_REFERENCE secret')
 await page.evaluate(id=>window.unreal.updateContext(id,{excluded:['private']}),lastSession)
 const search=await page.evaluate(()=>window.unreal.repositorySearch('INDEXED_REFERENCE'));assert.equal(search.hits.length,1);assert.equal(search.hits[0].path,'included.txt');report.retrieval=true
 await app.evaluate(({BrowserWindow},target)=>BrowserWindow.getAllWindows()[0].webContents.send('app:navigate',target),{project,sessionId:lastSession})
 await page.locator('.session-row.selected').waitFor()
 await page.getByRole('button',{name:'Context',exact:true}).click();await page.getByRole('heading',{name:'Context inspector'}).waitFor();await page.getByText('Latest provider-reported input: 22',{exact:false}).waitFor();await page.screenshot({path:join(root,'context-dark.png')})
 await page.evaluate(()=>window.unreal.updateSettings({theme:'light'}));await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.getByRole('button',{name:'Abilities',exact:true}).click();await page.getByRole('tab',{name:/MCPs/}).click();await page.getByRole('heading',{name:'MCP servers',exact:true}).waitFor();await page.screenshot({path:join(root,'connections-light.png'),animations:'disabled'})
 assert.deepEqual(report.errors,[]);report.requests=requested;console.log(JSON.stringify(report))
}catch(error){report.failure=String(error);const page=await app.firstWindow();report.visibleErrors=await page.locator('.error-inline,.banner-error').allTextContents();if(lastSession)writeFileSync(join(root,'events.json'),JSON.stringify(await page.evaluate(id=>window.unreal.getEvents(id,0),lastSession),null,2));writeFileSync(join(root,'requests.json'),JSON.stringify(modelRequests,null,2));await page.screenshot({path:join(root,'failure.png')});writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));throw error}
finally{await app.close().catch(()=>{});model.closeAllConnections();model.close();remote.closeAllConnections();remote.close()}
