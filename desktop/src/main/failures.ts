import { randomUUID } from 'node:crypto'
import type { AppFailure, RecoveryAction } from '../shared/failure'
import type { AgentEvent } from '../shared/api'
import { providerIssue } from '../shared/provider-issue'

export function providerFailure(raw: unknown): AppFailure {
  const issue=providerIssue(raw)
  const labels:Record<typeof issue.category,[string,string]>={
    refusal:['Request declined','The provider declined this request. Review its response and edit the request if appropriate.'],
    authentication:['Reconnect your account','Your credential was rejected or expired. Reconnect in Settings, then explicitly retry.'],
    access:['Model access denied','This account or endpoint cannot use the selected model. Refresh the model catalog and review provider access.'],
    subscription:['Subscription limit reached','Review your subscription limits and reset time in Usage. Resume explicitly when access is available.'],
    quota:['Provider quota exhausted','Check your provider balance or billing quota. Resume explicitly after restoring access.'],
    rate_limit:['Provider rate limit reached','Wait for the reported reset or retry time, then explicitly retry.'],
    context:['Context limit reached','Review attached context or compact the conversation before retrying.'],
    options:['Model option unsupported','Review the model, reasoning, speed and tool settings before retrying.'],
    transient:['Provider temporarily unavailable','Your accepted answers and completed tools are saved. Retry the response when the service recovers.'],
    unknown:['Provider response failed','Review the provider response and settings before deliberately retrying.']
  }
  const [title,message]=labels[issue.category]
  return {code:`PROVIDER_${issue.category.toUpperCase()}`,scope:'provider',title,message,actions:issue.category==='refusal'?[]:['settings'],retryable:issue.category==='transient'||issue.category==='rate_limit',reference:randomUUID().slice(0,8),details:redactDiagnostic(issue.message),providerIssue:{...issue,message:redactDiagnostic(issue.message)}}
}

