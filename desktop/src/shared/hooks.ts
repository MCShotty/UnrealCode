export type ProjectHook={id:string;event:'beforeTool'|'afterTool'|'turnComplete'|'verification';tool:string;command:string;timeoutMs:number;enabled:boolean}
export type HookSettings={version:1;revision:number;hooks:ProjectHook[];trustedDigest?:string}
