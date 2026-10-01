import {expect,it} from 'vitest'
import {meaningfulTimelineEvent} from './timeline-service'
it('does not turn advice, control records or streamed deltas into observer requests',()=>{
 for(const kind of ['advisory','control','crash'])expect(meaningfulTimelineEvent({v:1,seq:1,sessionId:'s',event:'session.item',payload:{Kind:'input',Data:{Kind:kind}}})).toBe(false)
 expect(meaningfulTimelineEvent({v:1,seq:1,sessionId:'s',event:'session.item',payload:{Kind:'input',Data:{Kind:'external'}}})).toBe(true)
 expect(meaningfulTimelineEvent({v:1,seq:0,sessionId:'s',event:'model.response.preview',payload:{text:'delta'}})).toBe(false)
})
