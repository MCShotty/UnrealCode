import {createHash} from 'node:crypto'
import { execFile } from 'node:child_process'
import { writeFileSync,mkdirSync,readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { basename, dirname, join, resolve } from 'node:path'
const require=createRequire(import.meta.url)
const stable=process.argv.includes('--stable'),unsignedPublic=process.argv.includes('--unsigned-public'),publisher=process.env.UNREALCODE_PUBLISHER?.trim()
if(stable&&unsignedPublic)throw new Error('Choose signed or explicitly unsigned release packaging')
// A separate local candidate directory lets QA proceed when Windows retains
// an image handle on an exited test process in the previous unpacked build.
const output=process.argv.find(value=>value.startsWith('--output='))?.slice('--output='.length)
if(stable&&!publisher)throw new Error('Stable builds require UNREALCODE_PUBLISHER and valid Windows signing credentials')
const version=JSON.parse(readFileSync('package.json','utf8')).version
if(stable&&!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Stable packaging requires a stable package version')
if(unsignedPublic){
 if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Public unsigned packaging requires a stable package version')
 const signingVariables=['UNREALCODE_PUBLISHER','CSC_LINK','CSC_KEY_PASSWORD','CSC_NAME','CSC_INSTALLER_LINK','CSC_INSTALLER_KEY_PASSWORD','WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD','WIN_CSC_NAME']
 if(signingVariables.some(name=>process.env[name]))throw new Error('Signing configuration is present; refuse an ambiguous unsigned release build')
 process.env.CSC_IDENTITY_AUTO_DISCOVERY='false'
}
const channel=version.includes('-')?'preview':'latest'
if(version.includes('-')&&!/^\d+\.\d+\.\d+-preview\.\d+$/.test(version))throw new Error('Prerelease package versions must use the preview channel suffix')
// Optional workaround for Windows hosts that stall the generated NSIS helper.
// Use the builder's own binary extractor; the normal signing step still follows.
if(process.platform==='win32'&&process.argv.includes('--extract-uninstaller')){
 const {WineVmManager}=require('app-builder-lib/out/vm/WineVm')
 const {UninstallerReader}=require('app-builder-lib/out/targets/nsis/nsisUtil')
 const original=WineVmManager.prototype.exec
 WineVmManager.prototype.exec=function(file,args,options){
  if(resolve(dirname(file))===resolve(output||'dist')&&basename(file)===`UnrealCode-Setup-${version}.exe`&&args.length===0&&options?.env?.__COMPAT_LAYER==='RunAsInvoker')return UninstallerReader.exec(file,join(dirname(file),`${basename(file,'exe')}__uninstaller.exe`))
  return original.call(this,file,args,options)
 }
}
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
await build({targets:Platform.WINDOWS.createTarget('nsis'),publish:'never',config:{afterSign:async context=>{const directory=join(context.appOutDir,'resources','computer-host'),file=join(directory,'UnrealCode.ComputerHost.exe'),manifest=join(directory,'manifest.json');const value=JSON.parse(readFileSync(manifest,'utf8'));value.sha256=createHash('sha256').update(readFileSync(file)).digest('hex');writeFileSync(manifest,JSON.stringify(value,null,2))},...(output?{directories:{output}}:{}),publish:{provider:'github',owner:'MCShotty',repo:'UnrealCode',channel,releaseType:channel==='preview'?'prerelease':'release'},generateUpdatesFilesForAllChannels:false,...(publisher?{win:{publisherName:publisher}}:{}),...(stable?{forceCodeSigning:true}:{})}})
