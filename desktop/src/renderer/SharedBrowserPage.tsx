import {useEffect,useRef,useState} from 'react'
import {ArrowLeft,ArrowRight,Globe2,Hand,Plus,RotateCw,Search,ShieldCheck,Square,X} from 'lucide-react'
import type {BrowserGrant,SharedBrowserCommand,SharedBrowserState} from '../shared/browser'
import {BrowserPage as LegacyBrowserPage} from './BrowserPage'
import {ProgressIndicator} from './ProgressIndicator'

const emptyGrant:BrowserGrant={enabled:false,origins:[],interactOrigins:[],ports:[]}
const pageUrl=(value:SharedBrowserState)=>value.tabs.find(tab=>tab.id===value.activeId)?.url||''
function address(value:string):string{
 const text=value.trim()
 if(/^https?:\/\//i.test(text))return text
 return /^(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(text)?`http://${text}`:`https://${text}`
}

export function SharedBrowserPage({project,sessionId}:{project:string;sessionId:string|null}){
 const [state,setState]=useState<SharedBrowserState>()
 const [grant,setGrant]=useState<BrowserGrant>(emptyGrant)
 const [url,setUrl]=useState(''),[find,setFind]=useState('')
 const [findOpen,setFindOpen]=useState(false),[newTabPending,setNewTabPending]=useState(false)
 const [accessOpen,setAccessOpen]=useState(false),[legacy,setLegacy]=useState(false)
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const viewport=useRef<HTMLDivElement>(null),addressInput=useRef<HTMLInputElement>(null)
 const findInput=useRef<HTMLInputElement>(null),accessDialog=useRef<HTMLDialogElement>(null),accessButton=useRef<HTMLButtonElement>(null)
 const generation=useRef(0),addressFocused=useRef(false),pendingNew=useRef(false),accessVisible=useRef(false),busyRef=useRef(false),findTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
 const active=state?.tabs.find(tab=>tab.id===state.activeId)

 useEffect(()=>{
  const version=++generation.current
  setState(undefined);setGrant(emptyGrant);setUrl('');setError('')
  accessVisible.current=false;setAccessOpen(false);accessDialog.current?.close()
  pendingNew.current=false;setNewTabPending(false)
  void window.unreal.sharedBrowserState().then(value=>{
   if(version!==generation.current)return
   setState(value);setGrant(value.grant);setUrl(pageUrl(value))
  }).catch(reason=>{if(version===generation.current)setError(String(reason))})
  const dispose=window.unreal.onSharedBrowserChanged(changed=>{
   if(changed!==project)return
   void window.unreal.sharedBrowserState().then(value=>{
    if(version!==generation.current)return
    setState(value)
    if(!addressFocused.current&&!pendingNew.current)setUrl(pageUrl(value))
    if(!accessVisible.current)setGrant(value.grant)
   }).catch(()=>{})
  })
  return()=>{generation.current++;dispose();void window.unreal.sharedBrowserHide()}
 },[project])
 useEffect(()=>()=>{if(findTimer.current)clearTimeout(findTimer.current)},[])
 useEffect(()=>{
  if(findTimer.current)clearTimeout(findTimer.current)
  setFind('');setFindOpen(false)
 },[active?.id])

 useEffect(()=>{
  const element=viewport.current
  if(!element||!active||newTabPending||accessOpen){void window.unreal.sharedBrowserHide();return}
  const update=()=>{
   const box=element.getBoundingClientRect()
   if(box.width>100&&box.height>80)void window.unreal.sharedBrowserShow(active.id,{x:box.x,y:box.y,width:box.width,height:box.height}).catch(reason=>setError(String(reason)))
  }
  const observer=new ResizeObserver(update)
  observer.observe(element);window.addEventListener('resize',update);update()
  return()=>{observer.disconnect();window.removeEventListener('resize',update)}
 },[active?.id,newTabPending,accessOpen])

 const command=async(value:SharedBrowserCommand)=>{
  if(busyRef.current)return
  busyRef.current=true;setBusy(true);setError('')
  try{
   const next=await window.unreal.sharedBrowserCommand(value)
   setState(next)
   if(['new','navigate','select','close','back','forward'].includes(value.type)){
    pendingNew.current=false;setNewTabPending(false);setUrl(pageUrl(next))
   }
  }catch(reason){setError(reason instanceof Error?reason.message:String(reason))}
  finally{busyRef.current=false;setBusy(false)}
 }
 const startTab=()=>{
  pendingNew.current=true;setNewTabPending(true);setUrl('');setFindOpen(false)
  addressInput.current?.focus()
 }
 const navigate=()=>{
  if(!url.trim())return
  void command({type:newTabPending||!active?'new':'navigate',tabId:active?.id,url:address(url)})
 }
 const queueFind=(value:string)=>{
  setFind(value)
  if(findTimer.current)clearTimeout(findTimer.current)
  if(active)findTimer.current=setTimeout(()=>{void window.unreal.sharedBrowserCommand({type:'find',tabId:active.id,query:value}).catch(reason=>setError(String(reason)))},140)
 }
 const closeFind=()=>{
  if(findTimer.current)clearTimeout(findTimer.current)
  setFind('');setFindOpen(false)
  if(active)void window.unreal.sharedBrowserCommand({type:'find',tabId:active.id,query:''}).catch(reason=>setError(String(reason)))
 }
 const openAccess=()=>{
  setGrant(state?.grant||emptyGrant)
  accessVisible.current=true;setAccessOpen(true)
  accessDialog.current?.showModal()
 }
 const closeAccess=(discard:boolean,force=false)=>{
  if(busyRef.current&&!force)return
  if(discard)setGrant(state?.grant||emptyGrant)
  accessVisible.current=false;setAccessOpen(false)
  accessDialog.current?.close()
  requestAnimationFrame(()=>accessButton.current?.focus())
 }
 const saveAccess=async()=>{
  if(busyRef.current)return
  busyRef.current=true;setBusy(true);setError('')
  try{
   await window.unreal.sharedBrowserConfigure(grant)
   const next=await window.unreal.sharedBrowserState()
   setState(next);setGrant(next.grant);closeAccess(false,true)
  }catch(reason){setError(reason instanceof Error?reason.message:String(reason))}
  finally{busyRef.current=false;setBusy(false)}
 }
 const setOrigins=(key:'origins'|'interactOrigins'|'cloudOrigins',value:string)=>setGrant(current=>({...current,[key]:value.split('\n').map(origin=>origin.trim()).filter(Boolean)}))

 return <div className="page-content shared-browser-page">
  <div className="page-heading"><div><h1>Browser</h1><p>Pages and sign-ins stay in this project's browser profile.</p></div></div>
  <div className="browser-shell">
   <div className="browser-tab-bar">
    <div className="shared-browser-tabs" role="tablist" aria-label="Project browser tabs">
     {state?.tabs.map(tab=><div className="shared-browser-tab" key={tab.id}>
      <button role="tab" type="button" aria-controls="shared-browser-content" aria-selected={tab.id===state.activeId&&!newTabPending} className={tab.id===state.activeId&&!newTabPending?'selected':''} onClick={()=>void command({type:'select',tabId:tab.id})} title={tab.url||tab.title}>
       <Globe2 size={15}/><span>{tab.title||tab.url||'New tab'}</span>{tab.control==='agent'&&<ShieldCheck size={14} aria-label="Agent access"/>}
      </button>
      <button type="button" className="browser-tab-close" aria-label={`Close ${tab.title||'browser tab'}`} onClick={()=>void command({type:'close',tabId:tab.id})}><X size={14}/></button>
     </div>)}
     {(!active||newTabPending)&&<span className="browser-pending-tab"><Globe2 size={15}/> New tab</span>}
    </div>
    <button type="button" className="browser-new-tab" aria-label="New browser tab" onClick={startTab}><Plus size={16}/><span>New tab</span></button>
   </div>
   <div className="shared-browser-toolbar">
    <div className="browser-nav-buttons">
     <button type="button" aria-label="Back" title="Back" disabled={!active?.canGoBack||newTabPending} onClick={()=>void command({type:'back',tabId:active?.id})}><ArrowLeft size={17}/></button>
     <button type="button" aria-label="Forward" title="Forward" disabled={!active?.canGoForward||newTabPending} onClick={()=>void command({type:'forward',tabId:active?.id})}><ArrowRight size={17}/></button>
     <button type="button" aria-label={active?.loading?'Stop loading':'Reload'} title={active?.loading?'Stop loading':'Reload'} disabled={!active||newTabPending} onClick={()=>void command({type:active?.loading?'stop':'reload',tabId:active?.id})}>{active?.loading?<Square size={15}/>:<RotateCw size={16}/>}</button>
    </div>
    <form className="browser-address" onSubmit={event=>{event.preventDefault();navigate()}}>
     <Globe2 size={17} aria-hidden="true"/>
     <input ref={addressInput} aria-label="Browser address" value={url} onChange={event=>setUrl(event.target.value)} onFocus={event=>{addressFocused.current=true;event.currentTarget.select()}} onBlur={()=>{addressFocused.current=false}} placeholder="Enter a website or localhost address" spellCheck={false} autoCapitalize="off"/>
     <button type="submit" disabled={!url.trim()||busy}>Go</button>
    </form>
    <div className="browser-toolbar-end">
     <button type="button" aria-label="Find on page" title="Find on page" aria-expanded={findOpen} disabled={!active||newTabPending} onClick={()=>{setFindOpen(value=>!value);if(!findOpen)requestAnimationFrame(()=>findInput.current?.focus());else closeFind()}}><Search size={17}/></button>
     <select aria-label="Browser zoom" title="Page zoom" value={active?.zoom||1} disabled={!active||newTabPending} onChange={event=>void command({type:'zoom',tabId:active?.id,zoom:Number(event.target.value)})}>{[.5,.75,1,1.25,1.5,2,3].map(value=><option key={value} value={value}>{Math.round(value*100)}%</option>)}</select>
    </div>
    {findOpen&&active&&!newTabPending&&<div className="browser-find"><Search size={16}/><input ref={findInput} aria-label="Find on page" value={find} onChange={event=>queueFind(event.target.value)} onKeyDown={event=>{if(event.key==='Escape')closeFind()}} placeholder="Find on this page"/><button type="button" aria-label="Close find" onClick={closeFind}><X size={15}/></button></div>}
   </div>
   <div className="shared-browser-access">
    <span className="browser-access-state">{active?.loading&&!newTabPending?<ProgressIndicator label="Page loading"/>:active?.control==='agent'&&!newTabPending?<ShieldCheck size={16}/>:<Hand size={16}/>}
     {active&&!newTabPending?(active.control==='agent'?'Agent may use this tab':'You control this tab'):'Your browsing stays private'}
    </span>
    <div className="browser-access-actions">
     {active&&!newTabPending&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void command({type:active.control==='agent'?'takeover':'handback',tabId:active.id})}>{active.control==='agent'?'Take over':'Hand to agent'}</button>}
     <button ref={accessButton} type="button" className="secondary-button" disabled={busy} onClick={openAccess}><ShieldCheck size={15}/> Agent access</button>
    </div>
   </div>
   {error&&<p role="alert" className="error-inline browser-error">{error}</p>}
   <div className="shared-browser-viewport" ref={viewport} id="shared-browser-content" role="region" aria-label="Live project browser">
    {(!active||newTabPending)&&<div className="browser-welcome">
     <span className="browser-welcome-icon"><Globe2 size={30}/></span>
     <h2>Open a page</h2>
     <p>Type a website or localhost address in the bar above, then press Go.</p>
     <button type="button" className="primary-button" onClick={()=>addressInput.current?.focus()}>Focus address bar</button>
     <small>Agent access stays off until you grant an origin and hand over a tab.</small>
    </div>}
   </div>
  </div>
  {sessionId&&<details className="legacy-browser"><summary onClick={()=>setLegacy(value=>!value)}>Legacy isolated browser recovery</summary>{legacy&&<LegacyBrowserPage sessionId={sessionId}/>}</details>}
  <dialog ref={accessDialog} className="browser-access-dialog" aria-labelledby="browser-access-title" onCancel={event=>{event.preventDefault();closeAccess(true)}}>
   <header><div><h2 id="browser-access-title">Agent browser access</h2><p>Project: {project.split(/[\\/]/).at(-1)}</p></div><button type="button" className="icon-button" aria-label="Close agent access" disabled={busy} onClick={()=>closeAccess(true)}><X size={18}/></button></header>
   <div className="browser-access-dialog-body">
    <p>The agent can observe signed-in pages only at origins you grant. Interaction and Jev cloud analysis need separate origin lists. Your own browsing needs no grant.</p>
    <label className="browser-enable-grant"><input type="checkbox" checked={grant.enabled} onChange={event=>setGrant(current=>({...current,enabled:event.target.checked}))}/> Allow agent access in this project</label>
    <label>Observe origins<textarea value={grant.origins.join('\n')} onChange={event=>setOrigins('origins',event.target.value)} placeholder="https://example.com" spellCheck={false}/><small>One exact origin per line. The agent may read page content and sign-in state there.</small></label>
    <label>Interact origins<textarea value={grant.interactOrigins.join('\n')} onChange={event=>setOrigins('interactOrigins',event.target.value)} placeholder="https://example.com" spellCheck={false}/><small>Must also appear in Observe origins. Consequential actions still require review.</small></label>
    <label>Jev cloud analysis origins<textarea value={(grant.cloudOrigins||[]).join('\n')} onChange={event=>setOrigins('cloudOrigins',event.target.value)} placeholder="https://example.com" spellCheck={false}/><small>Optional. Sends bounded, redacted page descriptions to the selected Jev model.</small></label>
    {error&&<p role="alert" className="error-inline">{error}</p>}
   </div>
   <footer><button type="button" className="secondary-button" disabled={busy} onClick={()=>closeAccess(true)}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={()=>void saveAccess()}>{busy?'Saving…':'Review and save grants'}</button></footer>
  </dialog>
 </div>
}
