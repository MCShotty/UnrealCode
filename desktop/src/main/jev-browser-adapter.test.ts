import {expect,it,vi} from 'vitest'
import {browserDo,insertedText} from './jev-browser-adapter'
import type {DecisionResult} from '../shared/api'

const page={tabId:'tab',url:'https://example.com/tasks?token=SECRET',frames:[{frameIndex:0,origin:'https://example.com',text:'Tasks',elements:[{i:0,tag:'button',label:'Open item',type:'button',href:'',selector:'[data-unrealcode-agent-i="0"]',disabled:false}]}]}
const reply=(answers:Record<string,unknown>):DecisionResult=>({engine:'jev',model:'jev-fixture',answers,usage:{input_tokens:5,output_tokens:2},durationMs:1})
const base={done:{noul:.1},blocked:{noul:.1},login:{noul:.1},consequential:{noul:.1},action:{choice:'click'},target:{choice:'f0e0',probabilities:{f0e0:.9}}}
it('acts once in a granted driver, verifies the observed outcome, and omits URL tokens',async()=>{
 const driver={agent:vi.fn(async action=>action.type==='snapshot'?page:{clicked:true})}
 const decide=vi.fn().mockResolvedValueOnce(reply(base)).mockResolvedValueOnce(reply({done:{noul:.95}}))
 const result=await browserDo(driver as any,'project','tab','Open item',{},decide)
 expect(result).toMatchObject({status:'done',jevCalls:2,usage:{inputTokens:10,outputTokens:4}})
 expect(driver.agent.mock.calls.filter(([action])=>action.type==='click')).toHaveLength(1)
 expect(JSON.stringify(decide.mock.calls)).not.toContain('token=SECRET')
})
it('holds consequential clicks and never sends supplied secret values to Jev',async()=>{
 const driver={agent:vi.fn(async()=>page)},decide=vi.fn(async()=>reply({...base,consequential:{noul:.8}}))
 const result=await browserDo(driver as any,'project','tab','Submit task',{password:'PRIVATE_SECRET'},decide)
 expect(result.status).toBe('needs_confirmation')
 expect(driver.agent).toHaveBeenCalledTimes(1)
 expect(JSON.stringify(decide.mock.calls)).not.toContain('PRIVATE_SECRET')
})
it('bounds change descriptions',()=>{expect(insertedText('one two','one two three')).toBe('three')})
it.each([
 ['already complete',{...base,done:{noul:.95}},'done'],
 ['sign-in',{...base,login:{noul:.95}},'needs_login'],
 ['blocked',{...base,blocked:{noul:.95}},'blocked'],
 ['no safe action',{...base,action:{choice:'none'}},'uncertain']
] as const)('returns %s without acting on the page',async(_name,answers,status)=>{
 const driver={agent:vi.fn(async()=>page)}
 const result=await browserDo(driver as any,'project','tab','Open item',{},async()=>reply(answers))
 expect(result.status).toBe(status)
 expect(driver.agent).toHaveBeenCalledTimes(1)
})
it('returns a bounded error if the selected browser action fails',async()=>{
 const driver={agent:vi.fn(async action=>{if(action.type==='snapshot')return page;throw Error('Target disappeared')})}
 const result=await browserDo(driver as any,'project','tab','Open item',{},async()=>reply(base))
 expect(result).toMatchObject({status:'error',info:'Target disappeared',jevCalls:1})
})
