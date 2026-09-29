export type BrowserGrant={enabled:boolean;origins:string[];interactOrigins:string[];ports:number[];cloudOrigins?:string[]}
export type BrowserTab={id:string;sessionId:string;url:string;title:string}
export type BrowserState={installed:boolean;running:boolean;grant:BrowserGrant;tabs:BrowserTab[];message:string}
export type BrowserAction={type:'navigate'|'snapshot'|'screenshot'|'click'|'fill'|'press'|'viewport'|'upload'|'download'|'close'|'takeover';tabId?:string;url?:string;selector?:string;text?:string;path?:string;downloadId?:string;width?:number;height?:number;x?:number;y?:number;frameIndex?:number}
export type SharedBrowserTab={id:string;url:string;title:string;loading:boolean;canGoBack:boolean;canGoForward:boolean;zoom:number;control:'user'|'agent'}
export type SharedBrowserState={tabs:SharedBrowserTab[];activeId?:string;grant:BrowserGrant;message:string}
export type SharedBrowserCommand={type:'new'|'navigate'|'select'|'close'|'back'|'forward'|'reload'|'stop'|'find'|'zoom'|'takeover'|'handback';tabId?:string;url?:string;query?:string;zoom?:number}
