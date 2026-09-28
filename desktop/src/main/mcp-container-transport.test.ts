import {EventEmitter} from 'node:events'
import {expect,it,vi} from 'vitest'

const calls=vi.hoisted(()=>({spawn:vi.fn(),execFile:vi.fn()}))
vi.mock('node:child_process',()=>calls)
vi.mock('./terminal-command',()=>({terminalDockerExecutable:()=> 'C:\\Program Files\\Docker\\docker.exe'}))
import {ContainerMcpTransport} from './mcp-container-transport'

it('uses the resolved Docker executable for both container startup and cleanup',async()=>{
 const child=new EventEmitter() as any
 child.stdin={writable:true,write:vi.fn((_data:unknown,done:(error?:Error)=>void)=>done()),end:vi.fn()}
 child.stdout=new EventEmitter()
 child.stderr={resume:vi.fn()}
 child.kill=vi.fn()
 calls.spawn.mockImplementation(()=>{queueMicrotask(()=>child.emit('spawn'));return child})
 calls.execFile.mockImplementation((_command:unknown,_args:unknown,_options:unknown,done:(error?:Error)=>void)=>done())
 const transport=new ContainerMcpTransport('fixture-container','python3',['fixture.py'],{})
 await transport.start();await transport.close()
 expect(calls.spawn.mock.calls[0][0]).toBe('C:\\Program Files\\Docker\\docker.exe')
 expect(calls.execFile.mock.calls[0][0]).toBe('C:\\Program Files\\Docker\\docker.exe')
})
