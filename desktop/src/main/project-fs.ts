import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {promises as fs} from 'node:fs'
import {join,resolve} from 'node:path'
import {backendEnvironment} from './child-environment'

type Reply={data?:string;mode?:number;handle?:string;size?:number;digest?:string;entries?:Array<{name:string;directory:boolean;size:number;mode:number;link:boolean;regular:boolean}>}
let child:ChildProcessWithoutNullStreams|undefined,next=0,buffer=''
const pending=new Map<number,{resolve(value:Reply):void;reject(reason:Error):void;timer:NodeJS.Timeout}>()
function start(){
 if(child)return child
 const resources=(process as NodeJS.Process & {resourcesPath?:string}).resourcesPath
 const binary=process.platform==='win32'?'unrealcode-host-files.exe':'unrealcode-host-files'
 const path=resources&&__dirname.includes('app.asar')?join(resources,'host-files',binary):resolve(__dirname,'../../generated',binary)
 const processChild=spawn(path,[],{windowsHide:true,env:backendEnvironment(),stdio:['pipe','pipe','pipe']});child=processChild;buffer=''
 const fail=()=>{if(child!==processChild)return;child=undefined;for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Confined file service is unavailable. Rebuild or reinstall UnrealCode, then retry.'))}pending.clear();processChild.kill()}
 processChild.on('error',fail);processChild.on('exit',fail);processChild.stdin.on('error',fail);processChild.stderr.resume()
 processChild.stdout.setEncoding('utf8')
 processChild.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>40*1024*1024){fail();return}for(;;){const newline=buffer.indexOf('\n');if(newline<0)break;const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);try{const value=JSON.parse(line),request=pending.get(value.id);if(!request)continue;pending.delete(value.id);clearTimeout(request.timer);if(value.error)request.reject(Object.assign(Error(value.error.message),{code:value.error.code}));else request.resolve(value.value||{})}catch{fail();return}}})
 processChild.unref();for(const stream of [processChild.stdin,processChild.stdout,processChild.stderr])(stream as unknown as {unref?:()=>void}).unref?.()
 return processChild
}
async function rootAuthority(root:string){
 const before=await fs.lstat(root,{bigint:true}),canonical=await fs.realpath(root),info=await fs.lstat(canonical,{bigint:true})
 if(!before.isDirectory()||before.isSymbolicLink()||!info.isDirectory()||info.isSymbolicLink()||before.ino!==info.ino||before.dev!==info.dev)throw Error('Trusted root changed or is not a regular directory')
 return {root:canonical,identity:process.platform==='win32'?`${info.dev}:${info.ino}`:''}
}
function request(method:string,options:Record<string,unknown>,timeoutMs=30000):Promise<Reply>{
 if(pending.size>=64)throw Error('Confined file service is busy; retry')
 const current=start(),id=++next
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{reject(Error('Confined file operation timed out; inspect the file before retrying'));closeProjectFiles()},timeoutMs);pending.set(id,{resolve,reject,timer});try{current.stdin.write(JSON.stringify({id,method,...options})+'\n')}catch(error){closeProjectFiles();reject(error)}})
}
async function call(root:string,path:string,method:string,options:Record<string,unknown>={},timeoutMs=30000){return request(method,{...await rootAuthority(root),path,...options},timeoutMs)}
export async function projectBytes(root:string,path:string,limit:number):Promise<{bytes:Buffer;mode:number}>{const value=await call(root,path,'read',{limit});return {bytes:Buffer.from(value.data||'','base64'),mode:value.mode!}}
export async function projectEntries(root:string,path=''){return ((await call(root,path,'list')).entries||[]).filter(item=>!item.link&&(item.regular||item.directory))}
export async function projectWrite(root:string,path:string,bytes:Buffer,options:{expected?:string;mode?:number;replaceDirectory?:boolean}={}):Promise<void>{await call(root,path,'write',{data:bytes.toString('base64'),...options})}
export async function projectDelete(root:string,path:string,expected?:string):Promise<void>{await call(root,path,'delete',{expected})}
export async function projectPrune(root:string,path:string):Promise<void>{await call(root,path,'prune')}
export async function confinedRemoveTree(root:string,path:string):Promise<void>{await call(root,path,'removeTree')}
export async function storageEntries(root:string,path=''){return (await call(root,path,'list',{allowGit:true})).entries||[]}
export async function storageHash(root:string,path:string){return (await call(root,path,'hash',{allowGit:true},300000)).digest!}
export async function storageCopy(root:string,path:string,destinationRoot:string,destinationPath:string){const authority=await rootAuthority(destinationRoot);await call(root,path,'copy',{allowGit:true,destinationRoot:authority.root,destinationIdentity:authority.identity,destinationPath},300000)}
export async function storageMkdir(root:string,path:string,recursive=false){await call(root,path,recursive?'mkdirAll':'mkdir',{allowGit:true})}
export async function openConfinedStream(root:string,path:string,write=false,allowGit=true){
 const opened=await call(root,path,write?'stream.openWrite':'stream.openRead',{allowGit}),handle=opened.handle!;let closed=false
 return {
  async stat(){return {size:opened.size!,isFile:()=>true}},
  async read(buffer:Buffer,offset:number,length:number,_position:null){const value=await request('stream.read',{handle,limit:length}),bytes=Buffer.from(value.data||'','base64');bytes.copy(buffer,offset);return {bytesRead:bytes.length}},
  async write(buffer:Buffer,offset:number,length:number){const value=await request('stream.write',{handle,data:buffer.subarray(offset,offset+length).toString('base64')});return {bytesWritten:value.size!}},
  async close(){if(closed)return;closed=true;await request('stream.close',{handle})}
 }
}
export function closeProjectFiles(){const current=child;child=undefined;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Application is closing; inspect pending file changes before retrying'))}pending.clear();current?.kill()}
