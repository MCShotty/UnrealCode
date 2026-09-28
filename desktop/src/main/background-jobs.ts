import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {promises as fs} from 'node:fs'
import {randomUUID,createHash} from 'node:crypto'
import type {BackgroundJob} from '../shared/background-jobs'
import {atomicMetadata} from './atomic-metadata'
import {backendEnvironment} from './child-environment'
import {terminalDockerExecutable} from './terminal-command'
import {redactContent} from './failures'
const exec=promisify(execFile)
export class BackgroundJobs{
  private jobs:BackgroundJob[]=[]
  private processes=new Map<string,ChildProcess>()
  private timers=new Map<string,NodeJS.Timeout>()
  private initialized?:Promise<void>
  private admissions:Promise<void>=Promise.resolve()
  private closing=false
  private saveTimer?:NodeJS.Timeout
  private saveTail:Promise<void>=Promise.resolve()
  private persistenceError?:string
  private waiters=new Map<string,Set<()=>void>>()
  onChanged:()=>void=()=>{}
  constructor(private path:string,private workspace:string,private container:()=>string,private onStart:()=>void,private launch:typeof spawn=spawn){}
  get busy(){return this.jobs.some(job=>['starting','running'].includes(job.state))}
  private async init(){if(!this.initialized)this.initialized=(async()=>{try{const data=JSON.parse(await fs.readFile(this.path,'utf8'));if(data.version!==1||!Array.isArray(data.jobs))throw Error('Unsupported background job metadata');this.jobs=data.jobs;for(const job of this.jobs)if(['starting','running'].includes(job.state))job.state='interrupted'}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}})();return this.initialized}
  private save():Promise<void>{
    const operation=this.saveTail.then(async()=>{try{await atomicMetadata(this.path,JSON.stringify({version:1,jobs:this.jobs}));this.persistenceError=undefined}catch(error){this.persistenceError='Background job status could not be saved. Inspect the running process and available storage before restarting.';try{this.onChanged()}catch{}throw error}try{this.onChanged()}catch{/* A renderer notification cannot undo a committed job. */}})
    this.saveTail=operation.then(()=>{},()=>{})
    return operation
  }
  private changed(){if(this.closing)return;clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>{void this.admissions.then(()=>this.save()).catch(()=>{this.persistenceError='Background job status could not be saved. Inspect the running process and available storage before restarting.';try{this.onChanged()}catch{}})},100);this.saveTimer.unref()}
  private visible(job:BackgroundJob):BackgroundJob{return {...structuredClone(job),...(this.persistenceError?{persistenceWarning:this.persistenceError}:{})}}
  private wake(id:string){for(const notify of this.waiters.get(id)||[])notify();this.waiters.delete(id)}
  async list(sessionId?:string):Promise<BackgroundJob[]>{await this.init();return this.jobs.filter(job=>!sessionId||job.sessionId===sessionId).map(job=>this.visible(job))}
  private job(id:string,sessionId:string){const job=this.jobs.find(job=>job.id===id&&job.sessionId===sessionId);if(!job)throw Error('Job does not belong to this session');return job}
  private reserve(sessionId:string,command:string,timeoutMs:number,requestId:string):Promise<{job:BackgroundJob;reused:boolean}>{
    const reservation=this.admissions.then(async()=>{
      await this.init();if(this.closing)throw Error('Workspace is closing; background job was not started')
      if(!/^[a-f0-9-]{36}$/.test(sessionId)||typeof command!=='string'||!command.trim()||command.length>16000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>86400000||typeof requestId!=='string'||!requestId||requestId.length>128)throw Error('Invalid background command, session, request or timeout')
      const digest=createHash('sha256').update(JSON.stringify({command,timeoutMs,sessionId})).digest('hex'),prior=this.jobs.find(job=>job.requestId===requestId)
      if(prior){if(prior.digest!==digest)throw Error('Replayed background command arguments changed');if(prior.state==='interrupted')throw Error('Previous background command outcome is uncertain. Inspect the retained job.');return {job:prior,reused:true}}
      if(this.jobs.filter(job=>['starting','running'].includes(job.state)).length>=4)throw Error('Four background jobs already run in this workspace')
      const container=this.container();if(!container)throw Error('Connect the workspace backend before starting a job')
      const id=randomUUID(),job:BackgroundJob={id,requestId,digest,sessionId,workspace:this.workspace,container,command:redactContent(command),createdAt:new Date().toISOString(),state:'starting',output:'',truncated:false,timeoutMs}
      this.jobs.push(job)
      try{await this.save()}catch(error){const index=this.jobs.indexOf(job);if(index>=0)this.jobs.splice(index,1);throw error}
      return {job,reused:false}
    })
    this.admissions=reservation.then(()=>{},()=>{})
    return reservation
  }
  async start(sessionId:string,command:string,timeoutMs=3600000,requestId:string=randomUUID()):Promise<BackgroundJob>{
    const {job,reused}=await this.reserve(sessionId,command,timeoutMs,requestId)
    if(reused)return structuredClone(job)
    if(this.closing){job.state='cancelled';job.endedAt=new Date().toISOString();await this.save();throw Error('Workspace closed before the background job started')}
    const id=job.id,container=job.container
    const marker=`__unrealcode_job_${id}:`
    let child:ChildProcess
    try{this.onStart();child=this.launch(terminalDockerExecutable(backendEnvironment()),['exec','-i',container,'setsid','--wait','/bin/bash','-c',`printf '${marker}%s\\n' "$$"; export UNREALCODE_JOB_ID="${id}"; exec /bin/bash -c "$1"`,'unrealcode-job',command],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:backendEnvironment()})}
    catch(error){job.state='failed';job.endedAt=new Date().toISOString();await this.save();throw error}
    this.processes.set(id,child);let prefix='',started=false
    const output=(value:string)=>{job.output=(job.output+redactContent(value));if(job.output.length>131072){job.output=job.output.slice(-131072);job.truncated=true}this.changed()}
    const unconfirmed=(message:string)=>{if(job.state==='interrupted')return;job.state='interrupted';output(`${message} The container process may still be active; inspect it before retrying.\n`);child.kill()}
    child.stdout!.on('data',chunk=>{if(job.state==='interrupted')return;let text=chunk.toString();if(!started){prefix+=text;const end=prefix.indexOf('\n');if(end<0){if(prefix.length>4096)unconfirmed('Container process identity exceeded the safety limit.');return};const line=prefix.slice(0,end).trim();if(!line.startsWith(marker)||!/^\d+$/.test(line.slice(marker.length))){unconfirmed('Container did not confirm process ownership.');return};job.pid=Number(line.slice(marker.length));if(job.pid<2){unconfirmed('Container returned an invalid process identity.');return};job.state='running';started=true;text=prefix.slice(end+1);prefix=''}output(text)})
    child.stderr!.on('data',chunk=>output(chunk.toString()))
    const finish=(code:number|null)=>{
      if(job.state==='starting'&&code===0&&!started){job.state='interrupted';output('Container did not confirm process ownership before exiting. Inspect the retained job before retrying.\n')}
      else if(['starting','running'].includes(job.state))job.state=code===0?'completed':'failed'
      job.exitCode=code??undefined;job.endedAt=new Date().toISOString();clearTimeout(this.timers.get(id));this.timers.delete(id);this.processes.delete(id);this.wake(id);this.changed()
    }
    child.on('error',()=>{output('Could not start Docker background job.\n');finish(null)});child.on('close',finish);child.stdin!.end()
    const timer=setTimeout(()=>void this.stop(sessionId,id).catch(()=>{
      if(!['starting','running'].includes(job.state))return
      job.state='interrupted'
      output('Could not stop timed-out background job. The container process may still be active; inspect it before retrying.\n')
      this.wake(id)
      child.kill()
    }),timeoutMs);timer.unref();this.timers.set(id,timer)
    return structuredClone(job)
  }
  async stop(sessionId:string,id:string):Promise<void>{await this.init();const job=this.job(id,sessionId);if(!['starting','running','interrupted'].includes(job.state))return
    if(job.pid){
      const stopScript=`import os,signal,sys,time
pgid=int(sys.argv[1]); marker=('UNREALCODE_JOB_ID='+sys.argv[2]).encode(); owned=False
for name in os.listdir('/proc'):
 if not name.isdigit(): continue
 try:
  stat=open('/proc/'+name+'/stat').read().rsplit(') ',1)[1].split()
  if int(stat[2])==pgid and marker in open('/proc/'+name+'/environ','rb').read().split(b'\\0'): owned=True; break
 except (OSError,ValueError,IndexError): pass
try: os.killpg(pgid,0)
except ProcessLookupError: sys.exit(0)
if not owned: sys.exit(7)
os.killpg(pgid,signal.SIGTERM); time.sleep(.2)
try: os.killpg(pgid,signal.SIGKILL)
except ProcessLookupError: pass`
      await exec(terminalDockerExecutable(backendEnvironment()),['exec',job.container,'python3','-c',stopScript,String(job.pid),job.id],{windowsHide:true,timeout:10000,env:backendEnvironment()})
    }
    else if(this.processes.has(id)){// Wait briefly for the trusted PID preamble before killing the group.
      for(let i=0;i<20&&!job.pid&&this.processes.has(id);i++)await new Promise(resolve=>setTimeout(resolve,50))
      if(job.pid)return this.stop(sessionId,id)
      if(this.processes.has(id))throw Error('Process identity is not confirmed. Inspect the container before stopping it.')
    }else throw Error('Interrupted job identity is unknown. Inspect its retained container.')
    if(['starting','running','interrupted'].includes(job.state)){job.state='cancelled';this.processes.get(id)?.kill();await this.admissions;await this.save()}
  }
  async read(sessionId:string,id:string){await this.init();return this.visible(this.job(id,sessionId))}
  async wait(sessionId:string,id:string,timeoutMs=30000){await this.init();const job=this.job(id,sessionId);if(!['starting','running'].includes(job.state))return structuredClone(job);await new Promise<void>(resolve=>{const listeners=this.waiters.get(id)||new Set();this.waiters.set(id,listeners);const finish=()=>{clearTimeout(timer);listeners.delete(finish);resolve()};const timer=setTimeout(finish,Math.min(60000,Math.max(1,timeoutMs)));listeners.add(finish)});return this.read(sessionId,id)}
  async close(){this.closing=true;clearTimeout(this.saveTimer);await this.admissions;await this.saveTail;await this.init();await Promise.allSettled(this.jobs.filter(job=>['running','starting'].includes(job.state)).map(job=>this.stop(job.sessionId,job.id)));for(const job of this.jobs)if(['running','starting'].includes(job.state))job.state='interrupted';await this.save()}
}
