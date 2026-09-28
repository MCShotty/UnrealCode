import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
const root=resolve(import.meta.dirname,'../..'),target=resolve(root,'desktop/generated'),windows=process.platform==='win32'
const exe=join(target,`unrealcode-host-files${windows?'.exe':''}`),source=join(root,'cmd/unrealcode-host-files'),hash=createHash('sha256')
for(const name of readdirSync(source).sort())if(name.endsWith('.go'))hash.update(name).update(readFileSync(join(source,name)))
hash.update(readFileSync(join(root,'go.mod'))).update(process.platform).update(process.arch)
const digest=hash.digest('hex'),stamp=exe+'.source'
if(existsSync(exe)&&existsSync(stamp)&&readFileSync(stamp,'utf8')===digest)process.exit(0)
mkdirSync(target,{recursive:true})
const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT)(?:_|$)/i.test(name)))
const options={cwd:root,windowsHide:true,stdio:'inherit',env:{...env,CGO_ENABLED:'0',GOOS:windows?'windows':'linux',GOARCH:process.arch==='arm64'?'arm64':'amd64'}}
let go=false;try{execFileSync('go',['version'],{...options,stdio:'ignore'});go=true}catch{}
if(go)execFileSync('go',['build','-trimpath','-buildvcs=false','-o',exe,'./cmd/unrealcode-host-files'],options)
else execFileSync('docker',['run','--rm','--init','--mount',`type=bind,source=${root},target=/src`,'--workdir','/src','-e',`GOOS=${options.env.GOOS}`,'-e',`GOARCH=${options.env.GOARCH}`,'-e','CGO_ENABLED=0','golang:1.27.1-trixie','go','build','-trimpath','-buildvcs=false','-o',`/src/desktop/generated/${windows?'unrealcode-host-files.exe':'unrealcode-host-files'}`,'./cmd/unrealcode-host-files'],{...options,env})
writeFileSync(stamp,digest)
