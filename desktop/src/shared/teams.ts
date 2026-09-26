import type { UsageTotals } from './api'

export type SpecialistRole = 'explorer' | 'implementer' | 'reviewer'
export type TeamOptions = { allowSpecialists: boolean; concurrency: number; workerLimit: number; modelRequestLimit: number; elapsedMinutes: number; tokenLimit: number }
export const defaultTeamOptions: TeamOptions = { allowSpecialists: false, concurrency: 2, workerLimit: 4, modelRequestLimit: 0, elapsedMinutes: 0, tokenLimit: 0 }
export type WorkerAssignment = { role: SpecialistRole; assignment: string; ownership: string[] }
export type SpecialistWorker = WorkerAssignment & {
  id: string; requestId: string; requestDigest: string; parentSessionId: string; createdAt: string;
  sessionId?: string; workspaceId?: string; path?: string; snapshot?: string; omitted?: Record<string,string>;
  state: 'starting' | 'running' | 'waiting_input' | 'review' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'integrated' | 'retained';
  message?: string; findings?: string;
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
  return { allowSpecialists:value.allowSpecialists,concurrency:value.concurrency,workerLimit:value.workerLimit,modelRequestLimit:value.modelRequestLimit,elapsedMinutes:value.elapsedMinutes,tokenLimit:value.tokenLimit }
}
export function validateAssignment(value: WorkerAssignment): WorkerAssignment {
  if (!value || !['explorer','implementer','reviewer'].includes(value.role) || typeof value.assignment!=='string' || !value.assignment.trim() || value.assignment.length>16000 || !Array.isArray(value.ownership) || !value.ownership.length || value.ownership.length>30 || value.ownership.some(item=>typeof item!=='string'||!item.trim()||item.length>500)) throw new Error('Give the specialist a role, bounded assignment and explicit file or responsibility ownership')
  return { role:value.role,assignment:value.assignment.trim(),ownership:value.ownership.map(item=>item.trim()) }
}
