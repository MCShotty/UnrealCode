import type {Provider} from './api'
export type MemoryProfile={provider:Provider;model:string;baseUrl:string;thinkingLevel:string;requestLimit:number;tokenLimit:number}
export type MemorySettings={version:1;enabled:boolean;profile?:MemoryProfile;verifiedProfile?:string;projects:string[]}
export type MemoryRecord={id:string;sessionId:string;turnId:string;workspace:string;content:string;sourceRefs:string[];sourceFiles?:Array<{path:string;sha256:string}>;createdAt:string;state:'pending'|'retained'|'failed'|'forgotten';attempts:number;error?:string;correction?:boolean;revision?:number;deletionPending?:boolean}
export type MemoryRecordPage={records:MemoryRecord[];total:number;olderCursor?:string}
export type MemoryStatus={state:'disabled'|'unconfigured'|'starting'|'ready'|'unavailable';message:string;pending:number;records:MemoryRecord[];totalRecords:number;inputTokens:number;outputTokens:number;requests:number;settings:MemorySettings}
