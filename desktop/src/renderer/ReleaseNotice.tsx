import {useEffect,useRef,useState} from 'react'
import {ArrowUpRight,Download} from 'lucide-react'
import type {UpdateState} from '../shared/recovery'

export function ReleaseNotice(){
 const [status,setStatus]=useState<UpdateState>(),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const previous=useRef<HTMLElement|null>(null),version=useRef<string|undefined>(undefined)
 useEffect(()=>{let live=true,eventReceived=false;const receive=(value:UpdateState)=>{if(!live)return;if(value.version!==version.current){previous.current=document.activeElement as HTMLElement;version.current=value.version;setError('')}setStatus(value)};const off=window.unreal.onUpdateStatus(value=>{eventReceived=true;receive(value)});void window.unreal.updateStatus().then(value=>{if(!eventReceived)receive(value)}).catch(()=>{});return()=>{live=false;off()}},[])
 if(!status||status.delivery!=='manual'||status.state!=='available'||status.stale||status.dismissed||!status.version)return null
 const act=async(dismiss=false)=>{setBusy(true);setError('');try{if(dismiss){setStatus(await window.unreal.updateDismiss(status.version!));if(previous.current?.isConnected)previous.current.focus({preventScroll:true})}else await window.unreal.updateOpenRelease()}catch{setError('Could not open release details. Try again from Settings → Recovery.')}finally{setBusy(false)}}
 return <aside className="release-notice" aria-label="New UnrealCode release" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();void act(true)}}}>
  <div className="release-notice-title" role="status"><Download size={18}/><strong>UnrealCode {status.version} is available</strong></div>
  <p>Read what changed and download the installer from GitHub. Installation is manual.</p>
  <div className="button-row"><button className="primary-button" disabled={busy} onClick={()=>void act()}>View release &amp; changelog <ArrowUpRight size={15}/></button><button className="text-button" disabled={busy} onClick={()=>void act(true)}>Dismiss</button></div>
  {error&&<small role="alert">{error}</small>}
 </aside>
}
