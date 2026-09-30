import {expect,it} from 'vitest'
import type {AgentEvent} from '../shared/api'
import {settledMemoryReply} from './memory-retention'

const sessionId='session'
function input(seq:number,id:string):AgentEvent{return {v:1,event:'session.item',sessionId,seq,payload:{Kind:'input',Data:{Kind:'external',ID:id}}}}
function reply(seq:number,turnId:string,text:string):AgentEvent{return {v:1,event:'session.item',sessionId,seq,payload:{Kind:'model_response',Data:{TurnID:turnId,Response:{Output:[{Type:'message',Data:{Text:text}}]}}}}}
function idle(seq:number,state:string,messageIds:string[],turnId?:string):AgentEvent{return {v:1,event:'session.idle',sessionId,seq,payload:{outcome:{state,messageIds,turnId}}}}

it('selects only the settled turn reply instead of an older or later turn',()=>{
 const events=[input(1,'old'),reply(2,'old-turn','Old result'),input(3,'current'),reply(4,'current-turn','Current result'),input(6,'later'),reply(7,'later-turn','Later result')]
 expect(settledMemoryReply(idle(5,'completed',['current'],'current-turn'),events)).toEqual({seq:4,text:'Current result'})
 expect(settledMemoryReply(idle(5,'completed',['current'],undefined),events)).toEqual({seq:4,text:'Current result'})
})

it('does not retain a previous reply for a turn without its own answer',()=>{
 const events=[input(1,'old'),reply(2,'old-turn','Old result'),input(3,'current')]
 expect(settledMemoryReply(idle(4,'completed',['current'],'current-turn'),events)).toBeUndefined()
})

it('waits for a terminal outcome and rejects unrelated session events',()=>{
 const events=[input(1,'current'),reply(2,'current-turn','Current result')]
 expect(settledMemoryReply(idle(3,'running',['current'],'current-turn'),events)).toBeUndefined()
 expect(settledMemoryReply(idle(3,'completed',[],'current-turn'),events)).toBeUndefined()
 expect(settledMemoryReply(idle(3,'completed',['current'],'current-turn'),[{...events[1],sessionId:'other'}])).toBeUndefined()
})

it('uses a verified turn identity when the input anchor fell outside the bounded page',()=>{
 expect(settledMemoryReply(idle(300,'completed',['current'],'current-turn'),[reply(299,'current-turn','Current result')])).toEqual({seq:299,text:'Current result'})
})

it('does not let the anchor fallback replace a response from a known turn',()=>{
 const events=[input(1,'current'),reply(2,'current-turn','Current result'),reply(3,'different-turn','Unrelated result')]
 expect(settledMemoryReply(idle(4,'completed',['current'],'current-turn'),events)).toEqual({seq:2,text:'Current result'})
})
