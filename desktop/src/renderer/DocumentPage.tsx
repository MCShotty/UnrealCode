import {useEffect,useRef,useState} from 'react'
import {ArrowLeft,ArrowRight,FileSearch,FolderOpen,Minus,Plus} from 'lucide-react'
import {ProgressIndicator} from './ProgressIndicator'
import type {DocumentHandle,DocumentPage as PageText,DocumentSearchPage} from '../shared/document'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

type PdfModule=typeof import('pdfjs-dist')
export function DocumentPage({sessionId,onAttach}:{sessionId?:string;onAttach(reference:string):void}){
 const [path,setPath]=useState(''),[password,setPassword]=useState(''),[handle,setHandle]=useState<DocumentHandle>(),[pdf,setPdf]=useState<Awaited<ReturnType<PdfModule['getDocument']>['promise']>>(),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[text,setText]=useState<PageText>(),[search,setSearch]=useState(''),[matches,setMatches]=useState<DocumentSearchPage>(),[language,setLanguage]=useState<'eng'|'ara'>('eng'),[ocr,setOcr]=useState<PageText>(),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const canvas=useRef<HTMLCanvasElement>(null),overlay=useRef<HTMLDivElement>(null),generation=useRef(0),attached=useRef(new Set<string>())
 const selection=useRef({id:handle?.id,page,revision:0}),pending=useRef(false)
 if(selection.current.id!==handle?.id||selection.current.page!==page)selection.current={id:handle?.id,page,revision:selection.current.revision+1}
 useEffect(()=>()=>{selection.current={...selection.current,revision:selection.current.revision+1}},[])
 const run=async(work:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await work()}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{pending.current=false;setBusy(false)}}
 const load=async(value:DocumentHandle)=>{
  const bytes=await window.unreal.documentBytes(value.id),module=await import('pdfjs-dist')
  module.GlobalWorkerOptions.workerSrc=workerUrl
  const document=await module.getDocument({data:bytes,password:password||undefined,disableFontFace:true}).promise
  await pdf?.loadingTask.destroy().catch(()=>{})
  if(handle&&!attached.current.has(handle.id))await window.unreal.documentClose(handle.id)
  setPdf(document);setHandle(value);setPage(1);setZoom(1);setText(undefined);setMatches(undefined);setOcr(undefined);setPassword('')
 }
 useEffect(()=>()=>{generation.current++;void pdf?.loadingTask.destroy().catch(()=>{});if(handle&&!attached.current.has(handle.id))void window.unreal.documentClose(handle.id)},[handle?.id])
 useEffect(()=>{setText(undefined);setOcr(undefined)},[handle?.id,page])
 useEffect(()=>{if(!pdf||!handle)return;const version=++generation.current;let rendering:{cancel():void;promise:Promise<void>}|undefined,textLayer:{cancel():void}|undefined
  void (async()=>{
   const sheet=await pdf.getPage(page),viewport=sheet.getViewport({scale:Math.min(3,Math.max(.4,zoom))}),target=canvas.current,layer=overlay.current
   if(!target||!layer||version!==generation.current)return
   target.width=Math.ceil(viewport.width);target.height=Math.ceil(viewport.height);target.style.width=`${viewport.width}px`;target.style.height=`${viewport.height}px`
   layer.replaceChildren();layer.style.width=`${viewport.width}px`;layer.style.height=`${viewport.height}px`
   rendering=sheet.render({canvasContext:target.getContext('2d')!,canvas:target,viewport});await rendering.promise
   if(version!==generation.current)return
   const module=await import('pdfjs-dist');const content=await sheet.getTextContent()
   if(version!==generation.current)return
   const layerTask=new module.TextLayer({textContentSource:content,container:layer,viewport});textLayer=layerTask
   await layerTask.render()
   if(version!==generation.current)return
   const extracted=await window.unreal.documentPage(handle.id,page)
   if(version===generation.current)setText(extracted)
  })().catch(reason=>{if(version===generation.current&&reason?.name!=='RenderingCancelledException')setError(String(reason))})
  return()=>{generation.current++;rendering?.cancel();textLayer?.cancel()}
 },[pdf,handle?.id,page,zoom])
 const openProject=()=>run(async()=>load(await window.unreal.documentOpenProject(path,password||undefined)))
 const openExternal=()=>run(async()=>{const chosen=await window.unreal.documentOpenExternal(password||undefined);if(chosen)await load(chosen)})
 const find=()=>run(async()=>{if(!handle)return;const result=await window.unreal.documentSearch(handle.id,search,1,30);setMatches(result);if(result.matches[0])setPage(result.matches[0].page)})
 const recognize=()=>run(async()=>{if(!handle)return;const requested=selection.current;const result=await window.unreal.documentOcr(handle.id,page,language);if(selection.current===requested)setOcr(result)})
 return <div className="page-content document-page"><div className="page-heading"><div><h1>Documents</h1><p>Read PDF pages locally. OCR text is labelled separately from embedded text.</p></div>{busy&&<ProgressIndicator label="Processing document"/>}</div>
  <div className="document-open"><label>Project PDF path<input value={path} onChange={event=>setPath(event.target.value)} placeholder="docs/report.pdf"/></label><label>Password, if required<input type="password" autoComplete="off" value={password} onChange={event=>setPassword(event.target.value)}/></label><button className="primary-button" disabled={busy||!path.trim()} onClick={()=>void openProject()}><FileSearch size={16}/> Open project PDF</button><button className="secondary-button" disabled={busy} onClick={()=>void openExternal()}><FolderOpen size={16}/> Choose external PDF</button></div>
  {error&&<p className="error-inline" role="alert">{error}</p>}
  {handle&&<><div className="document-toolbar"><strong title={handle.path}>{handle.title||handle.name}</strong><span>{handle.source==='project'?'Project document':'Chosen external document'} · {handle.pages} pages</span>{handle.source==='external'&&<button disabled={!sessionId||busy} title={!sessionId?'Open a conversation first':undefined} onClick={()=>void run(async()=>{await window.unreal.documentAttach(handle.id,sessionId!);attached.current.add(handle.id);onAttach(`Read the PDF I explicitly attached (${handle.name}, document handle ${handle.id}). Use DocumentInspect with documentId ${handle.id}, then bounded page tools.`)})}>Attach to chat</button>}<button disabled={page<=1} aria-label="Previous page" onClick={()=>setPage(page-1)}><ArrowLeft size={16}/></button><label>Page<input type="number" min={1} max={handle.pages} value={page} onChange={event=>setPage(Math.min(handle.pages,Math.max(1,Number(event.target.value)||1)))}/></label><button disabled={page>=handle.pages} aria-label="Next page" onClick={()=>setPage(page+1)}><ArrowRight size={16}/></button><button aria-label="Zoom out" disabled={zoom<=.5} onClick={()=>setZoom(Math.max(.5,zoom-.2))}><Minus size={16}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" disabled={zoom>=2.8} onClick={()=>setZoom(Math.min(3,zoom+.2))}><Plus size={16}/></button></div>
   <div className="document-columns"><div className="document-canvas-scroll"><div className="document-sheet"><canvas ref={canvas}/><div ref={overlay} className="textLayer"/></div></div><aside className="document-text"><div className="document-search"><input aria-label="Search PDF" value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void find()}} placeholder="Find text in pages"/><button disabled={busy||!search.trim()} onClick={()=>void find()}>Search</button></div>{matches?.matches.map(hit=><button className="document-hit" key={hit.page} onClick={()=>setPage(hit.page)}><strong>Page {hit.page}</strong><span>{hit.excerpt}</span></button>)}{matches?.nextPage&&<button className="secondary-button" onClick={()=>void run(async()=>{const next=await window.unreal.documentSearch(handle.id,search,matches.nextPage,30);setMatches({matches:[...matches.matches,...next.matches],nextPage:next.nextPage})})}>Search later pages</button>}
    <h2>Page {page} text</h2><p className="muted-copy">Embedded text · {text?.truncated?'truncated to 32 KiB':'page bounded'} · Reference: {handle.name}#page={page} · {handle.revision.slice(0,12)}</p><pre className="document-extracted">{text?.text||'No embedded text on this page. Try OCR.'}</pre><div className="button-row"><select aria-label="OCR language" value={language} onChange={event=>setLanguage(event.target.value as 'eng'|'ara')}><option value="eng">English</option><option value="ara">Arabic</option></select><button className="secondary-button" disabled={busy} onClick={()=>void recognize()}>Run page OCR</button></div>{ocr&&<><p className="muted-copy">OCR · {ocr.language} · confidence {Math.round(ocr.confidence||0)}%. Verify important values against the page.</p><pre className="document-extracted">{ocr.text}</pre></>}</aside></div>
  </>}
 </div>
}
