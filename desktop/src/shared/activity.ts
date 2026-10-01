import type { CacheStatus } from './history'
import type { TurnState } from './lifecycle'

export type QuestionChoice = { id:string; label:string; description?:string; recommended?:boolean }
export type QuestionItem = { id:string; title:string; choices?:QuestionChoice[] }
export type QuestionAnswer = { questionId:string; choiceId?:string; text?:string }
export type QuestionRequest = { id:string; sessionId:string; workspaceId:string; revision:number; mode:'required'|'background'; state:'pending'|'submitting'|'answered'|'cancelled'|'interrupted'; questions:QuestionItem[]; answers?:QuestionAnswer[]; submissionId?:string; createdAt:string; updatedAt:string; seq:number; workId?:string }
export type QuestionSubmission = { sessionId:string; workspaceId:string; id:string; revision:number; submissionId:string; answers:QuestionAnswer[]; resume?:boolean }
export type WorkSummary = { id:string; sessionId:string; seq:number; endSeq?:number; segments?:Array<{seq:number;id:string}>; state:TurnState; messageIds:string[]; startedAt?:string; endedAt?:string; elapsedMs?:number; modelMs:number; toolMs:number; overlapMs:number; finalMessageId?:string; finalMessageIds?:string[]; failureSequence?:number; open:boolean }
export type WorkView = { works:WorkSummary[]; questions:QuestionRequest[]; activity?:Array<Pick<ActivityRow,'id'|'status'>>; cache:CacheStatus; connected:boolean }
export type ActivityState = 'executing'|'waiting_approval'|'waiting_input'|'waiting_service'|'completed'|'failed'|'cancelled'|'interrupted'
export type ActivityRow = { id:string; sessionId:string; workId:string; turnId?:string; name:string; arguments:string; seq:number; operationIds:string[]; status:ActivityState; startedAt?:string; endedAt?:string; durationMs?:number; workspace?:string; error?:string; exitCode?:number }
export type ActivityQuery = { search?:string; status?:'all'|ActivityState; workId?:string; offset?:number; limit?:number }
export type ActivityPage = { rows:ActivityRow[]; total:number; offset:number; hasMore:boolean; executing:number; waitingApproval:number; waitingInput:number; connected:boolean; cache:CacheStatus; work?:WorkSummary; totals:{modelMs:number;toolMs:number;overlapMs:number} }
export type ActivityDetail = { row:ActivityRow; output:string; offset:number; total:number; hasMore:boolean }
export type ConversationUI = { expanded:Record<string,boolean>; feedExpanded?:Record<string,boolean>; drafts:Record<string,{revision:number;submissionId:string;answers:QuestionAnswer[]}> }
