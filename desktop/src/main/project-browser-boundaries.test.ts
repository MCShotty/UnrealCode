import {it,expect} from 'vitest'
import {existsSync,promises as fs} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer,type Server} from 'node:http'
import {createHash,randomUUID} from 'node:crypto'
import {chromium} from 'playwright-core'
import {ProjectBrowser} from './project-browser'

const shell=join(process.env.LOCALAPPDATA||'', 'ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe')
const executable=existsSync(chromium.executablePath())?chromium.executablePath():shell
const check=it.skipIf(!existsSync(executable))
async function listen(server:Server){await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));return `http://127.0.0.1:${(server.address() as {port:number}).port}`}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()))}
async function fixture(){const root=await fs.mkdtemp(join(tmpdir(),'unrealcode-browser-boundary-'));const browser=new ProjectBrowser(root,root,join(root,'grant.json'));(browser as any).executable=()=>executable;process.env.UNREAL_DESKTOP_BACKGROUND_CHECK='1';return {root,browser}}

check('blocks ungranted WebSockets while permitting granted connections and closing them on revocation',async()=>{
 const {root,browser}=await fixture();let deniedCount=0,allowedCount=0;const sockets=new Set<import('node:stream').Duplex>()
 const denied=createServer(),allowed=createServer((_req,res)=>res.end('Fixture'))
 for(const [server,mark] of [[denied,()=>deniedCount++],[allowed,()=>allowedCount++]] as const)server.on('upgrade',(req,socket)=>{mark();sockets.add(socket);socket.on('close',()=>sockets.delete(socket));const accept=createHash('sha1').update(String(req.headers['sec-websocket-key'])+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);socket.on('data',()=>{})})
 const no=await listen(denied),yes=await listen(allowed),session=randomUUID()
 try{
  await browser.configure({enabled:true,ports:[],origins:[yes],interactOrigins:[yes]})
  const tab=await browser.call(session,{type:'navigate',url:yes}),page=(browser as any).tabs.get(tab.tabId).page
  const deniedState=await page.evaluate((url:string)=>new Promise(resolve=>{const socket=new WebSocket(url);socket.onopen=()=>resolve('open');socket.onclose=()=>resolve('closed');socket.onerror=()=>resolve('error')}),no.replace('http:','ws:'))
  expect(deniedState).not.toBe('open');expect(deniedCount).toBe(0)
  await page.evaluate((url:string)=>new Promise<void>(resolve=>{const socket=new WebSocket(url);(globalThis as any).fixtureSocket=socket;socket.onopen=()=>resolve()}),yes.replace('http:','ws:'))
  expect(allowedCount).toBe(1)
  await browser.configure({enabled:true,ports:[],origins:[],interactOrigins:[]})
  await page.waitForFunction(()=> (globalThis as any).fixtureSocket.readyState===WebSocket.CLOSED)
 }finally{await browser.close();for(const socket of sockets)socket.destroy();await Promise.all([close(denied),close(allowed)]);await fs.rm(root,{recursive:true,force:true})}
},15_000)
check('cancels a delayed click without closing another session tab',async()=>{
 const {root,browser}=await fixture();let clicked=false
 const web=createServer((req,res)=>{if(req.url==='/acted'){clicked=true;res.end('ok');return}res.setHeader('content-type','text/html');res.end('<button style="display:none" onclick="fetch(\'/acted\')">Act</button><script>setTimeout(()=>document.querySelector("button").style.display="block",900)</script>')})
 const origin=await listen(web),session=randomUUID(),other=randomUUID()
 try{
  await browser.configure({enabled:true,ports:[],origins:[origin],interactOrigins:[origin]})
  const one=await browser.call(session,{type:'navigate',url:origin}),two=await browser.call(other,{type:'navigate',url:origin})
  const controller=new AbortController(),pending=browser.call(session,{type:'click',tabId:one.tabId,selector:'button'},controller.signal)
  const result=expect(pending).rejects.toThrow();setTimeout(()=>controller.abort(),100);await result
  await new Promise(resolve=>setTimeout(resolve,1000));expect(clicked).toBe(false)
  expect((await browser.state(other)).tabs[0].id).toBe(two.tabId)
  expect((await browser.call(other,{type:'snapshot',tabId:two.tabId})).snapshot).toContain('Act')
 }finally{await browser.close();await close(web);await fs.rm(root,{recursive:true,force:true})}
})
check('uploads approved project bytes with their filename and MIME type',async()=>{
 const {root,browser}=await fixture(),web=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<input type="file" accept="image/png">')})
 const origin=await listen(web),session=randomUUID();await fs.writeFile(join(root,'picture.png'),Buffer.from('synthetic PNG bytes'))
 try{
  await browser.configure({enabled:true,ports:[],origins:[origin],interactOrigins:[origin]})
  const tab=await browser.call(session,{type:'navigate',url:origin})
  await browser.call(session,{type:'upload',tabId:tab.tabId,selector:'input',path:'picture.png'})
  const selected=await (browser as any).tabs.get(tab.tabId).page.evaluate(async()=>{const file=(globalThis as any).document.querySelector('input').files[0];return {name:file.name,type:file.type,text:await file.text()}})
  expect(selected).toEqual({name:'picture.png',type:'image/png',text:'synthetic PNG bytes'})
 }finally{await browser.close();await close(web);await fs.rm(root,{recursive:true,force:true})}
})
