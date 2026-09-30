import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs'
import {resolve,join,relative} from 'node:path'
import {createHash} from 'node:crypto'
const root=resolve(import.meta.dirname,'../..'),project=join(root,'desktop/computer-host'),target=join(root,'desktop/generated/computer-host'),exe=join(target,'UnrealCode.ComputerHost.exe')
if(process.platform!=='win32'){console.log('Managed computer helper packaging is Windows-only.');process.exit(0)}
const hash=createHash('sha256')
function walk(path){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(['bin','obj'].includes(entry.name))continue;const file=join(path,entry.name);if(entry.isDirectory())walk(file);else hash.update(relative(root,file)).update(readFileSync(file))}}
walk(project);walk(join(root,'third_party/windows-mcp'));const sourceHash=hash.digest('hex'),manifestPath=join(target,'manifest.json')
if(existsSync(exe)&&existsSync(manifestPath)){const previous=JSON.parse(readFileSync(manifestPath,'utf8'));if(previous.sourceHash===sourceHash&&previous.sha256===createHash('sha256').update(readFileSync(exe)).digest('hex'))process.exit(0)}
mkdirSync(target,{recursive:true})
const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT)(?:_|$)/i.test(name)))
const options={cwd:project,windowsHide:true,stdio:'inherit',env}
execFileSync('dotnet',['restore','--locked-mode'],options)
execFileSync('dotnet',['publish','--no-restore','-c','Release','-o',target],options)
execFileSync(exe,['--self-test'],options)
writeFileSync(manifestPath,JSON.stringify({protocol:1,sourceHash,sha256:createHash('sha256').update(readFileSync(exe)).digest('hex'),upstream:JSON.parse(readFileSync(join(root,'third_party/windows-mcp/UPSTREAM.json'),'utf8'))},null,2))
