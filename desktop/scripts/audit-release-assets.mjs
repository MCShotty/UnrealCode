// Read-only GitHub inventory. Audits retained installer payloads, never executes them.
import {execFileSync} from 'node:child_process'
import {readFileSync,readdirSync,lstatSync,mkdirSync,existsSync} from 'node:fs'
import {join,resolve,relative} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {localCredentials} from './local-credentials.mjs'
import {secretPatterns} from './secret-patterns.mjs'
const archive=process.env.UNREALCODE_7ZIP||'C:\\Program Files\\7-Zip\\7z.exe'
if(!existsSync(archive))throw Error('Set UNREALCODE_7ZIP to an installed current 7-Zip executable')
const run=(file,args)=>execFileSync(file,args,{windowsHide:true,maxBuffer:16*1024*1024}).toString()
const releases=JSON.parse(run('gh',['api','repos/MCShotty/UnrealCode/releases','--paginate'])),root=resolve('generated',`release-audit-${randomUUID()}`);mkdirSync(root,{recursive:true})
const known=localCredentials(),report=[]
for(const release of releases)for(const asset of release.assets){
 if(!asset.name.endsWith('.exe'))throw Error(`Review non-installer release asset: ${release.tag_name}/${asset.name}`)
 const version=release.tag_name.replace(/^v/,''),candidates=[join('dist',asset.name),join('dist',`UnrealCode Setup ${version}.exe`)],installer=candidates.find(path=>existsSync(path)&&`sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`===asset.digest)
 if(!installer)throw Error(`No local installer matches GitHub digest for ${release.tag_name}; download and verify that asset before continuing`)
 const target=join(root,release.tag_name);mkdirSync(target)
 run(archive,['e','-y',resolve(installer),'$PLUGINSDIR\\app-64.7z',`-o${target}`])
 const payload=join(target,'app-64.7z');if(!existsSync(payload))throw Error('Installer payload not found')
 const listing=run(archive,['l','-slt',payload]).split('----------').slice(1).join('----------')
 if(/Symbolic Link =|Hard Link =/.test(listing))throw Error('Archive contains links')
 for(const line of listing.split(/\r?\n/).filter(line=>line.startsWith('Path = '))){const path=line.slice(7).replaceAll('\\','/');if(path.startsWith('/')||path.includes(':')||path.split('/').includes('..'))throw Error('Unsafe archived path')}
 const unpacked=join(target,'payload');run(archive,['x','-y',payload,`-o${unpacked}`]);let scanned=0;const hits=[]
 const visit=path=>{const info=lstatSync(path);if(info.isSymbolicLink())throw Error('Extracted link');if(info.isDirectory()){for(const name of readdirSync(path))visit(join(path,name));return}const bytes=readFileSync(path);scanned++;if(known.some(value=>bytes.includes(value)))hits.push({path:relative(unpacked,path),rule:'exact-local-credential'});if(!bytes.subarray(0,2048).includes(0)||path.endsWith('.asar'))for(const [rule,pattern]of secretPatterns)if(pattern.test(bytes.toString('utf8')))hits.push({path:relative(unpacked,path),rule})};visit(unpacked)
 report.push({tag:release.tag_name,digest:asset.digest,scanned,hits});if(hits.length)process.exitCode=1
}
console.log(JSON.stringify({root,releases:report}))
