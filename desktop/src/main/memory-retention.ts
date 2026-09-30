import type { AgentEvent } from '../shared/api'

export function settledMemoryReply(idle:AgentEvent,events:AgentEvent[]):{seq:number;text:string}|undefined{
  if(idle.event!=='session.idle')return
  const outcome=(idle.payload as {outcome?:{state?:string;turnId?:string;messageIds?:string[]}}).outcome
  if(!outcome||!['completed','completed_with_warnings','failed','stopped'].includes(outcome.state||''))return
  const ids=new Set((outcome.messageIds||[]).filter(id=>typeof id==='string'&&id))
  if(!ids.size)return
  const relevant=events.filter(item=>item.sessionId===idle.sessionId&&item.seq<=idle.seq).sort((a,b)=>a.seq-b.seq)
  const anchor=relevant.find(item=>{const payload=item.payload as {Kind?:string;Data?:{Kind?:string;ID?:string}};return item.event==='session.item'&&payload.Kind==='input'&&payload.Data?.Kind==='external'&&ids.has(payload.Data.ID||'')})?.seq
  const turnId=outcome.turnId
  const replies=relevant.flatMap(item=>{
    const payload=item.payload as {Kind?:string;Data?:{TurnID?:string;Response?:{Output?:Array<{Type?:string;Data?:{Text?:string}}>} }}
    if(item.event!=='session.item'||payload.Kind!=='model_response')return []
    if(turnId&&payload.Data?.TurnID&&payload.Data.TurnID!==turnId)return []
    const matchesTurn=!!turnId&&payload.Data?.TurnID===turnId
    if(!matchesTurn&&(anchor===undefined||item.seq<=anchor))return []
    return (payload.Data?.Response?.Output||[]).filter(output=>output.Type==='message'&&typeof output.Data?.Text==='string'&&output.Data.Text.trim()).map(output=>({seq:item.seq,text:output.Data!.Text!}))
  })
  return replies.at(-1)
}
