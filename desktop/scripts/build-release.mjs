import { execFile } from 'node:child_process'
import { writeFileSync,mkdirSync,readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
const require=createRequire(import.meta.url)
const stable=process.argv.includes('--stable'),publisher=process.env.UNREALCODE_PUBLISHER?.trim()
if(stable&&!publisher)throw new Error('Stable builds require UNREALCODE_PUBLISHER and valid Windows signing credentials')
const version=JSON.parse(readFileSync('package.json','utf8')).version
if(stable&&!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Stable packaging requires a stable package version')
const channel=version.includes('-')?'preview':'latest'
if(version.includes('-')&&!/^\d+\.\d+\.\d+-preview\.\d+$/.test(version))throw new Error('Prerelease package versions must use the preview channel suffix')
mkdirSync('generated',{recursive:true})
writeFileSync('generated/release-policy.json',JSON.stringify({publishers:publisher?[publisher]:[]}))
// Use npm's actual CLI with Node on Windows. The builder's PowerShell
// EncodedCommand wrapper can return an empty stream on restricted Windows hosts.
// Keep the real npm production tree, including optional/transitive dependencies.
if(process.platform==='win32'){
 const npm=process.env.npm_execpath
 if(!npm||!/[\\/]npm-cli\.js$/i.test(npm))throw new Error('Run packaging through npm run build:win or npm run build:stable')
 const {NpmNodeModulesCollector}=require('app-builder-lib/out/node-module-collector/npmNodeModulesCollector')
 NpmNodeModulesCollector.prototype.getDependenciesTree=async function(){
  let output
  try{output=(await promisify(execFile)(process.execPath,[npm,...this.getArgs()],{cwd:this.rootDir,windowsHide:true,maxBuffer:64*1024*1024,env:require('builder-util').stripSensitiveEnvVars(process.env)})).stdout}
  catch(error){if(error.code!==1||!error.stdout)throw error;output=error.stdout}
  const tree=JSON.parse(output);if(!tree.dependencies||tree.name!=='unrealcode')throw new Error('Invalid production dependency tree');return tree
 }
}
const {build,Platform}=require('electron-builder')
await build({targets:Platform.WINDOWS.createTarget('nsis'),publish:'never',config:{publish:{provider:'github',owner:'MCShotty',repo:'UnrealCode',channel,releaseType:channel==='preview'?'prerelease':'release'},generateUpdatesFilesForAllChannels:false,...(publisher?{win:{publisherName:publisher}}:{}),...(stable?{forceCodeSigning:true}:{})}})
