import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile)
const endpoint='https://api.github.com/repos/MCShotty/UnrealCode/releases'
/** A private repository may answer anonymous release checks with 404. */
export const releaseFetch:typeof fetch=async(input,init)=>{
 const target=new URL(String(input))
 if(target.origin+target.pathname!==endpoint)throw Error('Unexpected release endpoint')
 const anonymous=await fetch(input,init)
 if(anonymous.status!==404)return anonymous
 let token=''
 try{token=(await exec('gh',['auth','token'],{windowsHide:true,timeout:5000,maxBuffer:16384})).stdout.trim()}catch{return anonymous}
 if(!token)return anonymous
 await anonymous.body?.cancel().catch(()=>{})
 const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${token}`)
 return fetch(input,{...init,headers,redirect:'error'})
}
