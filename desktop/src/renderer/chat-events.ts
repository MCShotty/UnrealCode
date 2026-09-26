import type { AgentEvent } from '../shared/api'

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function field(value: unknown, ...names: string[]): unknown { const target = record(value); for (const name of names) if (name in target) return target[name]; return undefined }
function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function decisionAnswer(value: unknown): string {
  const answer = record(value)
  if (answer.type === 'choice') return `${string(answer.choice) || 'unknown'}${typeof answer.confidence === 'number' ? ` (${Math.round(answer.confidence * 100)}% confidence)` : ''}`
  if (answer.type === 'noul') return `${Math.round(Number(answer.noul || 0) * 100)}% yes`
  if (answer.type === 'score') return `${String(answer.score ?? 'unknown')}${typeof answer.confidence === 'number' ? ` (${Math.round(answer.confidence * 100)}% confidence)` : ''}`
  return JSON.stringify(answer)
}
function formatTime(value: unknown): string {
  const date = new Date(string(value))
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function asMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return string(field(value, 'prompt', 'Text', 'text'))
  return ''
}
export type ParsedEntry = { id: string; kind: 'user' | 'assistant' | 'tool' | 'decision' | 'status' | 'question'; seq?: number; text: string; title: string; timestamp: string; status?: string; raw?: unknown }
export function parseEvents(events: AgentEvent[]): ParsedEntry[] {
  const result: ParsedEntry[] = []
  const compactionTurns=new Set<string>()
  const tools = new Map<string, ParsedEntry>()
  const operationCalls = new Map<string, string>()
  const callOperations = new Map<string, string[]>()
  const operationStates = new Map<string,string>()
  const terminal = (state:string) => ['completed','failed','canceled'].includes(state)
  const callKey = (call:string,turn:unknown) => `call:${string(turn)}:${call}`
  // Telemetry can precede the persisted tool-call status in the event stream.
  // Resolve identities first so a completed operation never becomes a stray card.
  for(const event of events){
    if(event.event!=='session.item'||field(event.payload,'Kind','kind')!=='tool_call_status')continue
    const data=field(event.payload,'Data','data'),key=callKey(string(field(data,'CallID','callId')),field(data,'TurnID','turnId'))
    const ids=field(field(data,'Status','status'),'WaitingFor','waitingFor')
    if(Array.isArray(ids)){const names=ids.map(id=>typeof id==='string'?id:string(field(id,'ID','id'))).filter(Boolean);callOperations.set(key,names);for(const id of names)operationCalls.set(id,key)}
  }
  const operationState = (value:unknown):void => {const id=string(field(value,'ID','id')),state=string(field(value,'Status','status'));if(id&&state&&!(terminal(operationStates.get(id)||'')&&!terminal(state)))operationStates.set(id,state)}
  const callState = (key:string):string => {const ids=callOperations.get(key)||[];if(!ids.length)return 'completed';const states=ids.map(id=>operationStates.get(id)||'running');if(states.some(state=>!terminal(state)))return 'running';return states.includes('failed')?'failed':states.includes('canceled')?'canceled':'completed'}
  let sequence = 0
  const toolEntry = (key: string, update: Partial<ParsedEntry>): void => {
    update.seq = sequence
    const existing = tools.get(key)
    if (existing) { Object.assign(existing, update); return }
    const created: ParsedEntry = { id: key, kind: 'tool', title: update.title || 'Tool call', text: update.text || '', timestamp: update.timestamp || '', status: update.status, raw: update.raw, seq: sequence }
    tools.set(key, created)
    result.push(created)
  }
  for (const event of events) {
    sequence = event.seq
    if (event.event === 'session.needs_input') {
      result.push({ id: `${event.seq}:question`, kind: 'question', title: 'Your input is needed', text: string(field(event.payload, 'question')), timestamp: formatTime(event.recordedAt), raw: event.payload })
      continue
    }
    if (event.event === 'decision.result') {
      const payload = record(event.payload)
      const answers = record(payload.answers)
      const choices = Object.entries(answers).map(([name, answer]) => `${name}: ${decisionAnswer(answer)}`).join(' · ')
      result.push({ id: `${event.seq}:decision`, kind: 'decision', title: `${string(payload.engine).toUpperCase()} decision batch`, text: choices, timestamp: '', status: `${Number(payload.durationMs || 0)} ms`, raw: payload })
      continue
    }
    if (event.event === 'decision.error') {
      result.push({ id: `${event.seq}:decision-error`, kind: 'status', title: 'Decision engine unavailable', text: string(field(event.payload, 'message')), timestamp: '', status: 'error' })
      continue
    }
    if (event.event === 'session.status') {
      const state = string(field(event.payload, 'status'))
      if (state === 'error') result.push({ id: `${event.seq}:error`, kind: 'status', title: 'Agent error', text: string(field(event.payload, 'message')), timestamp: '', status: 'error' })
      continue
    }
    if (event.event === 'operation.update') {
      const operation = record(event.payload)
      const operationID = string(field(operation, 'ID', 'id'))
      const key = operationCalls.get(operationID) || `operation:${operationID}`
      operationState(operation)
      toolEntry(key, { title: tools.get(key)?.title || string(field(operation, 'Type', 'type')) || 'Operation', text: tools.get(key)?.text || operationID, status: operationCalls.has(operationID)?callState(key):operationStates.get(operationID), raw: event.payload })
      continue
    }
    if(event.event==='context.compaction.completed'){result.push({id:`${event.seq}:compaction`,kind:'status',title:'Context summary created',text:'Earlier history is summarized for future requests. Original events remain available in Context.',timestamp:formatTime(event.recordedAt)});continue}
    if (event.event !== 'session.item') continue
    const item = record(event.payload)
    const kind = string(field(item, 'Kind', 'kind'))
    const data = field(item, 'Data', 'data')
    const timestamp = formatTime(field(item, 'RecordedAt', 'recordedAt'))
    if(kind==='turn'&&field(data,'Type','type')==='compaction'){compactionTurns.add(string(field(data,'ID','id')));continue}
    if (kind === 'input') {
      if (string(field(data, 'Kind', 'kind')) !== 'external') continue
      const payload = field(data, 'Payload', 'payload')
      const text = (typeof payload === 'string' ? payload : asMessage(payload)).split('<unrealcode_context>')[0].trimEnd()
      result.push({ id: `${event.seq}:input`, kind: 'user', title: 'You', text, timestamp })
    } else if (kind === 'model_response') {
      if(compactionTurns.has(string(field(data,'TurnID','turnId'))))continue
      const response = field(data, 'Response', 'response')
      const outputs = field(response, 'Output', 'output')
      if (!Array.isArray(outputs)) continue
      for (let index = 0; index < outputs.length; index++) {
        const output = outputs[index]
        const outputType = string(field(output, 'Type', 'type'))
        const content = field(output, 'Data', 'data')
        if (outputType === 'message') {
          const text = asMessage(content)
          if (text) result.push({ id: `${event.seq}:message:${index}`, kind: 'assistant', title: 'UnrealCode', text, timestamp })
        } else if (outputType === 'tool_call') {
          const callID = string(field(content, 'CallID', 'callId')) || `${event.seq}:${index}`
          const key=callKey(callID,field(data,'TurnID','turnId'))
          toolEntry(key, { title: string(field(content, 'Name', 'name')) || 'Tool call', text: string(field(content, 'Arguments', 'arguments')), timestamp, status: tools.get(key)?.status||'started', raw: content })
        }
      }
    } else if (kind === 'tool_call_status') {
      const callID = string(field(data, 'CallID', 'callId'))
      const key = callKey(callID,field(data,'TurnID','turnId'))
      const status = field(data, 'Status', 'status')
      const operations = field(status, 'WaitingFor', 'waitingFor')
      if (Array.isArray(operations)) for (const operation of operations) {
        const operationID = typeof operation === 'string' ? operation : string(field(operation, 'ID', 'id'))
        if (operationID) operationCalls.set(operationID, key)
      }
      const hasError = !!string(field(status, 'Error', 'error'))
      const snapshots=field(data,'Operations','operations')
      if(Array.isArray(snapshots))for(const snapshot of snapshots)operationState(snapshot)
      toolEntry(key, { title: tools.get(key)?.title || 'Tool call', text: tools.get(key)?.text || callID, timestamp, status: hasError ? 'failed' : callState(key), raw: data })
    }
  }
  return result
}

