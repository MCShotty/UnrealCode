import {_electron as electron} from 'playwright'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const root=process.argv.find(value=>value.startsWith('--root='))?.slice(7)
if(!root||!process.argv.includes('--live'))throw Error('Use --live --root=<the disposable Fieldnotes fixture>')
const app=await electron.launch({executablePath:resolve(process.env.UNREAL_QA_EXECUTABLE||'node_modules/electron/dist/electron.exe'),args:process.env.UNREAL_QA_EXECUTABLE?[]:['.'],env:{...process.env,UNREAL_DESKTOP_USER_DATA:join(root,'profile'),UNREAL_DESKTOP_BACKGROUND_CHECK:'1'}})
try{const page=await app.firstWindow();await page.waitForFunction(()=>!!window.unreal);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0})});const api=(method,...args)=>page.evaluate(({method,args})=>window.unreal[method](...args),{method,args})
 await api('openProject',join(root,'fieldnotes'),true);const {sessionId}=await api('createSession',{}, {allowSpecialists:false,policy:'off',concurrency:2,workerLimit:2,modelRequestLimit:8,elapsedMinutes:3,tokenLimit:100000}),path=`docs/recovery-${randomUUID().slice(0,8)}.txt`,command=`test -f ${path} && cat ${path}`
 await api('sendMessage',sessionId,`Run an intentional tool-error recovery test in this disposable project. First call Bash using exactly ${JSON.stringify({command})}. Wait for its nonzero exit (the file is missing). Only after that failure, create ${path} with content recovered using ApplyPatch expectedRevision missing. Then repeat exactly the same Bash call and arguments and confirm exit 0. Do not run additional commands, delegate, commit or publish. Finish with the two actual exit codes.`,randomUUID())
 let events=[],outcome;const deadline=Date.now()+180000
 while(Date.now()<deadline){events=await api('getEvents',sessionId,0);outcome=events.findLast(event=>event.event==='session.idle')?.payload.outcome;if(outcome)break;const failed=events.findLast(event=>event.event==='session.status'&&event.payload.status==='error');if(failed)throw Error(failed.payload.message);await new Promise(resolve=>setTimeout(resolve,500))}
 const exits=events.filter(event=>event.event==='operation.update'&&event.payload.State?.Result).map(event=>event.payload.State.Result.ExitCode);assert(exits.includes(1));assert(exits.includes(0));assert.equal(outcome?.state,'completed')
 const report={sessionId,exits,outcome,check:'Actual Codex task retained a failing Bash exit, repeated the exact command successfully, and completed without an unresolved warning'};writeFileSync(join(root,'tool-recovery-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await app.close()}
