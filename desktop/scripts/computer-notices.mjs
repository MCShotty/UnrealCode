import {readFileSync,readdirSync,writeFileSync,existsSync,copyFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const root=resolve(import.meta.dirname,'../..'),dest=join(root,'desktop/third-party-licenses'),assets=JSON.parse(readFileSync(join(root,'desktop/computer-host/obj/project.assets.json'),'utf8')),cache=Object.keys(assets.packageFolders)[0]
const packages=Object.entries(assets.libraries).filter(([,value])=>value.type==='package').map(([name,value])=>({name,path:join(cache,value.path)}))
for(const name of ['microsoft.netcore.app.runtime.win-x64','microsoft.windowsdesktop.app.runtime.win-x64'])packages.push({name:`${name}/10.0.12`,path:join(cache,name,'10.0.12')})
const sections=['UnrealCode managed Computer helper','Pinned Windows MCP v1.3.25 (MIT), adapted as a library; source and modifications: third_party/windows-mcp/UPSTREAM.json','Self-contained .NET 10.0.12 Windows x64 runtime. Dependency versions and content hashes are locked in packages.lock.json.','MCP SDK copyright: Model Context Protocol a Series of LF Projects, LLC. Apache-2.0 license accompanies this file.'],seen=new Set()
for(const item of packages){
 const spec=readFileSync(join(item.path,readdirSync(item.path).find(n=>n.endsWith('.nuspec'))),'utf8'),license=/<license[^>]*type="([^"]+)"[^>]*>([^<]+)<\/license>/.exec(spec)
 if(!license||!(['MIT','Apache-2.0'].includes(license[2])||license[1]==='file'&&item.name==='Interop.UIAutomationClient/10.19041.0'))throw Error(`Review helper license: ${item.name}`)
 sections.push('',`===== ${item.name} (${license[2]}) =====`)
 const copyright=/<copyright>([^<]+)<\/copyright>/.exec(spec)?.[1];if(copyright)sections.push(copyright)
 const files=readdirSync(item.path).filter(n=>/^(LICENSE|THIRD-PARTY-NOTICES)/i.test(n))
 for(const name of files){const text=readFileSync(join(item.path,name),'utf8'),hash=createHash('sha256').update(text).digest('hex');if(!seen.has(hash)){seen.add(hash);sections.push(`----- ${name} -----`,text)}}
 if(license[2]==='MIT'&&!files.some(n=>/^LICENSE/i.test(n)))sections.push('Covered by the Microsoft/.NET MIT license reproduced below (runtime LICENSE.TXT).')
}
copyFileSync(join(root,'third_party/windows-mcp/LICENSE'),join(dest,'windows-mcp-LICENSE.txt'))
if(!existsSync(join(dest,'computer-mcp-sdk-LICENSE.txt')))throw Error('Missing pinned MCP SDK Apache license')
writeFileSync(join(dest,'computer-DOTNET_NOTICES.txt'),sections.join('\n')+'\n')
console.log(`Reviewed ${packages.length} helper dependency/runtime license entries.`)
