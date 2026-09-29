import {afterEach,expect,it} from 'vitest'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DocumentReader} from './document-reader'

const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
function smallPdf(text:string):Buffer{
 const body=`BT /F1 18 Tf 30 100 Td (${text}) Tj ET`
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`
 ]
 let pdf='%PDF-1.4\n',offsets=[0]
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
 const xref=Buffer.byteLength(pdf)
 pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return Buffer.from(pdf)
}
it('reads and searches bounded PDF text off the Electron main thread',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-document-'));roots.push(root)
 const path=join(root,'report.pdf');await writeFile(path,smallPdf('Hello UnrealCode'))
 const reader=new DocumentReader(root),handle=await reader.openExternal(path)
 expect(handle).toMatchObject({pages:1,source:'external'})
 expect(await reader.page(handle.id,1)).toMatchObject({page:1,text:'Hello UnrealCode',method:'embedded'})
 expect((await reader.search(handle.id,'UnrealCode')).matches).toMatchObject([{page:1}])
 await expect(reader.page(handle.id,2)).rejects.toThrow('Choose a page')
 reader.close(handle.id)
 await expect(reader.page(handle.id,1)).rejects.toThrow('no longer open')
})
it('opens a project PDF through the confined stream reader',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-document-project-'));roots.push(root)
 await writeFile(join(root,'project.pdf'),smallPdf('Project stream'))
 const reader=new DocumentReader(root),handle=await reader.openProject(root,'project.pdf')
 expect(handle).toMatchObject({source:'project',pages:1})
 expect((await reader.page(handle.id,1)).text).toBe('Project stream')
})
it('cancels queued document work without consuming a worker slot',async()=>{
 const reader=new DocumentReader(tmpdir())
 const slot=(reader as unknown as {slot(signal?:AbortSignal):Promise<()=>void>}).slot.bind(reader)
 const releaseOne=await slot(),releaseTwo=await slot(),controller=new AbortController()
 const queued=slot(controller.signal)
 controller.abort()
 await expect(queued).rejects.toThrow('cancelled')
 releaseOne()
 const releaseThree=await slot()
 releaseThree();releaseTwo()
})
it('requires an in-memory password for an encrypted PDF and rejects malformed input',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-document-edge-'));roots.push(root)
 const reader=new DocumentReader(root),encrypted=join(process.cwd(),'test-fixtures/password.pdf')
 await expect(reader.openExternal(encrypted)).rejects.toThrow(/password/i)
 const handle=await reader.openExternal(encrypted,'fixture-password')
 expect(handle.pages).toBe(1)
 const broken=join(root,'broken.pdf');await writeFile(broken,'not a PDF')
 await expect(reader.openExternal(broken)).rejects.toThrow()
})
it.runIf(process.env.UNREAL_TEST_OCR==='1')('downloads checksum-pinned English data and reads a rendered PDF page',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unrealcode-document-ocr-'));roots.push(root)
 const path=join(root,'scan.pdf');await writeFile(path,smallPdf('Hello OCR'))
 const reader=new DocumentReader(root),handle=await reader.openExternal(path)
 const result=await reader.ocrPage(handle.id,1,'eng')
 expect(result).toMatchObject({page:1,language:'eng',method:'ocr'})
 expect(result.text.toLowerCase()).toContain('hello')
 expect(result.confidence).toBeGreaterThan(0)
})
