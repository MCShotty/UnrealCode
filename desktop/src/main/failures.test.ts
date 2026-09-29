import { expect, it } from 'vitest'
import { classifyFailure, redactDiagnostic } from './failures'
it.each([
 ['open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.','DOCKER_UNAVAILABLE'],
 ['Linux engine required; Windows containers','DOCKER_WINDOWS_ENGINE'],
 ['docker context cannot be accessed','DOCKER_CONTEXT'],
 ['backend incompatible','BACKEND_INCOMPATIBLE'],
 ['SQLITE_CORRUPT: database disk image is malformed','CACHE_DAMAGED'],
 ['database is locked','CACHE_BUSY'],
 ['Saved metadata exceeds its safe size limit; the original file is preserved','METADATA_TOO_LARGE'],
 ['no space left on device','DISK_FULL'],
 ['OOMKilled: out of memory','MEMORY_LIMIT'],
 ['self signed certificate','TLS_FAILURE'],
 ['401 unauthorized','AUTH_REQUIRED'],
 ['429 rate limit','PROVIDER_LIMIT'],
 ['ECONNREFUSED','ENDPOINT_UNAVAILABLE'],
 ['mount failed: drive not shared','DOCKER_MOUNT'],
 ['failed to solve build error','BACKEND_BUILD'],
 ['Docker backend exited (1)','BACKEND_DISCONNECTED'],
 ['Hindsight startup timed out','MEMORY_START_TIMEOUT'],
 ['MCP connection failed','CONNECTION_FAILURE'],
 ['Retained volume ownership changed during export','RECOVERY_REVIEW'],
 ['File changed on disk; reload before saving','STALE_STATE']
 ,['Git for Windows is unavailable. Install Git, then retry Agent team.','GIT_MISSING']
 ,['Agent team needs a Git repository. Open one at its root; no GitHub login is required.','GIT_REPOSITORY_REQUIRED']
 ,['Open the repository root as the project before enabling Agent team.','GIT_ROOT_REQUIRED']
 ,['Make an initial Git commit before enabling Agent team.','GIT_COMMIT_REQUIRED']
 ,['Git could not run. Check its installation and access to this project.','GIT_INACCESSIBLE']
])('provides recovery for %s',(message,code)=>{const result=classifyFailure(new Error(message));expect(result.code).toBe(code);expect(result.actions.length).toBeGreaterThan(0);expect(result.reference).toBeTruthy()})
it('names the failed memory stage without exposing old profile details',()=>{
 expect(classifyFailure(new Error('Memory model verification failed: unsupported response'),'memory:switch-verified').code).toBe('MEMORY_MODEL_VERIFY_FAILED')
 expect(classifyFailure(new Error('Memory switch failed; previous profile restored: service unavailable'),'memory:switch-verified').code).toBe('MEMORY_SERVICE_FAILED')
 expect(classifyFailure(new Error('openrouter API key is not configured'),'memory:switch-verified').code).toBe('MEMORY_CREDENTIAL_REQUIRED')
})
it('routes retained-session conflicts to Recovery without exposing their raw diagnostic in the primary message',()=>{
 const failure=classifyFailure(new Error('Reattach blocked: retained session mapping belongs to another project'))
 expect(failure.code).toBe('RECOVERY_REVIEW')
 expect(failure.actions).toContain('recovery')
 expect(failure.message).toContain('Settings → Recovery')
})
it('redacts credentials in details and avoids raw command text in the main explanation',()=>{
 const fixtureKey=['sk','proj','abcdefghijklmnop'].join('-')
 const raw='Authorization: Bearer secret-bearer-value api_key="private key with spaces" refresh_token=verysecret '+fixtureKey+' https://user:password@example.test postgresql://dbuser:dbpassword@example.test eyJabcdef.abcd.efgh'
 const clean=redactDiagnostic(raw)
 for(const value of ['secret-bearer-value','private key with spaces','verysecret','abcdefghijklmnop','user:password','dbuser:dbpassword','eyJabcdef'])expect(clean).not.toContain(value)
 expect(classifyFailure(new Error(raw)).message).not.toContain('Authorization')
})
it('uses native error codes before incidental provider-like words and numbers in paths',()=>{
 expect(classifyFailure(Object.assign(new Error('open certificate/401/settings.json'),{code:'EACCES'})).code).toBe('ACCESS_DENIED')
 expect(classifyFailure(Object.assign(new Error('connect localhost:401'),{code:'ECONNREFUSED'})).code).toBe('ENDPOINT_UNAVAILABLE')
 expect(classifyFailure(Object.assign(new Error('missing Dockerfile.desktop'),{code:'ENOENT',path:'I:/bundle/Dockerfile.desktop'}),'docker-build').code).not.toBe('DOCKER_MISSING')
 expect(classifyFailure(Object.assign(new Error('spawn docker ENOENT'),{code:'ENOENT',path:'docker'}),'migration').code).toBe('DOCKER_MISSING')
})
it('explains a timed-out Docker dependency check using the child-process timeout evidence',()=>{
 const error=Object.assign(new Error('Command failed: C:\\Docker\\docker.exe info --format {{.OSType}}'),{killed:true,signal:'SIGTERM'})
 const failure=classifyFailure(error,'docker')
 expect(failure.code).toBe('DOCKER_TIMEOUT')
 expect(failure.actions).toEqual(expect.arrayContaining(['docker-open','retry']))
 expect(classifyFailure(error,'editor:save').code).not.toBe('DOCKER_TIMEOUT')
})
it.each(['history-cache','history cache','docker-build','provider-request'])('keeps resource exhaustion actionable in %s',scope=>{
 expect(classifyFailure(Object.assign(new Error('write failed'),{code:'ENOSPC'}),scope).code).toBe('DISK_FULL')
 expect(classifyFailure(Object.assign(new Error('allocation failed'),{code:'ENOMEM'}),scope).code).toBe('MEMORY_LIMIT')
 expect(classifyFailure(new Error('no space left on device'),scope).code).toBe('DISK_FULL')
})
it.each([
 ['Unsupported or damaged image','IMAGE_UNSUPPORTED'],
 ['Only regular files within the size limit can be read','IMAGE_TOO_LARGE'],
 ['Choose at most 1 image for this message','IMAGE_LIMIT'],
 ['Finish or remove pending image attachments first','IMAGE_LIMIT']
])('explains image attachment failure %s',(message,code)=>{
 const failure=classifyFailure(new Error(message),'images:pick')
 expect(failure.code).toBe(code)
 expect(failure.message).not.toContain('Review the task')
})
