import {useState} from 'react'
import {providerIssue} from '../shared/provider-issue'
export function ProviderRecovery({sessionId,failure,online,busy,onRetry}:{sessionId:string;failure:unknown;online:boolean;busy:boolean;onRetry():void}){
 const issue=providerIssue(failure),[notice,setNotice]=useState(''),[refreshing,setRefreshing]=useState(false)
 const navigate=(view:string)=>window.dispatchEvent(new CustomEvent('unrealcode:navigate-view',{detail:view}))
 const refresh=async()=>{setRefreshing(true);try{const config=await window.unreal.sessionConfig(sessionId),catalog=await window.unreal.modelCatalog(config.provider,config.baseUrl,true);setNotice(catalog.message)}catch{setNotice('Model refresh failed. Review the provider settings.')}finally{setRefreshing(false)}}
 const settings=()=>window.dispatchEvent(new CustomEvent('unrealcode:settings',{detail:'provider'}))
 return <div className="response-recovery"><p>{issue.category==='refusal'?'The provider declined this request. Review its answer and revise your request if appropriate.':'The response could not finish. Accepted answers and completed tool results remain saved.'}</p>
  {issue.category==='authentication'&&<button className="secondary-button" onClick={settings}>Reconnect account</button>}
  {issue.category==='access'&&<><button className="secondary-button" disabled={!online||refreshing} onClick={()=>void refresh()}>{refreshing?'Refreshing…':'Refresh models'}</button><button className="secondary-button" onClick={()=>navigate('workflow')}>Review model handoff</button></>}
  {['rate_limit','subscription','quota'].includes(issue.category)&&<button className="secondary-button" onClick={()=>navigate('usage')}>View usage and limits</button>}
  {issue.category==='context'&&<button className="secondary-button" onClick={()=>navigate('context')}>Review context</button>}
  {issue.category==='options'&&<button className="secondary-button" onClick={()=>navigate('control')}>Review model controls</button>}
  {issue.category==='refusal'?<button className="secondary-button" onClick={()=>document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()}>Edit request</button>:<button className="secondary-button" disabled={!online||busy} onClick={onRetry}>{busy?'Retrying…':'Retry response'}</button>}
  {issue.retryAfter&&<small>Provider retry hint: {issue.retryAfter}</small>}{issue.requestId&&<small>Provider request: {issue.requestId}</small>}{notice&&<p role="status">{notice}</p>}
 </div>
}
