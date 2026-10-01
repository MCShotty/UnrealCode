import {memo,useState} from 'react'
import {Check,ChevronRight,CircleAlert,Code2,Pause,Square} from 'lucide-react'
import {openToolActivity} from './ToolActivity'
import {ProgressIndicator} from './ProgressIndicator'
import {groupWorkFeed,type FeedRow} from './work-feed'
import type {ParsedEntry} from './chat-events'

const FeedEvent=memo(function FeedEvent({row,onReveal}:{row:FeedRow;onReveal():void}){
 const entry=row.entries[0],status=entry.status||'',running=['started','running','executing'].includes(status)
 const open=()=>entry.kind==='tool'?openToolActivity(entry.activityId||entry.id.replace(/^call:/,'')):onReveal()
 return <button type="button" className="compact-work-event" onClick={open} data-event-seq={entry.seq} title={row.entries.length>1?'Inspect grouped calls in Tool Activity':entry.title}>
  <span className="compact-event-icon" aria-hidden="true">{running?<ProgressIndicator animate={false}/>:status==='failed'?<CircleAlert size={15}/>:status.includes('waiting')?<Pause size={15}/>:['interrupted','cancelled','canceled','not carried into fork'].includes(status)?<Square size={13}/>:status==='completed'?<Check size={15}/>:<Code2 size={15}/>}</span>
  <span className="compact-event-text">{row.label}{entry.kind!=='tool'&&entry.text&&<small>{entry.text.slice(0,180)}</small>}</span>{status&&status!=='completed'&&<small className="compact-event-status">{status}</small>}<ChevronRight size={13}/>
 </button>
})
export function CompactWorkFeed({entries,selection,segment,expanded,onExpand,renderEntry,revealSequence,onPage,onOlder}:{entries:ParsedEntry[];selection:{visible:Set<string>;peek?:string;total?:number;lastSegment?:string;page?:Set<string>;hasEarlier?:boolean;older?:boolean};segment:string;expanded:boolean;onExpand(value:boolean):void;renderEntry(entry:ParsedEntry):React.ReactNode;revealSequence?:number;onPage():void;onOlder():void}){
 const {visible,peek}=selection
 const rows=groupWorkFeed(entries),[detail,setDetail]=useState<string>()
 const focused=document.activeElement?.closest<HTMLElement>('.compact-work-event')?.dataset.eventSeq
 for(const row of rows)if(row.id===detail||row.entries.some(entry=>String(entry.seq)===focused))visible.add(row.id)
 const paged=selection.page||new Set(rows.map(row=>row.id))
 const hidden=rows.filter(row=>expanded?!paged.has(row.id):!visible.has(row.id))
 return <div className="compact-work-feed">
  {hidden.flatMap(row=>row.entries.flatMap(entry=>[entry.seq,...entry.eventSequences||[]].filter(Boolean).map(seq=><span hidden key={`${entry.id}:${seq}`} data-event-seq={seq}/>)))}
  {rows.map(row=>expanded?!paged.has(row.id)?null:<div key={row.id}><FeedEvent row={row} onReveal={()=>setDetail(detail===row.id?undefined:row.id)}/>{row.entries.flatMap(entry=>(entry.eventSequences||[]).map(seq=><span key={`${entry.id}:${seq}`} data-event-seq={seq} aria-hidden="true"/>))}{detail===row.id&&row.entries.map(entry=><div className="compact-event-detail" key={entry.id}>{renderEntry(entry)}</div>)}</div>:visible.has(row.id)?<FeedEvent key={row.id} row={row} onReveal={()=>setDetail(detail===row.id?undefined:row.id)}/>:row.id===peek?<div className="work-faded-peek" key={row.id} aria-hidden="true"><span>{row.label}</span></div>:null)}
  {!expanded&&detail&&rows.find(row=>row.id===detail)?.entries.map(entry=><div key={entry.id} className="compact-event-detail">{renderEntry(entry)}</div>)}
  {expanded&&selection.lastSegment===segment&&selection.hasEarlier&&<button type="button" className="text-button" onClick={onPage}>Show 20 earlier entries</button>}{expanded&&selection.lastSegment===segment&&!selection.hasEarlier&&selection.older&&<button type="button" className="text-button" onClick={onOlder}>Load earlier history</button>}
  {(selection.total||rows.length)>4&&selection.lastSegment===segment&&<button type="button" className="work-feed-toggle text-button" onClick={()=>onExpand(!expanded)}>{expanded?'Show recent activity':'Show all'}</button>}
 </div>
}
