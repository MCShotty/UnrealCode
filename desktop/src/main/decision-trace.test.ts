import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DecisionOverrides, decisionTraces } from './decision-trace'
let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
it('preserves uncertain probabilities and explicit overrides through restart', async () => {
  root = await mkdtemp(join(tmpdir(), 'unrealcode-trace-'))
  const session = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const traces = decisionTraces([{ v: 1, sessionId: session, seq: 1, event: 'decision.result', payload: { id: 'decision-1', purpose: 'Relevance', engine: 'jev', model: 'version', questions: { relevant: { type: 'noul', instructions: 'Is the source relevant?' } }, evidence: { source: 'focused passage' }, answers: { relevant: { type: 'noul', noul: 0.51 } }, sourceRefs: ['src/example.ts'], durationMs: 24, usage: { input_tokens: 20 } } }])
  expect((traces[0].answers as any).relevant.noul).toBe(0.51)
  expect(traces[0].override).toBeUndefined()
  await new DecisionOverrides(root).save(session, 'decision-1', 'Use the other candidate after reviewing its tests.', traces)
  expect((await new DecisionOverrides(root).apply(session, traces))[0].override).toContain('other candidate')
  await expect(new DecisionOverrides(root).save(session, 'foreign-decision', 'note', traces)).rejects.toThrow('not in this session')
})
it('streams large override logs, skips an oversized damaged line, and reports real read failures',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-trace-large-'))
 const session='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',path=join(root,`${session}.jsonl`)
 const traces=decisionTraces([{v:1,sessionId:session,seq:1,event:'decision.result',payload:{id:'decision-1',engine:'jev',model:'version',answers:{}}}])
 await writeFile(path,`${JSON.stringify({id:'decision-1',note:'earlier'})}\n${'x'.repeat(2*1024*1024)}\n${JSON.stringify({id:'decision-1',note:'latest'})}\n`)
 expect((await new DecisionOverrides(root).apply(session,traces))[0].override).toBe('latest')
 await rm(path);await mkdir(path)
 await expect(new DecisionOverrides(root).apply(session,traces)).rejects.toThrow()
})
it('orders simultaneous override writes from separate IPC store instances',async()=>{
 root=await mkdtemp(join(tmpdir(),'unrealcode-trace-parallel-'))
 const session='cccccccc-cccc-cccc-cccc-cccccccccccc'
 const traces=decisionTraces([{v:1,sessionId:session,seq:1,event:'decision.result',payload:{id:'decision-1',engine:'jev',model:'version',answers:{}}}])
 const first=new DecisionOverrides(root).save(session,'decision-1','first correction',traces)
 const second=new DecisionOverrides(root).save(session,'decision-1','second correction',traces)
 expect((await new DecisionOverrides(root).apply(session,traces))[0].override).toBe('second correction')
 await Promise.all([first,second])
})
