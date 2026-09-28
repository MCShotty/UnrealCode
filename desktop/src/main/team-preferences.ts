import { defaultTeamPreferences,validateTeamOptions,type TeamPreferences } from '../shared/teams'
import { atomicMetadata } from './atomic-metadata'
import { readBoundedJSON } from './bounded-file-read'
export class TeamPreferenceStore {
  constructor(private path:string){}
  async read():Promise<TeamPreferences>{try{return this.validate(await readBoundedJSON<TeamPreferences>(this.path,1024*1024))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return structuredClone(defaultTeamPreferences);throw error}}
  private validate(value:TeamPreferences):TeamPreferences{
    if(!value||value.version!==1||!Array.isArray(value.profiles)||value.profiles.length!==4)throw Error('Invalid specialist preferences')
    for(const role of defaultTeamPreferences.profiles.map(x=>x.role)){const matches=value.profiles.filter(x=>x.role===role);if(matches.length!==1)throw Error('Provide each specialist role exactly once');const profile=matches[0];if(profile.limits)for(const [name,max] of [['modelRequestLimit',10000],['tokenLimit',10000000],['elapsedMinutes',1440]] as const)if(!Number.isSafeInteger(profile.limits[name])||profile.limits[name]<0||profile.limits[name]>max)throw Error('Invalid role limit');if(profile.baseUrl!==undefined&&(typeof profile.baseUrl!=='string'||profile.baseUrl.length>2000))throw Error('Invalid specialist endpoint');if(profile.baseUrl){const endpoint=new URL(profile.baseUrl);if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw Error('Use an HTTP(S) endpoint without embedded credentials')}if(!['inherit','openai','openai-codex','anthropic','openrouter','fireworks','ollama','openai-compatible'].includes(profile.provider)||typeof profile.model!=='string'||profile.model.length>200||typeof profile.instructions!=='string'||profile.instructions.length>16000||typeof profile.description!=='string'||profile.description.length>1000||!['','low','medium','high','xhigh','max'].includes(profile.thinkingLevel)||!Array.isArray(profile.disallowedTools)||profile.disallowedTools.length>100||profile.disallowedTools.some(x=>typeof x!=='string'||x.length>200))throw Error('Invalid specialist profile');if(profile.provider!=='inherit'&&!profile.model.trim())throw Error('Choose a model for the specialist provider')}
    return {version:1,options:validateTeamOptions(value.options),profiles:structuredClone(value.profiles)}
  }
  async save(value:TeamPreferences):Promise<TeamPreferences>{const valid=this.validate(value);await atomicMetadata(this.path,JSON.stringify(valid));return valid}
}
