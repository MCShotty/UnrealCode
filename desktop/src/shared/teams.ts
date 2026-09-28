import type { UsageTotals } from './api'

export type SpecialistRole = 'explorer' | 'implementer' | 'reviewer' | 'browser-tester'
export type DelegationPolicy = 'off' | 'manual' | 'automatic'
export type TeamOptions = { allowSpecialists: boolean; policy?:DelegationPolicy; concurrency: number; workerLimit: number; modelRequestLimit: number; elapsedMinutes: number; tokenLimit: number }
export const defaultTeamOptions: TeamOptions = { allowSpecialists: false, concurrency: 2, workerLimit: 4, modelRequestLimit: 0, elapsedMinutes: 0, tokenLimit: 0 }
export type WorkerAssignment = { role: SpecialistRole; assignment: string; ownership: string[]; expectedResult?:string; acceptance?:string[] }
export type SpecialistWorker = WorkerAssignment & {
  id: string; requestId: string; requestDigest: string; parentSessionId: string; createdAt: string;
  sessionId?: string; workspaceId?: string; path?: string; snapshot?: string; omitted?: Record<string,string>;
  state: 'queued' | 'starting' | 'running' | 'waiting_input' | 'review' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'integrated' | 'retained';
  message?: string; findings?: string; limits?:{modelRequestLimit:number;tokenLimit:number;elapsedMinutes:number}; elapsedMs?:number;
}
export type TeamTask = {
  parentSessionId: string; options: TeamOptions; paused: boolean; message?: string;
  parentState: 'idle' | 'running' | 'waiting_input' | 'stopped' | 'failed';
  workers: SpecialistWorker[]; modelRequests: number; elapsedMs: number;
  usage: Record<string,UsageTotals>; permits: string[];
}
export type TeamView = Omit<TeamTask,'permits'> & { parentUsage: UsageTotals; workerUsage: UsageTotals; totalUsage: UsageTotals; globalActiveWorkers: number }
export function validateTeamOptions(value: TeamOptions): TeamOptions {
  if (!value || typeof value.allowSpecialists !== 'boolean') throw new Error('Choose whether this task may use specialists')
  for (const [field,min,max] of [['concurrency',1,4],['workerLimit',1,100],['modelRequestLimit',0,100000],['elapsedMinutes',0,10080],['tokenLimit',0,1000000000]] as const) {
    if (!Number.isSafeInteger(value[field]) || value[field]<min || value[field]>max) throw new Error(`Invalid task limit: ${field}`)
  }
  if(value.policy!==undefined&&!['off','manual','automatic'].includes(value.policy))throw Error('Invalid delegation policy')
  return { allowSpecialists:value.allowSpecialists,policy:value.allowSpecialists?value.policy==='manual'?'manual':'automatic':'off',concurrency:value.concurrency,workerLimit:value.workerLimit,modelRequestLimit:value.modelRequestLimit,elapsedMinutes:value.elapsedMinutes,tokenLimit:value.tokenLimit }
}
export function validateAssignment(value: WorkerAssignment): WorkerAssignment {
  if (!value || !['explorer','implementer','reviewer','browser-tester'].includes(value.role) || typeof value.assignment!=='string' || !value.assignment.trim() || value.assignment.length>16000 || !Array.isArray(value.ownership) || !value.ownership.length || value.ownership.length>30 || value.ownership.some(item=>typeof item!=='string'||!item.trim()||item.length>500)) throw new Error('Give the specialist a role, bounded assignment and explicit file or responsibility ownership')
  if(value.expectedResult!==undefined&&(typeof value.expectedResult!=='string'||value.expectedResult.length>4000))throw Error('Expected result must be bounded text')
  if(value.acceptance!==undefined&&(!Array.isArray(value.acceptance)||value.acceptance.length>30||value.acceptance.some(x=>typeof x!=='string'||!x.trim()||x.length>2000)))throw Error('Invalid acceptance criteria')
  return { role:value.role,assignment:value.assignment.trim(),ownership:value.ownership.map(item=>item.trim()),expectedResult:value.expectedResult,acceptance:value.acceptance }
}

export type RoleProfile={role:SpecialistRole;description:string;instructions:string;provider:'inherit'|import('./api').Provider;model:string;baseUrl?:string;limits?:{modelRequestLimit:number;tokenLimit:number;elapsedMinutes:number};thinkingLevel:string;disallowedTools:string[]}
export type TeamPreferences={version:1;options:TeamOptions;profiles:RoleProfile[]}
export const defaultTeamPreferences:TeamPreferences={version:1,options:{...defaultTeamOptions,policy:'off'},profiles:(['explorer','implementer','reviewer','browser-tester'] as SpecialistRole[]).map(role=>({role,description:role==='explorer'?'Investigate code and return cited findings':role==='implementer'?'Implement the assigned change and verify it':role==='reviewer'?'Review correctness, risks and verification':'Exercise browser workflows and report reproducible failures',instructions:'',provider:'inherit',model:'',thinkingLevel:'',disallowedTools:[]}))}
