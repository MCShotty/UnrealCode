export type PlanMilestone={id:string;text:string;state:'pending'|'running'|'completed';evidence:string[]}
export type TaskPlan={revision:number;objective:string;body:string;acceptance:string[];milestones:PlanMilestone[];updatedAt:string;approvedRevision?:number}
export type Goal={objective:string;state:'paused'|'running'|'waiting_input'|'completed'|'limited';requestLimit:number;tokenLimit:number;elapsedMinutes:number;requests:number;tokens:number;elapsedMs:number;lastSequence:number;workerSequences?:Record<string,number>;message?:string;permits?:string[];evidence?:string[]}
export type PlanningState={version:1;plan?:TaskPlan;revisions:TaskPlan[];goal?:Goal;executionRevision?:number}
export function executingPlan(state:PlanningState):TaskPlan|undefined{
 const plans=[...(state.revisions||[]),...(state.plan?[state.plan]:[])]
 return state.executionRevision!==undefined?plans.find(plan=>plan.revision===state.executionRevision&&plan.approvedRevision===plan.revision):plans.reverse().find(plan=>plan.approvedRevision===plan.revision)
}
