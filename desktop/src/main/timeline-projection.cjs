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
   if((get(response,'Output')||[]).some(item=>get(item,'Type')==='message'))return {kind:'response',text:'Assistant response recorded'}
  }
  return null
 }
 if(type==='model.request.started')return {kind:'model',text:'Model request started'}
 if(type==='operation.started'){
  const name=get(payload,'Type')
  return {kind:'tool',text:typeof name==='string'&&/^[\w .-]{1,80}$/.test(name)?`${name} started`:'Tool started'}
 }
 if(type==='operation.update'){
  const state=String(get(payload,'Status')||'').toLowerCase()
  if(!terminal.has(state))return null
  return {kind:state==='completed'?'tool':'failure',text:state==='completed'?'Tool completed':`Tool ${state}`}
 }
 if(type==='verification.result'){
  const passed=payload.passed===true||payload.success===true||payload.status==='passed'
  return {kind:passed?'verification':'failure',text:passed?'Verification passed':'Verification needs review'}
 }
 if(type==='permission.requested')return {kind:'approval',text:'Approval requested'}
 if(type==='session.needs_input')return {kind:'question',text:'Waiting for an answer'}
 if(type==='question.updated'){
  const state=String(payload.state||'')
  if(state==='pending')return {kind:'question',text:'Question asked'}
  if(state==='answered')return {kind:'question',text:'Answer received'}
  return null
 }
 if(type==='session.idle'){
  const outcome=payload.outcome?.state
  if(outcome==='failed'||outcome==='completed_with_warnings')return {kind:'failure',text:outcome==='failed'?'Work failed':'Work completed with warnings'}
  if(outcome==='completed')return {kind:'complete',text:'Work completed'}
  if(outcome==='stopped'||outcome==='interrupted')return {kind:'stopped',text:outcome==='stopped'?'Work stopped':'Work interrupted'}
 }
 return null
}
module.exports={project}
