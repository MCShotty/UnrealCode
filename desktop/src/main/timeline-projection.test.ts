import {expect,it} from 'vitest'
import {createRequire} from 'node:module'
const project=createRequire(__filename)('./timeline-projection.cjs').project as (event:unknown)=>{kind:string;text:string}|null

it('shows typed stages without copying chat, tool output, or internal markers',()=>{
  const secret='PRIVATE_TRANSCRIPT_AND_TOKEN'
  const events=[
    {event:'session.item',payload:{Kind:'input',Data:{Kind:'external',Payload:secret}}},
    {event:'session.item',payload:{Kind:'model_response',Data:{Response:{Output:[{Type:'message',Data:{Text:secret}}]}}}},
    {event:'operation.started',payload:{Type:'ReadFile',State:{Input:{Command:secret}}}},
    {event:'operation.update',payload:{Status:'completed',State:{InlineOut:secret}}},
    {event:'session.idle',payload:{outcome:{state:'failed',detail:secret}}}
  ]
  const stages=events.map(project)
  expect(stages.map(stage=>stage?.kind)).toEqual(['request','response','tool','tool','failure'])
  expect(JSON.stringify(stages)).not.toContain(secret)
  expect(project({event:'operation.update',payload:{Status:'awaiting',State:{InlineOut:'{}'}}})).toBeNull()
})
