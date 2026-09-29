import { useEffect, useRef, useState } from 'react'
import { isWarningFailure, showFailureNotice, type AppFailure, type RecoveryAction } from '../shared/failure'

const labels:Record<RecoveryAction,string>={retry:'Retry checks','docker-open':'Open Docker Desktop','docker-help':'Docker setup help','backend-rebuild':'Rebuild backend',settings:'Open settings',recovery:'Open recovery', 'cache-rebuild':'Rebuild history cache',support:'Support and recovery'}
const warningKey=(value:AppFailure)=>[value.scope,value.code,value.message,value.details||''].join('\0')
export function FailureCenter(){
  const [failure,setFailure]=useState<AppFailure>(),[pending,setPending]=useState<string>()
  const priorFocus=useRef<HTMLElement|null>(null),warnings=useRef(true),ready=useRef(false),latest=useRef<AppFailure|undefined>(undefined)
  const dismissedWarnings=useRef(new Set<string>())
  useEffect(()=>{
    let live=true,preferenceRevision=0
    const show=(value:AppFailure)=>{
      if(value.code==='CANCELLED')return
      latest.current=value
      if(!ready.current||!showFailureNotice(value,warnings.current)||isWarningFailure(value)&&dismissedWarnings.current.has(warningKey(value)))return
      priorFocus.current=document.activeElement as HTMLElement
      setFailure(current=>current&&!isWarningFailure(current)&&isWarningFailure(value)?current:current?.code===value.code&&current.scope===value.scope&&current.details===value.details&&current.message===value.message?current:value)
    }
    const preferences=(enabled:boolean)=>{
      if(enabled&&!warnings.current)dismissedWarnings.current.clear()
      const initializing=!ready.current
      warnings.current=enabled;ready.current=true
      setFailure(current=>current&&!showFailureNotice(current,enabled)?undefined:current)
      if(initializing&&latest.current)show(latest.current)
    }
    const stopSettings=window.unreal.onSettingsChanged(value=>{preferenceRevision++;preferences(value.warningNotifications!==false)})
    void window.unreal.getSettings().then(value=>{if(live&&preferenceRevision===0)preferences(value.warningNotifications!==false)}).catch(()=>{if(live&&preferenceRevision===0)preferences(true)})
    const navigate=()=>{setFailure(undefined);latest.current=undefined}
    window.addEventListener('unrealcode:navigation',navigate)
    const stop=window.unreal.onFailure(show)
    const docker=window.unreal.onDockerStatus(status=>{if(status.failure)show(status.failure);else {for(const key of dismissedWarnings.current)if(key.startsWith('docker\0'))dismissedWarnings.current.delete(key);setFailure(current=>current?.scope==='docker'?undefined:current)}})
    void window.unreal.recoveryStatus().then(status=>{if(live&&status.failure)show(status.failure)}).catch(()=>{})
    return()=>{live=false;stop();docker();stopSettings();window.removeEventListener('unrealcode:navigation',navigate)}
  },[])
  if(!failure)return null
  const busy=pending===failure.reference,warning=isWarningFailure(failure)
  const dismiss=(reference=failure.reference)=>{
    if(isWarningFailure(failure)){dismissedWarnings.current.add(warningKey(failure));if(dismissedWarnings.current.size>64)dismissedWarnings.current.delete(dismissedWarnings.current.values().next().value!)}
    setFailure(current=>current?.reference===reference?undefined:current)
    if(priorFocus.current?.isConnected)priorFocus.current.focus()
  }
  const act=async(action:RecoveryAction)=>{
    const reference=failure.reference
    if(action==='settings'||action==='support'||action==='recovery'){window.dispatchEvent(new CustomEvent('unrealcode:settings',{detail:action==='settings'?'provider':'recovery'}));dismiss(reference);return}
    setPending(reference)
    try{await window.unreal.recoveryAction(action);if(action!=='docker-help'&&action!=='docker-open')dismiss(reference)}
    catch(error){const next=(error as {failure?:AppFailure}).failure;if(next)setFailure(current=>current?.reference===reference?next:current)}finally{setPending(current=>current===reference?undefined:current)}
  }
  const mute=async()=>{const reference=failure.reference;setPending(reference);try{await window.unreal.updateSettings({warningNotifications:false});dismiss(reference)}finally{setPending(current=>current===reference?undefined:current)}}
  return <aside className="failure-notice" role={warning?'status':'alert'} aria-label={failure.title}>
    <div className="failure-heading"><strong>{failure.title}</strong><button aria-label="Dismiss issue" onClick={()=>dismiss()}>×</button></div>
    <p>{failure.message}</p><div className="failure-actions">{failure.actions.map(action=><button key={action} disabled={busy} onClick={()=>void act(action)}>{labels[action]}</button>)}{warning&&<button disabled={busy} onClick={()=>void mute().catch(()=>{})}>Silence warnings</button>}</div>
    {warning&&<small>Restore warning popups in Settings → Appearance. Errors and required input stay visible.</small>}
    <details><summary>Technical details · {failure.reference}</summary><small>{failure.code} · {failure.scope}</small><pre>{failure.details}</pre></details>
  </aside>
}
