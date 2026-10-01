// A rebuildable, renderer-safe description of recorded activity. Never copy
// message bodies, tool arguments, output, or provider diagnostics into this rail.
const get=(value,key)=>value&&typeof value==='object'?value[key]??value[key[0].toLowerCase()+key.slice(1)]:undefined
const terminal=new Set(['completed','failed','cancelled','canceled','interrupted'])
function project(event){
 const type=event?.event,payload=event?.payload||{},data=get(payload,'Data')||{}
 if(type==='session.item'){
  const kind=get(payload,'Kind')
  if(kind==='input'&&get(data,'Kind')==='external')return {kind:'request',text:'Request received'}
  if(kind==='model_response'){
   const response=get(data,'Response')||{}
   if(get(response,'Failure')||get(response,'Stop')==='refused')return {kind:'failure',text:'Provider response failed'}
   if((get(response,'Output')||[]).some(item=>get(item,'Type')==='message'))return {kind:'response',text:'Assistant response recorded',busy:'end'}
  }
  return null
 }
 if(type==='model.request.started')return {kind:'model',text:'Model request started',busy:'start'}
 if(type==='model.request.completed')return {kind:'model',text:'Model request completed',busy:'end'}
 if(type==='operation.started'){
  const name=get(payload,'Type')
  return {kind:'tool',text:typeof name==='string'&&/^[\w .-]{1,80}$/.test(name)?`${name} started`:'Tool started',operationId:String(get(payload,'ID')||'').slice(0,128),...(!['RequestInput','WaitForInput'].includes(name)?{busy:'start'}:{})}
 }
 if(type==='operation.update'){
  const state=String(get(payload,'Status')||'').toLowerCase()
  if(!terminal.has(state))return null
  return {kind:state==='completed'?'tool':'failure',text:state==='completed'?'Tool completed':`Tool ${state}`,operationId:String(get(payload,'ID')||'').slice(0,128),busy:'end'}
 }
 if(type==='verification.result'){
  const passed=payload.passed===true||payload.success===true||payload.status==='passed'
  return {kind:passed?'verification':'failure',text:passed?'Verification passed':'Verification needs review'}
 }
 if(type==='permission.requested')return {kind:'approval',text:'Approval requested',humanWait:true,waitId:payload.operationId,operationId:payload.operationId,busy:'end'}
 if(type==='permission.resolved')return {kind:'approval',text:'Approval resolved',humanWait:false,waitId:payload.operationId,operationId:payload.operationId,busy:'start'}
 if(type==='session.needs_input')return {kind:'question',text:'Waiting for an answer',humanWait:payload.mode!=='background',waitId:payload.id||payload.operationId}
 if(type==='question.updated'){
  const state=String(payload.state||'')
  if(state==='pending')return {kind:'question',text:'Question asked',humanWait:payload.mode!=='background',waitId:payload.id||payload.operationId}
  if(['cancelled','interrupted'].includes(state))return {kind:'question',text:'Question '+state,humanWait:false,waitId:payload.id}
  if(state==='answered')return {kind:'question',text:'Answer received',humanWait:false,waitId:payload.id}
  return null
 }
 if(type==='session.status'&&['error','stopped'].includes(payload.status))return {kind:payload.status==='error'?'failure':'stopped',text:payload.status==='error'?'Task failed':'Task stopped'}
 if(type==='session.idle'){
  const outcome=payload.outcome?.state
  if(outcome==='failed'||outcome==='completed_with_warnings')return {kind:'failure',text:outcome==='failed'?'Work failed':'Work completed with warnings'}
  if(outcome==='completed')return {kind:'complete',text:'Work completed'}
  if(outcome==='stopped'||outcome==='interrupted')return {kind:'stopped',text:outcome==='stopped'?'Work stopped':'Work interrupted'}
 }
 return null
}
// Inference-only context. No output/log bodies, document contents, or embedded
// app context are copied. Main applies redaction, exclusions and native provenance.
function context(event){
 if(event?.event!=='session.item')return []
 const payload=event.payload||{},data=get(payload,'Data')||{},kind=get(payload,'Kind')
 if(kind==='input'&&get(data,'Kind')==='external'){
  const body=get(data,'Payload'),text=typeof body==='string'?body:String(get(body,'Prompt')||get(body,'Text')||'')
  return text?[{kind:'request',text:text.split(/<unrealcode_(?:context|memory|fieldnotes)>/)[0].slice(0,1200)}]:[]
 }
 if(kind!=='model_response')return []
 const rows=[]
 for(const item of get(get(data,'Response'),'Output')||[]){
  const value=get(item,'Data')||{}
  if(get(item,'Type')!=='tool_call')continue
  const name=get(value,'Name');if(typeof name!=='string'||!/^[\w .-]{1,80}$/.test(name)||name==='Computer')continue
  let args={};try{args=JSON.parse(get(value,'Arguments')||'{}')}catch{}
  const path=typeof args.path==='string'?args.path.slice(0,1024):undefined
  rows.push({kind:'tool',text:name,...(path?{path}:{})})
 }return rows.slice(0,30)
}
module.exports={project,context}
