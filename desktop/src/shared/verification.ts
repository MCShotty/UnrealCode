export type WorkflowTemplate={id:string;name:string;kind:'review'|'test'|'fix';prompt:string}
export type VerificationProfile={id:string;name:string;command:string;timeoutSeconds:number}
export type WorkflowPresets={templates:WorkflowTemplate[];profiles:VerificationProfile[]}
export type VerificationResult={id:string;command:string;exitCode:number;output:string;durationMs:number;cancelled:boolean}
export type WorkflowRun={id:string;sessionId:string;createdAt:string;profile:VerificationProfile;repairTemplate?:WorkflowTemplate;maxRepairAttempts:number;repairsStarted:number;state:'running'|'repairing'|'passed'|'failed'|'cancelled'|'interrupted';attempts:VerificationResult[];message?:string}
export const defaultWorkflowPresets:WorkflowPresets={profiles:[],templates:[
 {id:'review',name:'Review changes',kind:'review',prompt:'Review the current changes for correctness, regressions and missing verification. Report concrete findings with file references. Do not change files unless I ask.'},
 {id:'test',name:'Find verification gaps',kind:'test',prompt:'Inspect the changes and existing tests. Identify focused verification that would exercise the affected behavior, then run allowed checks and report observed results.'},
 {id:'fix',name:'Fix a failing check',kind:'fix',prompt:'Fix the reported verification failure with the smallest correct change. Inspect the relevant code and preserve unrelated work. Report your changes and any remaining uncertainty.'}
]}
export function validatePresets(value:WorkflowPresets):WorkflowPresets {
 if(!value||!Array.isArray(value.templates)||!Array.isArray(value.profiles)||value.templates.length>30||value.profiles.length>30)throw new Error('Keep at most 30 templates and 30 verification profiles')
 const ids=new Set<string>()
 for(const item of [...value.templates,...value.profiles]){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>100)throw new Error('Workflow names and unique IDs are required');ids.add(item.id)}
 for(const template of value.templates)if(!['review','test','fix'].includes(template.kind)||typeof template.prompt!=='string'||!template.prompt.trim()||template.prompt.length>16000)throw new Error('Each template needs a supported kind and a prompt below 16000 characters')
 for(const profile of value.profiles)if(typeof profile.command!=='string'||!profile.command.trim()||profile.command.length>4000||!Number.isInteger(profile.timeoutSeconds)||profile.timeoutSeconds<1||profile.timeoutSeconds>600)throw new Error('Each profile needs a command below 4000 characters and a 1–600 second timeout')
 return structuredClone(value)
}
