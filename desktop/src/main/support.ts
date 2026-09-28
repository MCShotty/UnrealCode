import { arch,release } from 'node:os'
export type SupportFailure={at:string;category:string;code:string;reference?:string}
const failures:SupportFailure[]=[]
export function recordFailure(category:string,error:unknown):void {
 const code=error&&typeof error==='object'&&'code' in error?String(error.code):'operation_failed'
 // Store classifications, never raw exception strings, prompts, paths or output.
 const reference=String((error as {reference?:string})?.reference||'')
 failures.push({at:new Date().toISOString(),category:category.replace(/[^a-z:.-]/gi,'').slice(0,70),code:/^[A-Z_0-9]{1,40}$/.test(code)?code:'operation_failed',reference:/^[a-f0-9]{8}$/.test(reference)?reference:undefined});if(failures.length>50)failures.shift()
}
export function supportDocument(version:string,health:{backendReady:boolean;openProjects:number;migrationBlocked:boolean;updateState:string}):string {
 return JSON.stringify({format:1,generatedAt:new Date().toISOString(),app:{name:'UnrealCode',version},runtime:{platform:process.platform,architecture:arch(),osRelease:release(),electron:process.versions.electron,node:process.versions.node,bridgeProtocol:1},health,failures,excluded:['credentials','project paths and names','project content','conversation messages','tool output','environment variables','raw error messages']},null,2)
}
