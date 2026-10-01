import {useEffect,useRef,useState} from 'react'
import {motion} from 'motion/react'
import {ProgressIndicator} from './ProgressIndicator'
import {useReducedMotion} from './useReducedMotion'
import {effects,instant,spatial} from './motion'
import type {TimelineView} from '../shared/timeline'
import {timelineDisplayPage,timelineStages} from '../shared/timeline'
function duration(ms:number|undefined){if(ms===undefined)return 'Timing unknown';if(ms<1000)return Math.round(ms)+' ms';const seconds=Math.floor(ms/1000);return seconds<60?seconds+'s':Math.floor(seconds/60)+'m '+seconds%60+'s'}
export function ActivityTimeline({sessionId,project,sequence,onEvidence}:{sessionId?:string;project?:string;sequence:number;onEvidence(seq:number):void}){
 const [view,setView]=useState<TimelineView>(),[error,setError]=useState(''),[before,setBefore]=useState<number>(),generation=useRef(0),root=useRef<HTMLElement>(null),seen=useRef<Set<string>|undefined>(undefined),reduced=useReducedMotion()
 const sequenceRef=useRef(sequence);sequenceRef.current=sequence
 useEffect(()=>{setBefore(undefined)},[sessionId,project])
 useEffect(()=>{
  const owner=++generation.current;let live=true,pending=false,inView=true,lastSequence=-1
  setView(undefined);setError('');seen.current=undefined;if(!sessionId)return
  const load=()=>{if(pending||!inView||document.visibilityState!=='visible')return;pending=true;void window.unreal.timeline(sessionId,before).then(value=>{if(live&&owner===generation.current){setView(value);setError('');lastSequence=sequenceRef.current}}).catch(()=>{if(live&&owner===generation.current)setError('Timeline unavailable. Conversation history is preserved.')}).finally(()=>{pending=false})}
  const tick=()=>{if(lastSequence!==sequenceRef.current||!before)load()}
  const timer=setInterval(tick,3000),observer=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;if(inView)load()})
  if(root.current)observer.observe(root.current)
  const dispose=window.unreal.onTimelineChanged(change=>{if(change.sessionId===sessionId&&(!project||change.project===project))load()})
  document.addEventListener('visibilitychange',load);load()
  return()=>{live=false;generation.current++;clearInterval(timer);observer.disconnect();dispose();document.removeEventListener('visibilitychange',load)}
 },[sessionId,project,before])
 const stages=view?.stages|| (view?timelineStages(view):[]),page=view?timelineDisplayPage(view):undefined,active=stages.findIndex(row=>row.phase==='working'),legacy=view?.summaries.filter(row=>row.workId===view.workId&&!row.stages).at(-1)
 useEffect(()=>{if(view)seen.current=new Set(stages.map(row=>row.id))},[view])
 const announcement=stages.find(row=>['working','waiting','blocked'].includes(row.phase))?.title|| (view?.state==='completed'?'Work completed':'')
 return <section ref={root} className="context-card timeline-card"><div className="section-heading"><h3>Activity timeline</h3>{view?.status==='analysing'&&<small className="timeline-updating">Updating stages…</small>}</div>
  <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
  {error&&<p className="muted-copy" role="status">{error}</p>}{view?.message&&<p className="timeline-status-note">{view.message}</p>}
  {view?.status==='disabled'&&<p className="timeline-status-note">Local activity. Enable a verified memory model for interpreted stages.</p>}
  {view?.plan&&<small className="timeline-freshness">Executing plan · revision {view.plan.revision}</small>}{view?.catchingUp&&<small className="timeline-freshness">Catching up · analysed through event {view.analysedThroughSeq}</small>}
  {view?.updatedAt&&<small className="timeline-freshness">Updated {new Date(view.updatedAt).toLocaleTimeString()}</small>}
  <ol className="live-stage-timeline">{stages.map((row,index)=>{
   const status=row.phase==='working'?'running':row.phase==='waiting'?'waiting':row.phase==='blocked'?'error':row.phase==='stopped'?'stopped':row.phase==='completed'?'success':'idle'
   const inferred=row.source==='inferred'||row.source==='plan'&&!row.verified&&row.phase!=='pending'&&view?.plan?.milestones.find(stage=>stage.id===row.id)?.state==='pending'
   return <motion.li key={row.id} data-phase={row.phase} initial={false} animate={{opacity:1}} transition={reduced?instant:effects.fast}><div className="stage-rail-marker"><motion.span initial={!reduced&&seen.current&&!seen.current.has(row.id)?{scale:.8}:false} animate={{scale:1}} transition={reduced?instant:spatial.fast}><ProgressIndicator state={status} animate={index===active||row.verified===true&&index===stages.length-1}/></motion.span></div><div className="stage-content"><strong>{row.title}</strong>{row.detail&&<p>{row.detail}</p>}<div className="stage-meta"><span>{inferred?'Inferred · ':''}{row.phase}</span><span>{duration(row.durationMs)}</span></div>{row.startedAt&&<time dateTime={row.startedAt}>{new Date(row.startedAt).toLocaleTimeString()}</time>}<div className="stage-evidence">{row.evidence.slice(0,4).map(seq=><button type="button" key={seq} onClick={()=>onEvidence(seq)} aria-label={`Open evidence event ${seq} for ${row.title}`}>Event {seq}</button>)}{row.evidence.length>4&&<button type="button" onClick={()=>onEvidence(row.evidence[4])}>+{row.evidence.length-4} more</button>}</div></div><motion.span aria-hidden="true" className="stage-connector" initial={false} animate={{opacity:row.phase==='pending'?.4:1,scaleY:reduced?1:row.phase==='pending'?.6:1}} transition={reduced?instant:spatial.fast}/></motion.li>
  })}</ol>
  {!stages.length&&<p className="muted-copy">{sessionId?'No stages recorded yet.':'Start a conversation to see its progress.'}</p>}
  {legacy&&<details className="legacy-timeline-interpretation"><summary>Earlier interpretation</summary><p>{legacy.summary}</p><div className="stage-evidence">{legacy.evidence.map(seq=><button type="button" key={seq} onClick={()=>onEvidence(seq)}>Event {seq}</button>)}</div></details>}
  <details className="timeline-evidence-trail"><summary>Recorded activity</summary>{page?.rows.map(row=><button type="button" className="timeline-event" key={row.seq} onClick={()=>onEvidence(row.seq)}><strong>{row.text}</strong><small>{row.at?new Date(row.at).toLocaleTimeString():'Time unknown'} · Event {row.seq}</small></button>)}</details>
  {page?.before&&<button type="button" className="text-button" onClick={()=>setBefore(page.before)}>Earlier activity</button>}{before&&<button type="button" className="text-button" onClick={()=>setBefore(undefined)}>Latest activity</button>}
 </section>
}
