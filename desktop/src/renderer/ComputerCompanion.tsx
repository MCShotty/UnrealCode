import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {ComputerPage} from './ComputerPage'
export const openComputerCompanion=()=>window.dispatchEvent(new Event('unrealcode:computer-companion'))
export function ComputerCompanion({sessionId}:{sessionId?:string}){
 const [open,setOpen]=useState(false),[narrow,setNarrow]=useState(true),dialog=useRef<HTMLDialogElement>(null),focus=useRef<HTMLElement|null>(null)
 useEffect(()=>{const show=()=>{focus.current=document.activeElement as HTMLElement;setOpen(true)},hide=()=>setOpen(false);window.addEventListener('unrealcode:computer-companion',show);window.addEventListener('unreal:tool-activity',hide);return()=>{window.removeEventListener('unrealcode:computer-companion',show);window.removeEventListener('unreal:tool-activity',hide)}},[])
 useLayoutEffect(()=>{const container=document.querySelector('.workspace-body');if(!container)return;const update=()=>setNarrow(container.clientWidth<960);update();const observer=new ResizeObserver(update);observer.observe(container);return()=>observer.disconnect()},[])
 useLayoutEffect(()=>{const element=dialog.current;if(!open||!element)return;const body=element.querySelector('.computer-scroll'),scroll=body?.scrollTop||0;const previous=document.activeElement as HTMLElement;element.close();if(narrow)element.showModal();else element.show();if(previous&&element.contains(previous))previous.focus({preventScroll:true});if(body)body.scrollTop=scroll;return()=>element.close()},[open,narrow])
 const close=()=>{setOpen(false);requestAnimationFrame(()=>focus.current?.isConnected&&focus.current.focus({preventScroll:true}))}
 if(!open)return null
 return <dialog ref={dialog} className={`computer-companion ${narrow?'compact':''}`} aria-label="Computer companion" onCancel={event=>{event.preventDefault();close()}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close()}}}><ComputerPage sessionId={sessionId} compact onClose={close}/></dialog>
}
