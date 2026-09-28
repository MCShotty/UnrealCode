import { useEffect,useRef,type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { X } from 'lucide-react'
import { effects, expressive, instant } from './motion'
export function SettingsOverlay({onClose,children}:{onClose():void;children:ReactNode}){
 const element=useRef<HTMLDivElement>(null),reduce=useReducedMotion()
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,root=element.current!
  const controls=()=>[...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(item=>item.getClientRects().length>0)
  controls()[0]?.focus()
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose()}if(event.key==='Tab'){const items=controls(),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}
  root.addEventListener('keydown',key);return()=>{root.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus()}
 },[])
 return <motion.div ref={element} className="setup-overlay" role="dialog" aria-modal="true" aria-label="Settings" initial={reduce?false:{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0,transition:reduce?instant:effects.fast}} transition={reduce?instant:expressive.dialog}><button className="close-overlay" aria-label="Close settings" onClick={onClose}><X size={20}/></button>{children}</motion.div>
}