export function redactDiagnostic(value: string): string { return redactContent(value).slice(-4000) }
export function redactContent(value: string): string {
  return value.replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|secret)["']?\s*[:=]\s*)(["'])(.*?)\2/gi,'$1"[redacted]"')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/gi,'[redacted]')
    .replace(/\b(?:sk-(?:proj-|ant-|or-v1-)?|gh[pousr]_)[a-z0-9_-]{8,}/gi, '[redacted]')
    .replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|password|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',}\r\n]+/gi, '$1[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
}
export class ActionableError extends Error {
  constructor(readonly failure: AppFailure) { super(failure.message); this.name = 'ActionableError' }
}
export function classifyFailure(error: unknown, scope = 'application'): AppFailure {
  if (error instanceof ActionableError) return error.failure
  const raw = error instanceof Error ? error.message : String(error), value = `${scope} ${raw}`.toLowerCase()
  const providerCode=/provider response failed \(([^)]+)\)/i.exec(raw)?.[1];if(providerCode)return providerFailure({Code:providerCode,Message:raw})
  const systemCode = String((error as { code?: string })?.code || '')
  let code = 'UNEXPECTED', title = 'This action could not finish', message = 'Review the task’s current state and the details below before retrying. You can also export a support bundle.', actions: RecoveryAction[] = ['support'], retryable = false
  const match = (pattern: RegExp): boolean => pattern.test(value)
  const set = (c: string, t: string, m: string, a: RecoveryAction[], retry = false): void => { code=c;title=t;message=m;actions=a;retryable=retry }
  if(systemCode==='EACCES'||systemCode==='EPERM')set('ACCESS_DENIED','Access was denied','Check folder or service permissions and whether another process has locked the file, then retry the original action.',['support'],true)
  else if(systemCode==='ENOSPC'||match(/no space left|disk.*full|not enough space/))set('DISK_FULL','Storage is full','Free space on the affected drive, then retry the original action. Existing recovery data is retained.',['settings','support'],true)
  else if(systemCode==='ENOMEM'||match(/out of memory|oomkilled|cannot allocate memory/))set('MEMORY_LIMIT','Not enough memory','Close unused models or increase Docker’s memory allocation, then retry the original action.',['settings','docker-help'],true)
  else if(['ECONNREFUSED','ENOTFOUND','ENETUNREACH','ECONNRESET'].includes(systemCode))set('ENDPOINT_UNAVAILABLE','Service cannot be reached','Check the endpoint, network, and whether the local model or service is running, then retry the original action.',['settings','support'],true)
  else if(scope==='images:pick'&&match(/unsupported or damaged image/))set('IMAGE_UNSUPPORTED','Image could not be opened','Choose a valid still PNG, JPEG, or WebP image, then attach it again.',[])
  else if(scope==='images:pick'&&match(/size limit|image remains too large|image dimensions exceed|file grew beyond/))set('IMAGE_TOO_LARGE','Image is too large','Choose an image below 4 MiB and 16 megapixels, or resize or compress it before attaching.',[])
  else if(scope==='images:pick'&&match(/choose at most|available image slots|pending image attachments/))set('IMAGE_LIMIT','Too many image attachments','Remove an image or choose fewer files, then attach again.',[])
  else if (systemCode === 'ENOENT' && /^docker(?:\.exe)?$/i.test(String((error as {path?:string})?.path||'')) || match(/spawn docker(?:\.exe)? enoent|docker(?:\.exe)?[^\r\n]*not recognized|docker cli executable.*not found/)) set('DOCKER_MISSING','Docker Desktop was not found','Install Docker Desktop, enable its Linux engine, then retry the checks.',['docker-help','retry'],true)
  else if (match(/windows.container|linux engine required|ostype.*windows/)) set('DOCKER_WINDOWS_ENGINE','Switch Docker to Linux containers','Use Docker Desktop’s menu to switch to Linux containers, then retry.',['docker-open','docker-help','retry'],true)
  else if (match(/dockerdesktoplinuxengine|\/\/\.\/pipe|docker.*(not running|not connected|daemon|cannot connect)|failed to connect to the docker api/)) set('DOCKER_UNAVAILABLE','Waiting for Docker','Open Docker Desktop and wait for its Linux engine to start. Saved work is retained.',['docker-open','retry','docker-help'],true)
  else if (match(/docker.*context|context.*docker/)) set('DOCKER_CONTEXT','Docker context is unavailable','Check the selected Docker context and its access permissions, then retry.',['docker-help','retry'],true)
  else if (match(/incompatible.*backend|backend.*incompatible/)) set('BACKEND_INCOMPATIBLE','Backend update required','Rebuild the backend image to match this version of UnrealCode.',['backend-rebuild'],true)
  else if (match(/sqlite_corrupt|sqlite_notadb|database disk image is malformed|file is not a database/)) set('CACHE_DAMAGED','History cache needs rebuilding','The rebuildable cache is damaged. Original sessions remain in Docker storage.',['cache-rebuild','support'])
  else if (match(/sqlite_busy|database is locked/)) set('CACHE_BUSY','History cache is busy','Another database operation holds a lock. Retry the original action after it finishes.',['support'],true)
  else if (match(/saved metadata exceeds.*size limit/)) set('METADATA_TOO_LARGE','Saved data needs review','The saved metadata is larger than this app can safely load. The original file was preserved; inspect a recovery backup or export a support bundle before changing it.',['settings','support'])
  else if(match(/history.*worker|history cache|cache queue/)) set('CACHE_UNAVAILABLE','History cache is unavailable','Original sessions are retained. Rebuild the cache to restore local history browsing.',['cache-rebuild','support'])
  else if (match(/certificate|self.signed|unable to verify|tls/)) set('TLS_FAILURE','Secure connection failed','Check the endpoint and trusted certificates or proxy configuration. TLS verification remains enabled.',['settings','support'])
  else if(scope.startsWith('memory:')&&match(/memory service startup failed|memory switch failed/))set('MEMORY_SERVICE_FAILED','Memory service could not start','The previous memory profile and saved knowledge were preserved. Check Docker and retry from Settings → Memory.',['settings','docker-help','support'],true)
  else if(scope.startsWith('memory:')&&match(/memory model verification failed|model did not return the required structured response/))set('MEMORY_MODEL_VERIFY_FAILED','Memory model test failed','Check the selected model and its structured-response capability. The previous profile remains selected.',['settings','support'])
  else if(scope.startsWith('memory:')&&match(/api key is not configured|invalid candidate memory credential/))set('MEMORY_CREDENTIAL_REQUIRED','Memory credentials need attention','Add or correct the key for the proposed memory provider. The previous profile remains selected.',['settings'])
  else if (match(/\b401\b|unauthorized|invalid.*(key|token)|expired.*(login|credential|token)|not authenticated|authentication|no codex login|codex credentials rejected|api key (?:must be set|is not configured|not configured)/)) set('AUTH_REQUIRED','Reconnect your account','Reconnect or update the credentials for this service in settings, then retry the action.',['settings'])
  else if (match(/\b429\b|rate.limit|quota|insufficient.credit/)) set('PROVIDER_LIMIT','Provider limit reached','Check the provider’s quota or reset time. Resume the task when access is available.',['settings'])
  else if(match(/empty_response|incomplete_response|provider returned no answer|provider stopped at its output limit|provider.*incomplete response/))set('PROVIDER_INCOMPLETE','The provider returned an incomplete response','Your accepted answers and completed tool results are saved. Use Retry response in this conversation when you are ready.',[],false)
  else if(match(/provider response failed|server_error|json error injected into sse stream/))set('PROVIDER_FAILED','The provider could not finish its response','Your accepted answers and completed tool results are saved. Review the provider status or settings, then use Retry response in this conversation.',['settings'],false)
  else if(match(/model.*(not found|not loaded|unavailable)|no.*model.*loaded|unsupported.*(model|tool)|context.*(limit|exceeded)/))set('MODEL_UNAVAILABLE','Check the selected model','Load the model in your local runtime, or select an available model with the required tools and context capacity in Settings.',['settings'])
  else if (match(/econnrefused|enotfound|network|fetch failed|endpoint.*unavailable/)) set('ENDPOINT_UNAVAILABLE','Service cannot be reached','Check the endpoint, network, and whether the local model or service is running, then retry the original action.',['settings','support'],true)
  else if (match(/mount.*(denied|failed|invalid)|drive.*shared/)) set('DOCKER_MOUNT','Project could not be mounted','Check that the project folder exists and Docker has access to its drive.',['docker-help','retry'],true)
  else if (match(/build.*(failed|error)|failed to solve/)) set('BACKEND_BUILD','Backend build failed','Review the build details, check network and disk space, then rebuild.',['backend-rebuild','support'],true)
  else if (match(/backend exited|backend stopped|broken pipe|epipe/)) set('BACKEND_DISCONNECTED','Backend disconnected','Inspect the retained session, then reconnect. Commands are not replayed automatically.',['retry','support'],true)
  else if (match(/retained.*(volume|session)|restore journal|reattach|session mapping/)) set('RECOVERY_REVIEW','Retained sessions need review','Open Settings → Recovery to inspect the saved copy and its ownership. Existing project history is preserved.',['recovery','support'])
  else if (match(/hindsight startup timed out|memory setup timed out/)) set('MEMORY_START_TIMEOUT','Memory service is still preparing','The pinned local memory models may need more time or a working download connection. Retry the memory service from Settings → Memory. Retained records and coding sessions are preserved.',['settings','support'],true)
  else if (match(/timed out|timeout/)) set('TIMEOUT','The action timed out','Its outcome may be incomplete. Check the task before retrying an action that changes files or remote state.',['support'])
  else if(match(/changed on disk|changed since|stale.*(revision|contents)|workspace changed|changed after.*preview/))set('STALE_STATE','The file or workspace changed','Reload the file or refresh the preview, then compare your changes before saving or restoring.',['support'])
  else if (systemCode==='EACCES'||systemCode==='EPERM'||match(/permission denied|access denied|not permitted/)) set('ACCESS_DENIED','Access was denied','Check folder or service permissions and whether another process has locked the file, then retry the original action.',['support'],true)
  else if (match(/invalid.*(metadata|registry)|unexpected.*json|json.*(invalid|position)|damaged.*profile/) || error instanceof SyntaxError && /migration|settings|storage/.test(scope)) set('METADATA_DAMAGED','Saved metadata needs recovery','Preserve the current data and inspect or restore a verified backup.',['settings','support'])
  else if(match(/git for windows is unavailable/))set('GIT_MISSING','Git is needed for Agent team','Install Git for Windows, then retry Agent team. A GitHub login is not required.',['support'])
  else if(match(/agent team needs a git repository|isolated tasks need a committed git repository/))set('GIT_REPOSITORY_REQUIRED','Open a Git repository','Agent team needs a Git repository opened at its root with an initial commit. Uncommitted changes are supported; a GitHub login is not required.',['support'])
  else if(match(/open the repository root|repository root as the trusted project/))set('GIT_ROOT_REQUIRED','Open the repository root','Select the repository root as the project, then retry this Git action.',['support'])
  else if(match(/make an initial git commit/))set('GIT_COMMIT_REQUIRED','Make an initial commit','Create the repository’s first commit, then retry Agent team. Later uncommitted changes are supported.',['support'])
  else if(match(/git could not run|repository could not be inspected|repository head could not be inspected/))set('GIT_INACCESSIBLE','Git could not inspect the project','Check Git and folder access, then retry Agent team. A GitHub login or clean working tree is not required.',['support'],true)
  else if(scope.startsWith('memory:'))set('MEMORY_SETUP_FAILED','Memory setup could not finish','Review the provider and model in Settings → Memory, then retry the failed step. Saved memories remain available.',['settings','support'])
  else if (match(/git|worktree/)) set('GIT_FAILURE','Git action could not finish','Review the repository and the specific Git operation in Technical details before retrying.',['support'])
  else if (match(/mcp|connection:/)) set('CONNECTION_FAILURE','Tool connection failed','Check the server configuration, credentials, and project grant in Connections.',['settings','support'])
  else if (match(/cancelled|canceled/)) set('CANCELLED','Action cancelled','The action was cancelled. Review any changes made before cancellation.',[])
  return {code,scope,title,message,actions,retryable,reference:randomUUID().slice(0,8),details:redactDiagnostic(raw)}
}
export const actionable = (error: unknown, scope: string): ActionableError => new ActionableError(classifyFailure(error,scope))
export function withEventFailure(event:AgentEvent):AgentEvent {
  if(event.failure||!event.payload||typeof event.payload!=='object')return event
  const payload=event.payload as Record<string,unknown>
  if(event.event==='session.item'){
    const data=(payload.Data??payload.data) as Record<string,unknown>|undefined,response=(data?.Response??data?.response) as Record<string,unknown>|undefined,providerFailure=((response?.Failure??response?.failure)||((response?.Stop??response?.stop)==='refused'?{Code:'model_refusal',Message:'The provider declined this request.'}:undefined)) as Record<string,unknown>|undefined
    if(providerFailure){const failure=classifyProviderEvent(providerFailure);const dataKey='Data'in payload?'Data':'data',responseKey=data&&'Response'in data?'Response':'response',failureKey=response&&'Failure'in response?'Failure':'failure';return {...event,failure,payload:{...payload,[dataKey]:{...data,[responseKey]:{...response,[failureKey]:{...providerFailure,Message:failure.message,Issue:failure.providerIssue}}}}}}
  }
  if(event.event==='session.status'&&payload.status==='error'||event.event==='decision.error'){
    const failure=classifyFailure(new Error(String(payload.message||'The agent request failed')),event.event)
    return {...event,failure,payload:{...payload,message:failure.message}}
  }
  return event
}

const classifyProviderEvent = providerFailure
