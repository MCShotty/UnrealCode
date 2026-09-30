import {PaneDialog} from './PaneDialog'
import './fieldnotes.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Download, FilePenLine, Folder, Plus, Search, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import type { Fieldnote, FieldnoteDraft, FieldnoteInput, FieldnotePage } from '../shared/fieldnotes'
import type { SessionInfo } from '../shared/api'
import { ProgressIndicator } from './ProgressIndicator'
import { effects, instant, spatial } from './motion'
import { useReducedMotion } from './useReducedMotion'

type Target={id:string;path:string;name:string}
const inputOf=(note:Fieldnote):FieldnoteInput=>({id:note.id,expectedRevision:note.revision,title:note.title,body:note.body,pointer:note.pointer,enabled:note.enabled,indexing:note.indexing})
const syncLabel=(note:Fieldnote)=>({local:'Local guidance',pending:'Waiting for memory',analysing:'Interpreting note',retaining:'Saving to memory',indexed:'Indexed in memory',failed:'Memory needs attention',disabled:'Disabled'})[note.sync.state]
export function FieldnotesPage({ initialId, initialText, onOpened }: { initialId?:string; initialText?:string; onOpened?():void }) {
 const [page,setPage]=useState<FieldnotePage>({notes:[],total:0,generation:0}),[query,setQuery]=useState(''),[filter,setFilter]=useState<'all'|'enabled'>('all')
 const [targets,setTargets]=useState<Target[]>([]),[sessions,setSessions]=useState<SessionInfo[]>([]),[drafts,setDrafts]=useState<FieldnoteDraft[]>([])
 const [draft,setDraftState]=useState<FieldnoteDraft|null>(null),[saved,setSaved]=useState<Fieldnote|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[draftStatus,setDraftStatus]=useState(''),[preview,setPreview]=useState(false),[fresh,setFresh]=useState(false),[pointerOpen,setPointerOpen]=useState(false)
 const draftRef=useRef(draft),loadedRef=useRef(saved),request=useRef(0),selection=useRef(0),busyRef=useRef(false),alive=useRef(true),reduced=useReducedMotion()
 loadedRef.current=saved
 const setDraft=(value:FieldnoteDraft|null)=>{draftRef.current=value;setDraftState(value)}
 const update=(patch:Partial<FieldnoteInput>)=>{if(draft)setDraft({...draft,value:{...draft.value,...patch},updatedAt:new Date().toISOString()})}
 const load=useCallback(async(cursor?:string)=>{
  const token=++request.current;setLoading(true)
  try{const result=await window.unreal.fieldnoteList({query,includeDisabled:filter==='all',cursor});if(token===request.current){setPage(current=>cursor?{...result,notes:[...new Map([...current.notes,...result.notes].map(note=>[note.id,note])).values()]}:result);setError('')}}
  catch(reason){if(token===request.current)setError(String(reason))}finally{if(token===request.current)setLoading(false)}
 },[query,filter])
  const loadRef=useRef(load);loadRef.current=load
 useEffect(()=>{const timer=setTimeout(()=>void load(),120);return()=>{clearTimeout(timer);request.current++}},[load])
 useEffect(()=>{
  alive.current=true
  void Promise.all([window.unreal.fieldnoteTargets(),window.unreal.fieldnoteDrafts()]).then(([rows,values])=>{if(alive.current){setTargets(rows);setDrafts(values)}}).catch(reason=>setError(String(reason)))
  return()=>{alive.current=false;request.current++;selection.current++;const current=draftRef.current;if(current)void window.unreal.fieldnoteDraft(current.key,current.value).catch(()=>{})}
 },[])
 useEffect(()=>window.unreal.onFieldnotesChanged(()=>{
  void load();const current=draftRef.current
  if(current?.value.id)void window.unreal.fieldnoteGet(current.value.id).then(note=>{if(alive.current&&draftRef.current?.value.id===note.id)setSaved(note)}).catch(()=>{})
 }),[load])
 useEffect(()=>{
  if(!draft)return
  setDraftStatus('Saving draft…')
  const key=draft.key,value=draft.value,timer=setTimeout(()=>void window.unreal.fieldnoteDraft(key,value).then(()=>{if(alive.current&&draftRef.current?.value===value)setDraftStatus('Draft saved on this device')}).catch(reason=>{if(alive.current)setDraftStatus(String(reason))}),350)
  return()=>clearTimeout(timer)
 },[draft])
 useEffect(()=>{
  let current=true;setSessions([])
  if(draft?.value.pointer.projectId)void window.unreal.fieldnoteSessions(draft.value.pointer.projectId).then(rows=>{if(current)setSessions(rows)}).catch(()=>{})
  return()=>{current=false}
 },[draft?.value.pointer.projectId])
 const remember=async()=>{const previous=draftRef.current;if(previous)await window.unreal.fieldnoteDraft(previous.key,previous.value)}
 const open=async(id:string)=>{
  const token=++selection.current;setError('');setNotice('');setFresh(false)
  try{await remember();const [note,allDrafts]=await Promise.all([window.unreal.fieldnoteGet(id),window.unreal.fieldnoteDrafts()]);if(token!==selection.current)return;setSaved(note);setDraft(allDrafts.find(d=>d.value.id===id)||{key:id,value:inputOf(note),updatedAt:note.updatedAt});setPreview(false)}catch(reason){if(token===selection.current)setError(String(reason))}
 }
 const create=async(text='')=>{
  const token=++selection.current
  try{await remember();const current=await window.unreal.projectPath(),rows=await window.unreal.fieldnoteTargets();if(token!==selection.current)return;setTargets(rows)
   const target=rows.find(p=>p.path===current),value:FieldnoteInput={title:'',body:text,pointer:{projectId:target?.id||'',projectPath:target?.path||'',projectName:target?.name||''},enabled:true,indexing:true}
   setDraft({key:crypto.randomUUID(),value,updatedAt:new Date().toISOString()});setSaved(null);setNotice('');setError('');setFresh(true);setPreview(false)
  }catch(reason){if(token===selection.current)setError(String(reason))}
 }
 useEffect(()=>{if(initialId){void open(initialId);onOpened?.()}else if(initialText!==undefined){void create(initialText);onOpened?.()}},[initialId,initialText])
 const action=async(work:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{await work()}catch(reason){setError(String(reason))}finally{busyRef.current=false;setBusy(false)}}
 const save=()=>action(async()=>{
   const snapshot=draftRef.current,token=selection.current;if(!snapshot)return
  const result=await window.unreal.fieldnoteSave(snapshot.value)
   const local=draftRef.current?.key===snapshot.key?draftRef.current:(await window.unreal.fieldnoteDrafts()).find(row=>row.key===snapshot.key)
   if(local){
    const next={key:result.id,value:local.value===snapshot.value?inputOf(result):{...local.value,id:result.id,expectedRevision:result.revision},updatedAt:result.updatedAt}
    if(token===selection.current&&draftRef.current?.key===snapshot.key){draftRef.current=next;if(alive.current){setSaved(result);setDraftState(next);setNotice('Saved locally. Guidance is available immediately.');setFresh(false)}}
    if(snapshot.key!==next.key)await window.unreal.fieldnoteDraft(snapshot.key,null)
    await window.unreal.fieldnoteDraft(next.key,next.value)
   }
   const remaining=await window.unreal.fieldnoteDrafts();if(alive.current){setDrafts(remaining);await loadRef.current()}
 })
 const cancel=()=>action(async()=>{const current=draftRef.current,token=++selection.current;if(!current)return;setDraft(null);await window.unreal.fieldnoteDraft(current.key,null);const note=current.value.id?await window.unreal.fieldnoteGet(current.value.id):null;if(alive.current&&token===selection.current){setSaved(note);setDraft(note?{key:note.id,value:inputOf(note),updatedAt:note.updatedAt}:null);setNotice('Unapplied changes discarded.')}const remaining=await window.unreal.fieldnoteDrafts();if(alive.current)setDrafts(remaining)})
 const remove=()=>action(async()=>{const current=saved,token=selection.current;if(!current||!confirm('Delete this Fieldnote? It stops influencing future requests. Historical messages, receipts, and existing backups remain unchanged.'))return;await window.unreal.fieldnoteDelete(current.id,current.revision);await window.unreal.fieldnoteDraft(current.id,null);if(alive.current&&token===selection.current){setDraft(null);setSaved(null);setNotice('Fieldnote deleted.')}if(alive.current)await loadRef.current()})
 const chooseProject=(target:Target)=>update({pointer:{projectId:target.id,projectPath:target.path,projectName:target.name}})
 const ready=!!draft?.value.title.trim()&&!!draft.value.body.trim()&&!!draft.value.pointer.projectId&&!saved?.deletedAt
 const dirty=!!draft&&(!saved||JSON.stringify(draft.value)!==JSON.stringify(inputOf(saved)))
 const indexing=saved&&['analysing','retaining'].includes(saved.sync.state)
 const pointerEditor=draft?(<fieldset className="fieldnote-pointer"><legend><Folder size={15}/> Points to</legend><label>Project<select value={draft.value.pointer.projectId} onChange={e=>{const target=targets.find(p=>p.id===e.target.value);if(target)chooseProject(target)}}><option value="">Choose a project</option>{targets.map(p=><option key={p.id} value={p.id}>{p.name} · {p.path}</option>)}</select></label><label>Session <small>optional</small><select value={draft.value.pointer.sessionId||''} onChange={e=>{const item=sessions.find(s=>s.id===e.target.value);update({pointer:{...draft.value.pointer,sessionId:item?.id,sessionTitle:item?.title}})}}><option value="">Project guidance</option>{draft.value.pointer.sessionId&&!sessions.some(s=>s.id===draft.value.pointer.sessionId)&&<option value={draft.value.pointer.sessionId}>{draft.value.pointer.sessionTitle||'Archived or unavailable session'}</option>}{sessions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label><button className="text-button" onClick={()=>void action(async()=>{const target=await window.unreal.fieldnotePickProject();if(target){setTargets(await window.unreal.fieldnoteTargets());chooseProject(target)}})}>Choose another folder / repair pointer</button><small>Attribution travels with the note. Relevant guidance may help other projects; this pointer grants no file access.</small></fieldset>):null
 return <div className={`page-content fieldnotes-page ${draft?'show-note':''}`}>
  <div className="page-heading"><div><div className="eyebrow">YOUR WORDS, WITH CONTEXT</div><h1>Fieldnotes</h1><p>A shared notebook for guidance worth keeping. Every note remembers where it belongs.</p></div><div className="button-row"><button className="secondary-button" onClick={()=>void action(async()=>{const path=await window.unreal.fieldnoteExport();if(path)setNotice('Private Fieldnotes export saved.')})} disabled={busy}><Download size={16}/> Export</button><button className="primary-button" onClick={()=>void create()} disabled={busy}><Plus size={17}/> New note</button></div></div>
  {error&&<p role="alert" className="error-inline">{error}</p>}{notice&&<p className="fieldnote-notice" role="status"><Check size={16}/>{notice}</p>}
  <div className="fieldnotes-layout"><aside className="fieldnotes-list" aria-label="Fieldnote library">
   <label className="fieldnote-search"><Search size={17}/><input aria-label="Search Fieldnotes" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find guidance…"/></label>
   <div className="fieldnote-filters" role="group" aria-label="Fieldnote filter"><motion.span className="fieldnote-filter-selection" aria-hidden="true" initial={false} animate={{x:filter==='all'?'0%':'100%'}} transition={reduced?instant:spatial.fast}/>{(['all','enabled'] as const).map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}><span>{value==='all'?'All notes':'Enabled'}</span></button>)}</div>
   {drafts.filter(d=>!d.value.id).length>0&&<details className="fieldnote-drafts"><summary>Unfinished drafts · {drafts.filter(d=>!d.value.id).length}</summary>{drafts.filter(d=>!d.value.id).map(d=><button key={d.key} className="text-button" onClick={()=>void action(async()=>{await remember();setSaved(null);setDraft(d);setFresh(false)})}>{d.value.title||'Untitled draft'}</button>)}</details>}
   <div className="fieldnote-results" aria-busy={loading}>{page.notes.map(note=><button className={`fieldnote-row ${draft?.value.id===note.id?'selected':''}`} key={note.id} onClick={()=>void open(note.id)} aria-current={draft?.value.id===note.id?'true':undefined}><FilePenLine size={19}/><span><strong>{note.title}</strong><small>{note.pointer.projectName}{note.pointer.sessionId?` › ${note.pointer.sessionTitle||'Session'}`:''}</small><span className="fieldnote-excerpt">{note.body.slice(0,120)}</span></span><span className="fieldnote-state">{note.enabled?'On':'Off'}</span></button>)}</div>
   {loading&&<p className="muted-copy pad" role="status">Loading notes…</p>}{!loading&&!page.notes.length&&<div className="fieldnote-empty-small"><FilePenLine size={25}/><p>{query?'No matching notes.':'A good idea deserves somewhere to live.'}</p></div>}
   {page.nextCursor&&<button className="text-button" disabled={loading} onClick={()=>void load(page.nextCursor)}>Load more notes</button>}
  </aside><section className="fieldnote-detail" aria-label="Fieldnote editor">
   {!draft?<div className="fieldnote-empty"><span className="fieldnote-paper"><FilePenLine size={38}/></span><h2>Leave a note for future you.</h2><p>Preferences, project constraints, debugging clues. Saved locally first; memory helps find the relevant ones.</p><button className="primary-button" onClick={()=>void create()}><Plus size={16}/> Write a Fieldnote</button></div>:<>
    <header className="fieldnote-detail-heading"><button className="text-button fieldnote-back" onClick={()=>void action(async()=>{await remember();setDraft(null)})}><ArrowLeft size={16}/> Library</button><span className={`fieldnote-paper small ${fresh&&!reduced?'fresh-note':''}`}><FilePenLine size={21}/></span><span>{saved?`Revision ${saved.revision}`:'New Fieldnote'}<small>{draftStatus}</small></span>{saved&&<span className="fieldnote-sync"><ProgressIndicator state={indexing?'running':saved.sync.state==='indexed'?'success':saved.sync.state==='failed'?'error':'idle'} animate={!!indexing}/>{syncLabel(saved)}</span>}</header>
    {saved?.deletedAt?<p className="notice">This note was deleted. Historical inclusion receipts retain what was originally supplied.</p>:<div className="fieldnote-editor-body">
     <label>Title<input value={draft.value.title} maxLength={160} onChange={e=>update({title:e.target.value})} placeholder="What should the agent keep in mind?"/></label>
     <div className="fieldnote-pointer-inline">{pointerEditor}</div><button className="fieldnote-pointer-open secondary-button" onClick={()=>setPointerOpen(true)}><Folder size={16}/>{draft.value.pointer.projectName||'Choose a project pointer'} · Edit pointer</button>
     {pointerOpen&&<PaneDialog title="Fieldnote pointer" onClose={()=>setPointerOpen(false)}>{pointerEditor}<button className="primary-button" onClick={()=>setPointerOpen(false)}>Done</button></PaneDialog>}
     <div className="fieldnote-body-heading"><label htmlFor="fieldnote-body">Guidance <small>Markdown supported</small></label><button className="text-button" aria-pressed={preview} onClick={()=>setPreview(!preview)}>{preview?'Edit':'Preview'}</button></div>
     {preview?<div className="markdown fieldnote-preview"><ReactMarkdown>{draft.value.body}</ReactMarkdown></div>:<textarea id="fieldnote-body" value={draft.value.body} onChange={e=>update({body:e.target.value})} placeholder="Write in your own words. Current requests always take precedence." spellCheck rows={10}/>}
     <div className="fieldnote-switches"><label><input type="checkbox" checked={draft.value.enabled} onChange={e=>update({enabled:e.target.checked})}/> Use as guidance</label><label><input type="checkbox" checked={draft.value.indexing} onChange={e=>update({indexing:e.target.checked})}/> Index with the configured memory model when enabled</label></div>
     <p className="muted-copy">Notes stay useful when memory is off. Saving does not grant tools or authorize actions.</p>
     {saved?.sync.error&&<div className="notice"><p>{saved.sync.error}</p><button className="secondary-button" disabled={busy||dirty} onClick={()=>void action(()=>window.unreal.fieldnoteRetry(saved.id))}>Retry memory indexing</button></div>}
     {saved?.interpretation&&<details className="fieldnote-interpretation"><summary>Memory interpretation · {saved.interpretation.model}</summary><p>{saved.interpretation.summary}</p><p>{saved.interpretation.applicability}</p><small>Source revision {saved.interpretation.revision} · {saved.interpretation.provider} · {saved.interpretation.topics.join(', ')}</small>{saved.interpretation.quotes.map((quote,index)=><blockquote key={index}>{quote}</blockquote>)}</details>}
    </div>}
    <footer className="fieldnote-footer"><div>{saved&&!saved.deletedAt&&<><button className="icon-button" aria-label="Delete Fieldnote" disabled={busy} onClick={()=>void remove()}><Trash2 size={17}/></button><button className="text-button" disabled={busy} onClick={()=>void action(()=>window.unreal.fieldnoteOpen(saved.id))}>Open source <ArrowUpRight size={15}/></button></>}</div><div><button className="secondary-button" disabled={busy} onClick={()=>void cancel()}>Cancel</button><button className="primary-button" disabled={busy||!ready||!dirty} onClick={()=>void save()}><Check size={16}/>{busy?'Saving…':'Save note'}</button></div></footer>
   </>}
  </section></div>
 </div>
}
