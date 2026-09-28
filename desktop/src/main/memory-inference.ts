import {createServer,type Server} from 'node:http'
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto'
import type {MemoryProfile} from '../shared/memory'
import {credentialFor} from './settings'
import type {DockerBridge} from './docker'

export class MemoryInference {
 private server?:Server
 private active=0
 private results=new Map<string,{at:number;result:Promise<any>}>()
 readonly token=randomBytes(32).toString('hex')
 inputTokens=0;outputTokens=0;requests=0
 constructor(private profile:()=>MemoryProfile,private bridge:()=>Promise<DockerBridge>,private onUsage:()=>void){}
 async start():Promise<string>{
  this.server=createServer(async(req,res)=>{
   const secret=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${this.token}`)
   if(req.method!=='POST'||req.url!=='/v1/chat/completions'||secret.length!==expected.length||!timingSafeEqual(secret,expected)){res.writeHead(403).end();return}
   if(this.active>=2){res.writeHead(429).end();return}
   this.active++
   try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024*1024)throw Error('Memory request too large')}
    const input=JSON.parse(body),profile=this.profile()
    if(!Array.isArray(input.messages)||input.messages.length>100)throw Error('Invalid memory messages')
    const messages:any[]=[]
    for(const item of input.messages){
     if(!['system','user','assistant','tool'].includes(item.role))throw Error('Unsupported memory role')
     const content=item.content==null?'':typeof item.content==='string'?item.content:Array.isArray(item.content)&&item.content.every((part:any)=>part.type==='text'&&typeof part.text==='string')?item.content.map((part:any)=>part.text).join('\n'):null
     if(content===null)throw Error('Unsupported memory content')
     if(item.role==='tool'){if(typeof item.tool_call_id!=='string')throw Error('Missing memory tool identity');messages.push({Type:'tool_result',Data:{CallID:item.tool_call_id,Output:[{Kind:'text',Value:content}]}})}
     else {if(content)messages.push({Type:'message',Data:{Role:item.role,Text:content}});if(item.tool_calls){if(item.role!=='assistant'||!Array.isArray(item.tool_calls)||item.tool_calls.length>30)throw Error('Invalid memory tool calls');for(const call of item.tool_calls){if(typeof call.id!=='string'||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string')throw Error('Invalid memory tool call');messages.push({Type:'tool_call',Data:{CallID:call.id,Name:call.function.name,Arguments:call.function.arguments}})}}}
    }
    if(input.response_format)messages.unshift({Type:'message',Data:{Role:'system',Text:`Return only JSON matching this response schema: ${JSON.stringify(input.response_format)}`}})
    const tools=(input.tools||[]).map((item:any)=>({Type:'function',Name:item.function?.name,Description:item.function?.description,Parameters:item.function?.parameters}))
    const key=createHash('sha256').update(body).digest('hex');for(const [id,cached] of this.results)if(Date.now()-cached.at>300000)this.results.delete(id)
    let cached=this.results.get(key)
    if(!cached){if(this.requests>=profile.requestLimit||this.inputTokens+this.outputTokens>=profile.tokenLimit)throw Error('Memory inference limit reached');this.requests++;this.onUsage();const generated=(async()=>{const bridge=await this.bridge(),result=await bridge.request<any>('inference.generate',{config:{provider:profile.provider,model:profile.model,baseUrl:profile.baseUrl,thinkingLevel:profile.thinkingLevel,systemPrompt:'',disallowedTools:[]},credential:credentialFor(profile.provider,profile.baseUrl),request:{Model:{ID:profile.model},Input:messages,Tools:tools}},125000)
    this.inputTokens+=Number(result.Usage?.InputTokens||0);this.outputTokens+=Number(result.Usage?.OutputTokens||0);this.onUsage();return result})();cached={at:Date.now(),result:generated};this.results.set(key,cached)}
    let result:any
    try{result=await cached.result}
    catch(error){if(this.results.get(key)===cached)this.results.delete(key);throw error}
    const output=result.Output||[],toolCalls=output.filter((item:any)=>item.Type==='tool_call').map((item:any)=>({id:item.Data.CallID,type:'function',function:{name:item.Data.Name,arguments:item.Data.Arguments}})),text=output.filter((item:any)=>item.Type==='message').map((item:any)=>item.Data.Text||'').join('\n')
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:result.ID,object:'chat.completion',model:profile.model,choices:[{index:0,message:{role:'assistant',content:text||null,...(toolCalls.length?{tool_calls:toolCalls}:{})},finish_reason:toolCalls.length?'tool_calls':'stop'}],usage:{prompt_tokens:result.Usage?.InputTokens||0,completion_tokens:result.Usage?.OutputTokens||0,total_tokens:(result.Usage?.InputTokens||0)+(result.Usage?.OutputTokens||0)}}))
   }catch{res.writeHead(502,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'Memory inference unavailable or profile limit reached'}}))}finally{this.active--}
  })
  await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(0,'127.0.0.1',()=>resolve())})
  const address=this.server.address();if(!address||typeof address==='string')throw Error('Memory broker did not bind')
  return `http://host.docker.internal:${address.port}/v1`
 }
 close(){this.server?.closeAllConnections();this.server?.close();this.server=undefined}
}
