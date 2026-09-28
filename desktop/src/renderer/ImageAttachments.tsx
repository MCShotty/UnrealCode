import {useState,useSyncExternalStore} from 'react'
import {imageAttachments,addImageAttachments,clearImageAttachments,resetImageDrafts,subscribeImages} from './image-drafts'
export {imageAttachments,clearImageAttachments} from './image-drafts'
let projectGeneration=0
export function useImageAttachments(sessionId:string|null){return useSyncExternalStore(subscribeImages,()=>imageAttachments(sessionId))}
export function clearProjectImages(){projectGeneration++;const ids=resetImageDrafts();if(ids.length)void window.unreal.discardImages(ids).catch(()=>{})}
export function ImageAttachments({sessionId}:{sessionId:string|null}){
 const images=useImageAttachments(sessionId),[error,setError]=useState(''),[picking,setPicking]=useState(false)
 const remaining=3-images.length
 return <div className="context-chips"><button className="text-button" disabled={picking||remaining===0} onClick={()=>{setError('');setPicking(true);const generation=projectGeneration;void window.unreal.pickImages(remaining).then(images=>{if(generation!==projectGeneration){void window.unreal.discardImages(images.map(image=>image.id));return}addImageAttachments(sessionId,images)}).catch(reason=>setError(String(reason))).finally(()=>setPicking(false))}}>Attach image</button>{imageAttachments(sessionId).map(image=><button className="text-button" key={image.id} title={`${image.width} × ${image.height}`} onClick={()=>{setError('');void window.unreal.discardImages([image.id]).then(()=>{clearImageAttachments(sessionId,[image.id])}).catch(reason=>setError(String(reason)))}}>{image.name} ×</button>)}{error&&<span role="alert">{error}</span>}</div>
}
