import type {WorkSummary} from '../shared/activity'
import type {ParsedEntry} from './chat-events'
export function workLabel(w:WorkSummary){
 const warning=w.state==='completed_with_warnings'?' · warnings':''
 if(w.state==='waiting_input')return 'Waiting for your answer';if(w.state==='running')return 'Working…';if(w.state==='failed')return 'Failed';if(w.state==='stopped')return 'Stopped';if(w.state==='interrupted')return 'Interrupted'
 if(w.elapsedMs===undefined)return 'Worked · timing unavailable'+warning
 if(w.elapsedMs<1000)return 'Worked for '+Math.round(w.elapsedMs)+' ms'+warning
 const seconds=Math.floor(w.elapsedMs/1000),m=Math.floor(seconds/60);return `Worked for ${m?`${m}m `:''}${seconds%60}s${warning}`
}
export type FeedRow={id:string;entries:ParsedEntry[];label:string}
export function groupWorkFeed(entries:ParsedEntry[]):FeedRow[]{
 const rows:FeedRow[]=[]
 for(const entry of entries){const previous=rows.at(-1),last=previous?.entries.at(-1),reader=entry.kind==='tool'&&['ReadFile','ListFiles','RepositorySearch'].includes(entry.title)&&entry.status==='completed'
  const sameScope=last&&last.kind==='tool'&&last.status==='completed'&&last.title===entry.title&&last.id.split(':')[1]===entry.id.split(':')[1]&&!!entry.stageId&&last.stageId===entry.stageId&&!!(entry.raw as any)?.WorkspaceID&&JSON.stringify((last.raw as any)?.WorkspaceID)===JSON.stringify((entry.raw as any)?.WorkspaceID)
  if(reader&&previous&&sameScope&&previous.entries.length<20){previous.entries.push(entry);previous.label=`${entry.title==='ReadFile'?'Read':entry.title==='ListFiles'?'Listed':'Searched'} ${previous.entries.length} ${entry.title==='ReadFile'?'files':'locations'}`}
  else rows.push({id:entry.id,entries:[entry],label:entry.kind==='tool'?toolLabel(entry):entry.title})
 }return rows
}
function toolLabel(entry:ParsedEntry){
 let path='';try{const value=JSON.parse(entry.text);path=typeof value.path==='string'?value.path:''}catch{}
 return (({ReadFile:'Read',ListFiles:'List',RepositorySearch:'Search',WriteFile:'Write',EditFile:'Edit',Bash:'Run command'} as Record<string,string>)[entry.title]||entry.title)+(path?' '+path:'')
}
export function protectedWorkEntry(entry:ParsedEntry,work?:WorkSummary){return entry.kind==='user'||entry.status==='incomplete'||entry.kind==='status'&&entry.status==='error'||entry.kind==='tool'&&entry.status==='failed'&&work?.state!=='completed'||entry.phase==='final_answer'||entry.id===work?.finalMessageId||!!work?.finalMessageIds?.includes(entry.id)}
export function workSegmentKey(work:WorkSummary,entries:ParsedEntry[],boundary?:string){const seq=entries[0]?.seq||work.seq;const anchor=[...(work.segments||[])].reverse().find(row=>row.seq<seq||row.seq===seq&&!row.id.includes(':message:'));return `${work.id}:${boundary||anchor?.id||work.id}`}
