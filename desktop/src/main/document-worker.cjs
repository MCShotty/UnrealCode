const {parentPort,workerData}=require('node:worker_threads')
const {createCanvas}=require('@napi-rs/canvas')

async function run(){
 const {method,bytes,page,query,fromPage,limit,language,languagePath,password}=workerData
 if(method==='ocr-image')return ocr(Buffer.from(bytes),language,languagePath)
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs')
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),password:password||undefined,isEvalSupported:false,disableFontFace:true,useSystemFonts:true,stopAtErrors:true})
 let document
 try{
  document=await task.promise
  if(document.numPages>1000)throw Error('PDF exceeds the 1000-page reader limit')
  if(method==='metadata'){
   const metadata=await document.getMetadata().catch(()=>({info:{}}))
   return {pages:document.numPages,title:String(metadata.info?.Title||'').slice(0,200),fingerprint:document.fingerprints?.[0]||''}
  }
  const read=async number=>{
   if(!Number.isInteger(number)||number<1||number>document.numPages)throw Error('Choose a page within this PDF')
   const sheet=await document.getPage(number),content=await sheet.getTextContent()
   const text=content.items.map(item=>typeof item.str==='string'?item.str:'').filter(Boolean).join(' ').slice(0,32768)
   return {page:number,text,method:'embedded',truncated:content.items.reduce((count,item)=>count+(item.str?.length||0),0)>32768}
  }
  if(method==='page')return read(page)
  if(method==='search'){
   if(typeof query!=='string'||!query.trim()||query.length>200)throw Error('Enter a search query below 200 characters')
   const start=Math.max(1,Number(fromPage)||1),count=Math.max(1,Math.min(30,Number(limit)||10)),matches=[]
   for(let number=start;number<=document.numPages&&number<start+count;number++){
    const value=await read(number),index=value.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    if(index>=0)matches.push({page:number,excerpt:value.text.slice(Math.max(0,index-80),Math.min(value.text.length,index+query.length+120))})
   }
   return {matches,nextPage:start+count<=document.numPages?start+count:undefined}
  }
  if(method==='ocr-page'){
   if(!Number.isInteger(page)||page<1||page>document.numPages)throw Error('Choose a page within this PDF')
   const sheet=await document.getPage(page),base=sheet.getViewport({scale:1}),scale=Math.min(2,2200/Math.max(base.width,base.height))
   const viewport=sheet.getViewport({scale}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
   await sheet.render({canvasContext:canvas.getContext('2d'),canvas,viewport}).promise
   const result=await ocr(canvas.toBuffer('image/png'),language,languagePath)
   return {...result,page,method:'ocr'}
  }
  throw Error('Unknown document operation')
 }finally{/* The owning thread is terminated after its one bounded result. */}
}
async function ocr(image,language,languagePath){
 if(!['eng','ara'].includes(language)||typeof languagePath!=='string')throw Error('Choose English or Arabic OCR')
 const {createWorker}=require('tesseract.js')
 let worker
 try{
  worker=await createWorker(language,1,{langPath:languagePath,gzip:false,cacheMethod:'none'})
  const result=await worker.recognize(image)
  return {text:String(result.data.text||'').slice(0,32768),confidence:Number(result.data.confidence)||0,language,method:'ocr',truncated:String(result.data.text||'').length>32768}
 }finally{await worker?.terminate().catch(()=>{})}
}
run().then(value=>parentPort.postMessage({ok:true,value}),error=>parentPort.postMessage({ok:false,error:{message:String(error?.message||error),code:error?.code||''}}))
