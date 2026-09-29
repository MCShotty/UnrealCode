// Adapted from jev-browser 0.1.1, commit e35ab134f65033d29c528132d92bf06e8d6adcb5,
// src/page-model.mjs and src/session.mjs (MIT, copyright 2026 Ying-Kai Liao).
// UnrealCode supplies a main-owned Electron tab driver and its existing Jev broker.
// The upstream Playwright launcher and environment-key client are intentionally absent.
import type {BrowserAction} from '../shared/browser'
import type {DecisionBatch,DecisionResult} from '../shared/api'
import {redactContent} from './failures'

type Element={i:number;tag:string;label:string;type:string;href:string;selector:string;disabled:boolean}
type Frame={frameIndex:number;origin:string;text:string;elements:Element[]}
type Snapshot={tabId:string;url:string;frames:Frame[]}
export type BrowserDoResult={status:'done'|'uncertain'|'blocked'|'needs_confirmation'|'needs_login'|'error';goal:string;tabId:string;action?:{type:string;frameIndex:number;label:string};info:string;before:string;after?:string;jevCalls:number;usage:{inputTokens:number;outputTokens:number};durationMs:number}
type Driver={agent(action:BrowserAction,project:string,signal?:AbortSignal):Promise<any>}
type Decision=(batch:DecisionBatch)=>Promise<DecisionResult>
const answer=(result:DecisionResult,id:string):Record<string,any>=>{const value=result.answers[id];if(!value||typeof value!=='object')throw Error(`Jev did not answer ${id}`);return value as Record<string,any>}
const probability=(result:DecisionResult,id:string):number=>{const value=Number(answer(result,id).noul);if(!Number.isFinite(value)||value<0||value>1)throw Error(`Jev returned an invalid ${id} probability`);return value}
const chosen=(result:DecisionResult,id:string,allowed:Set<string>):string=>{const value=answer(result,id).choice;if(typeof value!=='string'||!allowed.has(value))throw Error(`Jev returned an invalid ${id} choice`);return value}
const tokens=(result:DecisionResult)=>({inputTokens:Number(result.usage?.input_tokens)||0,outputTokens:Number(result.usage?.output_tokens)||0})
const safeUrl=(value:string)=>{try{const url=new URL(value);return url.origin+url.pathname.replace(/[A-Za-z0-9_-]{24,}/g,'[redacted]')}catch{return 'unknown page'}}
// Word runs inserted in b relative to a (bounded LCS, adapted from upstream pageDiff).
export function insertedText(a:string,b:string,max=300):string{
 const A=a.split(' ').slice(0,300),B=b.split(' ').slice(0,300),n=A.length,m=B.length
 const dp=Array.from({length:n+1},()=>new Uint16Array(m+1))
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=A[i]===B[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1])
 const runs:string[]=[],cur:string[]=[];let i=0,j=0
 while(j<m){if(i<n&&A[i]===B[j]){if(cur.length){runs.push(cur.join(' '));cur.length=0}i++;j++}else if(i<n&&dp[i+1][j]>=dp[i][j+1])i++;else cur.push(B[j++])}
 if(cur.length)runs.push(cur.join(' '))
 return runs.join(' | ').slice(0,max)
}
function focused(page:Snapshot){return {url:safeUrl(page.url),frames:page.frames.slice(0,8).map(frame=>({frameIndex:frame.frameIndex,origin:frame.origin,text:frame.text.slice(0,2200),elements:frame.elements.slice(0,80).map(({i,tag,label,type,href,disabled})=>({i,tag,label:label.slice(0,100),type,href,disabled}))}))}}
export async function browserDo(driver:Driver,project:string,tabId:string,goal:string,values:Record<string,string>,decide:Decision,signal?:AbortSignal):Promise<BrowserDoResult>{
 if(typeof goal!=='string'||!goal.trim()||goal.length>1000||!tabId||Object.keys(values||{}).length>10||Object.values(values||{}).some(value=>typeof value!=='string'||value.length>16000))throw Error('BrowserDo needs one bounded goal, a tab, and at most ten bounded values')
 if(/(?:password|api.?key|bearer|access.?token|secret)\s*[:=]\s*\S+/i.test(goal))throw Error('Keep credentials out of BrowserDo goals. Use direct browser tools or take over the tab.')
 const safeGoal=redactContent(goal)
 const started=Date.now(),before=await driver.agent({type:'snapshot',tabId},project,signal) as Snapshot
 const elements=before.frames.flatMap(frame=>frame.elements.map(element=>({...element,frameIndex:frame.frameIndex}))).slice(0,200)
 const candidates=Object.fromEntries(elements.map(item=>[`f${item.frameIndex}e${item.i}`,`${item.tag}${item.type?` type=${item.type}`:''}: ${item.label||item.href||'(unnamed)'}`.slice(0,150)]))
 const actionNames=['click',...(Object.keys(values||{}).length?['fill']:[]),'wait','none']
 const questions:DecisionBatch['questions']={
  done:{type:'noul',instructions:'Does page show that task.goal is already achieved? Judge only visible page evidence.'},
  blocked:{type:'noul',instructions:'Is progress on task.goal blocked by a login, CAPTCHA, access denial, or page error requiring user help?'},
  login:{type:'noul',instructions:'Does the page require the user to sign in before task.goal can continue?'},
  consequential:{type:'noul',instructions:'Would the next browser action toward task.goal likely send, purchase, publish, delete, upload, or otherwise change external state in a hard-to-undo way?'},
  action:{type:'choice',instructions:'Which single next action best advances task.goal from the current page? Choose none if no safe action is evident.',criteria:Object.fromEntries(actionNames.map(name=>[name,name]))}
 }
 if(elements.length)questions.target={type:'choice',instructions:'Which one of page.frames[*].elements should the next action use? Choose none if no element fits.',criteria:{...candidates,none:'No suitable element'}}
 if(Object.keys(values||{}).length)questions.value={type:'choice',instructions:'If the next action fills a field, which task.valueKeys key should be used? No value contents are shown.',criteria:{...Object.fromEntries(Object.keys(values).map(key=>[key,key])),none:'No suitable value'}}
 const first=await decide({state:{page:focused(before),task:{goal:safeGoal,valueKeys:Object.keys(values||{})}},questions,sourceRefs:[`browser:${tabId}`]})
 const usage=tokens(first),base={goal,tabId,before:safeUrl(before.url),jevCalls:1,usage,durationMs:Date.now()-started}
 const done=probability(first,'done'),blocked=probability(first,'blocked'),consequential=probability(first,'consequential')
 if(done>=.85)return {...base,status:'done',info:'The current page appears to show the requested outcome.'}
 if(probability(first,'login')>=.8)return {...base,status:'needs_login',info:'The page needs a sign-in. Browse in this tab, then hand it back to the agent.'}
 if(blocked>=.75)return {...base,status:'blocked',info:'The page appears to need sign-in or other user intervention.'}
 const action=chosen(first,'action',new Set(actionNames))
 if(action==='none'||action==='wait')return {...base,status:'uncertain',info:action==='wait'?'The page may still be loading; inspect it again.':'No supported next action was identified.'}
 const id=questions.target?chosen(first,'target',new Set([...Object.keys(candidates),'none'])):'none'
 const target=elements.find(item=>`f${item.frameIndex}e${item.i}`===id)
 if(!target||target.disabled)return {...base,status:'uncertain',info:'The chosen target is unavailable. Inspect the page and use a precise browser action.'}
 const probabilityTarget=Number(answer(first,'target').probabilities?.[id]||0)
 if(probabilityTarget<.35)return {...base,status:'uncertain',info:'The target choice is uncertain. Inspect the page before acting.'}
 const candidate={type:action,frameIndex:target.frameIndex,label:target.label||target.tag}
 if(consequential>=.5||action==='click'&&/submit|send|buy|pay|delete|publish|confirm|place order/i.test(target.label)||target.type==='submit')return {...base,status:'needs_confirmation',action:candidate,info:'Review this consequential browser action before running it with a precise tool.'}
 const browserAction:BrowserAction={type:action==='fill'?'fill':'click',tabId,frameIndex:target.frameIndex,selector:target.selector}
 if(action==='fill'){
  const key=chosen(first,'value',new Set([...Object.keys(values),'none']))
  if(key==='none')return {...base,status:'uncertain',action:candidate,info:'No suitable supplied value was selected.'}
  browserAction.text=values[key]
 }
 try{await driver.agent(browserAction,project,signal)}catch(error){return {...base,status:'error',action:candidate,info:String(error instanceof Error?error.message:error).slice(0,220),durationMs:Date.now()-started}}
 const after=await driver.agent({type:'snapshot',tabId},project,signal) as Snapshot
 const change=insertedText(before.frames.map(frame=>frame.text).join(' '),after.frames.map(frame=>frame.text).join(' '))
 const second=await decide({state:{page:focused(after),task:{goal:safeGoal,lastAction:candidate},observedChange:change},questions:{done:{type:'noul',instructions:'After the last action, does the current page visibly show that task.goal is fully achieved? Require direct evidence.'}},sourceRefs:[`browser:${tabId}`]})
 const later=tokens(second),finalUsage={inputTokens:usage.inputTokens+later.inputTokens,outputTokens:usage.outputTokens+later.outputTokens}
 return {goal,tabId,before:safeUrl(before.url),after:safeUrl(after.url),action:candidate,status:probability(second,'done')>=.85?'done':'uncertain',info:change?`Observed page change: ${change}`:'Action ran; verify its effect in the page.',jevCalls:2,usage:finalUsage,durationMs:Date.now()-started}
}
