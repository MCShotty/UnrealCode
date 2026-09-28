import {backendEnvironment} from './child-environment'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { modelHealth } from './model-health'
import { codexExecutable } from './account-usage'
import { documentedCapabilities, type ModelCapabilities } from '../shared/model-capabilities'
import type { Provider } from '../shared/api'

let cached:{until:number;models:any[]}|undefined
let pending:Promise<any[]>|undefined
async function catalog():Promise<any[]> {
  if(cached&&cached.until>Date.now())return cached.models
  if(pending)return pending
  pending=new Promise<any[]>((resolve,reject)=>{
    const binary=codexExecutable();if(!binary){reject(Error('Codex CLI unavailable'));return}
    const child=spawn(binary,['app-server','--stdio'],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:backendEnvironment()}),lines=createInterface({input:child.stdout})
    let done=false;const finish=(error?:Error,models:any[]=[])=>{if(done)return;done=true;clearTimeout(timer);lines.close();child.kill();error?reject(error):resolve(models)}
    const timer=setTimeout(()=>finish(Error('Model catalog timed out')),15000)
    const write=(value:unknown)=>{try{child.stdin.write(JSON.stringify(value)+'\n')}catch{finish(Error('Model catalog disconnected'))}}
    child.on('error',()=>finish(Error('Cannot start Codex catalog')));child.on('exit',()=>finish(Error('Model catalog disconnected')));child.stdin.on('error',()=>finish(Error('Model catalog disconnected')))
    lines.on('line',line=>{let message:any;try{message=JSON.parse(line)}catch{return};if(message.error){finish(Error('Model catalog unavailable'));return};if(message.id===1){write({method:'initialized',params:{}});write({id:2,method:'model/list',params:{includeHidden:false}})}else if(message.id===2)finish(undefined,Array.isArray(message.result?.data)?message.result.data:[])})
    write({id:1,method:'initialize',params:{clientInfo:{name:'unrealcode',version:'1.0.0-preview.1'}}})
  }).then(models=>{cached={until:Date.now()+300000,models};return models}).finally(()=>{pending=undefined})
  return pending
}
export async function modelCapabilities(provider:Provider,model:string,baseUrl=''):Promise<ModelCapabilities>{
  const result=documentedCapabilities(provider,model)
  if(['ollama','openai-compatible'].includes(provider)){try{const health=await modelHealth(provider,baseUrl,model,false);result.vision=health.capabilities.includes('vision');result.source='Local runtime capability report';result.checkedAt=health.checkedAt}catch{};return result}
  if(provider!=='openai-codex')return result
  try{const selected=(await catalog()).find(item=>item.id===model||item.model===model);if(!selected)return {...result,reasoning:[],message:'This model is not advertised by the installed Codex catalog.'}
    const tiers=selected.serviceTiers||selected.supportedServiceTiers||selected.availableServiceTiers||[]
    const fast=Array.isArray(tiers)&&tiers.some((tier:any)=>['fast','priority'].includes(typeof tier==='string'?tier:tier.id||tier.name||tier.serviceTier))
    return {...result,fast,vision:result.vision||(selected.inputModalities||[]).includes('image'),reasoning:(selected.supportedReasoningEfforts||[]).map((item:any)=>typeof item==='string'?item:item.reasoningEffort).filter((item:any)=>typeof item==='string'),source:'Installed Codex model/list',checkedAt:new Date().toISOString(),message:fast?'Installed Codex advertises Fast for this model. Usage limits still apply.':'Installed Codex does not advertise a Fast tier for this model.'}
  }catch{return {...result,fast:false,reasoning:[],message:'Codex catalog unavailable. Reconnect the CLI to verify model controls.'}}
}
