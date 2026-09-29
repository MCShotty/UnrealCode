import {expect,it} from 'vitest'
import {browserDescriptorText} from './browser-descriptor'
it('omits credential-bearing lines and token-like visible text before cloud decisions',()=>{
 const text='Welcome\nPassword: hunter2\nCookie session_id=abc\nLong value 1234567890123456789012345678901234567890\nOpen tasks'
 const reduced=browserDescriptorText(text)
 for(const value of ['hunter2','session_id=abc','1234567890123456789012345678901234567890'])expect(reduced).not.toContain(value)
 expect(reduced).toContain('Open tasks')
})
