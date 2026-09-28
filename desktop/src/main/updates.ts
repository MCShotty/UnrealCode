import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync,createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { NsisUpdater } from 'electron-updater'
import { CancellationToken } from 'builder-util-runtime'
import type { UpdateState } from '../shared/recovery'
import { backendEnvironment } from './child-environment'
const exec=promisify(execFile)
export async function verifyPublisher(path:string,publishers:string[]):Promise<void>{
 if(!publishers.length||publishers.some(value=>typeof value!=='string'||!value.trim()))throw new Error('No trusted Windows publisher configured')
 const command="$s=Get-AuthenticodeSignature -LiteralPath $env:UNREAL_VERIFY_FILE; @{status=[int]$s.Status; publisher=if($s.SignerCertificate){$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)}else{''}} | ConvertTo-Json -Compress"
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:20000,env:{...backendEnvironment(),UNREAL_VERIFY_FILE:path}})
 const result=JSON.parse(stdout);if(result.status!==0||!publishers.includes(result.publisher))throw new Error('Windows signature is invalid or belongs to an unexpected publisher')
}
export function requireUpdateHashes(files:readonly {sha512?:string}[]):void {if(!files.length||files.some(file=>typeof file.sha512!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)))throw new Error('Update metadata is missing a valid SHA-512 checksum')}
export async function verifyUpdateHash(path:string,expected:string):Promise<void>{requireUpdateHashes([{sha512:expected}]);const hash=createHash('sha512');for await(const chunk of createReadStream(path))hash.update(chunk);if(hash.digest('base64')!==expected)throw new Error('Installer checksum changed; download the update again')}
export class Updates {
 private updater:NsisUpdater|undefined
 private token:CancellationToken|undefined
 private downloaded:string[]=[]
 private publishers:string[]=[]
 private expectedHash=''
 private value:UpdateState={channel:'stable',state:'unavailable',message:'Updates require a signed Windows release.'}
 view():UpdateState{return {...this.value}}
 supportsInstallation():boolean{return !!this.updater}
 async initialize():Promise<void>{
  try{if(!app.isPackaged||process.platform!=='win32')return
   const policy=JSON.parse(readFileSync(join(process.resourcesPath,'release-policy.json'),'utf8'));this.publishers=policy.publishers
   await verifyPublisher(process.execPath,this.publishers)
   const updater=new NsisUpdater({provider:'github',owner:'MCShotty',repo:'UnrealCode',private:false});this.updater=updater
   updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.logger=null
   updater.verifyUpdateCodeSignature=async(_names,path)=>{try{await verifyPublisher(path,this.publishers);return null}catch{return 'Publisher signature verification failed'}}
   updater.on('download-progress',progress=>{this.value={...this.value,state:'downloading',percent:progress.percent,message:'Downloading the signed installer…'}})
   updater.on('error',()=>{this.value={...this.value,state:'error',message:'Update failed. Check your connection and retry; no update was installed.'};this.downloaded=[]})
   this.value={channel:'stable',state:'idle',message:'Check for an update when ready.'}
  }catch{this.value={channel:'stable',state:'unavailable',message:'This build is unsigned or its publisher cannot be verified. Install a verified signed release to enable updates.'}}
 }
 async check(channel:'stable'|'preview'):Promise<UpdateState>{
  if(!this.updater)throw new Error(this.value.message)
  if(!['stable','preview'].includes(channel)||['checking','downloading'].includes(this.value.state))throw new Error('Wait for the current update operation')
  this.downloaded=[];this.value={channel,state:'checking',message:'Checking the selected release channel…'}
  this.updater.channel=channel==='stable'?'latest':'preview';this.updater.allowPrerelease=channel==='preview';this.updater.allowDowngrade=false
  try{const result=await this.updater.checkForUpdates();if(result?.isUpdateAvailable){requireUpdateHashes(result.updateInfo.files);this.expectedHash=result.updateInfo.files.find(file=>/\.exe$/i.test(file.url))?.sha512||'';requireUpdateHashes([{sha512:this.expectedHash}]);this.value={channel,state:'available',version:result.updateInfo.version,message:'Update available. Download it when ready.'}}else this.value={channel,state:'idle',message:'No newer update is available in this channel.'}}
  catch{this.value={channel,state:'error',message:'Unable to check this channel. Verify network access and published release metadata.'}}
  return this.view()
 }
 async download():Promise<UpdateState>{if(!this.updater||this.value.state!=='available')throw new Error('Check for an available update first');this.token=new CancellationToken();this.value={...this.value,state:'downloading',percent:0,message:'Downloading…'}
  try{const paths=await this.updater.downloadUpdate(this.token);if(this.token.cancelled)throw new Error('Cancelled');if(paths.length!==1)throw new Error('Unexpected installer files');await verifyUpdateHash(paths[0],this.expectedHash);await verifyPublisher(paths[0],this.publishers);this.downloaded=paths;this.value={...this.value,state:'ready',percent:100,message:'Verified update ready. Restart explicitly after settling active work.'}}
  catch{this.downloaded=[];this.value={...this.value,state:'error',message:'Download interrupted or verification failed. Retry from Check for updates.'}}
  finally{this.token=undefined}return this.view()
 }
 cancel():void{this.token?.cancel()}
 async install():Promise<void>{if(!this.updater||this.value.state!=='ready'||this.downloaded.length!==1)throw new Error('No verified update is ready');await verifyUpdateHash(this.downloaded[0],this.expectedHash);await verifyPublisher(this.downloaded[0],this.publishers);this.updater.quitAndInstall(false,true)}
}
