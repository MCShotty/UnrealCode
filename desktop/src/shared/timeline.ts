import type {TaskPlan} from './planning'
import type {TurnState} from './lifecycle'
export type TimelinePhase='pending'|'working'|'waiting'|'completed'|'blocked'|'stopped'
export type TimelineStage={id:string;title:string;detail:string;phase:TimelinePhase;evidence:number[];source:'plan'|'inferred'|'recorded';startedAt?:string;endedAt?:string;durationMs?:number;verified?:boolean}
export type TimelineEvidence={seq:number;kind:string;at?:string;text:string;operationId?:string;busy?:'start'|'end';humanWait?:boolean;waitId?:string}
export type TimelineSummary={id:string;workId:string;fromSeq:number;toSeq:number;planRevision:number;summary:string;stageId?:string;phase:'working'|'waiting'|'completed'|'blocked';evidence:number[];createdAt:string;provider:string;model:string;usage:{inputTokens:number;outputTokens:number};stages?:TimelineStage[];revision?:number;workspace?:string;profileGeneration?:number;profileIdentity?:string;planProgressIdentity?:string}
export type TimelineChanged={project:string;sessionId:string;workId?:string;revision?:number}
export type TimelineView={evidence:TimelineEvidence[];summaries:TimelineSummary[];plan?:TaskPlan;workId:string;state:TurnState;before?:number;status:'idle'|'analysing'|'unavailable'|'disabled';message?:string;stages?:TimelineStage[];snapshotRevision?:number;analysedThroughSeq?:number;catchingUp?:boolean;updatedAt?:string;workspace?:string;workFromSeq?:number}

/** Wall time minus intervals entirely awaiting a human. Unknown clocks stay unknown. */
export function timelineDuration(rows:TimelineEvidence[],from:number,to:number,now?:number):number|undefined{
 const events=rows.filter(row=>row.seq>=from&&row.seq<=to)
 if(!events.length||events.some(row=>!row.at||!Number.isFinite(Date.parse(row.at))))return
 let previous=Date.parse(events[0].at!),duration=0;const waiting=new Set<string>(),busy=new Set<string>()
 for(const row of events){const at=Date.parse(row.at!);if(at<previous)return;if(!waiting.size||busy.size)duration+=at-previous;previous=at
  if(row.busy==='start')busy.add(row.operationId||'model');if(row.busy==='end')busy.delete(row.operationId||'model')
  if(row.humanWait===true)waiting.add(row.waitId||'human');if(row.humanWait===false)waiting.delete(row.waitId||'human')
 }
 if(now!==undefined){if(now<previous)return;if(!waiting.size||busy.size)duration+=now-previous}
 return duration
}
export function timelineStages(view:Pick<TimelineView,'evidence'|'summaries'|'plan'|'workId'|'state'>,now?:number):TimelineStage[]{
 const summary=view.summaries.filter(row=>row.workId===view.workId&&row.planRevision===(view.plan?.revision||0)).at(-1)
 const inferred=summary?.stages||[],plan=view.plan?.approvedRevision===view.plan?.revision&&view.plan?.milestones.length?view.plan:undefined
 let stages:TimelineStage[]=plan?plan.milestones.map(row=>{const observed=inferred.find(stage=>stage.id===row.id),selected=summary?.stageId===row.id
  return {id:row.id,title:row.text,detail:observed?.detail||'',phase:row.state==='completed'?'completed':row.state==='running'?'working':observed?.phase|| (selected?summary!.phase:'pending'),evidence:observed?.evidence||[],source:'plan',verified:row.state==='completed'&&row.evidence.some(ref=>/^event:\d+$/.test(ref)&&view.evidence.some(event=>event.seq===Number(ref.slice(6))&&event.kind==='verification'))}
 }):inferred.map(row=>({...row,source:'inferred',verified:false}))
 if(!stages.length){const grouped=new Map<string,TimelineStage>()
  for(const row of view.evidence){const key=row.kind==='tool'?/Read|List|Search|Inspect/.test(row.text)?'inspect':/Write|Edit|Patch/.test(row.text)?'edit':'tools':['question','approval'].includes(row.kind)?'waiting':['failure','stopped','complete'].includes(row.kind)?'outcome':row.kind==='verification'?'verify':'conversation'
   const title=({inspect:'Inspecting the project',edit:'Updating files',tools:'Running tools',waiting:'Waiting for input',verify:'Checking results',outcome:'Task outcome',conversation:'Working on the request'} as Record<string,string>)[key]
   const stage=grouped.get(key)||{id:`recorded:${view.workId}:${key}`,title,detail:row.text,phase:'working' as const,evidence:[],source:'recorded' as const}
   stage.evidence.push(row.seq);stage.detail=row.text;grouped.set(key,stage)
  }stages=[...grouped.values()].slice(-12);stages.forEach((row,i)=>{row.phase=i===stages.length-1?'working':'completed'})
 }
 const active=stages.findIndex(row=>row.phase==='working'),index=active>=0?active:stages.length-1
 if(index>=0){const row=stages[index]
  if(view.state==='waiting_input')row.phase='waiting'
  if(view.state==='failed'||view.state==='completed_with_warnings')row.phase='blocked'
  if(view.state==='stopped'||view.state==='interrupted')row.phase='stopped'
  if(view.state==='completed'&&row.phase!=='pending'){row.phase='completed';row.verified=row.source==='recorded'||row.verified}
  const recorded=[...view.evidence].reverse().find(event=>row.phase==='blocked'?event.kind==='failure':row.phase==='waiting'?event.humanWait===true:row.phase==='stopped'?event.kind==='stopped':false)
  if(recorded){row.detail=recorded.text;row.evidence=[...new Set([...row.evidence,recorded.seq])];row.verified=false}
 }
 return stages.map(row=>{const seqs=row.evidence,first=Math.min(...seqs),last=Math.max(...seqs),start=view.evidence.find(e=>e.seq===first),end=view.evidence.find(e=>e.seq===last)
  return {...row,startedAt:start?.at||row.startedAt,endedAt:row.phase==='working'?undefined:end?.at||row.endedAt,durationMs:start&&end?timelineDuration(view.evidence,first,last,row.phase==='working'?now:undefined):row.durationMs}
 })
}
// The observer reads a larger evidence window than the compact rail displays.
// Page from the first displayed entry so the hidden part is never skipped.
export function timelineDisplayPage(view:TimelineView){const rows=view.evidence.slice(-12);return {rows:[...rows].reverse(),before:view.evidence.length>12?rows[0].seq:view.before}}
