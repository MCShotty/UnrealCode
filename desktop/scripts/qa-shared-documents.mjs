import {_electron as electron} from 'playwright'
import {createServer} from 'node:http'
import {mkdtempSync,writeFileSync,rmSync,copyFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'

function pdf(text){
 const body=`BT /F1 18 Tf 30 100 Td (${text}) Tj ET`,objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`]
 let value='%PDF-1.4\n';const offsets=[]
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(value));value+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
 const start=Buffer.byteLength(value)
 value+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
 return value
}
const desktop=resolve(import.meta.dirname,'..'),packaged=process.argv.includes('--packaged'),executablePath=packaged?resolve(process.env.UNREALCODE_QA_EXECUTABLE||join(desktop,'dist/win-unpacked/UnrealCode.exe')):join(desktop,'node_modules/electron/dist/electron.exe')
const root=mkdtempSync(join(tmpdir(),'unrealcode-shared-qa-')),profile=join(root,'profile'),workspace=join(root,'project')
const {mkdirSync}=await import('node:fs');mkdirSync(workspace);writeFileSync(join(workspace,'fixture.pdf'),pdf('Hello packaged PDF'))
copyFileSync(join(desktop,'test-fixtures/password.pdf'),join(workspace,'protected.pdf'))
let otherAddress=''
const otherServer=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<h1>Ungrantable test origin</h1>')})
await new Promise(resolve=>otherServer.listen(0,'127.0.0.1',resolve))
otherAddress=`http://127.0.0.1:${otherServer.address().port}`
const server=createServer((request,response)=>{if(request.url==='/redirect'){response.writeHead(302,{Location:otherAddress+'/outside'});response.end();return}response.setHeader('Content-Type','text/html');response.end(request.url==='/frame'?'<h1>Frame content</h1>':'<h1>Shared browser fixture</h1><button id="test-button">Open item</button><iframe src="/frame"></iframe>')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const address=`http://127.0.0.1:${server.address().port}`
let instance
try{
 instance=await electron.launch({executablePath,args:packaged?[]:['.'],cwd:packaged?dirname(executablePath):desktop,env:{...process.env,UNREAL_DESKTOP_USER_DATA:profile,UNREAL_DESKTOP_BACKGROUND_CHECK:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}})
 const page=await instance.firstWindow(),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.getByRole('heading',{name:'Choose a decision engine'}).waitFor({timeout:20000});await page.getByRole('button',{name:'Set up later'}).click()
 await instance.evaluate(({dialog})=>{dialog.showMessageBox=async(...args)=>{const title=args.at(-1)?.title;if(!['Trust this workspace?','Allow TypeSafe decisions?','Grant agent access to shared browser tabs'].includes(title))throw Error(`Unexpected dialog ${title}`);return {response:0,checkboxChecked:false}}})
 await page.evaluate(path=>window.unreal.openProject(path,true),workspace)
 // The direct preload call sets Electron-main state; reload lets React read it.
 await page.reload()
 try{await page.getByRole('button',{name:'Browser',exact:true}).waitFor({timeout:120000})}
 catch(error){throw Error(`Project navigation unavailable: ${(await page.locator('body').innerText()).slice(0,1200)}; ${String(error)}`)}
 await page.getByRole('button',{name:'Browser',exact:true}).click()
 const opened=await page.evaluate(url=>window.unreal.sharedBrowserCommand({type:'new',url}),address)
 if(opened.tabs[0]?.url!==address+'/')throw Error('Shared tab did not navigate to fixture')
 const tab=opened.tabs[0].id
 let viewCount=0
 for(let attempt=0;attempt<30;attempt++){viewCount=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.length);if(viewCount>=1)break;await page.waitForTimeout(100)}
 if(viewCount<1)throw Error(`WebContentsView was not mounted; state=${JSON.stringify(await page.evaluate(()=>window.unreal.sharedBrowserState()))}; errors=${await page.locator('.error-inline').allInnerTexts()}; viewport=${JSON.stringify(await page.locator('.shared-browser-viewport').boundingBox())}`)
 await page.evaluate(origin=>window.unreal.sharedBrowserConfigure({enabled:true,origins:[origin],interactOrigins:[origin],cloudOrigins:[],ports:[]}),address)
 const handed=await page.evaluate(id=>window.unreal.sharedBrowserCommand({type:'handback',tabId:id}),tab)
 if(handed.tabs.find(item=>item.id===tab)?.control!=='agent')throw Error('Browser handback failed')
 await instance.evaluate(async({BrowserWindow},url)=>{const wc=BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;await wc.executeJavaScript(`location.href=${JSON.stringify(url)}`).catch(()=>{})},address+'/redirect')
 await page.waitForTimeout(350)
 const redirected=await page.evaluate(()=>window.unreal.sharedBrowserState())
 if(!redirected.tabs.find(item=>item.id===tab)?.url.startsWith(address))throw Error('Agent redirect escaped the granted origin')
 await instance.evaluate(async({BrowserWindow},url)=>{const wc=BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;await wc.executeJavaScript(`document.querySelector('iframe').src=${JSON.stringify(url)}`).catch(()=>{})},otherAddress+'/frame')
 await page.waitForTimeout(350)
 const framed=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.mainFrame.framesInSubtree.map(frame=>frame.url))
 if(framed.length<2||framed.some(url=>url.startsWith(otherAddress)))throw Error(`Agent frame isolation failed: ${JSON.stringify(framed)}`)
 const taken=await page.evaluate(id=>window.unreal.sharedBrowserCommand({type:'takeover',tabId:id}),tab)
 if(taken.tabs.find(item=>item.id===tab)?.control!=='user')throw Error('Browser takeover failed')
 await page.evaluate(()=>window.unreal.sharedBrowserConfigure({enabled:false,origins:[],interactOrigins:[],cloudOrigins:[],ports:[]}))
 const revoked=await page.evaluate(()=>window.unreal.sharedBrowserState())
 if(revoked.grant.enabled)throw Error('Project origin grant revocation failed')
 await page.getByRole('button',{name:'Documents',exact:true}).click()
 await page.getByLabel('Project PDF path').fill('fixture.pdf')
 await page.getByRole('button',{name:'Open project PDF'}).click()
 await page.getByText('Hello packaged PDF').first().waitFor({timeout:30000})
 const canvasWidth=await page.locator('.document-sheet canvas').evaluate(element=>element.width)
 if(canvasWidth<100)throw Error('Packaged PDF page did not render')
 await page.getByRole('textbox',{name:'Search PDF'}).fill('packaged')
 await page.getByRole('button',{name:'Search',exact:true}).click()
 await page.getByRole('button',{name:/Page 1/}).first().waitFor({timeout:15000})
 const openedDocument=await page.evaluate(()=>window.unrealTransport.documentOpenProject('fixture.pdf'))
 if(!openedDocument.ok)throw Error(`Packaged document open failed: ${JSON.stringify(openedDocument.failure)}`)
 const handle=openedDocument.value
 const extracted=await page.evaluate(id=>window.unreal.documentPage(id,1),handle.id)
 if(extracted.text!=='Hello packaged PDF')throw Error(`PDF worker returned unexpected text: ${extracted.text}`)
 await page.getByLabel('Project PDF path').fill('protected.pdf')
 await page.getByLabel('Password, if required').fill('fixture-password')
 await page.getByRole('button',{name:'Open project PDF'}).click()
 await page.waitForFunction(()=>document.querySelector('.document-toolbar strong')?.getAttribute('title')==='protected.pdf',{}, {timeout:10000})
 await page.waitForFunction(()=>document.querySelector('.document-sheet canvas')?.width>100)
 if(await page.getByLabel('Password, if required').inputValue())throw Error('PDF password was not cleared after opening')
 let ocr
 if(process.env.UNREAL_QA_OCR==='1'){
  ocr=await page.evaluate(id=>window.unreal.documentOcr(id,1,'eng'),handle.id)
  if(!ocr.text.toLowerCase().includes('hello'))throw Error('Packaged OCR worker could not read the fixture')
  const arabic=await page.evaluate(id=>window.unreal.documentOcr(id,1,'ara'),handle.id)
  if(arabic.language!=='ara'||arabic.method!=='ocr')throw Error('Packaged Arabic OCR data did not load')
 }
 if(errors.length)throw Error(`Renderer errors: ${errors.join(' | ')}`)
 console.log(JSON.stringify({sharedBrowser:true,webContentsViews:viewCount,projectOriginGrant:true,redirectIsolation:true,frameIsolation:true,takeover:true,revocation:true,pdfPages:handle.pages,pdfText:extracted.text,passwordPdf:true,ocr:ocr?{language:ocr.language,confidence:ocr.confidence}:undefined}))
}finally{if(instance)await instance.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>otherServer.close(resolve));rmSync(root,{recursive:true,force:true})}
