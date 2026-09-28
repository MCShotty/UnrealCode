export type BrowserGrant={enabled:boolean;origins:string[];interactOrigins:string[];ports:number[]}
export type BrowserTab={id:string;sessionId:string;url:string;title:string}
export type BrowserState={installed:boolean;running:boolean;grant:BrowserGrant;tabs:BrowserTab[];message:string}
export type BrowserAction={type:'navigate'|'snapshot'|'screenshot'|'click'|'fill'|'press'|'viewport'|'upload'|'download'|'close'|'takeover';tabId?:string;url?:string;selector?:string;text?:string;path?:string;downloadId?:string;width?:number;height?:number;x?:number;y?:number}
