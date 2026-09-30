import {BrowserWindow,WebContentsView,session,type DownloadItem,type Session} from 'electron'
import type {EventEmitter} from 'node:events'
import {randomUUID,createHash} from 'node:crypto'
import {join} from 'node:path'
import {promises as fs} from 'node:fs'
import {atomicMetadata} from './atomic-metadata'
import {readBoundedRegularFile} from './bounded-file-read'
import {browserOrigin,normalizeBrowserGrant} from './project-browser'
import {redactContent} from './failures'
import {editorPath} from './editor-files'
import {projectBytes,projectWrite} from './project-fs'
import {browserDescriptorText} from './browser-descriptor'
import type {BrowserAction,BrowserGrant,SharedBrowserCommand,SharedBrowserState,SharedBrowserTab} from '../shared/browser'

type Tab={id:string;view:WebContentsView;control:'user'|'agent';controlEpoch:number;errors:string[];agentInput:boolean}
const emptyGrant:BrowserGrant={enabled:false,origins:[],interactOrigins:[],ports:[]}
function http(value:string):string{if(typeof value!=='string'||value.length>8000)throw Error('Enter a bounded HTTP(S) address');browserOrigin(value);return value}
export class SharedProjectBrowser{
 private tabs=new Map<string,Tab>()
 private activeId?:string
 private window?:BrowserWindow
 private bounds?:{x:number;y:number;width:number;height:number}
 private attached?:string
 private grantEpoch=0
 private grant:BrowserGrant=structuredClone(emptyGrant)
 private loaded?:Promise<void>
 private downloads=new Map<string,{item:DownloadItem;tabId:string}>()
 private partition:string
 private browserSession:Session
 private grantFile:string
 onChanged:()=>void=()=>{}
 constructor(private project:string,private profile:string){const key=createHash('sha256').update(project.toLowerCase()).digest('hex').slice(0,24);this.partition=`persist:unrealcode-shared-${key}`;this.grantFile=join(profile,'shared-browser-grants',`${key}.json`);this.browserSession=session.fromPartition(this.partition);this.browserSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));this.browserSession.on('will-download',(_event,item,contents)=>{const tab=[...this.tabs.values()].find(value=>value.view.webContents.id===contents.id);if(!tab)return;const id=randomUUID();this.downloads.set(id,{item,tabId:tab.id});item.setSaveDialogOptions({defaultPath:item.getFilename()});item.once('done',()=>this.notify());this.notify()})}
 private notify(){try{this.onChanged()}catch{}}
 private setControl(tab:Tab,control:Tab['control']){tab.control=control;tab.controlEpoch++}
 private async load(){if(!this.loaded)this.loaded=(async()=>{try{this.grant=normalizeBrowserGrant(JSON.parse((await readBoundedRegularFile(this.grantFile,1024*1024)).toString('utf8')))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Shared browser grants are damaged. Review the saved file before granting agent access.')}})();return this.loaded}
 async configure(value:BrowserGrant){await this.load();const valid=normalizeBrowserGrant(value);await atomicMetadata(this.grantFile,JSON.stringify(valid));this.grant=valid;this.grantEpoch++;for(const tab of this.tabs.values())if(tab.control==='agent'&&!this.framesAllowed(tab))this.setControl(tab,'user');this.notify()}
 private allowed(value:string,interaction=false){let origin:string;try{origin=browserOrigin(value)}catch{return false}return this.grant.enabled&&(interaction?this.grant.interactOrigins:this.grant.origins).includes(origin)}
  canAnalyse(id:string){const tab=this.current(id);return tab.control==='agent'&&this.grant.enabled&&this.grant.cloudOrigins?.includes(browserOrigin(tab.view.webContents.getURL()))===true&&this.framesAllowed(tab)&&tab.view.webContents.mainFrame.framesInSubtree.every(frame=>!frame.url||frame.url==='about:blank'||this.grant.cloudOrigins?.includes(browserOrigin(frame.url)))}
 private framesAllowed(tab:Tab,interaction=false){const frames=tab.view.webContents.mainFrame?.framesInSubtree||[];return frames.every(frame=>!frame.url||frame.url==='about:blank'||this.allowed(frame.url,interaction))}
 private current(id?:string):Tab{const tab=this.tabs.get(id||this.activeId||'');if(!tab)throw Error('Choose a browser tab');return tab}
 private tabState(tab:Tab):SharedBrowserTab{const wc=tab.view.webContents;return {id:tab.id,url:wc.getURL(),title:wc.getTitle()||'New tab',loading:wc.isLoading(),canGoBack:wc.navigationHistory.canGoBack(),canGoForward:wc.navigationHistory.canGoForward(),zoom:wc.getZoomFactor(),control:tab.control}}
 async state():Promise<SharedBrowserState>{await this.load();return {tabs:[...this.tabs.values()].map(tab=>this.tabState(tab)),activeId:this.activeId,grant:structuredClone(this.grant),message:this.tabs.size?'Project browser ready':'Open an address to start browsing. Agent access is off until you grant origins and hand back a tab.'}}
 private create(control:'user'|'agent'='user'):Tab{
  if(this.tabs.size>=12)throw Error('Close a browser tab before opening another')
  const view=new WebContentsView({webPreferences:{partition:this.partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false}})
  const tab:Tab={id:randomUUID(),view,control,controlEpoch:0,errors:[],agentInput:false},wc=view.webContents
  this.tabs.set(tab.id,tab);this.activeId=tab.id
  wc.setWindowOpenHandler(({url})=>{try{void this.open(url).catch(()=>{});}catch{}return {action:'deny'}})
  wc.on('will-navigate',(event,url)=>{try{http(url)}catch{event.preventDefault();return}if(tab.control==='agent'&&!this.allowed(url)){event.preventDefault();tab.errors.push('Navigation to an ungranted origin was blocked');this.notify()}})
  ;(wc as EventEmitter).on('will-frame-navigate',(event:{preventDefault():void},details:{url:string})=>{if(tab.control==='agent'&&!this.allowed(details.url)&&details.url!=='about:blank'){event.preventDefault();tab.errors.push('Frame navigation to an ungranted origin was blocked');this.notify()}})
  wc.on('will-redirect',(event,url)=>{if(tab.control==='agent'&&!this.allowed(url)){event.preventDefault();tab.errors.push('Redirect to an ungranted origin was blocked');this.notify()}})
  wc.on('before-input-event',(_event,input)=>{if(!tab.agentInput&&input.type==='keyDown'&&tab.control==='agent'){this.setControl(tab,'user');this.notify()}})
  wc.on('before-mouse-event',(_event,mouse)=>{if(!tab.agentInput&&mouse.type==='mouseDown'&&tab.control==='agent'){this.setControl(tab,'user');this.notify()}})
  for(const name of ['did-navigate','did-navigate-in-page','page-title-updated','did-start-loading','did-stop-loading'] as const)(wc as EventEmitter).on(name,()=>this.notify())
  wc.on('render-process-gone',()=>{this.setControl(tab,'user');tab.errors.push('Page process stopped. Reload this tab.');this.notify()})
  wc.on('console-message',(_event,level,message)=>{if(level===3){tab.errors.push(redactContent(message).slice(0,300));if(tab.errors.length>30)tab.errors.shift()}})
  this.mount(tab);this.notify();return tab
 }
 private mount(tab:Tab){if(!this.window||!this.bounds||this.bounds.width<100||this.bounds.height<80)return;if(this.attached){const prior=this.tabs.get(this.attached);if(prior)this.window.contentView.removeChildView(prior.view)}this.window.contentView.addChildView(tab.view);tab.view.setBounds(this.bounds);this.attached=tab.id}
 show(window:BrowserWindow,id:string|undefined,bounds:{x:number;y:number;width:number;height:number}){
  if(![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)||bounds.width<100||bounds.height<80)throw Error('Invalid browser viewport')
  this.window=window;this.bounds={x:Math.round(bounds.x),y:Math.round(bounds.y),width:Math.round(bounds.width),height:Math.round(bounds.height)}
  const tab=this.tabs.get(id||this.activeId||'');if(tab){if(this.attached!==tab.id)this.mount(tab);else tab.view.setBounds(this.bounds)}
 }
 hide(){if(this.window&&this.attached){const tab=this.tabs.get(this.attached);if(tab)this.window.contentView.removeChildView(tab.view)}this.attached=undefined;this.window=undefined;this.bounds=undefined}
 async open(url:string,control:'user'|'agent'='user'){const target=http(url),tab=this.create(control);try{await tab.view.webContents.loadURL(target)}catch(error){tab.errors.push(redactContent(String(error)).slice(0,300))}this.notify();return this.tabState(tab)}
 async command(value:SharedBrowserCommand):Promise<SharedBrowserState>{
  await this.load();if(!value||typeof value.type!=='string')throw Error('Choose a browser action')
  if(value.type==='new'){await this.open(value.url||'https://example.com');return this.state()}
  const tab=this.current(value.tabId),wc=tab.view.webContents
  if(value.type==='select'){this.activeId=tab.id;this.mount(tab)}
  else if(value.type==='close'){if(this.attached===tab.id&&this.window){this.window.contentView.removeChildView(tab.view);this.attached=undefined}this.tabs.delete(tab.id);wc.close();this.activeId=this.tabs.keys().next().value;if(this.activeId&&this.window)this.mount(this.current(this.activeId))}
  else if(value.type==='navigate'){this.setControl(tab,'user');await wc.loadURL(http(value.url||''))}
  else if(value.type==='back'){this.setControl(tab,'user');if(wc.navigationHistory.canGoBack())wc.navigationHistory.goBack()}
  else if(value.type==='forward'){this.setControl(tab,'user');if(wc.navigationHistory.canGoForward())wc.navigationHistory.goForward()}
  else if(value.type==='reload'){this.setControl(tab,'user');wc.reload()}
  else if(value.type==='stop'){this.setControl(tab,'user');wc.stop()}
  else if(value.type==='find'){if(typeof value.query!=='string'||value.query.length>200)throw Error('Search phrase is too long');this.setControl(tab,'user');if(value.query)wc.findInPage(value.query);else wc.stopFindInPage('clearSelection')}
  else if(value.type==='zoom'){if(typeof value.zoom!=='number'||value.zoom<.5||value.zoom>3)throw Error('Choose zoom from 50% to 300%');this.setControl(tab,'user');wc.setZoomFactor(value.zoom)}
  else if(value.type==='takeover')this.setControl(tab,'user')
  else if(value.type==='handback'){if(!this.allowed(wc.getURL())||!this.framesAllowed(tab))throw Error('Grant observation for this tab and every loaded frame before handing it to the agent');this.setControl(tab,'agent')}
  else throw Error('Unknown browser action')
  this.notify();return this.state()
 }
  async actionNeedsReview(action:BrowserAction):Promise<boolean>{
   if(['upload','download','press'].includes(action.type))return true
   if(action.type!=='click')return false
   if(!action.selector)return true
   const tab=this.current(action.tabId),wc=tab.view.webContents,frame=wc.mainFrame.framesInSubtree[action.frameIndex||0]
   if(!frame||!this.allowed(frame.url,true))return true
   const selector=JSON.stringify(action.selector)
   return !!await frame.executeJavaScript(`(() => {const e=document.querySelector(${selector});if(!e)return true;const label=(e.getAttribute('aria-label')||e.innerText||e.getAttribute('value')||'').slice(0,200);return e.matches('button[type=submit],input[type=submit],input[type=file]')||/\\b(submit|send|buy|pay|delete|remove|publish|checkout|place order|confirm)\\b/i.test(label)})()`,true)
  }
 async agent(action:BrowserAction,project:string,signal?:AbortSignal):Promise<any>{
  await this.load();signal?.throwIfAborted()
  if(action.type==='navigate'&&!action.tabId){if(!this.allowed(http(action.url||'')))throw Error('Grant this exact origin before agent navigation');const epoch=this.grantEpoch,opened=await this.open(action.url!,'agent'),tab=this.current(opened.id);if(signal?.aborted||epoch!==this.grantEpoch||tab.control!=='agent'||!this.allowed(opened.url)||!this.framesAllowed(tab)){this.setControl(tab,'user');signal?.throwIfAborted();throw Error('Browser access changed or navigation failed; inspect the tab before retrying.')}return {tabId:opened.id,url:opened.url,title:opened.title}}
  const tab=this.current(action.tabId),wc=tab.view.webContents
  if(tab.control!=='agent')throw Error('The user controls this tab. Hand it back to the agent first.')
  if(!this.allowed(wc.getURL())||!this.framesAllowed(tab))throw Error('Agent access needs observation grants for the page and every frame')
  const interacting=['click','fill','press','upload','download'].includes(action.type)
  if(interacting&&(!this.allowed(wc.getURL(),true)||!this.framesAllowed(tab,true)))throw Error('Agent interaction needs grants for the page and every frame')
  const before=wc.getURL(),grantEpoch=this.grantEpoch,controlEpoch=tab.controlEpoch
  const assertAccess=(allowNavigation=false)=>{
   signal?.throwIfAborted()
   if(this.tabs.get(tab.id)!==tab||tab.control!=='agent'||tab.controlEpoch!==controlEpoch||this.grantEpoch!==grantEpoch)throw Error('Browser control or grants changed while the action was waiting. Observe again after explicit handback.')
   if(!allowNavigation&&wc.getURL()!==before||!this.allowed(wc.getURL(),interacting)||!this.framesAllowed(tab,interacting))throw Error('Browser page access changed during this action')
  }
  assertAccess()
  let result:any
  if(action.type==='navigate'){if(!this.allowed(http(action.url||'')))throw Error('Grant this exact origin before agent navigation');await wc.loadURL(action.url!);result={url:wc.getURL(),title:wc.getTitle()}}
  else if(action.type==='snapshot'){
   const frames=[]
   for(const [frameIndex,frame] of wc.mainFrame.framesInSubtree.entries()){if(!frame.url||frame.url==='about:blank')continue;if(!this.allowed(frame.url))throw Error('A loaded frame has an ungranted origin')
    const content=await frame.executeJavaScript(`(() => { const root=document.body;if(!root)return {text:'',elements:[]};const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&!e.closest('[aria-hidden=true]')};const elements=[];for(const e of root.querySelectorAll('a,button,input,select,textarea,[role=button],[contenteditable=true]')){if(elements.length>=120)break;if(!visible(e)||e.matches('input[type=password],input[type=hidden]'))continue;const i=elements.length;e.setAttribute('data-unrealcode-agent-i',String(i));let href='';try{const u=new URL(e.getAttribute('href')||'',location.href);if(e.hasAttribute('href')&&['http:','https:'].includes(u.protocol))href=u.origin+u.pathname}catch{}elements.push({i,tag:e.tagName.toLowerCase(),label:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||e.getAttribute('name')||'').trim().slice(0,120),type:e.getAttribute('type')||'',href,selector:'[data-unrealcode-agent-i="'+i+'"]',disabled:e.disabled===true})}const lines=[];const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=walk.nextNode())&&lines.length<250){const p=n.parentElement;if(!p||p.closest('script,style,noscript,[aria-hidden=true],input,textarea,select'))continue;if(!visible(p))continue;const t=n.textContent?.trim();if(t)lines.push(t.slice(0,220))}return {text:lines.join('\\n').slice(0,10000),elements} })()`,true) as {text:string;elements:Array<{i:number;tag:string;label:string;type:string;href:string;selector:string;disabled:boolean}>}
    assertAccess();frames.push({frameIndex,origin:browserOrigin(frame.url),text:browserDescriptorText(content.text).slice(0,10000),elements:content.elements.map(item=>({...item,label:browserDescriptorText(item.label),href:browserDescriptorText(item.href)}))})
   }
   result={url:before,frames,errors:tab.errors.slice(-20),downloads:[...this.downloads].filter(([,entry])=>entry.tabId===tab.id).map(([id,entry])=>({id,filename:entry.item.getFilename()}))}
  }
  else if(action.type==='screenshot'){const image=wc.capturePage();const png=(await image).toPNG();if(png.length>750000)throw Error('Screenshot exceeds the bounded evidence size');result={mimeType:'image/png',image:png.toString('base64')}}
  else if(action.type==='click'||action.type==='fill'){
   if(typeof action.selector!=='string'||!action.selector||action.selector.length>2000)throw Error('Choose a bounded selector')
   const selector=JSON.stringify(action.selector),frames=wc.mainFrame.framesInSubtree,frame=frames[action.frameIndex||0]
   if(!frame||!this.allowed(frame.url,true))throw Error('Target frame needs an interaction grant')
   if(action.type==='click')result=await frame.executeJavaScript(`(() => { const e=document.querySelector(${selector}); if(!e)throw Error('Element not found'); if(e.matches('input[type=password],input[type=hidden]'))throw Error('Protected field'); e.click(); return {clicked:true,tag:e.tagName.toLowerCase(),text:(e.innerText||'').slice(0,120)} })()`,true)
   else{if(typeof action.text!=='string'||action.text.length>16000)throw Error('Input is too large');const text=JSON.stringify(action.text);result=await frame.executeJavaScript(`(() => { const e=document.querySelector(${selector}); if(!e||!e.matches('input,textarea,[contenteditable=true]'))throw Error('Editable element not found'); if(e.matches('input[type=password],input[type=hidden]'))throw Error('Protected field'); e.focus(); if(e.isContentEditable)e.textContent=${text};else e.value=${text};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {filled:true} })()`,true)}
  }
  else if(action.type==='press'){if(typeof action.text!=='string'||action.text.length>80)throw Error('Choose a bounded key');tab.agentInput=true;try{wc.sendInputEvent({type:'keyDown',keyCode:action.text});wc.sendInputEvent({type:'keyUp',keyCode:action.text})}finally{tab.agentInput=false}result={pressed:true}}
  else if(action.type==='upload'){
   if(!action.path||!action.selector)throw Error('Choose a project file and input')
   await editorPath(project,action.path);const {bytes}=await projectBytes(project,action.path,20*1024*1024),temporary=join(this.profile,'shared-browser-upload',randomUUID())
   await fs.mkdir(join(this.profile,'shared-browser-upload'),{recursive:true});await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600})
   const debuggerClient=wc.debugger
   try{assertAccess();if(!debuggerClient.isAttached())debuggerClient.attach('1.3')
    const root=await debuggerClient.sendCommand('DOM.getDocument');assertAccess()
    const target=await debuggerClient.sendCommand('DOM.querySelector',{nodeId:root.root.nodeId,selector:action.selector});assertAccess()
    if(!target.nodeId)throw Error('File input not found')
    await debuggerClient.sendCommand('DOM.setFileInputFiles',{nodeId:target.nodeId,files:[temporary]});result={uploaded:true,name:action.path}}
   finally{const cleanup=setTimeout(()=>void fs.unlink(temporary).catch(()=>{}),60000);cleanup.unref()}
  }
  else if(action.type==='download'){
   const entry=this.downloads.get(action.downloadId||'');if(!entry||entry.tabId!==tab.id||!action.path)throw Error('Choose a download from this tab and a project destination')
   if(entry.item.getState()!=='completed')throw Error('Download has not finished')
   const source=entry.item.getSavePath();if(!source)throw Error('Download destination is unavailable')
   const bytes=await readBoundedRegularFile(source,20*1024*1024);await editorPath(project,action.path);assertAccess();await projectWrite(project,action.path,bytes,{expected:'missing'});result={saved:true,path:action.path};this.downloads.delete(action.downloadId!)
  }
  else if(action.type==='close'){await this.command({type:'close',tabId:tab.id});return {closed:true}}
  else if(action.type==='viewport')throw Error('Resize the shared browser pane to change its viewport')
  else throw Error('Unsupported shared browser action')
  assertAccess(action.type==='navigate'||action.type==='click'||action.type==='press')
  this.notify();return {tabId:tab.id,...result}
 }
 close(){this.hide();for(const tab of this.tabs.values())tab.view.webContents.close();this.tabs.clear();this.downloads.clear()}
}
