import {createHash} from 'node:crypto'
import type {HookSettings,ProjectHook} from '../shared/hooks'
import {atomicMetadata} from './atomic-metadata'
import {stableJSON} from './host-operations'
import {readBoundedJSON} from './bounded-file-read'
export class ProjectHooks{
 constructor(private path:string){}
 async read():Promise<HookSettings>{try{const value=await readBoundedJSON<HookSettings>(this.path,2*1024*1024);if(value.version!==1||!Array.isArray(value.hooks))throw Error('Unsupported hook configuration');return value}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,revision:0,hooks:[]};throw error}}
 digest(hooks:ProjectHook[]){return createHash('sha256').update(stableJSON(hooks)).digest('hex')}
 validate(hooks:ProjectHook[]):ProjectHook[]{if(!Array.isArray(hooks)||hooks.length>30||new Set(hooks.map(x=>x.id)).size!==hooks.length||hooks.some(hook=>!hook||typeof hook.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(hook.id)||!['beforeTool','afterTool','turnComplete','verification'].includes(hook.event)||typeof hook.tool!=='string'||hook.tool.length>100||typeof hook.command!=='string'||!hook.command.trim()||hook.command.length>16000||!Number.isSafeInteger(hook.timeoutMs)||hook.timeoutMs<1000||hook.timeoutMs>120000||typeof hook.enabled!=='boolean'))throw Error('Provide bounded hooks with unique IDs, explicit commands and 1–120 second timeouts');return structuredClone(hooks)}
 async save(hooks:ProjectHook[]):Promise<HookSettings>{const valid=this.validate(hooks),previous=await this.read(),value:HookSettings={version:1,revision:previous.revision+1,hooks:valid,trustedDigest:this.digest(valid)};await atomicMetadata(this.path,JSON.stringify(value));return value}
 async matching(event:ProjectHook['event'],tool:string){const value=await this.read();if(value.trustedDigest!==this.digest(value.hooks))throw Error('Hook definitions changed. Review and trust them again.');return {revision:value.revision,hooks:value.hooks.filter(hook=>hook.enabled&&hook.event===event&&(hook.tool==='*'||hook.tool===tool))}}
 async enabled(){const value=await this.read();return value.hooks.some(hook=>hook.enabled)}
}
