import {readBoundedJSON} from './bounded-file-read'
import {atomicMetadata} from './atomic-metadata'
import type {UpdateState} from '../shared/recovery'

export type ReleaseChannel='stable'|'preview'
export type ReleasePreferences={automaticChecks:boolean;channel:ReleaseChannel}
type Release={version:string;preview:boolean;url:string}
type Page={etag?:string;next:boolean;releases:Release[]}
type Saved={version:1;pages:Page[];releases:Release[];lastAttempt:number;checkedAt?:string;retryAt:number;dismissed:string[];error?:string}
const endpoint='https://api.github.com/repos/MCShotty/UnrealCode/releases'
const day=86400000
const initial=():Saved=>({version:1,pages:[],releases:[],lastAttempt:0,retryAt:0,dismissed:[]})
function version(value:string):number[]|undefined{
 const m=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/.exec(value)
 if(!m)return;const parts=m.slice(1).map((v,i)=>v===undefined&&i===3?Infinity:Number(v))
 if(parts.slice(0,3).some(v=>!Number.isSafeInteger(v))||parts[3]!==Infinity&&!Number.isSafeInteger(parts[3]))return
 return parts
}
export function compareReleaseVersions(a:string,b:string):number{
 const x=version(a),y=version(b);if(!x||!y)throw Error('Invalid release version')
 for(let i=0;i<4;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1
 return 0
}
export function releaseURL(value:string):string{
 if(!version(value))throw Error('Invalid release version')
 return `https://github.com/MCShotty/UnrealCode/releases/tag/v${value}`
}
export function eligibleRelease(raw:any):Release|undefined{
 if(!raw||raw.draft!==false||typeof raw.tag_name!=='string'||!raw.tag_name.startsWith('v'))return
 const v=raw.tag_name.slice(1);if(!version(v)||raw.prerelease!==v.includes('-preview.')||raw.html_url!==releaseURL(v))return
 if(!Array.isArray(raw.assets))return
 const required=[`UnrealCode-Setup-${v}.exe`,'SHA256SUMS']
 if(!required.every(name=>raw.assets.some((asset:any)=>asset?.name===name&&asset.state==='uploaded'&&Number.isSafeInteger(asset.size)&&asset.size>0&&asset.browser_download_url===`https://github.com/MCShotty/UnrealCode/releases/download/v${v}/${name}`)))return
 return {version:v,preview:raw.prerelease,url:releaseURL(v)}
}
function validRelease(value:any):value is Release{return typeof value?.version==='string'&&!!version(value.version)&&value.url===releaseURL(value.version)&&value.preview===value.version.includes('-preview.')}
function validSaved(value:any):value is Saved{return value?.version===1&&(value.error===undefined||typeof value.error==='string'&&value.error.length<=500)&&Array.isArray(value.pages)&&value.pages.length<=5&&value.pages.every((p:any)=>p&&typeof p.next==='boolean'&&(p.etag===undefined||typeof p.etag==='string'&&p.etag.length<1000)&&Array.isArray(p.releases)&&p.releases.length<=100&&p.releases.every(validRelease))&&Array.isArray(value.releases)&&value.releases.length<=500&&value.releases.every(validRelease)&&Number.isFinite(value.lastAttempt)&&value.lastAttempt>=0&&Number.isFinite(value.retryAt)&&value.retryAt>=0&&(value.checkedAt===undefined||typeof value.checkedAt==='string'&&Number.isFinite(Date.parse(value.checkedAt)))&&Array.isArray(value.dismissed)&&value.dismissed.length<=100&&value.dismissed.every((v:unknown)=>typeof v==='string'&&!!version(v))}

export class ReleaseNotifications{
 private saved=initial();private preferences:ReleasePreferences={automaticChecks:true,channel:'stable'}
 private loading?:Promise<void>;private pending?:Promise<UpdateState>;private timer?:ReturnType<typeof setTimeout>;private closed=false;private scheduled=false;private controller?:AbortController
 private error='';private checking=false
 constructor(private path:string,private currentVersion:string,private fetcher:typeof fetch=fetch,private notify:()=>void=()=>{},private clock=Date.now){}
 private emit(){try{this.notify()}catch{/* A closed window cannot undo release metadata. */}}
 private load(){return this.loading||=(async()=>{try{const value=await readBoundedJSON<unknown>(this.path,2*1024*1024);if(validSaved(value)){this.saved=value;this.error=value.error||''}else this.error='Saved release information could not be read; check again.'}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.error='Saved release information could not be read; check again.'}if(this.saved.lastAttempt>this.clock())this.saved.lastAttempt=this.clock();this.saved.retryAt=Math.min(this.saved.retryAt,this.clock()+7*day)})()}
 private async save(){await atomicMetadata(this.path,JSON.stringify({...this.saved,error:this.error||undefined}))}
 async initialize(preferences:ReleasePreferences,scheduled=true){this.configure(preferences);await this.load();this.scheduled=scheduled;this.arm(3000);this.emit()}
 configure(preferences:ReleasePreferences){if(typeof preferences.automaticChecks!=='boolean'||!['stable','preview'].includes(preferences.channel))throw Error('Invalid release preferences');this.preferences={...preferences};this.arm();this.emit()}
 view():UpdateState{
  const release=this.saved.releases.filter(r=>(this.preferences.channel==='preview'||!r.preview)&&compareReleaseVersions(r.version,this.currentVersion)>0).sort((a,b)=>compareReleaseVersions(b.version,a.version))[0]
  const stale=!!this.error||!!this.saved.checkedAt&&this.clock()-Date.parse(this.saved.checkedAt)>day
  return {channel:this.preferences.channel,delivery:'manual',automaticChecks:this.preferences.automaticChecks,state:this.checking?'checking':this.error?'error':release?'available':'idle',message:this.checking?'Checking GitHub releases…':this.error||(release?'A newer release is available. View its changelog and download the installer from GitHub.':this.saved.checkedAt?'No newer release is available in this channel.':'Release notifications are available. Installation is manual for this unsigned build.'),version:release?.version,releaseUrl:release?.url,checkedAt:this.saved.checkedAt,stale,dismissed:release?this.saved.dismissed.includes(release.version):false,retryAt:this.saved.retryAt>this.clock()?new Date(this.saved.retryAt).toISOString():undefined}
 }
 private arm(delay?:number){clearTimeout(this.timer);if(this.closed||!this.scheduled||!this.preferences.automaticChecks)return;const due=Math.max(this.saved.lastAttempt?this.saved.lastAttempt+day:0,this.saved.retryAt);this.timer=setTimeout(()=>void this.check(false),Math.max(delay??0,due-this.clock(),1000));this.timer.unref?.()}
 wake(){this.arm()}
 async check(manual=true):Promise<UpdateState>{
  await this.load();if(this.closed)return this.view();if(this.pending)return this.pending
  const now=this.clock();if(now<this.saved.retryAt||this.saved.lastAttempt&&now<this.saved.lastAttempt+(manual?60000:day)){this.arm();return this.view()}
  if(!manual&&!this.preferences.automaticChecks)return this.view()
  this.pending=this.perform().finally(()=>{this.pending=undefined;this.arm()});return this.pending
 }
 private async perform():Promise<UpdateState>{
  this.checking=true;this.saved.lastAttempt=this.clock();this.emit()
  try{
   // Persist the attempt before networking so restart cannot bypass the cadence.
   await this.save();const pages:Page[]=[]
   for(let n=0;n<5;n++){
    this.controller=new AbortController();const timeout=setTimeout(()=>this.controller?.abort(),10000)
    try{
     const cached=this.saved.pages[n],response=await this.fetcher(`${endpoint}?per_page=100&page=${n+1}`,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'UnrealCode-release-notifications',...(cached?.etag?{'If-None-Match':cached.etag}:{})},redirect:'error',signal:this.controller.signal})
     const remaining=response.headers.get('x-ratelimit-remaining'),retry=response.headers.get('retry-after'),reset=response.headers.get('x-ratelimit-reset')
     if(response.status===429||response.status===403||remaining==='0'){
      const retryTime=retry?(/^[0-9]+$/.test(retry)?this.clock()+Number(retry)*1000:Date.parse(retry)):0,resetTime=reset&&/^\d+$/.test(reset)?Number(reset)*1000:0
      this.saved.retryAt=Math.min(this.clock()+7*day,Math.max(this.clock()+60000,Number.isFinite(retryTime)?retryTime:0,Number.isFinite(resetTime)?resetTime:0))
      if(response.status!==200&&response.status!==304)throw Error('GitHub is limiting release checks. Try again after the displayed retry time.')
     }
     let page:Page
     if(response.status===304){if(!cached)throw Error('GitHub returned an unusable cached response.');page=cached}
     else{
      if(!response.ok)throw Error('GitHub release checks are unavailable. Your work can continue.')
      const reader=response.body?.getReader();if(!reader)throw Error('GitHub returned an empty release response.')
      const chunks:Uint8Array[]=[];let bytes=0
      try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw Error('GitHub release information exceeded its size limit.');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
      const raw:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(raw)||raw.length>100)throw Error('GitHub returned invalid release information.')
      const next=/<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link')||'')
      if(next){const target=new URL(next[1]);if(target.origin+target.pathname!==endpoint||target.searchParams.get('page')!==String(n+2)||target.searchParams.get('per_page')!=='100')throw Error('GitHub returned an unexpected release page.')}
      const etag=response.headers.get('etag');page={...(etag&&etag.length<1000?{etag}:{}),next:!!next,releases:raw.map(eligibleRelease).filter((r):r is Release=>!!r)}
     }
     pages.push(page);if(!page.next)break;if(n===4)throw Error('Release listing exceeded its page limit; view GitHub releases directly.')
    }finally{clearTimeout(timeout);this.controller=undefined}
    if(this.closed)throw Error('Release check stopped.')
   }
   if(this.closed)return this.view()
   this.saved.pages=pages;this.saved.releases=[...new Map(pages.flatMap(p=>p.releases).map(r=>[r.version,r])).values()];this.saved.checkedAt=new Date(this.clock()).toISOString();this.error='';await this.save()
  }catch(error){if(!this.closed){this.error=error instanceof Error&&error.message.startsWith('GitHub')||error instanceof Error&&error.message.startsWith('Release listing')?error.message:'Release checks are unavailable. Check your connection and try again.';await this.save().catch(()=>{})}}
  finally{this.checking=false;this.emit()}
  return this.view()
 }
 async dismiss(v:string){await this.load();if(this.view().version!==v)throw Error('The available release changed. Refresh its details.');const before=this.saved.dismissed;this.saved.dismissed=[...new Set([...before,v])].slice(-100);try{await this.save()}catch(error){this.saved.dismissed=before;throw error}this.emit();return this.view()}
 releaseToOpen(){const status=this.view();if(!status.version||status.releaseUrl!==releaseURL(status.version))throw Error('Check for an available release first.');return status.releaseUrl}
 close(){this.closed=true;clearTimeout(this.timer);this.controller?.abort()}
 async settled(){await this.pending}
}
