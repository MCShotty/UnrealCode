import type { Provider } from './api'
export type ModelCapabilities={provider:Provider;model:string;fast:boolean;vision:boolean;reasoning:string[];source:string;checkedAt:string;message:string}
// Explicit documented models only. Compatible endpoints do not inherit the
// capabilities of a provider merely by choosing a similar model name.
export function documentedCapabilities(provider:Provider,model:string):ModelCapabilities {
  const openai=['gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-5.6-sol']
  const claude=['claude-opus-5-5','claude-opus-5','claude-opus-4-8']
  const fast=provider==='openai'&&openai.includes(model)||provider==='anthropic'&&claude.includes(model)
  return {provider,model,fast,vision:(['openai','openai-codex'].includes(provider)&&openai.includes(model))||(provider==='anthropic'&&claude.includes(model)),reasoning:provider==='openai'||provider==='openai-codex'?['low','medium','high','xhigh','max']:[],checkedAt:'2026-09-27',source:provider==='anthropic'?'https://platform.claude.com/docs/en/build-with-claude/fast-mode':'https://developers.openai.com/api/docs/guides/fast-mode',message:fast?'Provider supports this speed tier; account access is checked when requested. Fast processing can consume more paid usage.':'No verified Fast capability for this provider/model. No model or effort substitution will occur.'}
}
