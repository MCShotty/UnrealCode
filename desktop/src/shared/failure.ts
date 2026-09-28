export type RecoveryAction = 'retry' | 'docker-open' | 'docker-help' | 'backend-rebuild' | 'settings' | 'recovery' | 'cache-rebuild' | 'support'
export type AppFailure = { code: string; scope: string; title: string; message: string; actions: RecoveryAction[]; retryable: boolean; reference: string; details?: string; providerIssue?: import('./provider-issue').ProviderIssue }
export type IPCResult<T> = { unrealResult: true; ok: true; value: T } | { unrealResult: true; ok: false; failure: AppFailure }
