export type BackupPreview = { id:string; createdAt:string; version:string; profile:string; files:number; bytes:number; volumes:number; warnings:string[] }
export type StorageItem = { id:string; category:'checkpoints'|'index'|'worktrees'|'models'|'backups'; path:string; bytes:number; removable:boolean; reason:string }
export type RecoveryStatus = { busy:boolean; message:string; migrationError?:string; lastBackup?:string }
export type UpdateState = { channel:'stable'|'preview'; state:'unavailable'|'idle'|'checking'|'available'|'downloading'|'ready'|'error'; message:string; version?:string; percent?:number }
