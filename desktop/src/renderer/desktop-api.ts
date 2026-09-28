import type { DesktopAPI } from '../shared/api'
import type { IPCResult } from '../shared/failure'
declare global { interface Window { unrealTransport:DesktopAPI } }

// Electron strips custom Error properties across contextBridge. Transfer plain
// result envelopes and create the error in the renderer, where callers can keep
// the typed recovery information. The exposed transport still has only the
// explicitly declared preload methods; no IPC channel or filesystem access.
const transport=window.unrealTransport
const api:Record<string,unknown>={}
function unwrap(value:unknown):unknown {
  const reply=value as IPCResult<unknown>|undefined
  if(reply?.unrealResult!==true)return value
  if(reply.ok)return reply.value
  throw Object.assign(new Error(reply.failure.message),{failure:reply.failure})
}
for(const name of Object.keys(transport)){
  const method=transport[name as keyof DesktopAPI] as (...args:unknown[])=>unknown
  api[name]=(...args:unknown[])=>{
    const value=method(...args)
    return value&&typeof (value as Promise<unknown>).then==='function'?Promise.resolve(value).then(unwrap):value
  }
}
Object.defineProperty(window,'unreal',{value:Object.freeze(api),writable:false,configurable:false})
