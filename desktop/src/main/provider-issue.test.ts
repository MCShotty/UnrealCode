import {expect,it} from 'vitest'
import {providerIssue} from '../shared/provider-issue'
import {providerFailure,withEventFailure} from './failures'
it.each([
 [{Code:'model_refusal',Message:'Declined'},'refusal'],[{Code:'cyber_policy',StatusCode:400},'refusal'],[{Code:'usage_limit_reached',StatusCode:429},'subscription'],[{Code:'insufficient_quota',StatusCode:429},'quota'],[{StatusCode:401},'authentication'],[{StatusCode:403},'access'],[{Code:'model_not_found'},'access'],[{StatusCode:429},'rate_limit'],[{Code:'context_length_exceeded'},'context'],[{Code:'invalid_request_error'},'options'],[{StatusCode:503},'transient']
])('classifies structured provider metadata %j',(raw,category)=>expect(providerIssue(raw).category).toBe(category))
it('retains safe metadata, redacts secrets, and does not treat refusal as retryable',()=>{
 const failure=providerFailure({Code:'model_refusal',Message:'Authorization: Bearer fixture-secret',RequestID:'request-one',RetryAfter:'30'})
 expect(failure.retryable).toBe(false);expect(failure.providerIssue?.requestId).toBe('request-one');expect(JSON.stringify(failure)).not.toContain('fixture-secret')
 const event=withEventFailure({v:1,seq:2,sessionId:'session',event:'session.item',payload:{Kind:'model_response',Data:{Response:{Failure:{Code:'usage_limit_reached',Message:'limit'},Usage:{InputTokens:7}}}}})
 expect(event.failure?.providerIssue?.category).toBe('subscription');expect((event.payload as any).Data.Response.Usage.InputTokens).toBe(7)
})
