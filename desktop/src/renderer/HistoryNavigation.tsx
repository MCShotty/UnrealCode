import { useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '../shared/api'
import type { CacheStatus } from '../shared/history'
export function HistoryNavigation({sessionId,firstSeq,older,onPage,hasNewHistory}:{hasNewHistory:boolean;sessionId:string;firstSeq?:number;older:boolean;onPage(events:AgentEvent[],older:boolean):void}){
  const generation=useRef(0)
  useEffect(()=>{generation.current++;return()=>{generation.current++}},[sessionId])
  const [status,setStatus]=useState<CacheStatus>(),[busy,setBusy]=useState(false),[hasOlder,setHasOlder]=useState(false)
  useEffect(()=>{let live=true;setStatus(undefined);const refresh=()=>void window.unreal.historyPage(sessionId,{limit:1}).then(page=>{if(live){setStatus(page.cache);setHasOlder(!!firstSeq&&firstSeq>1)}}).catch(()=>{});refresh();const timer=setInterval(refresh,5000);return()=>{live=false;clearInterval(timer)}},[sessionId,firstSeq])
  const load=async(past:boolean)=>{const current=generation.current;setBusy(true);try{const page=await window.unreal.historyPage(sessionId,{before:past?firstSeq:undefined,limit:1000});if(current!==generation.current)return;onPage(page.events,past);setStatus(page.cache);setHasOlder(page.hasOlder)}catch{/* Structured failures are shown by FailureCenter. */}finally{if(current===generation.current)setBusy(false)}}
  useEffect(()=>{const requested=(event:Event)=>{if((event as CustomEvent<string>).detail===sessionId&&hasOlder&&!busy)void load(true)};window.addEventListener('unreal:load-work-history',requested);return()=>window.removeEventListener('unreal:load-work-history',requested)},[sessionId,firstSeq,hasOlder,busy])
  const rebuild=async()=>{const current=generation.current;setBusy(true);try{await window.unreal.rebuildHistoryCache();const page=await window.unreal.historyPage(sessionId,{limit:1});if(current===generation.current){setStatus(page.cache);setHasOlder(!!firstSeq&&firstSeq>1)}}catch{/* Structured failures are shown by FailureCenter. */}finally{if(current===generation.current)setBusy(false)}}
  return <div className="history-navigation" aria-label="History cache">
    <span>{older?'Viewing older events':status?.state==='offline'?(!status.lastSyncedAt||status.cursor<status.latest?'Offline · cached history is incomplete':'Offline · cached history'):status?.state==='partial'?'History is still syncing':status?.state==='unavailable'?'History cache unavailable':'Local history'}{status?.lastSyncedAt&&<small> · Synced {new Date(status.lastSyncedAt).toLocaleString()}</small>}</span>
    {status?.failure&&<button disabled={busy} onClick={()=>void rebuild()}>{busy?'Rebuilding…':'Rebuild cache'}</button>}{hasOlder&&<button disabled={busy} onClick={()=>void load(true)}>Load older</button>}{(older||hasNewHistory)&&<button disabled={busy} onClick={()=>void load(false)}>Jump to latest</button>}
  </div>
}
