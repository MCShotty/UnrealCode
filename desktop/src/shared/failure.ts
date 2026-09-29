export type RecoveryAction = 'retry' | 'docker-open' | 'docker-help' | 'backend-rebuild' | 'settings' | 'recovery' | 'cache-rebuild' | 'support'
export type AppFailure = { code: string; scope: string; title: string; message: string; actions: RecoveryAction[]; retryable: boolean; reference: string; details?: string; providerIssue?: import('./provider-issue').ProviderIssue }
export type IPCResult<T> = { unrealResult: true; ok: true; value: T } | { unrealResult: true; ok: false; failure: AppFailure }

// Only advisory/background failures may be muted. State-changing operations and
// failures affecting stored data or task execution remain visible.
const advisoryScopes=new Set(['decision.error','usage:snapshot','models:discover','models:health','models:catalog','memory:status','timeline:view','docker-storage'])
const criticalCodes=new Set(['DISK_FULL','MEMORY_LIMIT','ACCESS_DENIED','METADATA_DAMAGED','METADATA_TOO_LARGE','CACHE_DAMAGED','RECOVERY_REVIEW'])
export function isWarningFailure(failure:AppFailure):boolean{
  if(criticalCodes.has(failure.code)||failure.providerIssue)return false
  return advisoryScopes.has(failure.scope)||(failure.scope==='docker'&&['DOCKER_UNAVAILABLE','DOCKER_MISSING','DOCKER_WINDOWS_ENGINE','DOCKER_CONTEXT'].includes(failure.code))
}
export function showFailureNotice(failure:AppFailure,warningsEnabled=true):boolean{
  return failure.code!=='CANCELLED'&&(warningsEnabled||!isWarningFailure(failure))
}
