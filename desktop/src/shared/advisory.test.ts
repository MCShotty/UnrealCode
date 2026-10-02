import {expect,it} from 'vitest'
import {advisoryStatus,validAdvisorySlot} from './advisory'
const uuid=()=>crypto.randomUUID()
it('requires exact project/session bindings and known versioned advice states',()=>{
 const binding={projectId:'project',workspaceId:'workspace',sessionId:uuid(),runId:uuid(),sourceInputId:uuid(),requestGeneration:1,decisionGeneration:1,contextRevision:1},value={version:1,id:uuid(),binding,state:'ready'}
 expect(advisoryStatus(value)?.state).toBe('ready')
 expect(validAdvisorySlot(value,'other',binding.sessionId)).toBe(false)
 expect(validAdvisorySlot(value,'project',uuid())).toBe(false)
 for(const changed of [{...value,version:2},{...value,state:'approve'},{...value,binding:{...binding,requestGeneration:0}},{...value,id:'bad'}])expect(advisoryStatus(changed)).toBeUndefined()
})
