export type DocumentHandle={id:string;name:string;path:string;source:'project'|'external';revision:string;pages:number;title:string}
export type DocumentPage={page:number;text:string;method:'embedded'|'ocr';truncated:boolean;confidence?:number;language?:'eng'|'ara'}
export type DocumentSearchPage={matches:Array<{page:number;excerpt:string}>;nextPage?:number}
