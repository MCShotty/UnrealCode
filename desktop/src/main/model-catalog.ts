import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {createHash} from 'node:crypto'
import {backendEnvironment} from './child-environment'
import {codexExecutable} from './account-usage'
import {codexCredential} from './settings'
import {discoverModels} from './models'
import {providerIssue} from '../shared/provider-issue'
import type {Provider} from '../shared/api'
import type {CatalogModel,ModelCatalog} from '../shared/model-catalog'

export function normalizeCatalogModel(value:any):CatalogModel|undefined {
 const id=value?.model||value?.id;if(typeof id!=='string'||!id||id.length>200)return
 const list=(input:any)=>Array.isArray(input)?input:[]
 return {id,name:typeof value.displayName==='string'?value.displayName.slice(0,200):id,description:typeof value.description==='string'?value.description.slice(0,1000):'',hidden:value.hidden===true,
  reasoning:list(value.supportedReasoningEfforts).map(x=>typeof x==='string'?x:x?.reasoningEffort).filter(x=>typeof x==='string'),inputModalities:list(value.inputModalities).filter(x=>typeof x==='string'),
  fast:list(value.serviceTiers||value.supportedServiceTiers||value.availableServiceTiers).some(x=>['fast','priority'].includes(typeof x==='string'?x:x?.id||x?.name||x?.serviceTier)),availability:'listed'}
}
export async function readCodexCatalog(binary=codexExecutable(),launch=spawn):Promise<CatalogModel[]> {
 if(!binary)throw Error('Install Codex and sign in to discover subscription models.')
 return new Promise((resolve,reject)=>{
  const child=launch(binary,['app-server','--stdio'],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:backendEnvironment()}),reader=createInterface({input:child.stdout!})
  const rows=new Map<string,CatalogModel>(),cursors=new Set<string>();let done=false,id=1,pages=0,bytes=0
  const timer=setTimeout(()=>finish(Error('Codex model discovery timed out. Reconnect and refresh.')),15000)
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);reader.close();child.kill();error?reject(error):resolve([...rows.values()])}
  const write=(method:string,params:unknown,notify=false)=>{try{child.stdin!.write(JSON.stringify({...(notify?{}:{id}),method,params})+'\n')}catch{finish(Error('Codex catalog disconnected'))}}
  const page=(cursor?:string)=>{if(++pages>100){finish(Error('Codex catalog exceeded 100 pages'));return}id++;write('model/list',{limit:100,includeHidden:true,...(cursor?{cursor}:{})})}
  reader.on('line',line=>{bytes+=Buffer.byteLength(line);if(bytes>4*1024*1024){finish(Error('Codex catalog exceeds its size limit'));return}let msg:any;try{msg=JSON.parse(line)}catch{return}if(msg.id!==id)return;if(msg.error){finish(Error('Codex rejected model discovery. Reconnect your login and refresh.'));return}if(id===1){write('initialized',{},true);page();return}if(!Array.isArray(msg.result?.data)){finish(Error('Codex returned an invalid model catalog'));return}for(const raw of msg.result.data){const row=normalizeCatalogModel(raw);if(row)rows.set(row.id,row)}const next=msg.result.nextCursor;if(next){if(typeof next!=='string'||cursors.has(next)){finish(Error('Codex returned a repeated catalog cursor'));return}cursors.add(next);page(next)}else finish()})
  child.once('error',()=>finish(Error('Cannot start the Codex CLI.')));child.once('exit',()=>finish(Error('Codex exited before returning models.')));child.stdin!.on('error',()=>finish(Error('Codex catalog disconnected')))
  write('initialize',{clientInfo:{name:'unrealcode',version:'1.0.1'}})
 })
}
let identity='',cache:ModelCatalog|undefined,pending:Promise<ModelCatalog>|undefined,until=0
const rejected=new Map<string,string>()
function account(){try{return createHash('sha256').update(JSON.stringify(codexCredential())).digest('hex')}catch{return 'unavailable'}}
function refreshIdentity(){const next=account();if(next!==identity){identity=next;cache=undefined;pending=undefined;until=0;rejected.clear()}return next}
export function recordModelRejection(provider:Provider,model:string,failure:unknown){if(provider!=='openai-codex')return;refreshIdentity();const issue=providerIssue(failure);if(issue.category==='access')rejected.set(model,'The provider rejected access for this account. Reconnect or refresh before trying again.')}
export async function modelCatalog(provider:Provider,baseUrl='',force=false):Promise<ModelCatalog>{
 if(!['openai-codex','ollama','openai-compatible'].includes(provider))return {provider,models:[],state:'unavailable',message:'Enter the model ID supplied by this provider. Account access is checked on use.'}
 if(provider!=='openai-codex'){try{return {provider,state:'ready',message:'Models reported by this endpoint. Access is checked on use.',checkedAt:new Date().toISOString(),models:(await discoverModels(provider,baseUrl)).map(id=>({id,name:id,description:'',hidden:false,reasoning:[],inputModalities:[],fast:false,availability:'listed'}))}}catch{return {provider,state:'unavailable',models:[],message:'Model discovery failed. Check the endpoint or enter a model ID manually.'}}}
 const owner=refreshIdentity();if(force){until=0;rejected.clear()}
 if(!pending&&(!cache||Date.now()>=until)){
  const work=readCodexCatalog().then(models=>({provider,models,state:'ready' as const,checkedAt:new Date().toISOString(),message:'Reported by your installed Codex CLI; access is checked when a request is made.'})).catch(()=>({...cache,provider,models:cache?.models||[],state:cache?'stale' as const:'unavailable' as const,message:'Codex catalog unavailable. Install or reconnect Codex, then refresh.'})).then(value=>{if(identity===owner){cache=value;until=Date.now()+(value.state==='ready'?300000:15000)}return value}).finally(()=>{if(pending===work)pending=undefined});pending=work
 }
 const value=pending?await pending:cache!;if(owner!==refreshIdentity())return modelCatalog(provider,baseUrl)
 const models=value.models.map(row=>rejected.has(row.id)?{...row,availability:'rejected' as const,reason:rejected.get(row.id)}:row)
 for(const [id,reason]of rejected)if(!models.some(row=>row.id===id))models.push({id,name:id,description:'',hidden:false,reasoning:[],inputModalities:[],fast:false,availability:'rejected',reason})
 return {...value,models}
}
