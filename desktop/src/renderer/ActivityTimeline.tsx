import {useEffect,useRef,useState} from 'react'
import {ProgressIndicator} from './ProgressIndicator'
import type {TimelineView} from '../shared/timeline'
import {timelineDisplayPage} from '../shared/timeline'
export function ActivityTimeline({sessionId,sequence,onEvidence}:{sessionId?:string;sequence:number;onEvidence(seq:number):void}){
 const [view,setView]=useState<TimelineView>(),[error,setError]=useState(''),[before,setBefore]=useState<number>(),generation=useRef(0)
 useEffect(()=>{generation.current++;setView(undefined);setError('');setBefore(undefined)},[sessionId])
 useEffect(()=>{if(!sessionId)return;const owner=generation.current;let live=true,pending=false;const load=()=>{if(pending)return;pending=true;void window.unreal.timeline(sessionId,before).then(value=>{if(live&&owner===generation.current){setView(value);setError('')}}).catch(()=>{if(live&&owner===generation.current)setError('Timeline unavailable. Conversation history is preserved.')}).finally(()=>{pending=false})};const timer=setTimeout(load,350),dispose=window.unreal.onWorkflowChanged(load);return()=>{live=false;clearTimeout(timer);dispose()}},[sessionId,sequence,before])
 const summary=view?.summaries.filter(row=>row.workId===view.workId&&row.planRevision===(view.plan?.revision||0)).at(-1),plan=view?.plan?.approvedRevision===view?.plan?.revision?view?.plan:undefined
 const blocked=view&&['failed','interrupted','stopped','waiting_input'].includes(view.state)
 const page=view?timelineDisplayPage(view):undefined
 return <section className="context-card timeline-card"><div className="section-heading"><h3>Activity timeline</h3>{view?.status==='analysing'&&<ProgressIndicator label="Summarizing activity"/>}</div>
  {error&&<p className="muted-copy" role="status">{error}</p>}{view?.message&&<small>{view.message}</small>}{blocked&&<p className="muted-copy">Recorded task state: {view!.state.replaceAll('_',' ')}</p>}
  {plan&&<ol className="plan-timeline">{plan.milestones.map(stage=>{const inferred=summary?.stageId===stage.id,active=stage.state==='running'||inferred&&summary?.phase==='working',blockedHere=blocked&&(stage.state==='running'||inferred),state=blockedHere?(view.state==='waiting_input'?'waiting':'error'):stage.state==='completed'?'success':active?'running':'idle';return <li key={stage.id} data-active={active&&!blocked}><ProgressIndicator state={state} animate={view?.status!=='analysing'&&active&&!blocked}/><div><strong>{stage.text}</strong><small>{blockedHere?view!.state.replaceAll('_',' '):stage.state!=='pending'?stage.state:inferred?`Inferred · ${summary.phase}`:'Pending'}</small></div></li>})}</ol>}
  {summary&&<div className="timeline-summary"><strong>Activity summary <small>· inferred</small></strong><p>{summary.summary}</p><div className="timeline-evidence-links">{summary.evidence.map(seq=><button type="button" className="text-button" key={seq} onClick={()=>onEvidence(seq)}>Event {seq}</button>)}</div></div>}
  <details open={!plan&&!summary}><summary>Recorded activity</summary>{page?.rows.map(row=><button type="button" className="timeline-event" key={row.seq} onClick={()=>onEvidence(row.seq)}><span>{row.kind==='session.item'?'Conversation':row.kind.replaceAll('.',' ')}</span><small>{row.text.slice(0,180)}</small></button>)}</details>
  {page?.before&&<button type="button" className="text-button" onClick={()=>setBefore(page.before)}>Earlier activity</button>}{before&&<button type="button" className="text-button" onClick={()=>setBefore(undefined)}>Latest activity</button>}
  {!sessionId&&<p className="muted-copy">Start a conversation to see its progress.</p>}
 </section>
}
