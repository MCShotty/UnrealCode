import {expect,it} from 'vitest'
import {isWarningFailure,showFailureNotice,type AppFailure} from './failure'
const failure=(scope:string,code='ENDPOINT_UNAVAILABLE'):AppFailure=>({scope,code,title:'Fixture',message:'Fixture',actions:[],retryable:false,reference:'fixture'})
it('mutes advisory notices while retaining task, data and explicit-action failures',()=>{
 for(const scope of ['decision.error','usage:snapshot','memory:status','timeline:view'])expect(showFailureNotice(failure(scope),false)).toBe(false)
 for(const scope of ['provider','session.status','memory:switch-verified','editor:save','migration'])expect(showFailureNotice(failure(scope),false)).toBe(true)
 for(const code of ['DISK_FULL','ACCESS_DENIED','METADATA_DAMAGED','CACHE_DAMAGED'])expect(showFailureNotice(failure('memory:status',code),false)).toBe(true)
 expect(isWarningFailure(failure('docker','DOCKER_UNAVAILABLE'))).toBe(true)
 expect(showFailureNotice(failure('migration','DOCKER_UNAVAILABLE'),false)).toBe(true)
 expect(showFailureNotice(failure('application','CANCELLED'))).toBe(false)
})
