import { validateTeamOptions, type TeamOptions, type DelegationPolicy } from '../shared/teams'
export type TaskOptionsDraft = { policy: DelegationPolicy; concurrency: string; workerLimit: string; modelRequestLimit: string; elapsedMinutes: string; tokenLimit: string }
export function appliedPolicy(options: TeamOptions): DelegationPolicy { return options.allowSpecialists ? options.policy === 'manual' ? 'manual' : 'automatic' : 'off' }
export function editTaskOptions(options: TeamOptions): TaskOptionsDraft {
  return { policy: appliedPolicy(options), concurrency: String(options.concurrency), workerLimit: String(options.workerLimit), modelRequestLimit: options.modelRequestLimit ? String(options.modelRequestLimit) : '', elapsedMinutes: options.elapsedMinutes ? String(options.elapsedMinutes) : '', tokenLimit: options.tokenLimit ? String(options.tokenLimit) : '' }
}
export function commitTaskOptions(draft: TaskOptionsDraft): TeamOptions {
  const number = (text: string, optional = false) => {
    if (!text.trim() && optional) return 0
    if (!/^\d+$/.test(text.trim())) throw Error('Enter whole numbers for task limits, or leave optional limits blank.')
    return Number(text)
  }
  return validateTeamOptions({ allowSpecialists: draft.policy !== 'off', policy: draft.policy, concurrency: number(draft.concurrency), workerLimit: number(draft.workerLimit), modelRequestLimit: number(draft.modelRequestLimit, true), elapsedMinutes: number(draft.elapsedMinutes, true), tokenLimit: number(draft.tokenLimit, true) })
}
