import { useEffect, useRef, useState } from 'react'
import type { AppFailure, RecoveryAction } from '../shared/failure'

const labels:Record<RecoveryAction,string>={retry:'Retry checks','docker-open':'Open Docker Desktop','docker-help':'Docker setup help','backend-rebuild':'Rebuild backend',settings:'Open settings',recovery:'Open recovery', 'cache-rebuild':'Rebuild history cache',support:'Support and recovery'}
export function FailureCenter(){
  const [failure,setFailure]=useState<AppFailure>(),[busy,setBusy]=useState(false)
  const priorFocus=useRef<HTMLElement|null>(null)
  useEffect(()=>{
    const show=(value:AppFailure)=>{if(value.code==='CANCELLED')return;priorFocus.current=document.activeElement as HTMLElement;setFailure(value)}
    const navigate=()=>setFailure(undefined)
    window.addEventListener('unrealcode:navigation',navigate)
    const stop=window.unreal.onFailure(show)
    const docker=window.unreal.onDockerStatus(status=>{if(status.failure)show(status.failure);else setFailure(current=>current?.code.startsWith('DOCKER_')?undefined:current)})
    void window.unreal.recoveryStatus().then(status=>{if(status.failure)show(status.failure)}).catch(()=>{})
    return()=>{stop();docker();window.removeEventListener('unrealcode:navigation',navigate)}
  },[])
  if(!failure)return null
  const dismiss=()=>{setFailure(undefined);if(priorFocus.current?.isConnected)priorFocus.current.focus()}
  const act=async(action:RecoveryAction)=>{
    if(action==='settings'||action==='support'||action==='recovery'){window.dispatchEvent(new CustomEvent('unrealcode:settings',{detail:action==='support'?'recovery':action}));dismiss();return}
    setBusy(true)
    try{await window.unreal.recoveryAction(action);if(action!=='docker-help'&&action!=='docker-open')dismiss()}
    catch(error){const next=(error as {failure?:AppFailure}).failure;if(next)setFailure(next)}finally{setBusy(false)}
  }
  return <aside className="failure-notice" role="alert" aria-label={failure.title}>
    <div className="failure-heading"><strong>{failure.title}</strong><button aria-label="Dismiss issue" onClick={dismiss}>×</button></div>
    <p>{failure.message}</p><div className="failure-actions">{failure.actions.map(action=><button key={action} disabled={busy} onClick={()=>void act(action)}>{labels[action]}</button>)}</div>
    <details><summary>Technical details · {failure.reference}</summary><small>{failure.code} · {failure.scope}</small><pre>{failure.details}</pre></details>
  </aside>
}
