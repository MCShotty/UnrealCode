export type GitHubIssue = { number:number;title:string;body:string;url:string;state:string }
export type GitHubReviewComment = { id:number;body:string;path:string;line:number|null;url:string;author:string }
export type GitHubCheck = { name:string;state:string;url:string }
export type GitHubTaskSource = { kind:'issue'|'review-comment';url:string;number:number;commentId?:number }
export type GitHubRemoteState = { repository:string;remote:string;branch:string;head:string }
