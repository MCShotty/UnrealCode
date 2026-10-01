import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConversationUI } from '../shared/activity'
import { readBoundedJSON } from './bounded-file-read'

export class ConversationUIStore {
 private saving=Promise.resolve()
 constructor(private directory:string){}
 private path(id:string){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('Invalid conversation identity');return join(this.directory,id+'.json')}
 async get(id:string):Promise<ConversationUI>{await this.saving;try{return await readBoundedJSON<ConversationUI>(this.path(id),2*1024*1024)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {expanded:{},drafts:{}};throw error}}
 async patch(id:string,patch:Partial<ConversationUI>):Promise<void>{
  const path=this.path(id)
  if(!patch||typeof patch!=='object'||Buffer.byteLength(JSON.stringify(patch))>128*1024)throw Error('Conversation preference update is too large')
  for(const [key,value] of Object.entries(patch.expanded||{}))if(key.length>160||typeof value!=='boolean')throw Error('Invalid work disclosure state')
  for(const [key,value] of Object.entries(patch.feedExpanded||{}))if(key.length>160||typeof value!=='boolean')throw Error('Invalid work feed state')
  for(const [key,value] of Object.entries(patch.drafts||{}))if(key.length>160||!value||!Number.isSafeInteger(value.revision)||!/^[-a-zA-Z0-9]{1,64}$/.test(value.submissionId)||!Array.isArray(value.answers)||value.answers.length>3||value.answers.some(a=>typeof a.questionId!=='string'||a.questionId.length>64||(a.choiceId!==undefined&&(typeof a.choiceId!=='string'||a.choiceId.length>64))||(a.text!==undefined&&(typeof a.text!=='string'||a.text.length>8000))))throw Error('Invalid question draft')
  const job=this.saving.then(async()=>{let value:ConversationUI;try{value=await readBoundedJSON<ConversationUI>(path,2*1024*1024)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;value={expanded:{},drafts:{}}}value={expanded:{...value.expanded,...patch.expanded},feedExpanded:{...value.feedExpanded,...patch.feedExpanded},drafts:{...value.drafts,...patch.drafts}};const data=JSON.stringify(value);if(Buffer.byteLength(data)>2*1024*1024)throw Error('Conversation preferences exceed their storage limit');await fs.mkdir(this.directory,{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,data,{flag:'wx',mode:0o600});await fs.rename(temp,path)}finally{await fs.rm(temp,{force:true})}})
  this.saving=job.catch(()=>{});return job
 }
}
