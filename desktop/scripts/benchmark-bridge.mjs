// Synthetic bridge-only comparison. No real provider, host project or credentials.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const images = process.argv.slice(2)
if (images.length !== 2) throw new Error('Supply baseline and candidate Docker image tags')
const server = createServer(async (req, res) => {
  let text = ''; for await (const part of req) text += part
  const request = JSON.parse(text)
  const finished = request.messages.some(message => message.role === 'tool')
  const message = finished ? { role: 'assistant', content: 'Done' } : { role: 'assistant', tool_calls: ['a','b'].map(id => ({ id, type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 'sleep 0.25; echo fixture' }) } })) }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ id: randomUUID(), choices: [{ index: 0, finish_reason: finished ? 'stop' : 'tool_calls', message }], usage: { prompt_tokens: 20, completion_tokens: 10 } }))
})
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)]
async function benchmark(image) {
  const child = spawn('docker', ['run', '--rm', '-i', '--cap-drop=ALL', '--security-opt=no-new-privileges', image], { windowsHide: true, stdio: ['pipe','pipe','pipe'] })
  let buffer = '', stderr = ''
  const pending = new Map(), events = []
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-1000) })
  child.stdout.on('data', bytes => {
    buffer += bytes
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; const line = buffer.slice(0,end); buffer = buffer.slice(end+1); const message = JSON.parse(line); if (message.event) events.push(message); else if (pending.has(message.id)) { const operation = pending.get(message.id); pending.delete(message.id); clearTimeout(operation.timer); message.ok ? operation.resolve(message.result) : operation.reject(Error(message.error)) } }
  })
  const request = (method, params = {}) => new Promise((resolve,reject) => { const id = randomUUID(); const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out: ${stderr}`)) }, 30000); pending.set(id,{ resolve,reject,timer }); child.stdin.write(JSON.stringify({ v:1,id,method,params })+'\n') })
  const wait = async predicate => { const deadline = Date.now()+30000; while (!predicate()) { if (Date.now()>deadline) throw Error('Benchmark completion timed out'); await new Promise(resolve => setTimeout(resolve,5)) } }
  const durations = [], steering = [], overlaps = []
  try {
    const health = await request('health')
    for (let index=0;index<12;index++) {
      const config = { provider:'openai-compatible',model:'fixture',baseUrl:`http://host.docker.internal:${server.address().port}/v1`,thinkingLevel:'low',systemPrompt:'',disallowedTools:[] }
      if (health.capabilities?.includes('permissions.v1')) config.mode='agent'
      const { sessionId } = await request('session.create',{ config,credential:{} })
      const start = performance.now(), messageId = randomUUID()
      await request('session.send',{sessionId,prompt:'Run fixture tools',messageId,credential:{}})
      await wait(() => events.filter(event => event.sessionId===sessionId && event.event==='operation.started').length===2)
      const steerStart = performance.now(), steerId = randomUUID()
      await request('session.send',{sessionId,prompt:'Continue the same fixture',messageId:steerId,credential:{}})
      steering.push(performance.now()-steerStart)
      await wait(() => events.some(event => event.sessionId===sessionId && event.event==='session.idle' && event.payload.messageIds?.includes(steerId)))
      durations.push(performance.now()-start)
      const items = events.filter(event => event.sessionId===sessionId), lanes = new Map()
      for (const event of items) {
        const id = event.payload.ID
        if (!id) continue
        if (event.event==='operation.started' && !lanes.has(id)) lanes.set(id,{start:Date.parse(event.recordedAt)})
        if (event.event==='operation.dispatched') lanes.set(id,{start:Date.parse(event.recordedAt)})
        if (event.event==='operation.update' && ['completed','failed','canceled'].includes(event.payload.Status)) { const lane=lanes.get(id); if (lane) lane.end=Date.parse(event.recordedAt) }
      }
      const [a,b]=[...lanes.values()]; assert(a?.end && b?.end)
      const overlap=Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start)); overlaps.push(overlap); assert(overlap>100,'Independent tools did not overlap')
      await request('session.stop',{sessionId})
    }
    return { image, runs:durations.length, medianTaskMs:median(durations), medianSteeringAckMs:median(steering), medianToolOverlapMs:median(overlaps), scope:'Synthetic bridge with fixture provider and two 250 ms shell tools; excludes desktop rendering and snapshot setup.' }
  } finally { for (const operation of pending.values()) clearTimeout(operation.timer); child.stdin.end(); await new Promise(resolve => { child.once('exit',resolve); setTimeout(() => { child.kill(); resolve() },5000).unref() }) }
}
try { const baseline=await benchmark(images[0]),candidate=await benchmark(images[1]); console.log(JSON.stringify({baseline,candidate,taskChangePercent:(candidate.medianTaskMs/baseline.medianTaskMs-1)*100})) } finally { server.close() }
