// Explicit live memory integration test; synthetic data and an isolated profile.
import {_electron as electron} from 'playwright'
import {createServer} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,statSync,readdirSync,existsSync,readFileSync} from 'node:fs'
import {join,resolve,dirname,basename} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
if(!process.argv.includes('--live'))throw Error('Use --live to authorize the configured Codex login for synthetic memory checks')
const reused=process.env.UNREAL_QA_REUSE_ROOT
if(process.argv.includes('--retry')&&!reused)throw Error('A retry fixture requires an existing disposable profile')
if(reused){const real=realpathSync(reused),parent=statSync(dirname(real)),temp=statSync(tmpdir());if(parent.dev!==temp.dev||parent.ino!==temp.ino||!basename(real).startsWith('unrealcode-memory-qa-'))throw Error('Reuse only an existing disposable UnrealCode memory QA profile under Temp')}
const root=reused?realpathSync(reused):mkdtempSync(join(tmpdir(),'unrealcode-memory-qa-')),project=join(root,'project');mkdirSync(project,{recursive:true});writeFileSync(join(project,'README.md'),'Synthetic Hindsight integration fixture.\n')
const server=createServer(async(req,res)=>{for await(const _ of req){};res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:randomUUID(),choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'Synthetic fixture fact: this sample application uses local port 8123. Its verification command is python -m unittest discover. This is fixture documentation, not a real deployment.'}}],usage:{prompt_tokens:30,completion_tokens:15}}))});await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve))
const launch=()=>electron.launch({executablePath:resolve(process.env.UNREAL_QA_EXECUTABLE||'node_modules/electron/dist/electron.exe'),args:process.env.UNREAL_QA_EXECUTABLE?[]:['.'],cwd:process.cwd(),env:{...process.env,UNREAL_DESKTOP_BACKGROUND_CHECK:'1',UNREAL_DESKTOP_USER_DATA:join(root,'profile')}});let app=await launch();const report={root,checks:[]}
try{let page=await app.firstWindow();await page.waitForFunction(()=>!!window.unreal);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0})})
 const api=(method,...args)=>page.evaluate(async({method,args})=>{try{return await window.unreal[method](...args)}catch(error){throw Error(`${method}: ${error.failure?.details||error.message}`)}},{method,args})
 await api('updateSettings',{decisionSetupSeen:true,decisionEngine:'off',provider:'openai-compatible',model:'memory-coding-fixture',baseUrl:`http://localhost:${server.address().port}/v1`,executionMode:'agent',taskIsolation:false});await api('openProject',project,true);await page.reload();await page.waitForFunction(()=>!!window.unreal)
 const prior=await api('memoryStatus')
 if(process.argv.includes('--retry')&&prior.settings.enabled&&prior.settings.verifiedProfile&&prior.settings.projects.includes(project)){
  console.log('Memory fixture: retrying unavailable service with retained model cache')
  let current=prior;const initialUntil=Date.now()+360000
  while(current.state==='starting'&&Date.now()<initialUntil){await new Promise(resolve=>setTimeout(resolve,1000));current=await api('memoryStatus')}
  if(current.state==='ready'){
   const memoryRoot=join(root,'profile','memory'),manifests=readdirSync(memoryRoot,{withFileTypes:true}).filter(item=>item.isDirectory()).map(item=>join(memoryRoot,item.name,'runtime.json')).filter(existsSync)
   assert.equal(manifests.length,1,'Expected one owned memory runtime manifest in disposable profile')
   const manifest=JSON.parse(readFileSync(manifests[0],'utf8')),identity=String(manifest.volume||'').replace(/^unrealcode-memory-/,'')
   assert.match(identity,/^[a-f0-9]{16}$/)
   const name=`unrealcode-memory-api-${identity}`,container=JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8',windowsHide:true}))[0]
   assert.equal(container.Config.Labels['ai.unrealcode.kind'],'memory')
   assert(container.Mounts.some(mount=>mount.Name===manifest.cache),'Crash test must target this fixture cache')
   execFileSync('docker',['stop','-t','1',name],{windowsHide:true,stdio:'ignore'})
   const crashUntil=Date.now()+15000;do{current=await api('memoryStatus');if(current.state==='unavailable')break;await new Promise(resolve=>setTimeout(resolve,200))}while(Date.now()<crashUntil)
  }
  assert.equal(current.state,'unavailable','Owned memory service crash must remain visible for retry')
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('unrealcode:settings',{detail:'memory'})))
  const retry=page.getByRole('button',{name:'Retry memory service'}).first()
  await retry.waitFor({timeout:10000})
  await retry.click()
  const retryUntil=Date.now()+360000;let resumed
  while(Date.now()<retryUntil){resumed=await api('memoryStatus');if(resumed.state==='ready')break;await new Promise(resolve=>setTimeout(resolve,1000))}
  assert.equal(resumed?.state,'ready','Memory Settings retry should start the retained service')
  report.checks.push('Settings retry action preserved profile and records')
 }else{
  await api('memoryConfigure',{provider:'openai-codex',model:'gpt-6-astra',baseUrl:'',thinkingLevel:'low',requestLimit:40,tokenLimit:150000});console.log('Memory fixture: verifying model profile');await api('memoryVerify');report.checks.push('separate Codex memory profile verified')
  console.log('Memory fixture: preparing pinned local runtime');await api('memoryEnable',true)
 }
 report.checks.push('private Docker service ready')
 const session=await api('createSession',{});await api('sendMessage',session.sessionId,'Record the synthetic fixture documentation.',randomUUID())
 const currentRecords=status=>status.records.filter(row=>row.sessionId===session.sessionId)
 const until=Date.now()+180000;let status;while(Date.now()<until){status=await api('memoryStatus');if(currentRecords(status).some(row=>row.state==='retained'))break;if(currentRecords(status).some(row=>row.state==='failed'))throw Error(JSON.stringify(currentRecords(status).map(row=>({state:row.state,error:row.error}))));await new Promise(resolve=>setTimeout(resolve,1000))}
 assert(currentRecords(status).some(row=>row.state==='retained'));report.checks.push('automatic canonical-outcome retention')
 const recall=await api('memoryRecall','Which local port does the synthetic sample application use?');assert(JSON.stringify(recall).includes('8123'));report.checks.push('actual Hindsight recall with provenance')
 const reflection=await api('memoryReflect','Which local port does the synthetic sample application use? Cite the retained source.');assert(JSON.stringify(reflection).includes('8123'));assert(reflection.sources?.length>0);report.checks.push('scoped reflection through a fresh temporary bank')
 const memoryDirectory=join(root,'profile','memory');for(const entry of readdirSync(memoryDirectory,{withFileTypes:true})){const path=join(memoryDirectory,entry.name,'memory.json');if(entry.isDirectory()&&existsSync(path))assert.deepEqual(JSON.parse(readFileSync(path,'utf8')).reflectionBanks,[],'Temporary reflection bank must be deleted')}
 const backup=join(root,'backup');if(process.argv.includes('--recovery')){await app.evaluate(({dialog,app},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});app.relaunch=()=>{}},backup);await api('backupExport');report.checks.push('memory database dump and metadata backup verified');await api('openProject',project,true);await api('memoryEnable',true)}
 const record=currentRecords(status).find(row=>row.state==='retained');await api('memoryForget',record.id);assert.equal((await api('memoryStatus')).records.find(row=>row.id===record.id).state,'forgotten');report.checks.push('forget tombstone retained')
 const final=await api('memoryStatus');report.usage={requests:final.requests,input:final.inputTokens,output:final.outputTokens};await api('memoryEnable',false);report.checks.push('disable preserves sources and leaves coding available');if(process.argv.includes('--recovery')){const preview=await api('backupPreview');await api('backupRestore',preview.id).catch(error=>{if(!/closed|destroyed/.test(String(error)))throw error});await app.close().catch(()=>{});app=await launch();page=await app.firstWindow();await page.waitForFunction(()=>!!window.unreal);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0})});await api('openProject',project,true);const restored=await api('memoryStatus');assert(!restored.settings.enabled);assert(!restored.settings.verifiedProfile);await api('memoryVerify');await api('memoryEnable',true);const deadline=Date.now()+180000;while(Date.now()<deadline){if((await api('memoryStatus')).records.some(row=>row.state==='retained'))break;await new Promise(resolve=>setTimeout(resolve,1000))}assert(JSON.stringify(await api('memoryRecall','What port does the synthetic sample use?')).includes('8123'));report.checks.push('restored private database in a new volume, reset consent and explicit re-verification');await api('memoryEnable',false)}console.log(JSON.stringify(report,null,2))
}catch(error){console.log(JSON.stringify({...report,failure:String(error)},null,2));throw error}finally{await app.close();server.close()}
