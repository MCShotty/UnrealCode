// Rebuildable projections. Only the history writer changes these tables; the
// two readers use their own WAL snapshots. Raw events remain authoritative.
const get=(v,k)=>v&&typeof v==='object'?v[k]??v[k[0].toLowerCase()+k.slice(1)]:undefined
const terminal=s=>['completed','failed','canceled','cancelled','interrupted'].includes(s)
const stamp=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?t:undefined}
const json=v=>JSON.stringify(v)
const parse=v=>v?JSON.parse(v):undefined
const tables=['work_groups','work_cursor','activity_calls','activity_ops','activity_output','question_cards','work_segments']
function initialize(db){
 db.exec(`CREATE TABLE IF NOT EXISTS work_groups(project TEXT, session TEXT, id TEXT, seq INTEGER, end_seq INTEGER, data TEXT, PRIMARY KEY(project,session,id));
 CREATE INDEX IF NOT EXISTS work_order ON work_groups(project,session,seq);
 CREATE TABLE IF NOT EXISTS work_segments(project TEXT,session TEXT,work TEXT,seq INTEGER,id TEXT,PRIMARY KEY(project,session,work,seq,id));
 CREATE TABLE IF NOT EXISTS work_cursor(project TEXT,session TEXT,seq INTEGER,data TEXT,PRIMARY KEY(project,session));
 CREATE TABLE IF NOT EXISTS activity_calls(project TEXT,session TEXT,id TEXT,seq INTEGER,status TEXT,work TEXT,search TEXT,data TEXT,PRIMARY KEY(project,session,id));
 CREATE INDEX IF NOT EXISTS activity_order ON activity_calls(project,session,status,seq);
 CREATE TABLE IF NOT EXISTS activity_ops(project TEXT,session TEXT,id TEXT,call_id TEXT,data TEXT,PRIMARY KEY(project,session,id));
 CREATE INDEX IF NOT EXISTS activity_owners ON activity_ops(project,session,call_id);
 CREATE TABLE IF NOT EXISTS activity_output(project TEXT,session TEXT,id TEXT,body TEXT,PRIMARY KEY(project,session,id));
 CREATE TABLE IF NOT EXISTS question_cards(project TEXT,session TEXT,id TEXT,seq INTEGER,state TEXT,data TEXT,PRIMARY KEY(project,session,id));`)
}
function service(db){
 const readStatements=new Map()
 const read=(table,p,s,id)=>{if(typeof id!=='string')return;let statement=readStatements.get(table);if(!statement){statement=db.prepare(`SELECT data FROM ${table} WHERE project=? AND session=? AND id=?`);readStatements.set(table,statement)}return parse(statement.get(p,s,id)?.data)}
 const ops=(p,s,id)=>db.prepare('SELECT data FROM activity_ops WHERE project=? AND session=? AND call_id=?').all(p,s,id).map(r=>parse(r.data))
 const callStatement=db.prepare('INSERT OR REPLACE INTO activity_calls VALUES(?,?,?,?,?,?,?,?)')
 const workStatement=db.prepare('INSERT OR REPLACE INTO work_groups VALUES(?,?,?,?,?,?)')
 const saveCall=(p,s,row)=>callStatement.run(p,s,row.id,row.seq,row.status,row.workId,[row.name,row.arguments,row.error].join(' ').toLowerCase(),json(row))
 const insertSegment=db.prepare('INSERT OR IGNORE INTO work_segments VALUES(?,?,?,?,?)')
 const segmentRange=db.prepare('SELECT seq,id FROM work_segments WHERE project=? AND session=? AND work=? AND seq>=? AND seq<=? ORDER BY seq DESC LIMIT 1000')
 const precedingSegment=db.prepare('SELECT seq,id FROM work_segments WHERE project=? AND session=? AND work=? AND seq<? ORDER BY seq DESC LIMIT 1')
 const saveWork=(p,s,w)=>workStatement.run(p,s,w.id,w.seq,w.endSeq??null,json(w))
 // Kept separate from the exposed summary: bounded live identities, no output.
 function advance(w,at){if(at===undefined){w.unknown=true;return}if(w.tick!==undefined){if(at<w.tick)w.unknown=true;const delta=Math.max(0,at-w.tick),active=Object.values(w.ops||{}).filter(v=>v==='executing').length,waiting=Object.keys(w.human||{}).length;if(w.open&&(['running','waiting_input'].includes(w.state)||Object.keys(w.ops||{}).length||w.model)){if(!waiting||active||w.model)w.elapsedMs+=delta;if(w.model)w.modelMs+=delta;if(active)w.toolMs+=delta;if(active>1)w.overlapMs+=delta}}w.tick=Math.max(w.tick??at,at)}
 function refreshCall(p,s,id){let row=read('activity_calls',p,s,id);if(!row)return;const list=ops(p,s,id);row.operationIds=list.map(o=>o.id);if(list.length){const states=list.map(o=>o.status);row.status=states.includes('executing')?'executing':states.includes('waiting_approval')?'waiting_approval':states.includes('waiting_input')?'waiting_input':states.includes('waiting_service')?'waiting_service':states.includes('failed')?'failed':states.includes('cancelled')?'cancelled':states.includes('interrupted')?'interrupted':'completed';const starts=list.map(o=>stamp(o.startedAt)).filter(x=>x!==undefined),ends=list.map(o=>stamp(o.endedAt)).filter(x=>x!==undefined);row.startedAt=starts.length?new Date(Math.min(...starts)).toISOString():undefined;row.endedAt=list.every(o=>terminal(o.status))&&ends.length===list.length?new Date(Math.max(...ends)).toISOString():undefined;row.durationMs=row.startedAt&&row.endedAt&&stamp(row.endedAt)>=stamp(row.startedAt)?stamp(row.endedAt)-stamp(row.startedAt):undefined;row.error=list.find(o=>o.error)?.error;row.exitCode=list.find(o=>o.exitCode!==undefined&&o.exitCode!==0)?.exitCode??list.find(o=>o.exitCode!==undefined)?.exitCode;row.workspace=list.find(o=>o.workspace)?.workspace}saveCall(p,s,row)}
 function consume(p,s,e,c){
  const payload=e.payload||{},data=get(payload,'Data'),kind=get(payload,'Kind'),at=stamp(e.recordedAt),type=e.event
  let w=c.work?read('work_groups',p,s,c.work):undefined
  if(w&&!(type==='session.status'&&payload.status==='running'))advance(w,at)
  if(w?.resuming&&['operation.started','model.request.started'].includes(type)){w.open=true;w.state='running';w.settled=undefined;w.resuming=false;w.tick=at;delete w.endSeq;delete w.endedAt}
  const input=type==='session.item'&&kind==='input'&&get(data,'Kind')==='external'
  const inputBody=input?get(data,'Payload'):undefined,workerNotice=input&&(typeof inputBody==='string'?inputBody:get(inputBody,'Prompt')||'').startsWith('<unrealcode_worker_event>')
  if(workerNotice&&w&&!w.open&&['completed','completed_with_warnings'].includes(w.state)){w.open=true;w.state='running';w.settled=undefined;w.tick=at;w.unknown=true;delete w.endSeq;delete w.endedAt}
  if(input||!w&&['model.request.started','operation.started','question.updated'].includes(type)){
   if(!w?.open){if(w)saveWork(p,s,w);w={id:input&&get(data,'ID')?String(get(data,'ID')):`partial:${e.seq}`,sessionId:s,seq:e.seq,state:'running',messageIds:[],startedAt:e.recordedAt,elapsedMs:0,modelMs:0,toolMs:0,overlapMs:0,open:true,tick:at,ops:{},human:{},model:false,unknown:!input};c.work=w.id}
   if(input){insertSegment.run(p,s,w.id,e.seq,String(get(data,'ID')||e.seq));const id=get(data,'ID');if(typeof id==='string'&&id){if(!w.messageIds.includes(id))w.messageIds.push(id);w.pending||={};w.pending[id]=true}w.settled=undefined;w.state=Object.keys(w.human).length?'waiting_input':'running'}
  }
  if(type==='session.item'&&kind==='fork'){if(w){w.open=false;w.state='interrupted';w.endSeq=e.seq;saveWork(p,s,w)}c.work=undefined;w=undefined}
  if(type==='session.item'&&kind==='turn')c.turn=get(data,'ID')
  if(w&&type==='model.request.started'){w.model=true;w.state='running'}
  if(w&&type==='model.request.completed')w.model=false
  if(type==='session.item'&&kind==='model_response'){
   const response=get(data,'Response');if(w){w.model=false;if(get(response,'Failure')||get(response,'Stop')==='refused'){w.state='failed';w.failureSequence=e.seq;w.fatal=true}}
   for(const [i,out] of (get(response,'Output')||[]).entries()){
    const d=get(out,'Data');if(get(out,'Type')==='message'&&get(d,'Text')&&w){w.lastMessageId=`${e.seq}:message:${i}`;if(get(d,'Phase'))w.phases=true;if(get(d,'Phase')==='final_answer'){w.finalMessageId=w.lastMessageId;insertSegment.run(p,s,w.id,e.seq,w.lastMessageId)}}
    if(get(out,'Type')!=='tool_call')continue
    const id=`${get(data,'TurnID')}:${get(d,'CallID')}`
    saveCall(p,s,{id,sessionId:s,workId:w?.id||'',turnId:get(data,'TurnID'),name:get(d,'Name')||'Tool',arguments:get(d,'Arguments')||'',seq:e.seq,operationIds:[],status:get(response,'Failure')?'failed':'executing',startedAt:e.recordedAt})
   }
  }
  function updateOperation(value,override){
   const id=get(value,'ID');if(!id)return
   const previous=read('activity_ops',p,s,id),state=get(value,'State')||{},raw=get(value,'Status')||'awaiting'
   // Terminal replay snapshots cannot resurrect a completed call.
   if(previous&&terminal(previous.status)&&!terminal(raw)&&!override&&!(previous.status==='interrupted'&&type==='operation.started'))return
   let status=raw==='canceled'?'cancelled':terminal(raw)?raw:previous&&['waiting_input','waiting_approval','waiting_service'].includes(previous.status)?previous.status:'executing'
   if(override)status=override
   const result=get(state,'Result'),exitCode=get(result,'ExitCode'),error=get(state,'TerminalError')||get(value,'Error')
   if(status==='completed'&&typeof exitCode==='number'&&exitCode!==0)status='failed'
   const row={...previous,id,status,callId:previous?.callId||`operation:${id}`,startedAt:previous?.startedAt||(type==='operation.started'?e.recordedAt:undefined),endedAt:terminal(status)?e.recordedAt:undefined,error:typeof error==='string'?error:undefined,exitCode,workspace:payload.workspaceId||previous?.workspace,seq:e.seq}
   db.prepare('INSERT OR REPLACE INTO activity_ops VALUES(?,?,?,?,?)').run(p,s,id,row.callId,json(row))
   if(!read('activity_calls',p,s,row.callId))saveCall(p,s,{id:row.callId,sessionId:s,workId:w?.id||'',name:get(value,'Type')||'Operation',arguments:'',seq:e.seq,status,operationIds:[id]})
   if(Object.keys(state).length){const body=json({result:get(state,'Result'),stdout:get(state,'InlineOut'),stderr:get(state,'InlineErr'),output:get(state,'TerminalResult'),error:get(state,'TerminalError')});db.prepare('INSERT OR REPLACE INTO activity_output VALUES(?,?,?,?)').run(p,s,id,body)}
   refreshCall(p,s,row.callId);if(w){if(terminal(status))delete w.ops[id];else w.ops[id]=status;if(status==='waiting_approval'||status==='waiting_input')w.human[id]=true;else delete(w.human[id])}
  }
  if(type==='operation.started'||type==='operation.update'||type==='operation.dispatched')updateOperation(payload,type==='operation.dispatched'?'executing':undefined)
  if(['permission.requested','permission.resolved','host.request','host.resolved','session.needs_input'].includes(type)){
   const id=payload.operationId;if(id){const prior=read('activity_ops',p,s,id),raw={ID:id,Status:prior&&terminal(prior.status)?prior.status:'awaiting'};if(!prior||!terminal(prior.status))updateOperation(raw,type==='permission.requested'?'waiting_approval':type==='host.request'?'waiting_service':type==='session.needs_input'?'waiting_input':'executing')}
  }
  if(type==='session.item'&&kind==='tool_call_status'){
   const id=`${get(data,'TurnID')}:${get(data,'CallID')}`,status=get(data,'Status')||{},values=get(data,'Operations')||get(data,'InheritedOperations')||[],ids=new Set([...(get(status,'WaitingFor')||[]).map(x=>typeof x==='string'?x:get(x,'ID')),...values.map(x=>get(x,'ID'))].filter(Boolean))
   if(!read('activity_calls',p,s,id))saveCall(p,s,{id,sessionId:s,workId:w?.id||'',turnId:get(data,'TurnID'),name:'Tool',arguments:'',seq:e.seq,status:'executing',operationIds:[]})
   for(const opid of ids){const prior=read('activity_ops',p,s,opid)||{id:opid,status:'executing'},old=prior.callId;prior.callId=id;db.prepare('INSERT OR REPLACE INTO activity_ops VALUES(?,?,?,?,?)').run(p,s,opid,id,json(prior));if(old?.startsWith('operation:'))db.prepare('DELETE FROM activity_calls WHERE project=? AND session=? AND id=?').run(p,s,old)}
   for(const value of values)updateOperation(value,get(data,'InheritedOperations')&&!terminal(get(value,'Status'))?'interrupted':undefined)
   let row=read('activity_calls',p,s,id);if(get(status,'Error')){row.status='failed';row.error=String(get(status,'Error'));row.endedAt=e.recordedAt;saveCall(p,s,row)}else if(!ids.size){row.status='completed';row.endedAt=e.recordedAt;saveCall(p,s,row)}else refreshCall(p,s,id)
  }
  if(type==='question.updated'||type==='session.needs_input'&&!payload.questionId){
   const id=type==='question.updated'?payload.id:payload.operationId;if(id){const prior=read('question_cards',p,s,id);let q=type==='question.updated'?{...payload}: {id,legacy:true,sessionId:s,workspaceId:'',revision:1,mode:'required',state:'pending',questions:[{id:'q1',title:payload.question,choices:(payload.choices||[]).map((label,i)=>({id:String(i+1),label}))}],createdAt:e.recordedAt,updatedAt:e.recordedAt};q.seq=prior?.seq??e.seq;if(w&&!prior)insertSegment.run(p,s,w.id,e.seq,'question:'+id);q.workId=prior?.workId??w?.id;db.prepare('INSERT OR REPLACE INTO question_cards VALUES(?,?,?,?,?,?)').run(p,s,id,q.seq,q.state,json(q));if(w){if(q.mode==='required'&&q.state==='pending')w.human[id]=true;else delete(w.human[id])}}
  }
  if(type==='operation.update'){
   const id=get(payload,'ID'),q=read('question_cards',p,s,id);if(q?.legacy&&q.state==='pending'&&terminal(get(payload,'Status'))){q.state=get(payload,'Status')==='completed'?'answered':'cancelled';q.answers=q.state==='answered'?[{questionId:'q1',text:String(get(get(payload,'State'),'TerminalResult')||'Answer recorded')}]:undefined;q.updatedAt=e.recordedAt;db.prepare('UPDATE question_cards SET state=?,data=? WHERE project=? AND session=? AND id=?').run(q.state,json(q),p,s,id);if(w)delete(w.human[id])}
  }
  if(w){
   if(type==='session.status'&&payload.status==='running'&&w.open){
    // A newly started coordinator is an explicit resume, not proof that every
    // old operation is alive. Only fresh operation.started events revive it.
    for(const id of Object.keys(w.ops))if(!terminal(w.ops[id]))updateOperation({ID:id,Status:'interrupted'},'interrupted')
    w.model=false;w.state='interrupted';w.open=false;w.endSeq=e.seq;w.endedAt=e.recordedAt;w.tick=at;w.unknown=true;w.resuming=true
   }
   if(type==='session.idle'){for(const id of payload.messageIds||[])if(w.pending)delete w.pending[id];if(!Object.keys(w.pending||{}).length&&!['running','waiting_input'].includes(payload.outcome?.state))w.settled=payload.outcome?.state||'completed'}
   if(type==='session.status'&&['error','stopped'].includes(payload.status)){w.settled=payload.status==='error'?'failed':w.settled||'stopped';if(payload.status==='error'){w.fatal=true;w.failureSequence=w.failureSequence||e.seq};for(const id of Object.keys(w.ops)){if(!terminal(w.ops[id]))updateOperation({ID:id,Status:'interrupted'},'interrupted')}}
   const unsettled=Object.values(w.ops).some(x=>!terminal(x))
   if(w.settled&&!unsettled&&!w.model){w.state=w.fatal?'failed':w.settled;w.open=false;w.endSeq=e.seq;w.endedAt=e.recordedAt;w.finalMessageId=w.phases?w.finalMessageId:['completed','completed_with_warnings'].includes(w.state)?w.lastMessageId:undefined;if(w.finalMessageId){w.finalMessageIds||=[];if(!w.finalMessageIds.includes(w.finalMessageId))w.finalMessageIds.push(w.finalMessageId)}}
   else if(w.open&&!w.fatal)w.state=Object.keys(w.human).length?'waiting_input':'running'
   saveWork(p,s,w)
  }
  c.seq=e.seq
 }
 function project(p,s,earliest=0){
  let cursor=db.prepare('SELECT * FROM work_cursor WHERE project=? AND session=?').get(p,s),c=cursor?parse(cursor.data):{seq:0}
  if(earliest&&earliest<=c.seq){for(const table of tables)db.prepare(`DELETE FROM ${table} WHERE project=? AND session=?`).run(p,s);c={seq:0}}
  for(const row of db.prepare('SELECT payload FROM events WHERE project=? AND session=? AND seq>? ORDER BY seq').iterate(p,s,c.seq))consume(p,s,parse(row.payload),c)
  db.prepare('INSERT OR REPLACE INTO work_cursor VALUES(?,?,?,?)').run(p,s,c.seq,json(c))
  const latest=c.work&&read('work_groups',p,s,c.work),meta=parse(db.prepare('SELECT metadata FROM sessions WHERE project=? AND session=?').get(p,s)?.metadata)
  if(latest&&meta){meta.state=latest.state;meta.outcome={...meta.outcome,state:latest.state,messageIds:latest.messageIds,updatedAt:latest.endedAt||latest.startedAt};meta.outcomeSequence=c.seq;db.prepare('UPDATE sessions SET metadata=? WHERE project=? AND session=?').run(json(meta),p,s)}
 }
 function summary(w,online){if(!w)return undefined;const v={...w,ops:{...w.ops},human:{...w.human}};if(online&&v.open)advance(v,Date.now());const {ops,human,tick,model,unknown,lastMessageId,settled,fatal,segments,...result}=v;if(unknown)delete result.elapsedMs;if(!online&&result.open){if(!['failed','stopped','completed','completed_with_warnings'].includes(result.state))result.state='interrupted';result.open=false}return result}
 function visible(row,online){return !online&&!terminal(row.status)?{...row,status:'interrupted'}:row}
 function view(p){
  const rows=db.prepare('SELECT data FROM work_groups WHERE project=? AND session=? AND seq<=? AND (end_seq IS NULL OR end_seq>=?) ORDER BY seq DESC LIMIT 1000').all(p.project,p.session,p.to||Number.MAX_SAFE_INTEGER,p.from||0).reverse()
  const questions=db.prepare("SELECT data FROM question_cards WHERE project=? AND session=? AND (state='pending' OR seq BETWEEN ? AND ?) ORDER BY seq LIMIT 1000").all(p.project,p.session,p.from||0,p.to||Number.MAX_SAFE_INTEGER).map(r=>{const q=parse(r.data);return !p.active&&q.state==='pending'?{...q,state:'interrupted'}:q})
  const activity=db.prepare('SELECT id,status FROM activity_calls WHERE project=? AND session=? AND seq<=? ORDER BY seq DESC LIMIT 1000').all(p.project,p.session,p.to||Number.MAX_SAFE_INTEGER).map(row=>visible(row,p.active))
  const works=rows.map(r=>{const work=summary(parse(r.data),p.active);const segments=segmentRange.all(p.project,p.session,work.id,p.from||0,p.to||Number.MAX_SAFE_INTEGER).reverse();if(p.from&&work.seq<p.from){const prior=precedingSegment.get(p.project,p.session,work.id,p.from);if(prior)segments.unshift(prior)}work.segments=segments;return work});return {works,questions,activity}
 }
 function page(p){
  const filter=p.query||{},offset=Math.max(0,Math.min(100000,filter.offset||0)),limit=Math.max(1,Math.min(100,filter.limit||30));let where='project=? AND session=?',args=[p.project,p.session]
  if(filter.workId){where+=' AND work=?';args.push(filter.workId)}
  const counts=db.prepare(`SELECT status,COUNT(*) n FROM activity_calls WHERE ${where} GROUP BY status`).all(...args),count=status=>counts.find(r=>r.status===status)?.n||0
  if(filter.search){where+=' AND instr(search,?)>0';args.push(String(filter.search).toLowerCase().slice(0,500))}
  if(filter.status&&filter.status!=='all'){if(!p.active&&filter.status==='interrupted')where+=" AND status NOT IN ('completed','failed','cancelled')";else {where+=' AND status=?';args.push(filter.status)}}
  const total=db.prepare(`SELECT COUNT(*) n FROM activity_calls WHERE ${where}`).get(...args).n
  const rows=db.prepare(`SELECT data FROM activity_calls WHERE ${where} ORDER BY CASE WHEN status IN ('executing','waiting_approval','waiting_input','waiting_service') THEN 0 ELSE 1 END,seq DESC,id LIMIT ? OFFSET ?`).all(...args,limit,offset).map(r=>visible(parse(r.data),p.active))
  const work=filter.workId?summary(read('work_groups',p.project,p.session,filter.workId),p.active):undefined
  const totals=work?{modelMs:work.modelMs,toolMs:work.toolMs,overlapMs:work.overlapMs}:db.prepare("SELECT COALESCE(SUM(json_extract(data,'$.modelMs')),0) modelMs,COALESCE(SUM(json_extract(data,'$.toolMs')),0) toolMs,COALESCE(SUM(json_extract(data,'$.overlapMs')),0) overlapMs FROM work_groups WHERE project=? AND session=?").get(p.project,p.session)
  if(!work&&p.active){const latest=parse(db.prepare('SELECT data FROM work_groups WHERE project=? AND session=? ORDER BY seq DESC LIMIT 1').get(p.project,p.session)?.data);if(latest?.open){const live=summary(latest,true);for(const key of ['modelMs','toolMs','overlapMs'])totals[key]+=live[key]-latest[key]}}
  return {rows,total,offset,hasMore:offset+rows.length<total,executing:p.active?count('executing'):0,waitingApproval:p.active?count('waiting_approval'):0,waitingInput:p.active?count('waiting_input'):0,work,totals}
 }
 function detail(p){const row=read('activity_calls',p.project,p.session,p.id);if(!row)throw Error('Activity is not cached yet. Refresh history.');const offset=Math.max(0,Math.floor(p.offset||0)),limit=16384;let total=0,output='',used=0;for(const id of row.operationIds){const length=db.prepare('SELECT length(body) n FROM activity_output WHERE project=? AND session=? AND id=?').get(p.project,p.session,id)?.n||0;if(total+length>offset&&used<limit){const start=Math.max(0,offset-total),chunk=db.prepare('SELECT substr(body,?,?) body FROM activity_output WHERE project=? AND session=? AND id=?').get(start+1,limit-used,p.project,p.session,id)?.body||'';output+=chunk;used+=Array.from(chunk).length}total+=length}return {row:visible(row,p.active),output,offset,total,hasMore:offset+used<total}}
 return {project,view,page,detail}
}
module.exports={initialize,service}
