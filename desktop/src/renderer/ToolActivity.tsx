import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Search, Square, X } from 'lucide-react'
import type { ActivityDetail, ActivityPage, ActivityQuery, ActivityRow } from '../shared/activity'
import { duration } from '../shared/duration'
import { motion } from 'motion/react'
import { ProgressIndicator } from './ProgressIndicator'
import { useReducedMotion } from './useReducedMotion'
import { expressive, instant } from './motion'
import { TaskTeamRail } from './TaskTeams'

const api=window.unreal
export function openToolActivity(id?:string){window.dispatchEvent(new CustomEvent('unreal:tool-activity',{detail:id}))}
function useActivity(sessionId:string|undefined,query:ActivityQuery,eventSequence:number){
 const [page,setPage]=useState<ActivityPage>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),generation=useRef(0),sequence=useRef(0)
 const key=JSON.stringify(query),selected=useRef(sessionId);if(selected.current!==sessionId){selected.current=sessionId;generation.current++}
 const refresh=useCallback(()=>{if(!sessionId){setLoading(false);return}const gen=generation.current,request=++sequence.current;void api.activityPage(sessionId,JSON.parse(key)).then(p=>{if(generation.current===gen&&sequence.current===request){setPage(p);setError('');setLoading(false)}}).catch(e=>{if(generation.current===gen&&sequence.current===request&&!String(e).includes('cancelled')){setError(String(e));setLoading(false)}})},[sessionId,key])
 useEffect(()=>{generation.current++;setPage(undefined);setLoading(true);setError('');refresh();const interval=setInterval(refresh,1500);return()=>{generation.current++;clearInterval(interval)}},[refresh])
 useEffect(()=>{const timer=setTimeout(refresh,150);return()=>clearTimeout(timer)},[eventSequence,refresh])
 return {page,error,loading}
}
function Metrics({page}:{page:ActivityPage}){return <><small className="activity-scope">{page.work?'Current work':'Conversation history'} · measured time</small><div className="execution-metrics"><span><strong>{duration(page.totals.modelMs)}</strong><small>Model</small></span><span><strong>{duration(page.totals.toolMs)}</strong><small>Tool wall time</small></span><span><strong>{duration(page.totals.overlapMs)}</strong><small>Tool overlap</small></span></div></>}
function Badge({page,loading}:{page?:ActivityPage;loading:boolean}){return <span className="activity-badge" aria-live="polite">{page?.connected && !!page.executing && <ProgressIndicator label="Tools running"/>}{loading?'Loading…':!page?'Unavailable':!page.connected?'Offline':page.cache.state!=='ready'?'Syncing…':`${page.executing} active`}</span>}
function Row({row,onClick}:{row:ActivityRow;onClick():void}){return <button className="activity-row" onClick={onClick}><span><strong>{row.name}</strong><small className="activity-row-status">{row.status==='executing'&&<ProgressIndicator animate={false}/>} {row.status.replaceAll('_',' ')}</small></span><span className="activity-row-time">{row.durationMs===undefined?row.endedAt?'Unknown':row.startedAt&&row.status==='executing'?duration(Math.max(0,Date.now()-Date.parse(row.startedAt))):'—':duration(row.durationMs)}<ChevronRight size={14}/></span></button>}
export function ExecutionInspector({sessionId,eventSequence}:{sessionId?:string;eventSequence:number}):ReactNode{
 const {page,error,loading}=useActivity(sessionId,{limit:5},eventSequence)
 return <section className="context-card execution-inspector"><div className="section-heading"><button className="activity-heading" onClick={()=>openToolActivity()} disabled={!sessionId}><h3>Tool Activity</h3><ChevronRight size={16}/></button><Badge page={page} loading={loading}/></div>{page&&<Metrics page={page}/>} {!!page?.waitingApproval&&<small>{page.waitingApproval} waiting for approval</small>}{!!page?.waitingInput&&<small>{page.waitingInput} waiting for answers</small>}{page?.rows.map(row=><Row key={row.id} row={row} onClick={()=>openToolActivity(row.id)}/>)}{page&&!page.rows.length&&<p className="muted-copy">No tool calls in this conversation.</p>}{page&&page.total>5&&<button className="text-button" onClick={()=>openToolActivity()}>View all {page.total} calls</button>}{error&&<p className="error-inline">{error}</p>}</section>
}
function Details({sessionId,id,refreshKey,connected,onBack}:{sessionId:string;id:string;refreshKey:number;connected:boolean;onBack():void}){
 const [detail,setDetail]=useState<ActivityDetail>(),[offset,setOffset]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),generation=useRef(0)
 useEffect(()=>{setOffset(0);setDetail(undefined)},[sessionId,id])
 useEffect(()=>{const gen=++generation.current;void api.activityDetail(sessionId,id,offset).then(value=>{if(generation.current===gen){setDetail(value);setError('')}}).catch(e=>{if(generation.current===gen)setError(String(e))});return()=>{generation.current++}},[sessionId,id,offset,refreshKey])
 const row=detail?.row
 const cancel=async()=>{if(!row)return;setBusy(true);try{await Promise.all(row.operationIds.map(op=>api.cancelOperation(sessionId,op)))}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section className="activity-detail"><button className="text-button" onClick={onBack}>← All tool calls</button>{row?<><h3>{row.name}</h3><dl><dt>Status</dt><dd>{row.status.replaceAll('_',' ')}</dd><dt>Started</dt><dd>{row.startedAt?new Date(row.startedAt).toLocaleString():'Unknown'}</dd><dt>Finished</dt><dd>{row.endedAt?new Date(row.endedAt).toLocaleString():'Not recorded'}</dd><dt>Duration</dt><dd>{duration(row.durationMs)}</dd><dt>Workspace</dt><dd>{row.workspace||'Recorded workspace unavailable'}</dd><dt>Conversation</dt><dd>{row.sessionId}</dd><dt>Work section</dt><dd><button className="text-button" onClick={()=>document.querySelector(`[data-work-id="${CSS.escape(row.workId)}"]`)?.scrollIntoView({block:'center'})}>Locate work in chat</button></dd>{row.exitCode!==undefined&&<><dt>Exit status</dt><dd>{row.exitCode}</dd></>}</dl>{connected&&['executing','waiting_approval','waiting_input','waiting_service'].includes(row.status)&&<button className="secondary-button" disabled={busy} onClick={()=>void cancel()}><Square size={14}/>Cancel this tool</button>}<h4>Arguments</h4><pre tabIndex={0}>{row.arguments||'No arguments recorded'}</pre>{row.error&&<p className="error-inline">{row.error}</p>}<h4>Output</h4><pre tabIndex={0}>{detail?.output||'No output recorded yet.'}</pre><div className="activity-pagination"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-16384))}>Previous output</button><small>{offset.toLocaleString()} / {detail?.total.toLocaleString()} characters</small><button disabled={!detail?.hasMore} onClick={()=>setOffset(offset+Array.from(detail?.output||'').length)}>Next output</button></div></>:<p>Loading tool details…</p>}{error&&<p className="error-inline" role="alert">{error}</p>}</section>
}
function ActivityPanel({sessionId,initialId,eventSequence,onOpenSession}:{sessionId?:string;initialId?:string;eventSequence:number;onOpenSession(id:string):void}){
 const [search,setSearch]=useState(''),[status,setStatus]=useState<ActivityQuery['status']>('all'),[scope,setScope]=useState<'all'|'current'>('all'),[offset,setOffset]=useState(0),[workId,setWorkId]=useState<string>(),[selected,setSelected]=useState(initialId)
 useEffect(()=>{setSelected(initialId);setOffset(0)},[initialId,sessionId])
 useEffect(()=>{let live=true;if(sessionId)void api.workView(sessionId).then(view=>{if(live)setWorkId(view.works.at(-1)?.id)}).catch(()=>{});return()=>{live=false}},[sessionId,eventSequence])
 const {page,error,loading}=useActivity(sessionId,{search,status,offset,limit:30,workId:scope==='current'?workId:undefined},eventSequence)
 return <>{!sessionId?<p>Select a conversation to inspect its tool activity.</p>:<><div className="activity-panel-heading"><Badge page={page} loading={loading}/><span>{page?.waitingApproval||0} approval · {page?.waitingInput||0} answer waits</span></div>{page&&<Metrics page={page}/>}<div className="activity-filters"><label><Search size={16}/><input aria-label="Search tool activity" placeholder="Search names or arguments…" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}/></label><div><select aria-label="Activity status" value={status} onChange={e=>{setStatus(e.target.value as ActivityQuery['status']);setOffset(0)}}>{['all','executing','waiting_approval','waiting_input','waiting_service','completed','failed','cancelled','interrupted'].map(v=><option key={v} value={v}>{v === 'all' ? 'All statuses' : v.replaceAll('_',' ').replace(/^./, letter => letter.toUpperCase())}</option>)}</select><select aria-label="Activity scope" value={scope} onChange={e=>{setScope(e.target.value as typeof scope);setOffset(0)}}><option value="all">All history</option><option value="current">Current work</option></select></div></div>{error&&<p className="error-inline">{error}</p>}{selected?<Details sessionId={sessionId} id={selected} refreshKey={eventSequence} connected={!!page?.connected} onBack={()=>setSelected(undefined)}/>:<><div className="activity-list">{page?.rows.map(row=><Row key={row.id} row={row} onClick={()=>setSelected(row.id)}/>)}{page&&!page.rows.length&&<p className="muted-copy">No matching tool calls.</p>}</div><div className="activity-pagination"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-30))}>Previous</button><span>{page?.total||0} calls</span><button disabled={!page?.hasMore} onClick={()=>setOffset(offset+30)}>Next</button></div><TaskTeamRail sessionId={sessionId} onOpen={onOpenSession}/></>}</>}</>
}
export function ToolActivityHost({sessionId,eventSequence,onOpenSession}:{sessionId?:string;eventSequence:number;onOpenSession(id:string):void}){
 const [open,setOpen]=useState(false),[id,setId]=useState<string>(),[narrow,setNarrow]=useState(true)
 useEffect(()=>{const close=()=>setOpen(false);window.addEventListener('unrealcode:computer-companion',close);return()=>window.removeEventListener('unrealcode:computer-companion',close)},[])
 const focus=useRef<HTMLElement|null>(null),dialog=useRef<HTMLDialogElement>(null),modeSnapshot=useRef<{scroll:number;focus:HTMLElement|null}|undefined>(undefined),reduced=useReducedMotion()
 useLayoutEffect(()=>{
  const container=document.querySelector('.workspace-body')
  if(!container)return
  const update=()=>setNarrow(container.clientWidth<900)
  update();const observer=new ResizeObserver(update);observer.observe(container)
  return()=>observer.disconnect()
 },[])
 useEffect(()=>{const show=(event:Event)=>{if(!open){focus.current=document.activeElement as HTMLElement;modeSnapshot.current=undefined}setId((event as CustomEvent).detail);setOpen(true)};window.addEventListener('unreal:tool-activity',show);return()=>window.removeEventListener('unreal:tool-activity',show)},[open])
 useLayoutEffect(()=>{
  const element=dialog.current;if(!open||!element)return
  const body=element.querySelector<HTMLElement>('.tool-activity-body'),position=modeSnapshot.current?.scroll??body?.scrollTop??0,previous=modeSnapshot.current?.focus||document.activeElement as HTMLElement|null
  const retainFocus=!!previous&&element.contains(previous)
  element.close();if(narrow)element.showModal();else element.show()
  if(retainFocus)previous?.focus({preventScroll:true});else element.querySelector<HTMLButtonElement>('.icon-button')?.focus({preventScroll:true})
  if(body)body.scrollTop=position
  return()=>{modeSnapshot.current={scroll:body?.scrollTop||0,focus:element.contains(document.activeElement)?document.activeElement as HTMLElement:null};element.close()}
 },[open,narrow])
 const close=()=>{setOpen(false);requestAnimationFrame(()=>{const previous=focus.current;let restored=false;if(previous?.isConnected&&previous.getClientRects().length&&previous.matches('button,input,textarea,select,a[href],[tabindex]')){previous.focus({preventScroll:true});restored=document.activeElement===previous}if(!restored){const disclosure=previous?.closest('[data-work-id]')?.querySelector<HTMLButtonElement>('.work-disclosure');(disclosure||document.querySelector<HTMLTextAreaElement>('.composer textarea'))?.focus({preventScroll:true})}})}
 if(!open)return null
 return <dialog ref={dialog} className={`tool-activity-panel ${narrow?'compact':''}`} aria-label="Tool Activity" onCancel={event=>{event.preventDefault();close()}} onKeyDown={event=>{if(!narrow&&event.key==='Escape'){event.preventDefault();close()}}}>
  <motion.div className="tool-activity-surface" initial={reduced?false:{opacity:0,x:12}} animate={{opacity:1,x:0}} transition={reduced?instant:expressive.panel}>
   <header><h2>Tool Activity</h2><button className="icon-button" aria-label="Close tool activity" onClick={close}><X size={19}/></button></header>
   <div className="tool-activity-body"><ActivityPanel key={sessionId} sessionId={sessionId} initialId={id} eventSequence={eventSequence} onOpenSession={onOpenSession}/></div>
  </motion.div>
 </dialog>
}
