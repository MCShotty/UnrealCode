import { it,expect } from 'vitest'
import type { AgentEvent } from '../shared/api'
import { parseEvents } from './chat-events'
const event=(seq:number,name:string,payload:unknown):AgentEvent=>({v:1,seq,event:name,sessionId:'s',payload})
const call=(seq:number,turn='turn')=>event(seq,'session.item',{Kind:'model_response',Data:{TurnID:turn,Response:{Output:[{Type:'tool_call',Data:{CallID:'call',Name:'TeamDispatch',Arguments:'{}'}}]}}})
const status=(seq:number,states:string[],turn='turn')=>event(seq,'session.item',{Kind:'tool_call_status',Data:{TurnID:turn,CallID:'call',Status:{WaitingFor:states.map((_,i)=>`${turn}-${i}`)},Operations:states.map((state,i)=>({ID:`${turn}-${i}`,Status:state}))}})
it('uses persisted terminal snapshots without turning completed cards back into running',()=>{
 const entries=parseEvents([call(1),status(2,['ready']),event(3,'operation.update',{ID:'turn-0',Status:'completed'}),status(4,['completed'])])
 expect(entries.filter(item=>item.kind==='tool')).toHaveLength(1);expect(entries[0].status).toBe('completed')
 expect(parseEvents([call(1),status(2,['completed'])])[0].status).toBe('completed')
})
it('keeps unfinished operations running even when the model emits a final answer',()=>{
 const final=event(3,'session.item',{Kind:'model_response',Data:{TurnID:'turn',Response:{Output:[{Type:'message',Data:{Text:'Done',Phase:'final_answer'}}]}}})
 expect(parseEvents([call(1),status(2,['completed','running']),final])[0].status).toBe('running')
 expect(parseEvents([call(1),status(2,['completed','canceled']),final])[0].status).toBe('canceled')
})
it('keeps repeated provider call IDs separate across turns and maps early telemetry',()=>{
 const entries=parseEvents([event(1,'operation.update',{ID:'first-0',Status:'failed'}),call(2,'first'),status(3,['failed'],'first'),call(4,'second'),status(5,['completed'],'second')])
 expect(entries.filter(item=>item.kind==='tool').map(item=>item.status)).toEqual(['failed','completed'])
})
