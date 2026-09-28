import type {TaskPlan} from './planning'
import type {TurnState} from './lifecycle'
export type TimelineEvidence={seq:number;kind:string;at?:string;text:string}
export type TimelineSummary={id:string;workId:string;fromSeq:number;toSeq:number;planRevision:number;summary:string;stageId?:string;phase:'working'|'waiting'|'completed'|'blocked';evidence:number[];createdAt:string;provider:string;model:string;usage:{inputTokens:number;outputTokens:number}}
export type TimelineView={evidence:TimelineEvidence[];summaries:TimelineSummary[];plan?:TaskPlan;workId:string;state:TurnState;before?:number;status:'idle'|'analysing'|'unavailable'|'disabled';message?:string}
// The observer reads a larger evidence window than the compact rail displays.
// Page from the first displayed entry so the hidden part is never skipped.
export function timelineDisplayPage(view:TimelineView){const rows=view.evidence.slice(-12);return {rows:[...rows].reverse(),before:view.evidence.length>12?rows[0].seq:view.before}}
