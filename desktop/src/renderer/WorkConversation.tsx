import {ProviderRecovery} from './ProviderRecovery'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, CircleHelp, RotateCcw } from 'lucide-react'
import {AnimatePresence,motion,useIsPresent} from 'motion/react'
import {CompactWorkFeed} from './CompactWorkFeed'
import {groupWorkFeed,protectedWorkEntry,workLabel as label,workSegmentKey,type FeedRow} from './work-feed'
import type { AgentEvent,SessionInfo } from '../shared/api'
import type { ConversationUI, QuestionAnswer, QuestionRequest, WorkSummary, WorkView } from '../shared/activity'
import type { ParsedEntry } from './chat-events'
import { spatial,instant,effects } from './motion'
import { ProgressIndicator } from './ProgressIndicator'
import { useReducedMotion } from './useReducedMotion'

const api=window.unreal
const emptyUI=():ConversationUI=>({expanded:{},drafts:{}})
export function useWorkView(id:string|undefined,events:AgentEvent[]){
 type State={id?:string;view?:WorkView;ui:ConversationUI;error:string;loaded:boolean}
 const [state,setState]=useState<State>(()=>({ui:emptyUI(),error:'',loaded:false}))
 const selection=useRef({id,generation:0,pending:false,dirty:false,patch:{} as Partial<ConversationUI>})
 if(selection.current.id!==id)selection.current={id,generation:selection.current.generation+1,pending:false,dirty:false,patch:{}}
 const first=events.find(e=>e.seq>0)?.seq,last=events.filter(e=>e.seq>0).at(-1)?.seq,range=useRef({first,last}),applied=useRef<{owner:typeof selection.current;first?:number;last?:number}|undefined>(undefined)
 range.current={first,last}
 const mergeUI=(current:ConversationUI,patch:Partial<ConversationUI>):ConversationUI=>({expanded:{...current.expanded,...patch.expanded},drafts:{...current.drafts,...patch.drafts},feedExpanded:{...current.feedExpanded,...patch.feedExpanded}})
 const refresh=()=>{
  const owner=selection.current;if(!owner.id)return
  if(owner.pending){owner.dirty=true;return}
  owner.pending=true;owner.dirty=false;const generation=owner.generation,snapshot={...range.current},current=()=>selection.current===owner&&owner.generation===generation
  void api.workView(owner.id,{...(snapshot.first?{from:snapshot.first}:{}),...(snapshot.last?{to:snapshot.last}:{})}).then(value=>{
   if(current()){applied.current={owner,...snapshot};setState(state=>state.id===owner.id?{...state,view:value,error:''}:state)}
  }).catch(error=>{if(current()&&!String(error).includes('cancelled'))setState(state=>state.id===owner.id?{...state,error:String(error)}:state)}).finally(()=>{owner.pending=false;if(current()&&owner.dirty)refresh()})
 }
 useEffect(()=>{
  let live=true;const owner=selection.current;setState({id,ui:emptyUI(),error:'',loaded:!id})
  if(id)void api.conversationUI(id).then(value=>{if(live&&selection.current===owner){const ui=mergeUI(value,owner.patch);owner.patch={};setState(state=>state.id===id?{...state,ui,loaded:true}:state)}}).catch(error=>{if(live&&selection.current===owner)setState(state=>state.id===id?{...state,error:String(error)}:state)})
  return()=>{live=false;owner.generation++}
 },[id])
 useEffect(()=>{const timer=setTimeout(refresh,100),interval=setInterval(refresh,2000);return()=>{clearTimeout(timer);clearInterval(interval)}},[id,first,last])
 const save=(patch:Partial<ConversationUI>)=>{
  const owner=selection.current;owner.patch=mergeUI(mergeUI(emptyUI(),owner.patch),patch)
  setState(state=>state.id===id?{...state,ui:mergeUI(state.ui,patch)}:state)
  if(id){const generation=owner.generation;void api.saveConversationUI(id,patch).catch(error=>{if(selection.current===owner&&owner.generation===generation)setState(state=>state.id===id?{...state,error:`Draft could not be saved: ${error}`}:state)})}
 }
 const value=state.id===id?state:{ui:emptyUI(),error:'',loaded:false,view:undefined},ready=value.loaded&&!!value.view&&value.view.cache.latest>=(last||0)&&applied.current?.owner===selection.current&&applied.current.first===first&&applied.current.last===last
 return {...value,save,refresh,ready}
}
export type WorkController=ReturnType<typeof useWorkView>
function WorkBody({children,reduced}:{children:ReactNode;reduced:boolean}){
 const present=useIsPresent()
 return <motion.div className="work-content" inert={!present} aria-hidden={!present||undefined} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={reduced?instant:effects.fast}>{children}</motion.div>
}
function selectedWithin(root:HTMLElement){
 const selected=window.getSelection()
 if(!selected||selected.isCollapsed)return false
 for(let i=0;i<selected.rangeCount;i++)try{if(selected.getRangeAt(i).intersectsNode(root))return true}catch{/* Detached ranges cannot hold a disclosure open. */}
 return false
}
function WorkDisclosure({work,expanded,onChange,children,disabled,animateProgress,anchors}:{work:WorkSummary;anchors:number[];expanded?:boolean;onChange(value:boolean):void;children:ReactNode;disabled?:boolean;animateProgress:boolean}){
 const ref=useRef<HTMLElement>(null),reduced=useReducedMotion(),[held,setHeld]=useState(false)
 const wasRunning=useRef(work.open),root=ref.current,scroller=root?.closest('.chat-scroll'),protect=wasRunning.current&&!work.open&&!!root&&!!scroller&&(root.contains(document.activeElement)||selectedWithin(root)||scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight>60),open=expanded??(work.open||held||protect)
 useLayoutEffect(()=>{if(wasRunning.current&&!work.open&&expanded===undefined){const root=ref.current,scroller=root?.closest('.chat-scroll');if(root&&scroller&&(root.contains(document.activeElement)||selectedWithin(root)||scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight>60))setHeld(true)}wasRunning.current=work.open},[work.open,expanded])
 return <section className={`work-section ${open?'expanded':''}`} ref={ref} data-work-id={work.id}><button className="work-disclosure" disabled={disabled} aria-expanded={open} onClick={()=>{setHeld(false);onChange(!open)}}><ProgressIndicator animate={animateProgress} state={work.state==='running'?'running':work.state==='waiting_input'?'waiting':work.state==='failed'?'error':work.state==='stopped'||work.state==='interrupted'?'stopped':work.state==='completed'?'success':'idle'}/><span>{label(work)}</span><motion.span initial={false} animate={{rotate:open?0:-90}} transition={reduced?instant:spatial.fast}><ChevronDown size={15}/></motion.span></button>{!open&&anchors.map(seq=><span key={seq} hidden data-event-seq={seq}/>)}<AnimatePresence initial={false}>{open&&<WorkBody reduced={reduced}>{children}</WorkBody>}</AnimatePresence></section>
}
function QuestionCard({q,controller,online,sessionActive,onStop,answerSequence}:{q:QuestionRequest;controller:WorkController;online:boolean;sessionActive:boolean;onStop():void;answerSequence?:number}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[summaryOpen,setSummaryOpen]=useState(false)
 const stored=controller.ui.drafts[q.id],draft=stored?.revision===q.revision?stored:undefined
 const [identity]=useState(()=>crypto.randomUUID()),answers:QuestionAnswer[]=draft?.answers||q.questions.map(item=>({questionId:item.id,text:''})),submissionId=draft?.submissionId||identity
 const answered=q.state==='answered',cancelled=q.state==='cancelled',interrupted=q.state==='interrupted'
 const update=(index:number,patch:Partial<QuestionAnswer>)=>{const next=answers.map((a,i)=>i===index?{...a,...patch}:a);controller.save({drafts:{[q.id]:{revision:q.revision,submissionId,answers:next}}})}
 const submit=async()=>{if(busy)return;setBusy(true);setError('');controller.save({drafts:{[q.id]:{revision:q.revision,submissionId,answers}}});try{await api.answerQuestion({sessionId:q.sessionId,workspaceId:q.workspaceId,id:q.id,revision:q.revision,submissionId,answers,resume:interrupted});controller.refresh()}catch(e){setError(String(e))}finally{setBusy(false)}}
 const complete=answers.length===q.questions.length&&answers.every(a=>a.choiceId||a.text?.trim())
 const dismiss=async()=>{setBusy(true);try{await api.dismissQuestion(q.sessionId,q.id);controller.refresh()}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section id={`question-${q.id}`} className={`question-card ${q.state}`} aria-label={answered?'Answered questions':'Your input is needed'} tabIndex={-1} data-event-seq={q.seq}>
  {answerSequence&&<span data-event-seq={answerSequence} aria-hidden="true"/>}
  <header><CircleHelp size={19}/><strong>{answered?'Answers recorded':cancelled?'Question dismissed':q.mode==='background'?'A question for you':'Your input is needed'}</strong><span className="activity-badge">{busy?'Submitting…':q.state}</span></header>
  {answered?<><button className="question-summary" aria-expanded={summaryOpen} onClick={()=>setSummaryOpen(!summaryOpen)}>{q.questions.map(item=>{const a=q.answers?.find(a=>a.questionId===item.id),choice=item.choices?.find(c=>c.id===a?.choiceId);return <span key={item.id}><strong>{item.title}</strong><span>{choice?.label}{choice&&a?.text?' — ':''}{a?.text}</span></span>})}<ChevronDown size={16}/></button>{summaryOpen&&<p className="muted-copy">Accepted {new Date(q.updatedAt).toLocaleString()}. These answers do not change tool permissions.</p>}</>:cancelled?<p>{q.questions.map(item=>item.title).join(' · ')}</p>:<form onSubmit={event=>{event.preventDefault();void submit()}}>
   {q.questions.map((item,index)=><fieldset key={item.id} disabled={busy||!controller.loaded}><legend>{item.title}</legend>{item.choices?.map(choice=><label className={`question-choice ${answers[index]?.choiceId===choice.id?'selected':''}`} key={choice.id}><input type="radio" name={`${q.id}-${item.id}`} checked={answers[index]?.choiceId===choice.id} onChange={()=>update(index,{choiceId:choice.id})}/><span><strong>{choice.label}</strong>{choice.recommended&&<small className="recommendation">Recommended</small>}{choice.description&&<span>{choice.description}</span>}</span></label>)}<label className="question-free"><span>{item.choices?.length?'Or write your own answer':'Your answer'}</span><textarea aria-label={`Your answer: ${item.title}`} maxLength={8000} value={answers[index]?.text||''} onChange={event=>update(index,{text:event.target.value,choiceId:undefined})} rows={2}/></label></fieldset>)}
   <div className="question-actions"><button type="submit" className="primary-button" disabled={busy||!online||!complete||!controller.loaded}>{busy?'Submitting…':interrupted?'Answer and resume':'Submit answers'}</button>{q.mode==='required'?<button type="button" className="secondary-button" disabled={busy||!online} onClick={onStop}>Stop task</button>:<button type="button" className="text-button" disabled={busy||!online} onClick={()=>void dismiss()}>Dismiss</button>}</div>
   {!online&&<p className="muted-copy">Your draft stays here. Connect Docker to submit it.</p>}{interrupted&&online&&<p className="muted-copy">This task is interrupted. Submitting explicitly resumes it; paused queues still require Resume.</p>}
  </form>}{error&&<p className="error-inline" role="alert">{error}</p>}
 </section>
}
export function WorkConversation({entries,controller,session,online,renderEntry,onStop}:{entries:ParsedEntry[];controller:WorkController;session:SessionInfo|undefined;online:boolean;renderEntry(entry:ParsedEntry):ReactNode;onStop():void}){
 const [retryBusy,setRetryBusy]=useState(false),[retryError,setRetryError]=useState(''),retryIds=useRef(new Map<number,string>())
 const view=controller.view,works=view?.works||[]
 const [revealSequence,setRevealSequence]=useState<number>(),[feedLimits,setFeedLimits]=useState<Record<string,number>>({})
 useEffect(()=>{const reveal=(event:Event)=>{const seq=(event as CustomEvent<number>).detail,work=works.find(w=>seq>=w.seq&&(!w.endSeq||seq<=w.endSeq));if(work){controller.save({expanded:{[work.id]:true},feedExpanded:{[work.id]:true}});setRevealSequence(seq)}};window.addEventListener('unreal:reveal-event',reveal);return()=>window.removeEventListener('unreal:reveal-event',reveal)},[works,session?.id])
 useEffect(()=>{if(controller.ready)window.dispatchEvent(new Event('unreal:work-ready'))},[view,controller.ready])
 const rows=useMemo(()=>{const statuses=new Map(view?.activity?.map(row=>[row.id,row.status]));return [...entries.filter(e=>e.kind!=='question'&&(!e.questionResponseId||!view?.questions.some(q=>q.id===e.questionResponseId))).map(entry=>{const status=statuses.get(entry.activityId||entry.id.replace(/^call:/,''));return {seq:entry.seq||Number(entry.id.split(':')[0])||0,entry:status&&entry.kind==='tool'?{...entry,status:status.replaceAll('_',' ')}:entry}}),...(view?.questions||[]).map(question=>({seq:question.seq,question}))].sort((a,b)=>a.seq-b.seq)},[entries,view])
 const parts:ReactNode[]=[];let group:ParsedEntry[]=[],current:WorkSummary|undefined,boundary:string|undefined;const indicated=new Set<string>()
 const feeds=new Map<string,{rows:FeedRow[];selection:{visible:Set<string>;peek?:string;total?:number;lastSegment?:string;page?:Set<string>;hasEarlier?:boolean;older?:boolean}}>()
 const flush=()=>{if(!group.length)return;const chunk=group;group=[];const w=current;if(!w){parts.push(...chunk.map(e=><div key={e.id} data-event-seq={e.seq}>{(e.eventSequences||[]).filter(seq=>seq!==e.seq).map(seq=><span key={seq} data-event-seq={seq} aria-hidden="true"/>)}{renderEntry(e)}</div>));return}const animateProgress=w.id===works.at(-1)?.id&&!indicated.has(w.id);indicated.add(w.id);const feed=feeds.get(w.id)||{rows:[],selection:{visible:new Set<string>()}};feed.rows.push(...groupWorkFeed(chunk));feed.selection.lastSegment=workSegmentKey(w,chunk,boundary);feeds.set(w.id,feed);parts.push(<WorkDisclosure anchors={[...new Set(chunk.flatMap(e=>[e.seq,...e.eventSequences||[]]).filter((seq):seq is number=>!!seq))]} animateProgress={animateProgress} key={workSegmentKey(w,chunk,boundary)} work={w} disabled={!controller.loaded} expanded={controller.ui.expanded[w.id]} onChange={value=>controller.save({expanded:{[w.id]:value}})}><CompactWorkFeed entries={chunk} selection={feed.selection} segment={workSegmentKey(w,chunk,boundary)} expanded={!!controller.ui.feedExpanded?.[w.id]} onExpand={value=>controller.save({feedExpanded:{[w.id]:value}})} renderEntry={renderEntry} revealSequence={revealSequence} onPage={()=>setFeedLimits(current=>({...current,[w.id]:(current[w.id]||20)+20}))} onOlder={()=>window.dispatchEvent(new CustomEvent('unreal:load-work-history',{detail:session?.id}))}/></WorkDisclosure>)}
 for(const row of rows){const work=works.find(w=>row.seq>=w.seq&&(!w.endSeq||row.seq<=w.endSeq));if(work?.id!==current?.id){flush();current=work;boundary=undefined}if('question'in row){flush();boundary='question:'+row.question.id;parts.push(<QuestionCard key={row.question.id} q={row.question} answerSequence={entries.find(e=>e.questionResponseId===row.question.id)?.seq} controller={controller} online={online} sessionActive={!!session?.active} onStop={onStop}/>);continue}const entry=row.entry;if(protectedWorkEntry(entry,work)){flush();boundary=entry.kind==='user'?work?.segments?.find(segment=>segment.seq===row.seq)?.id:entry.id;parts.push(<div key={entry.id} data-event-seq={row.seq}>{renderEntry(entry)}</div>)}else group.push(entry)}flush()
 for(const [id,feed] of feeds){const target=feed.rows.findIndex(row=>row.entries.some(entry=>entry.seq===revealSequence||entry.eventSequences?.includes(revealSequence||-1)));const limit=Math.max(feedLimits[id]||20,target>=0?feed.rows.length-target:0);feed.selection.page=new Set(feed.rows.slice(-limit).map(row=>row.id));feed.selection.hasEarlier=feed.rows.length>limit;feed.selection.older=!!works.find(work=>work.id===id&&work.seq<(entries[0]?.seq||work.seq));feed.selection.total=feed.rows.length;feed.rows.slice(-4).forEach(row=>feed.selection.visible.add(row.id));feed.selection.peek=feed.rows.at(-5)?.id}
 const failed=[...works].reverse().find(w=>w.state==='failed'&&w.failureSequence),latest=works.at(-1)
 if(latest?.open&&!indicated.has(latest.id))parts.push(<div className="work-pending" role="status" key={`pending:${latest.id}`}><ProgressIndicator state={latest.state==='waiting_input'?'waiting':'running'}/><span>{label(latest)}</span></div>)
 const retry=async()=>{if(!session||!failed?.failureSequence||retryBusy)return;const seq=failed.failureSequence;let id=retryIds.current.get(seq);if(!id){id=crypto.randomUUID();retryIds.current.set(seq,id)}setRetryBusy(true);setRetryError('');try{await api.retryResponse(session.id,seq,id);controller.refresh()}catch(e){setRetryError(String(e))}finally{setRetryBusy(false)}}
 return <><span hidden data-work-ready={controller.ready}/>{controller.error&&<p className="error-inline">{controller.error}</p>}{parts}{failed&&failed===latest&&session&&<ProviderRecovery sessionId={session.id} failure={entries.find(row=>row.seq===failed.failureSequence&&row.kind==='status')?.raw} online={online} busy={retryBusy} onRetry={()=>void retry()}/>} {retryError&&<p className="error-inline" role="alert">{retryError}</p>}</>
}
