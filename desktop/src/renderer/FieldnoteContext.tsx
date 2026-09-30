import { useEffect, useRef, useState } from 'react'
import { FilePenLine, Search } from 'lucide-react'
import { PaneDialog } from './PaneDialog'
import type { Fieldnote, FieldnoteReceipt, FieldnoteSelection } from '../shared/fieldnotes'
import { fieldnoteSelection, openFieldnote, saveFieldnoteSelection } from './fieldnote-selections'

export function FieldnoteComposer({sessionId,prompt}:{sessionId?:string;prompt:string}){
 const [project,setProject]=useState(''),[notes,setNotes]=useState<Fieldnote[]>([]),[choices,setChoices]=useState<FieldnoteSelection>({include:[],exclude:[]}),[open,setOpen]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const generation=useRef(0)
 useEffect(()=>{let alive=true;void window.unreal.projectPath().then(root=>{if(alive){setProject(root||'');setChoices(fieldnoteSelection(root||'',sessionId))}});return()=>{alive=false}},[sessionId])
 useEffect(()=>{
  const refresh=()=>{const token=++generation.current;setLoading(true);void (open&&query?window.unreal.fieldnoteList({query,limit:30}):window.unreal.fieldnoteSuggest(prompt,sessionId)).then(async page=>{
   const extras=await Promise.all(choices.include.filter(id=>!page.notes.some(n=>n.id===id)).map(id=>window.unreal.fieldnoteGet(id).catch(()=>null)))
   if(token===generation.current){setNotes([...extras.filter((n):n is Fieldnote=>!!n),...page.notes]);setError('')}
  }).catch(reason=>{if(token===generation.current)setError(String(reason))}).finally(()=>{if(token===generation.current)setLoading(false)})}
  const timer=setTimeout(refresh,250),off=window.unreal.onFieldnotesChanged(refresh)
  return()=>{clearTimeout(timer);generation.current++;off()}
 },[prompt,sessionId,query,open,choices.include])
 const choose=(id:string,include:boolean)=>{const value={include:include?[...new Set([...choices.include,id])]:choices.include.filter(x=>x!==id),exclude:include?choices.exclude.filter(x=>x!==id):[...new Set([...choices.exclude,id])]};saveFieldnoteSelection(project,sessionId,value);setChoices(value)}
 const count=notes.filter(n=>n.enabled&&!n.deletedAt&&!choices.exclude.includes(n.id)).length
 return <>
  <button className="text-button composer-accessory" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><FilePenLine size={15}/><span>Fieldnotes{count?` · ${Math.min(count,8)} suggested`:''}</span></button>
  {open&&<PaneDialog title="Fieldnotes for this request" onClose={()=>setOpen(false)}><p>Relevant guidance is selected when you send. Pin a note to include it, or uncheck it for this conversation. The current request takes precedence.</p><label className="fieldnote-search"><Search size={16}/><input aria-label="Find Fieldnotes to include" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search the shared notebook"/></label>{loading&&<p role="status">Finding guidance…</p>}{notes.map(note=><label className="fieldnote-context-choice" key={note.id}><input type="checkbox" checked={!choices.exclude.includes(note.id)} disabled={!note.enabled||!!note.deletedAt} onChange={e=>choose(note.id,e.target.checked)}/><span><strong>{note.title}</strong><small>{note.pointer.projectName}{note.pointer.sessionId?` › ${note.pointer.sessionTitle||'Session'}`:''} · revision {note.revision}{!note.enabled?' · disabled':''}{choices.include.includes(note.id)?' · pinned':''}</small><span>{note.body}</span></span><button className="text-button" onClick={()=>{setOpen(false);openFieldnote(note.id)}}>Inspect</button></label>)}{!loading&&!notes.length&&<p>No matching guidance. Create a Fieldnote or search for one to include explicitly.</p>}{error&&<p role="alert" className="error-inline">{error}</p>}<p className="muted-copy">Up to eight complete notes and 16 KiB. The inclusion receipt records the exact accepted text.</p></PaneDialog>}
 </>
}
export function FieldnoteReceipts({sessionId}:{sessionId?:string}){
 const [rows,setRows]=useState<FieldnoteReceipt[]>([]),generation=useRef(0)
 useEffect(()=>{
  setRows([]);if(!sessionId)return
  let timer:ReturnType<typeof setTimeout>|undefined
  const refresh=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{const token=++generation.current;void window.unreal.fieldnoteReceipts(sessionId).then(value=>{if(token===generation.current)setRows(value.filter(r=>r.notes?.length||r.omitted?.length).slice(0,10))}).catch(()=>{})},80)}
  refresh();const changes=window.unreal.onFieldnotesChanged(refresh),events=window.unreal.onEvent(event=>{if(event.sessionId===sessionId&&event.event==='session.item')refresh()})
  return()=>{generation.current++;if(timer)clearTimeout(timer);changes();events()}
 },[sessionId])
 if(!rows.length)return null
 return <details className="fieldnote-receipts"><summary><FilePenLine size={14}/> Guidance receipts · {rows[0].notes.length} notes on the latest request</summary>{rows.map(row=><details key={row.messageId}><summary>{new Date(row.createdAt).toLocaleString()} · {row.state==='accepted'?'Attached to request':'Awaiting backend receipt'}</summary>{(row.notes||[]).map(note=><article key={note.id}><header><strong>{note.title}</strong><button className="text-button" onClick={()=>openFieldnote(note.id)}>Open note</button></header><small>{note.pointer.projectName}{note.pointer.sessionId?` › ${note.pointer.sessionTitle||'Session'}`:''} · revision {note.revision} · {note.reason}{note.redacted?' · secrets redacted':''}</small><pre>{note.text}</pre></article>)}{(row.omitted||[]).map(note=><p key={note.id}>{note.title}: {note.reason}</p>)}</details>)}</details>
}
export function SaveSelectionAsFieldnote(){
 const [text,setText]=useState('')
 useEffect(()=>{const update=()=>{const selection=window.getSelection(),anchor=selection?.anchorNode,node=anchor?.nodeType===Node.ELEMENT_NODE?anchor as Element:anchor?.parentElement;setText(node?.closest('.chat-entry')?selection?.toString()||'':'')};document.addEventListener('selectionchange',update);return()=>document.removeEventListener('selectionchange',update)},[])
 if(!text.trim())return null
 return <button className="text-button composer-accessory" onMouseDown={event=>event.preventDefault()} onClick={()=>window.dispatchEvent(new CustomEvent('unrealcode:fieldnote',{detail:{text}}))}><FilePenLine size={15}/> Save selection as Fieldnote</button>
}
