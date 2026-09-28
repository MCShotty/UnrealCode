import {dirname,posix} from 'node:path'
import {readFile} from './files'
import {createHash} from 'node:crypto'
export type InstructionSource={path:string;scope:string;content:string;revision:string}
export async function projectInstructions(project:string,paths:string[],excluded:(path:string)=>boolean):Promise<InstructionSource[]>{
 const candidates=new Set(['AGENTS.md'])
 for(const path of paths){let scope=posix.dirname(path.replaceAll('\\','/'));while(scope!=='.'&&scope!=='/'){candidates.add(`${scope}/AGENTS.md`);scope=posix.dirname(scope)}}
 const result:InstructionSource[]=[];let bytes=0
 for(const path of [...candidates].sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b))){if(excluded(path))continue;let content:string;try{content=await readFile(project,path)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error};bytes+=Buffer.byteLength(content);if(bytes>96000)throw Error('Applicable project instructions exceed 96 KB; shorten them or narrow context');result.push({path,scope:path.includes('/')?posix.dirname(path):'.',content,revision:createHash('sha256').update(content).digest('hex')})}
 return result
}
