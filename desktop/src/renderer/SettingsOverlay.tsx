import { useEffect,useRef,type ReactNode } from 'react'
import { motion,useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { spatial } from './motion'
export function SettingsOverlay({onClose,children}:{onClose():void;children:ReactNode}){
 const element=useRef<HTMLDivElement>(null),reduce=useReducedMotion()
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,root=element.current!
  const controls=()=>[...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(item=>item.getClientRects().length>0)
  controls()[0]?.focus()
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose()}if(event.key==='Tab'){const items=controls(),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}
  root.addEventListener('keydown',key);return()=>{root.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus()}
 },[])
 return <motion.div ref={element} className="setup-overlay" role="dialog" aria-modal="true" aria-label="Settings" initial={reduce?false:{opacity:0,scale:.98}} animate={{opacity:1,scale:1}} exit={reduce?undefined:{opacity:0,scale:.98}} transition={reduce?{duration:0}:spatial.slow}><button className="close-overlay" aria-label="Close settings" onClick={onClose}><X size={20}/></button>{children}</motion.div>
}
