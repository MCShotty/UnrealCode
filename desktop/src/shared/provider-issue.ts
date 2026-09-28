export type ProviderIssue = {
  category: 'refusal'|'authentication'|'access'|'subscription'|'quota'|'rate_limit'|'context'|'options'|'transient'|'unknown'
  code: string; message: string; status?: number; requestId?: string; retryAfter?: string
}
// Provider fields have priority over text. Never treat a 403 as a filesystem error.
export function providerIssue(raw: unknown): ProviderIssue {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const field = (name:string) => v[name] ?? v[name[0].toLowerCase()+name.slice(1)]
  const code = String(field('Code') || field('Type') || '').slice(0,120), type=String(field('Type')||'')
  const status=Number(field('StatusCode')) || undefined, message=String(field('Message')||'The provider could not finish this request.')
  const tags=`${code} ${type}`.toLowerCase()
  let category:ProviderIssue['category']='unknown'
  if (/refus|content_filter|content_policy|cyber_policy|bio_policy|misalignment_policy/.test(tags)) category='refusal'
  else if (/invalid_api_key|invalid_token|authentication|token_expired/.test(tags)||status===401) category='authentication'
  else if (/usage_not_included|usage_limit_reached/.test(tags)) category='subscription'
  else if (/insufficient_quota|credit_balance|billing|insufficient_credit/.test(tags)||status===402) category='quota'
  else if (/permission|access_denied|model_not_found|model_not_available|unsupported_model/.test(tags)||status===403||status===404) category='access'
  else if (/context_length|context_window/.test(tags)) category='context'
  else if (/unsupported|invalid_request|invalid_parameter/.test(tags)) category='options'
  else if (/rate_limit|slow_down/.test(tags)||status===429) category='rate_limit'
  else if (/server_error|overload/.test(tags)||(status!==undefined&&status>=500)) category='transient'
  return {category,code,message,status,requestId:typeof field('RequestID')==='string'?String(field('RequestID')).slice(0,200):undefined,retryAfter:typeof field('RetryAfter')==='string'?String(field('RetryAfter')).slice(0,120):undefined}
}
