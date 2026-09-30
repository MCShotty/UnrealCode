import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import type {ComputerCall,ComputerGrant,ComputerObservation,ComputerOwner,ComputerStatus,ComputerWindow} from '../shared/computer'
import {ensureGuidanceDataVersion} from './feature-data-version'
import {atomicMetadata} from './atomic-metadata'
import {readBoundedJSON} from './bounded-file-read'
import {redactContent} from './failures'
import {routineComputerAction,validComputerAction} from './computer-policy'

type Pending={method:string;resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout;cleanup:()=>void}
type Capture={data:string;owner:ComputerOwner;lease:string;generation:string;createdAt:number}
type NativeStatus={state:'ready'|'active'|'paused';message:string;leaseId?:string}
export class ComputerManager {
 onChanged:()=>void=()=>{}
 private settings={enabled:false}
 private loaded?:Promise<void>
 private starting?:Promise<void>
 private closing?:Promise<void>
 private lifecycle=0
 private child?:ChildProcessWithoutNullStreams
 private pending=new Map<string,Pending>()
 private generation=''
 private state:ComputerStatus['state']='disabled'
 private message='Enable Computer, then choose the windows a task may use.'
 private grant?:ComputerGrant
 private views=new Map<string,ComputerObservation>()
 private captures=new Map<string,Capture>()
 private captureTimer?:NodeJS.Timeout
 private waiting=new Map<string,{sessionId:string;project:string}>()
 private epoch=0
 private records:Record<string,'started'|'finished'>={}
 private writeTail:Promise<unknown>=Promise.resolve()
 private shortcut=false
 private readiness=false
 private startup?:ComputerStatus['startup']
 private legacy:Array<{id:string;name:string}>=[]
 constructor(private directory:string,private resources:string,private hotkey:{register:()=>boolean;unregister:()=>void},private environment=process.env){ }
 private load(){return this.loaded??=(async()=>{await ensureGuidanceDataVersion(this.directory);try{const value=await readBoundedJSON<{enabled:boolean}>(join(this.directory,'computer-settings','settings.json'),4096);if(typeof value.enabled!=='boolean')throw Error('Invalid computer settings');this.settings=value}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}try{this.records=await readBoundedJSON(join(this.directory,'computer-settings','dispatches.json'),4*1024*1024);if(!this.records||typeof this.records!=='object'||Array.isArray(this.records)||Object.entries(this.records).some(([key,state])=>{try{const id=JSON.parse(key);return !Array.isArray(id)||id.length!==3||typeof id[0]!=='string'||id.slice(1).some(v=>typeof v!=='string'||!(/^[a-f0-9-]{36}$/).test(v))||!['started','finished'].includes(state)}catch{return true}}))throw Error('Computer dispatch metadata is damaged; restore its private backup before using input')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}this.state=this.settings.enabled?'ready':'disabled'})()}
 private notify(){try{this.onChanged()}catch{/* Renderer closed. */}}
 async status():Promise<ComputerStatus>{await this.load();return {enabled:this.settings.enabled,state:this.state,message:this.message,generation:this.generation||undefined,startup:this.startup?{...this.startup}:undefined,activity:[...this.pending.values()].some(p=>p.method==='act'||p.method==='focus')?'Interacting with the selected window':[...this.pending.values()].some(p=>p.method==='observe')?'Observing the selected window':undefined,grant:this.grant?structuredClone(this.grant):undefined,shortcut:this.shortcut,waiting:[...this.waiting.values()],legacyConnections:this.legacy}}
 setLegacy(value:Array<{id:string;name:string}>){this.legacy=value}
 latest():ComputerObservation|null{const view=[...this.views.values()].at(-1);if(!view)return null;const capture=view.imageRef?this.captures.get(view.imageRef):undefined;return {...structuredClone(view),preview:capture?.data}}
 async enable(enabled:boolean){await this.load();if(typeof enabled!=='boolean')throw Error('Invalid Computer setting');await atomicMetadata(join(this.directory,'computer-settings','settings.json'),JSON.stringify({enabled}));this.settings={enabled};if(!enabled)await this.close();else await this.start();this.notify();return this.status()}
 async start(){const lifecycle=this.lifecycle;await this.load();if(lifecycle!==this.lifecycle)throw Error('Computer startup was cancelled');if(this.closing)await this.closing;if(!this.settings.enabled)throw Error('Enable Computer before using Windows applications');if(this.child&&this.generation)return;if(this.starting)return this.starting
   this.starting=this.launch(lifecycle).finally(()=>{this.starting=undefined});return this.starting
 }
 private async launch(lifecycle:number){
  this.state='starting';this.startup=undefined;this.notify()
  try{
   if(process.platform!=='win32')throw Error('Managed computer use requires Windows')
   const path=join(this.resources,'UnrealCode.ComputerHost.exe'),manifest=await readBoundedJSON<{sha256:string;protocol:number}>(join(this.resources,'manifest.json'),8192)
   if(manifest.protocol!==1||createHash('sha256').update(await fs.readFile(path)).digest('hex')!==manifest.sha256)throw Error('The bundled computer helper failed its integrity check. Reinstall UnrealCode.')
    if(lifecycle!==this.lifecycle||!this.settings.enabled)throw Error('Computer startup was cancelled')
   const env:NodeJS.ProcessEnv={};for(const name of ['SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','USERPROFILE'])if(this.environment[name])env[name]=this.environment[name]
   env.PATH=join(env.SystemRoot||'C:\\Windows','System32')
   const child=spawn(path,['--parent',String(process.pid)],{stdio:'pipe',windowsHide:true,env});this.child=child
   let buffer='',ready=false,startupFailure:Error|undefined
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{reject(Error('Computer helper startup timed out'));void this.close()},12000)
    const failed=()=>{clearTimeout(timer);if(!ready)reject(startupFailure||Error('Computer helper could not start'));if(this.child===child){this.child=undefined;this.generation='';this.readiness=false;this.invalidate(startupFailure?.message||'Computer helper stopped. Review access again.');for(const item of this.pending.values()){clearTimeout(item.timer);item.cleanup();item.reject(Error('Computer helper stopped. Inspect the window before retrying any action.'))}this.pending.clear();this.state=this.settings.enabled?'unavailable':'disabled';this.notify()}}
    child.once('error',failed);child.once('exit',failed);child.stderr.on('data',()=>{/* Never forward native diagnostics containing screen text. */})
    child.stdout.on('data',chunk=>{if(this.child!==child)return;buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>4*1024*1024){child.kill();return}let newline:number;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);try{
     const value=JSON.parse(line)
      if(value.event==='ready'){if(lifecycle!==this.lifecycle||!this.settings.enabled){clearTimeout(timer);reject(Error('Computer startup was cancelled'));child.kill();return}this.startup={protocol:typeof value.protocol==='number'?value.protocol:0,inputMonitor:value.inputMonitor===true,desktopReady:value.desktopReady===true,elevated:value.elevated!==false};if(value.protocol!==1||value.inputMonitor!==true||value.desktopReady!==true||value.elevated!==false){startupFailure=Error(value.protocol!==1?'The computer helper protocol is incompatible. Reinstall UnrealCode.':value.elevated!==false?'Start UnrealCode without Run as administrator before enabling Computer.':value.inputMonitor!==true?'Physical input monitoring is unavailable. Computer remains disabled; use an unlocked interactive Windows desktop.':'Desktop monitoring is unavailable. Unlock Windows and use a desktop with Explorer running before enabling Computer.');clearTimeout(timer);reject(startupFailure);child.kill();return}this.generation=String(value.generation);this.readiness=true;this.state='ready';this.message='Choose windows and review access for a task.';ready=true;clearTimeout(timer);resolve();this.notify()}
     else if(value.event==='status'){const status=value.status as NativeStatus;this.state=this.settings.enabled?status.state:'disabled';this.message=status.message;if(status.state==='paused'){this.epoch++;this.views.clear();this.captures.clear()}if(!status.leaseId&&this.grant)this.invalidate(status.message);this.notify()}
     else if(typeof value.id==='string'){const pending=this.pending.get(value.id);if(!pending)continue;this.pending.delete(value.id);clearTimeout(pending.timer);pending.cleanup();this.notify();if(value.error)pending.reject(Error(String(value.error.message||'Windows operation failed')));else pending.resolve(value.result)}
    }catch{child.kill()}}})
   })
   }catch(error){if(lifecycle!==this.lifecycle)throw Error('Computer startup was cancelled');this.state=this.settings.enabled?'unavailable':'disabled';this.message=String(error);this.notify();throw error}
 }
 private request<T=any>(method:string,payload:unknown={},signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const child=this.child;if(!child||!this.generation)throw Error('Computer helper is not connected');if(this.pending.size>=8&&!['stop','pause','cancel'].includes(method))throw Error('Computer is busy; wait for the current native operation')
  const id=randomUUID()
  return new Promise<T>((resolve,reject)=>{const abort=()=>{this.pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);if(child.stdin.writable)child.stdin.write(JSON.stringify({id:randomUUID(),method:'cancel',payload:{requestId:id}})+'\n');reject(Error('Computer operation cancelled. Observe before retrying any action.'))};const timer=setTimeout(()=>{abort();void this.pause()},35000);this.pending.set(id,{method,resolve,reject,timer,cleanup:()=>signal?.removeEventListener('abort',abort)});signal?.addEventListener('abort',abort,{once:true});this.notify();child.stdin.write(JSON.stringify({id,method,payload})+'\n',error=>{if(error)abort()})})
 }
 private invalidate(message:string){if(this.captureTimer)clearTimeout(this.captureTimer);this.captureTimer=undefined;this.epoch++;this.grant=undefined;this.views.clear();this.captures.clear();this.waiting.clear();this.message=message;this.hotkey.unregister();this.shortcut=false}
 async windows():Promise<ComputerWindow[]>{await this.start();return this.request('windows')}
 private matches(owner:ComputerOwner,grant=this.grant){return !!grant&&['project','workspace','workspaceId','sessionId','destination'].every(key=>owner[key as keyof ComputerOwner]===grant[key as keyof ComputerOwner])&&grant.generation===this.generation}
 async grantWindows(owner:ComputerOwner,ids:string[],control:boolean){
  await this.start();if(!/^[a-f0-9-]{36}$/.test(owner.sessionId)||!Array.isArray(ids)||ids.length<1||ids.length>8||new Set(ids).size!==ids.length||typeof control!=='boolean')throw Error('Choose one to eight windows for this task')
  if(this.grant&&!this.matches(owner))throw Error('Another task owns Computer. Stop its control before granting another task access.')
  const available=await this.windows(),windows=ids.map(id=>available.find(w=>w.id===id));if(windows.some(w=>!w||w.blocked))throw Error('A selected window is no longer available')
  if(control&&!this.shortcut){this.shortcut=this.hotkey.register();if(!this.shortcut)throw Error('Ctrl+Alt+Shift+. is unavailable. Release that shortcut before granting computer input.')}
  const id=randomUUID(),epoch=++this.epoch
  try{await this.request('grant',{leaseId:id,taskId:owner.sessionId,windows:ids,control});if(epoch!==this.epoch)throw Error('Computer access changed during the grant');this.grant={...owner,id,windows:windows as ComputerWindow[],control,generation:this.generation,createdAt:new Date().toISOString()};this.state='active';this.waiting.delete(owner.sessionId);this.views.clear();this.captures.clear();this.notify();return this.status()}catch(error){await this.stop();throw error}
 }
 async pause(){this.epoch++;this.views.clear();this.captures.clear();if(this.child&&this.generation)await this.request('pause').catch(()=>{});if(this.grant)this.state='paused';this.notify()}
 async resume(){if(!this.grant)throw Error('Review selected-window access first');await this.request('resume',{leaseId:this.grant.id});this.state='active';this.views.clear();this.notify()}
 async stop(){this.lifecycle++;this.invalidate('Computer control stopped. Execution will not resume automatically.');if(this.child&&this.generation)await this.request('stop').catch(()=>{});else this.child?.kill();await this.starting?.catch(()=>{});this.state=this.settings.enabled?'ready':'disabled';this.notify()}
 stopSession(project:string,sessionId:string){if(this.grant?.project===project&&this.grant.sessionId===sessionId)void this.stop()}
 private require(owner:ComputerOwner){if(!this.matches(owner)){this.waiting.set(owner.sessionId,{sessionId:owner.sessionId,project:owner.project});if(this.waiting.size>16)this.waiting.delete(this.waiting.keys().next().value!);this.notify();throw Error(this.grant?'Another task owns Computer. It must stop before this task can receive access.':'Choose windows and grant this task access in Computer.')}if(this.state!=='active')throw Error('You have control. Hand back explicitly in Computer before continuing.');return this.grant!}
 async preview(windowId:string):Promise<ComputerObservation>{await this.start();const result=await this.request<ComputerObservation&{image?:string}>('observe',{windowId,local:true,image:true});const {image,...rest}=result;return {...rest,preview:image}}
 private saveCapture(data:string,owner:ComputerOwner,lease:string){if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)||Buffer.byteLength(data)>3*1024*1024)throw Error('Invalid bounded computer screenshot');for(const [id,capture] of this.captures)if(Date.now()-capture.createdAt>300000)this.captures.delete(id);while(this.captures.size>=8)this.captures.delete(this.captures.keys().next().value!);const id=randomUUID();this.captures.set(id,{data,owner,lease,generation:this.generation,createdAt:Date.now()});this.expireCaptures();return id}
 private expireCaptures(){if(this.captureTimer)clearTimeout(this.captureTimer);const now=Date.now();for(const [id,capture] of this.captures)if(now-capture.createdAt>=300000)this.captures.delete(id);if(this.captures.size){const at=Math.min(...[...this.captures.values()].map(c=>c.createdAt))+300000;this.captureTimer=setTimeout(()=>{this.expireCaptures();this.notify()},Math.max(1,at-Date.now()));this.captureTimer.unref()}}
 resolveImage(owner:ComputerOwner,id:string){const capture=this.captures.get(id);if(!capture||!this.matches(owner)||capture.lease!==this.grant?.id||capture.generation!==this.generation||capture.owner.sessionId!==owner.sessionId||Date.now()-capture.createdAt>300000||this.state!=='active')return '';return capture.data}
 pin(owner:ComputerOwner,id:string){const data=this.resolveImage(owner,id);if(!data)throw Error('Capture expired. Observe the selected window again.');return data}
 review(owner:ComputerOwner,call:ComputerCall){this.require(owner);if(call.type!=='act')return false;const view=this.views.get(call.observationId||'');if(!view)throw Error('Observe the window again; this target expired');return !routineComputerAction(validComputerAction(call.action),view)}
 private persistDispatch(key:string,state:'started'|'finished'){const work=this.writeTail.catch(()=>{}).then(async()=>{if(state==='started'&&this.records[key])throw Error('This computer action was already attempted. Observe its outcome; it will not be replayed.');const next={...this.records,[key]:state};const keys=Object.keys(next);if(keys.length>20000)throw Error('Computer dispatch journal is full. Export support metadata before continuing.');await atomicMetadata(join(this.directory,'computer-settings','dispatches.json'),JSON.stringify(next));this.records=next});this.writeTail=work;return work}
 async call(owner:ComputerOwner,call:ComputerCall,operationId:string,signal:AbortSignal):Promise<unknown>{
  await this.load();signal.throwIfAborted();if(call.type==='status'){const status=await this.status();return {enabled:status.enabled,state:status.state,message:this.grant&&!this.matches(owner)?'Another task owns Computer. Review access in the Computer page.':status.message,ownsAccess:this.matches(owner),...(this.matches(owner)?{windows:this.grant!.windows.map(w=>({id:w.id,title:redactContent(w.title),process:w.process})),control:this.grant!.control}:{})}}const grant=this.require(owner),epoch=this.epoch
  if(call.type==='windows')return {windows:grant.windows.map(({handle,started,...window})=>({...window,title:redactContent(window.title)}))}
  if(call.type==='wait'){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,1000);function done(){signal.removeEventListener('abort',abort);resolve()}function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(Error('Computer wait cancelled'))}signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()});this.require(owner);return this.call(owner,{type:'status'},operationId,signal)}
  if(call.type==='observe'){
   if(!grant.windows.some(w=>w.id===call.windowId))throw Error('This window was not granted to the task')
   const result=await this.request<ComputerObservation&{image?:string}>('observe',{leaseId:grant.id,windowId:call.windowId,parentElement:call.parentElement,image:call.image===true},signal)
   this.require(owner);if(epoch!==this.epoch)throw Error('Observation discarded after control changed');const {image,...view}=result
   view.elements=view.elements.map(e=>({...e,name:redactContent(e.name)}));view.window.title=redactContent(view.window.title)
   const visible={...view,...(image?{imageRef:this.saveCapture(image,owner,grant.id)}:{})};this.views.set(view.id,visible);while(this.views.size>16)this.views.delete(this.views.keys().next().value!);this.notify();return visible
  }
  if(!grant.control)throw Error('This task has observation access only')
  const key=JSON.stringify([owner.project,owner.sessionId,operationId]);await this.persistDispatch(key,'started');signal.throwIfAborted();this.require(owner);if(epoch!==this.epoch)throw Error('Computer control changed before dispatch')
  try{
   if(call.type==='focus'){if(!grant.windows.some(w=>w.id===call.windowId))throw Error('Window access was not granted');return await this.request('focus',{leaseId:grant.id,windowId:call.windowId},signal)}
   if(call.type!=='act')throw Error('Unknown Computer operation')
   const action=validComputerAction(call.action),view=this.views.get(call.observationId||'');if(!view||Date.now()-Date.parse(view.created)>30000)throw Error('Take a fresh observation before acting')
   this.views.delete(view.id);return await this.request('act',{leaseId:grant.id,observationId:view.id,action},signal)
  }finally{await this.persistDispatch(key,'finished');this.notify()}
 }
 close():Promise<void>{
  if(this.closing)return this.closing
  this.lifecycle++;this.invalidate('Computer is stopped. Review access before using it again.')
  const opening=this.starting,child=this.child
  this.closing=(async()=>{
   if(child){
    if(this.generation)await this.request('stop').catch(()=>{});else child.kill()
    if(child.exitCode===null)await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);child.removeListener('exit',done);resolve()},timer=setTimeout(()=>{child.kill();done()},1500);child.once('exit',done);child.stdin.end()})
   }
   if(this.child===child)this.child=undefined
   this.generation='';this.readiness=false
   for(const item of this.pending.values()){clearTimeout(item.timer);item.cleanup();item.reject(Error('Computer stopped'))}this.pending.clear()
   await opening?.catch(()=>{});await this.writeTail.catch(()=>{})
   this.state=this.settings.enabled?'ready':'disabled';this.notify()
  })().finally(()=>{this.closing=undefined})
  return this.closing
 }
}
