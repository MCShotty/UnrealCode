import {modelHealth} from './model-health'
import {modelCatalog} from './model-catalog'
import {documentedCapabilities,type ModelCapabilities} from '../shared/model-capabilities'
import type {Provider} from '../shared/api'
export async function modelCapabilities(provider:Provider,model:string,baseUrl=''):Promise<ModelCapabilities>{
 const result=documentedCapabilities(provider,model)
 if(['ollama','openai-compatible'].includes(provider)){try{const health=await modelHealth(provider,baseUrl,model,false);result.vision=health.capabilities.includes('vision');result.source='Local runtime capability report';result.checkedAt=health.checkedAt}catch{};return result}
 if(provider!=='openai-codex')return result
 const catalog=await modelCatalog(provider),selected=catalog.models.find(row=>row.id===model)
 if(!selected||catalog.state!=='ready'||selected.availability==='rejected')return {...result,fast:false,vision:false,reasoning:[],source:'Installed Codex catalog',message:selected?.reason||catalog.message}
 return {...result,fast:selected.fast,vision:selected.inputModalities.includes('image'),reasoning:selected.reasoning.filter(effort=>['low','medium','high','xhigh','max'].includes(effort)),checkedAt:catalog.checkedAt||'',source:'Installed Codex model/list',message:selected.fast?'Codex advertises a fast tier for this model.':'No fast tier is advertised for this model.'}
}
