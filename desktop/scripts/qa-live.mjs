// Explicit live check using the user's existing, externally managed Codex login.
// No authentication material is copied into test files or exposed to the renderer.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
if (!process.argv.includes('--codex')) throw new Error('Live provider verification requires --codex')
const root = mkdtempSync(join(tmpdir(), 'unrealcode-live-')), project = join(root, 'project')
mkdirSync(project); writeFileSync(join(project, 'sample.txt'), 'UNREALCODE_NATIVE_READ_OK\n')
if(process.argv.includes('--teams')){const git=args=>execFileSync('git',['-C',project,...args],{windowsHide:true,stdio:'ignore'});git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Live read fixture'])}
const app = await electron.launch({ executablePath: resolve(process.env.UNREALCODE_QA_EXECUTABLE || 'dist/win-unpacked/UnrealCode.exe'), args: [], env: { ...process.env, UNREAL_DESKTOP_USER_DATA: join(root, 'data'), UNREAL_DESKTOP_BACKGROUND_CHECK: '1' } })
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Set up later' }).click()
  const status = await page.evaluate(() => window.unreal.codexStatus())
  if (!status.available) { console.log(JSON.stringify({ available: false, reason: status.message })); process.exitCode = 2 }
  else {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await page.evaluate(() => window.unreal.updateSettings({ provider: 'openai-codex', executionMode: 'plan', taskIsolation: false, thinkingLevel: 'low' }))
    await page.evaluate(path => window.unreal.openProject(path, true), project)
    const { sessionId } = await page.evaluate(() => window.unreal.createSession())
    await page.evaluate(id => window.unreal.sendMessage(id, 'Use ReadFile to read sample.txt. Reply with its exact content. Do not use other tools.', crypto.randomUUID()), sessionId)
    const deadline = Date.now() + 120000
    let events = [], reply = ''
    while (Date.now() < deadline) {
      events = await page.evaluate(id => window.unreal.getEvents(id, 0), sessionId)
      reply = events.flatMap(event => event.payload?.Kind === 'model_response' ? event.payload.Data?.Response?.Output || [] : []).filter(item => item.Type === 'message').map(item => item.Data?.Text || '').join('\n')
      if (reply.includes('UNREALCODE_NATIVE_READ_OK') || events.some(event => event.event === 'session.status' && event.payload.status === 'error')) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert(reply.includes('UNREALCODE_NATIVE_READ_OK'), 'Live Codex response did not complete; reconnect the external login or inspect the provider failure locally')
    assert(events.some(event => JSON.stringify(event.payload).includes('"Name":"ReadFile"')), 'Native ReadFile was not exercised')
    if(process.argv.includes('--teams')) {
      const idleDeadline=Date.now()+30000
      while(!(await page.evaluate(id=>window.unreal.getEvents(id,0),sessionId)).some(event=>event.event==='session.idle')){if(Date.now()>idleDeadline)throw Error('Parent did not become idle');await new Promise(resolve=>setTimeout(resolve,100))}
      await page.evaluate(id=>window.unreal.teamConfigure(id,{allowSpecialists:true,concurrency:2,workerLimit:2,modelRequestLimit:10,elapsedMinutes:5,tokenLimit:100000}),sessionId)
      const worker=await page.evaluate(id=>window.unreal.teamDispatch(id,{role:'explorer',assignment:'Use ReadFile to read sample.txt. Reply with its exact content. Do not use other tools.',ownership:['sample.txt']}),sessionId)
      const workerDeadline=Date.now()+120000;let finished
      while(Date.now()<workerDeadline){finished=(await page.evaluate(id=>window.unreal.teamView(id),sessionId)).workers.find(item=>item.id===worker.id);if(['completed','review','failed'].includes(finished.state))break;await new Promise(resolve=>setTimeout(resolve,250))}
      assert.equal(finished.state,'completed');assert(finished.findings.includes('UNREALCODE_NATIVE_READ_OK'));const config=await page.evaluate(id=>window.unreal.sessionConfig(id),worker.sessionId);assert.equal(config.mode,'plan');assert.equal(config.provider,'openai-codex')
      console.log(JSON.stringify({provider:'openai-codex',specialistRead:true,inheritedProvider:true,nestedDelegation:false,root}))
    }
    console.log(JSON.stringify({ provider: 'openai-codex', nativeRead: true, reply, sessionId, root }))
  }
} finally { await app.close().catch(() => {}) }
