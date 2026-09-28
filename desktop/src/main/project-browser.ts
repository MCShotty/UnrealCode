import {chromium,type BrowserContext,type Page,type Download,type WebSocketRoute} from 'playwright-core'
import {promises as fs} from 'node:fs'
import {join,dirname,basename} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {storageLocation,timestampPath} from './storage-locations'
import {atomicMetadata} from './atomic-metadata'
import {readBoundedRegularFile} from './bounded-file-read'
import {backendEnvironment} from './child-environment'
import {redactContent} from './failures'
import {editorPath} from './editor-files'
import {projectBytes,projectWrite} from './project-fs'
import type {BrowserAction,BrowserGrant,BrowserState} from '../shared/browser'
const exec=promisify(execFile),runtimeRequire=createRequire(__filename)
const mime=runtimeRequire('mime-types') as {lookup(path:string):string|false}
export function browserOrigin(value:string):string{let url:URL;try{url=new URL(value)}catch{throw Error('Only valid HTTP(S) browser origins without credentials are allowed')}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Only HTTP(S) browser origins without credentials are allowed');return url.origin}
export function socketOrigin(value:string):string{const url=new URL(value);if(!['ws:','wss:'].includes(url.protocol))throw Error('Invalid socket URL');url.protocol=url.protocol==='wss:'?'https:':'http:';return browserOrigin(url.toString())}
export function browserFailureSummary(method:string,value:string,failure:string|undefined):string{
 let origin='blocked target';try{origin=browserOrigin(value)}catch{/* Do not include a rejected URL in activity logs. */}
 const verb=/^[A-Z]{1,12}$/.test(method)?method:'REQUEST'
 const code=/\bnet::ERR_[A-Z_]+\b|\bblockedbyclient\b/i.exec(failure||'')?.[0]||'Request failed'
 return `${verb} ${origin}: ${code}`
}
function grantOrigin(value:string):string{
 if(typeof value!=='string'||value.length>2048)throw Error('Enter a valid bare browser origin')
 let url:URL;try{url=new URL(value)}catch{throw Error('Enter a valid bare browser origin')}
 const origin=browserOrigin(value)
 if(url.pathname!=='/'||url.search||url.hash)throw Error('Enter a bare origin without a path, query, or fragment; access covers the whole origin')
 return origin
}
export function normalizeBrowserGrant(value:BrowserGrant):BrowserGrant{
 if(!value||typeof value.enabled!=='boolean'||!Array.isArray(value.origins)||value.origins.length>50||!Array.isArray(value.interactOrigins)||value.interactOrigins.length>50||!Array.isArray(value.ports)||value.ports.length>10||value.ports.some(port=>!Number.isInteger(port)||port<1024||port>65535))throw Error('Invalid browser permissions')
 const origins=[...new Set(value.origins.map(grantOrigin))],interactOrigins=[...new Set(value.interactOrigins.map(grantOrigin))]
 if(interactOrigins.some(origin=>!origins.includes(origin)))throw Error('Interaction needs a granted origin')
 return {enabled:value.enabled,origins,interactOrigins,ports:[...new Set(value.ports)]}
}
function intersection(a:BrowserGrant,b:BrowserGrant):BrowserGrant{return {enabled:a.enabled&&b.enabled,origins:a.origins.filter(origin=>b.origins.includes(origin)),interactOrigins:a.interactOrigins.filter(origin=>b.interactOrigins.includes(origin)),ports:a.ports.filter(port=>b.ports.includes(port))}}
export class ProjectBrowser {
 private parent?:ProjectBrowser
 private children=new Set<ProjectBrowser>()
 private sockets=new Map<WebSocketRoute,string>()
 private tabActions=new Map<string,Promise<unknown>>()
 inherit(parent:ProjectBrowser){this.parent?.children.delete(this);this.parent=parent;parent.children.add(this);this.revokeSockets()}
 private revokeSockets(){for(const [socket,origin] of this.sockets)if(!this.allowed(origin)){socket.close();this.sockets.delete(socket)}for(const child of this.children)child.revokeSockets()}
 private previewOrigins=new Set<string>()
 setPreviewOrigins(origins:string[]){if(origins.some(origin=>!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)))throw Error('Preview addresses must be loopback');this.previewOrigins=new Set(origins)}
 private allowed(origin:string,interaction=false):boolean{return this.grant.enabled&&(!this.parent||this.parent.allowed(origin,interaction))&&(this.previewOrigins.has(origin)||(interaction?this.grant.interactOrigins:this.grant.origins).includes(origin))}
 private context?:BrowserContext
 private tabs=new Map<string,{page:Page;sessionId:string;log:string[]}>()
 private downloads=new Map<string,{download:Download;sessionId:string}>()
 private grant:BrowserGrant={enabled:false,origins:[],interactOrigins:[],ports:[]}
 private loaded?:Promise<void>;private launching?:Promise<void>
 private invalidMetadata=false
 private configuration:Promise<void>=Promise.resolve()
 private message='Dedicated browser is stopped'
 readonly directory:string;private runtimeDirectory:string
 onChanged:()=>void=()=>{}
 private notify():void{try{this.onChanged()}catch{/* Renderer teardown cannot undo browser state or grants. */}}
 constructor(private profile:string,private project:string,private metadata:string){this.directory=storageLocation(profile,'browser-profiles',project);this.runtimeDirectory=storageLocation(profile,'browser-runtime','chromium-1243')}
 private executable(){return join(this.runtimeDirectory,'chromium-1243','chrome-win64','chrome.exe')}
 private async load(){if(!this.loaded)this.loaded=(async()=>{
  let content:string
  try{content=(await readBoundedRegularFile(this.metadata,1024*1024)).toString('utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  try{this.grant=normalizeBrowserGrant(JSON.parse(content))}
  catch{this.invalidMetadata=true;throw Error('Saved browser permissions are invalid. The original file is preserved; review and save new access to recover a dated copy.')}
 })();return this.loaded}
 async configure(value:BrowserGrant){
  const grant=normalizeBrowserGrant(value)
  const run=this.configuration.catch(()=>{}).then(async()=>{
   try{await this.load()}
   catch(error){if(!this.invalidMetadata)throw error;await fs.copyFile(this.metadata,timestampPath(dirname(this.metadata),'.browser-grants-invalid.json'))}
   const previous=this.grant
   this.grant=intersection(previous,grant)
   this.revokeSockets()
   try{await atomicMetadata(this.metadata,JSON.stringify(grant))}
   catch(error){this.grant=previous;this.notify();throw error}
   this.grant=grant
   if(this.invalidMetadata){this.invalidMetadata=false;this.loaded=Promise.resolve()}
   try{if(!grant.enabled)await this.close()}finally{this.notify()}
  })
  this.configuration=run.then(()=>{},()=>{})
  return run
 }
 async installed(){return fs.stat(this.executable()).then(stat=>stat.isFile(),()=>false)}
 async install(){await fs.mkdir(this.runtimeDirectory,{recursive:true});this.message='Downloading pinned Chromium runtime…';this.notify();try{const cli=join(dirname(runtimeRequire.resolve('playwright-core/package.json')),'cli.js');await exec(process.execPath,[cli,'install','chromium'],{windowsHide:true,timeout:600000,maxBuffer:4*1024*1024,env:{...backendEnvironment(),ELECTRON_RUN_AS_NODE:'1',PLAYWRIGHT_BROWSERS_PATH:this.runtimeDirectory}});if(!await this.installed())throw Error('Pinned Chromium executable was not installed');this.message='Chromium is ready'}catch{this.message='Browser download failed. Check network access and disk space, then retry.';throw Error(this.message)}finally{this.notify()}}
 async state(sessionId?:string):Promise<BrowserState>{await this.load();return {installed:await this.installed(),running:!!this.context,grant:structuredClone(this.grant),message:this.message,tabs:await Promise.all([...this.tabs].filter(([,tab])=>!sessionId||tab.sessionId===sessionId).map(async([id,tab])=>({id,sessionId:tab.sessionId,url:tab.page.url(),title:await tab.page.title().catch(()=> 'Browser tab')})))}}
 private async start(){await this.load();if(!this.grant.enabled)throw Error('Enable browser access for this project first');if(this.context)return;if(this.launching)return this.launching;this.launching=(async()=>{
  if(!await this.installed())throw Error('Prepare the browser runtime in Browser settings')
  this.context=await chromium.launchPersistentContext(this.directory,{executablePath:this.executable(),headless:process.env.UNREAL_DESKTOP_BACKGROUND_CHECK==='1',viewport:{width:1280,height:800},serviceWorkers:'block',acceptDownloads:true,env:backendEnvironment()})
  await this.context.route('**/*',async route=>{try{if(this.allowed(browserOrigin(route.request().url()))){await route.continue();return}}catch{}await route.abort('blockedbyclient')})
  await this.context.routeWebSocket('**/*',socket=>{
   let origin:string
   try{origin=socketOrigin(socket.url());if(!this.allowed(origin))throw Error('Origin not granted')}catch{socket.close();return}
   this.sockets.set(socket,origin)
   const server=socket.connectToServer(),close=()=>{this.sockets.delete(socket);socket.close();server.close()}
   socket.onMessage(message=>{if(this.allowed(origin))server.send(message);else close()})
   server.onMessage(message=>{if(this.allowed(origin))socket.send(message);else close()})
   socket.onClose(()=>{this.sockets.delete(socket);server.close()})
   server.onClose(()=>{this.sockets.delete(socket);socket.close()})
  })
  this.context.on('page',page=>{void page.opener().then(opener=>{if(opener)return page.close()}).catch(()=>{})})
  this.context.on('close',()=>{this.context=undefined;this.tabs.clear();this.sockets.clear();this.message='Browser closed';this.notify()})
  this.message='Dedicated browser is running';this.notify()
 })().finally(()=>{this.launching=undefined});return this.launching}
 async call(sessionId:string,action:BrowserAction,signal?:AbortSignal):Promise<any>{
  const key=action?.tabId||randomUUID(),previous=this.tabActions.get(key)||Promise.resolve()
  const run=previous.catch(()=>{}).then(()=>this.perform(sessionId,action,signal))
  this.tabActions.set(key,run)
  try{return await run}finally{if(this.tabActions.get(key)===run)this.tabActions.delete(key)}
 }
 private async perform(sessionId:string,action:BrowserAction,signal?:AbortSignal):Promise<any>{
  signal?.throwIfAborted()
  if(!/^[a-f0-9-]{36}$/.test(sessionId)||!action||!['navigate','snapshot','screenshot','click','fill','press','viewport','upload','download','close','takeover'].includes(action.type))throw Error('Invalid browser action')
  await this.start();signal?.throwIfAborted();let id=action.tabId,tab=id?this.tabs.get(id):undefined;if(id&&(!tab||tab.sessionId!==sessionId))throw Error('Browser tab belongs to another session')
  const abort=()=>{if(tab){this.tabs.delete(id!);void tab.page.close().catch(()=>{})}}
  signal?.addEventListener('abort',abort,{once:true})
  try{
  if(action.type==='navigate'){
   if(typeof action.url!=='string'||action.url.length>8000||!this.allowed(browserOrigin(action.url)))throw Error('Grant this exact browser origin before navigation')
   if(!tab){const page=await this.context!.newPage();id=randomUUID();tab={page,sessionId,log:[]};this.tabs.set(id,tab);const log=tab.log;page.on('console',message=>{if(message.type()==='error'){log.push(redactContent(message.text()).slice(0,2000));if(log.length>100)log.shift()}});page.on('pageerror',error=>{log.push(redactContent(error.message).slice(0,2000));if(log.length>100)log.shift()});page.on('requestfailed',request=>{log.push(browserFailureSummary(request.method(),request.url(),request.failure()?.errorText));if(log.length>100)log.shift()});page.on('download',download=>{const key=randomUUID();this.downloads.set(key,{download,sessionId});this.notify()})}
   if(signal?.aborted){abort();signal.throwIfAborted()}
   await tab.page.goto(action.url,{waitUntil:'domcontentloaded',timeout:30000});signal?.throwIfAborted();this.notify();return {tabId:id,url:tab.page.url(),title:await tab.page.title()}
  }
  if(!tab)throw Error('Choose a browser tab first');const page=tab.page
  if(action.type==='close'){await page.close();this.tabs.delete(id!);return {closed:true}}
  if(!this.allowed(browserOrigin(page.url())))throw Error('Browser origin grant was revoked')
  if(action.type==='takeover'){await page.bringToFront();return {message:'The dedicated browser is ready for manual input'}}
  if(action.type==='snapshot')return {tabId:id,url:page.url(),snapshot:(await page.locator('body').ariaSnapshot()).slice(0,30000),errors:tab.log,downloads:[...this.downloads].filter(([,entry])=>entry.sessionId===sessionId).map(([key,entry])=>({id:key,filename:entry.download.suggestedFilename()}))}
  if(action.type==='screenshot'){const image=(await page.screenshot({type:'png',timeout:15000})).toString('base64');if(image.length>950000)throw Error('Screenshot exceeds the bounded evidence size. Choose a smaller viewport and capture again.');return {tabId:id,mimeType:'image/png',image}}
  if(action.type==='viewport'){if(!Number.isInteger(action.width)||!Number.isInteger(action.height)||action.width!<320||action.width!>2560||action.height!<240||action.height!>2160)throw Error('Choose a bounded viewport');await page.setViewportSize({width:action.width!,height:action.height!});return {resized:true}}
  if(!this.allowed(browserOrigin(page.url()),true))throw Error('This origin has observation access only; grant interaction explicitly')
  if(action.selector!==undefined&&(typeof action.selector!=='string'||action.selector.length>2000))throw Error('Invalid browser selector')
  if(action.text!==undefined&&(typeof action.text!=='string'||action.text.length>16000))throw Error('Browser input is too large')
  if(action.type==='click'){if(Number.isFinite(action.x)&&Number.isFinite(action.y)){const viewport=page.viewportSize()!;if(action.x!<0||action.x!>viewport.width||action.y!<0||action.y!>viewport.height)throw Error('Point outside viewport');await page.mouse.click(action.x!,action.y!)}else if(action.selector)await page.locator(action.selector).click({timeout:10000});else throw Error('Choose an element or viewport point')}
  else if(action.type==='fill'){if(!action.selector)throw Error('Choose an input element');await page.locator(action.selector).fill(action.text||'',{timeout:10000})}
  else if(action.type==='press'){if(!action.text)throw Error('Choose a key');await page.keyboard.press(action.text)}
  else if(action.type==='upload'){if(!action.selector||!action.path)throw Error('Choose a project file and input');await editorPath(this.project,action.path);const {bytes}=await projectBytes(this.project,action.path,20*1024*1024);signal?.throwIfAborted();await page.locator(action.selector).setInputFiles({name:basename(action.path),mimeType:mime.lookup(action.path)||'application/octet-stream',buffer:bytes},{timeout:10000})}
  else if(action.type==='download'){const entry=this.downloads.get(action.downloadId||'');if(!entry||entry.sessionId!==sessionId||!action.path)throw Error('Choose an owned download and project destination');await editorPath(this.project,action.path);const source=await entry.download.path();if(!source)throw Error('Download unavailable');const bytes=await readBoundedRegularFile(source,20*1024*1024);signal?.throwIfAborted();await projectWrite(this.project,action.path,bytes,{expected:'missing'});this.downloads.delete(action.downloadId!)}
  signal?.throwIfAborted();this.notify();return {tabId:id,completed:true}
  }finally{signal?.removeEventListener('abort',abort)}
 }
 async close(){await this.context?.close();this.context=undefined;this.tabs.clear();for(const entry of this.downloads.values())await entry.download.delete().catch(()=>{});this.downloads.clear()}
}
