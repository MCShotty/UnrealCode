import {ChevronDown} from 'lucide-react'
import type {DockerStatus} from '../shared/api'
import {useEffect,useRef,useState} from 'react'

export function ContainerStatus({status,onRecovery}:{status:DockerStatus;onRecovery():void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const root=useRef<HTMLDetailsElement>(null)
 useEffect(()=>{const close=(event:Event)=>{const node=root.current;if(!node?.open)return;if(event instanceof KeyboardEvent&&event.key==='Escape'){node.open=false;node.querySelector('summary')?.focus();event.stopPropagation()}else if(event.type==='pointerdown'&&!node.contains(event.target as Node))node.open=false};document.addEventListener('keydown',close);document.addEventListener('pointerdown',close);return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',close)}},[])
 const retry=async()=>{if(busy)return;setBusy(true);try{setMessage((await window.unreal.dockerStatus()).message)}catch{setMessage('Checks unavailable. Open Support and recovery for details.')}finally{setBusy(false)}}
 const preparing=status.phase==='checking'||status.phase==='building',label=status.ready?'Container running':preparing?'Preparing backend':'Container offline'
 return <details ref={root} className="container-status-control"><summary aria-label={`Container status: ${label}`}><span className={`status-dot ${status.ready?'on':''}`}/><span>{label}</span><ChevronDown size={14}/></summary><div className="container-status-details"><strong>{label}</strong><p>{status.message}</p>{message&&<p role="status">{message}</p>}{status.container&&<code>{status.container}</code>}<button type="button" className="secondary-button" onClick={onRecovery}>Support and recovery</button><button type="button" disabled={busy} className="text-button" onClick={()=>void retry()}>{busy?'Checking…':'Retry checks'}</button></div></details>
}
