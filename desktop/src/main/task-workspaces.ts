import { storageLocation } from './storage-locations'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { CheckpointStore, type Snapshot } from './checkpoints'
import { editorPath } from './editor-files'
import { projectWrite,projectDelete,projectPrune } from './project-fs'
import type { TaskWorkspace, WorkspacePreview } from '../shared/task-workspaces'
import type { GitAvailability } from '../shared/api'
import { atomicMetadata } from './atomic-metadata'

const exec = promisify(execFile)
async function canonicalLocation(path:string):Promise<string>{const missing:string[]=[];let current=resolve(path);for(;;){try{return join(await fs.realpath(current),...missing.reverse())}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||dirname(current)===current)throw error;missing.push(basename(current));current=dirname(current)}}}
type StoredWorkspace = TaskWorkspace & { baseline: Snapshot; archive?: { snapshot:Snapshot; revision:string } }
export class TaskWorkspaces {
  private source: CheckpointStore
  private serial = Promise.resolve()
  private metadataTail = Promise.resolve()
  constructor(readonly project: string, private directory: string, private recoveryStore = new CheckpointStore(project, join(directory, 'integration-recovery'))) { this.source = new CheckpointStore(project, join(directory, 'snapshot-data')) }
  private async git(args: string[], cwd = this.project): Promise<string> { const { stdout } = await exec('git', args, { cwd, windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }); return stdout.trim() }
  private metadata(id: string): string { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid task workspace'); return join(this.directory, `${id}.json`) }
  private async read(id: string): Promise<StoredWorkspace> { const value: StoredWorkspace = JSON.parse(await fs.readFile(this.metadata(id), 'utf8'));const expected=storageLocation(this.directory,'worktrees',id,join(this.directory,'worktrees',id));if(value.id!==id||typeof value.path!=='string')throw Error('Invalid owned workspace metadata');if(value.path!==expected){const [actual,registered]=await Promise.all([canonicalLocation(value.path),canonicalLocation(expected)]);if(actual!==registered)throw Error('Invalid owned workspace metadata')} Object.setPrototypeOf(value.baseline.files, null); Object.setPrototypeOf(value.baseline.skipped, null); return value }
  private save(value: StoredWorkspace): Promise<void> { return atomicMetadata(this.metadata(value.id),JSON.stringify(value)) }
  private view({ baseline: _, archive: _archive, ...value }: StoredWorkspace): TaskWorkspace { return value }
  async availability(): Promise<GitAvailability> {
    let project:string
    try { project=await fs.realpath(this.project) }
    catch { return {available:false,code:'GIT_INACCESSIBLE',message:'The project folder is inaccessible. Reopen it before enabling Agent team.'} }
    try { await this.git(['--version']) }
    catch(error) { return (error as NodeJS.ErrnoException).code==='ENOENT' ? {available:false,code:'GIT_MISSING',message:'Git for Windows is unavailable. Install Git, then retry Agent team.'} : {available:false,code:'GIT_INACCESSIBLE',message:'Git could not run. Check its installation and access to this project, then retry Agent team.'} }
    let root:string
    try { root=await fs.realpath(await this.git(['rev-parse','--show-toplevel'])) }
    catch(error) { return /not a git repository/i.test(String((error as {stderr?:string}).stderr||error)) ? {available:false,code:'GIT_REPOSITORY_REQUIRED',message:'Agent team needs a Git repository. Open one at its root; no GitHub login is required.'} : {available:false,code:'GIT_INACCESSIBLE',message:'The repository could not be inspected. Check Git and folder access, then retry Agent team.'} }
    if(root.toLowerCase()!==project.toLowerCase())return {available:false,code:'GIT_ROOT_REQUIRED',message:`Open the repository root (${root}) as the project before enabling Agent team.`}
    try { await this.git(['rev-parse','--verify','HEAD']) }
    catch(error) { return /needed a single revision|unknown revision|ambiguous argument|valid object name|does not have any commits/i.test(String((error as {stderr?:string}).stderr||error)) ? {available:false,code:'GIT_COMMIT_REQUIRED',message:'Make an initial Git commit before enabling Agent team. Uncommitted later changes are supported.'} : {available:false,code:'GIT_INACCESSIBLE',message:'The repository HEAD could not be inspected. Check Git permissions, then retry Agent team.'} }
    return {available:true}
  }
  async available(): Promise<boolean> { return (await this.availability()).available }
  async list(): Promise<TaskWorkspace[]> {
    let names: string[]; try { names = await fs.readdir(this.directory) } catch { return [] }
    return Promise.all(names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(async name => this.view(await this.read(name.slice(0,-5)))))
  }
  async recover(): Promise<void> { for (const item of await this.list()) {if(item.state==='running')await this.update(item.id,{state:'interrupted'});else if(item.state==='integrated'){const value=await this.read(item.id);if(value.archive&&!await fs.stat(value.path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error}))await this.update(item.id,{state:'archived'})}} }
  private mutate<T>(work: () => Promise<T>): Promise<T> { const run = this.metadataTail.then(work); this.metadataTail = run.then(() => {}, () => {}); return run }
  private patch(id: string, change: (value: StoredWorkspace) => void): Promise<TaskWorkspace> { return this.mutate(async () => { const value = await this.read(id); change(value); await this.save(value); return this.view(value) }) }
  update(id: string, patch: Partial<Pick<TaskWorkspace, 'sessionId' | 'state' | 'title' | 'usage' | 'usageRecords' | 'outcomes'>>): Promise<TaskWorkspace> { return this.mutate(async () => { const value = await this.read(id); const outcomes=patch.outcomes?{...value.outcomes,...patch.outcomes}:value.outcomes; Object.assign(value, patch, {outcomes}); await this.save(value); return this.view(value) }) }
  link(id: string, sessionId: string): Promise<void> { return this.mutate(async () => { const value = await this.read(id); value.linkedSessions = [...new Set([...(value.linkedSessions || []), sessionId])]; await this.save(value) }) }
  async prepare(recorded?: { store:CheckpointStore; snapshot:Snapshot; label:string },requestedId?:string): Promise<TaskWorkspace> {
    if(requestedId){
      if(!/^[a-f0-9-]{36}$/.test(requestedId))throw Error('Invalid queued task workspace identity')
      try{await fs.stat(this.metadata(requestedId));return this.view(await this.read(requestedId))}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    }
    if (!await this.available()) throw new Error('Isolated tasks need a committed Git repository opened at its root')
    const revision = await this.git(['rev-parse', 'HEAD']), id = requestedId||randomUUID(), branch = `unrealcode/task-${id.slice(0,8)}`
    const baseline = recorded ? await this.source.importSnapshot(recorded.store, recorded.snapshot) : await this.source.captureSnapshot()
    const path = storageLocation(this.directory,'worktrees',id,join(this.directory,'worktrees',id))
    const value: StoredWorkspace = { id, path, branch, revision, createdAt: new Date().toISOString(), capturedFiles: Object.keys(baseline.files).length, state: 'prepared', title: recorded ? `Specialist from ${recorded.label}` : 'New isolated task', omitted: baseline.skipped, baseline }
    await this.save(value)
    return this.view(value)
  }
  async materialize(id: string): Promise<TaskWorkspace> {
    const value = await this.read(id)
    if (value.state !== 'prepared') throw new Error('Task snapshot has already been used')
    await fs.mkdir(dirname(value.path), { recursive: true })
    await this.git(['worktree', 'add', '-b', value.branch, value.path, value.revision])
    try {
      await this.writeSnapshot(value.path, value.baseline)
      return this.update(id, { state: 'interrupted' })
    } catch (error) { await this.update(id, { state: 'interrupted' }); throw new Error(`Workspace preparation failed; retained at ${value.path}: ${String(error)}`) }
  }
  async materializeQueued(id:string):Promise<TaskWorkspace>{
    const value=await this.read(id)
    if(value.sessionId||!['prepared','interrupted'].includes(value.state))throw Error('This queued workspace has linked or later work. Review it before starting another attempt.')
    const existing=await fs.lstat(value.path).then(stat=>stat,error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error})
    if(!existing){
      if(value.state!=='prepared')throw Error('The queued worktree is missing. Review the retained task before retrying.')
      return this.materialize(id)
    }
    if(!existing.isDirectory()||existing.isSymbolicLink())throw Error('The queued worktree path is no longer a normal directory. Review it before retrying.')
    const [actualRoot,expectedRoot,branch,snapshot]=await Promise.all([
      this.git(['rev-parse','--show-toplevel'],value.path).then(path=>fs.realpath(path)),
      fs.realpath(value.path),
      this.git(['symbolic-ref','--short','HEAD'],value.path),
      new CheckpointStore(value.path,join(this.directory,'snapshot-data')).captureSnapshot()
    ])
    if(actualRoot.toLowerCase()!==expectedRoot.toLowerCase()||branch!==value.branch)throw Error('The queued worktree registration changed. Review it before retrying.')
    const before=Object.entries(value.baseline.files),after=Object.entries(snapshot.files)
    if(before.length!==after.length||before.some(([path,entry])=>snapshot.files[path]?.hash!==entry.hash||snapshot.files[path]?.mode!==entry.mode)||
      Object.keys(snapshot.skipped).some(path=>!value.baseline.skipped[path])||Object.keys(value.baseline.skipped).some(path=>!snapshot.skipped[path]))throw Error('The queued worktree changed or its snapshot is incomplete. Review it before retrying.')
    return value.state==='prepared'?this.update(id,{state:'interrupted'}):this.view(value)
  }
  private async writeSnapshot(path: string, snapshot: Snapshot): Promise<void> {
    const tracked = (await this.git(['ls-files', '-z'], path)).split('\0').filter(Boolean)
    for (const name of tracked) if (!snapshot.files[name] && !snapshot.skipped[name]) {
      const target = await editorPath(path, name)
      await projectDelete(path,name).catch(error => { if (error.code !== 'ENOENT') throw error })
      await projectPrune(path,name).catch(error=>{if(error.code!=='ENOENT')throw error})
    }
    for (const [name, entry] of Object.entries(snapshot.files)) {
      await editorPath(path, name)
      await projectWrite(path,name,(await this.source.snapshotBytes(snapshot,name))!,{mode:entry.mode,replaceDirectory:true})
    }
  }
  async preview(id: string): Promise<WorkspacePreview> {
    const value = await this.read(id), task = new CheckpointStore(value.path, join(this.directory, 'snapshot-data'))
    const [after, current] = await Promise.all([task.captureSnapshot(), this.source.captureSnapshot()])
    const omitted = { ...value.omitted, ...after.skipped, ...current.skipped }
    const changes: WorkspacePreview['changes'] = []
    for (const path of new Set([...Object.keys(value.baseline.files), ...Object.keys(after.files)])) {
      const before = value.baseline.files[path], next = after.files[path]
      if (before?.hash === next?.hash && before?.mode === next?.mode) continue
      const [a, b] = await Promise.all([this.source.snapshotBytes(value.baseline, path), task.snapshotBytes(after, path)])
      const binary = !!a?.includes(0) || !!b?.includes(0)
      changes.push({ path, change: !before ? 'added' : !next ? 'deleted' : 'modified', binary, conflict: !!omitted[path] || current.files[path]?.hash !== before?.hash || current.files[path]?.mode !== before?.mode, reason: omitted[path], before: binary ? undefined : a?.toString('utf8'), after: binary ? undefined : b?.toString('utf8') })
    }
    return { workspace: this.view(value), changes, omitted }
  }
  async archivePreview(id:string):Promise<{path:string;files:number;bytes:number}>{
    const value=await this.read(id);if(value.state!=='integrated')throw new Error('Only fully integrated tasks can be archived. Retained or unfinished work stays available.')
    const preview=await this.preview(id);if(preview.changes.length||Object.keys(preview.omitted).length)throw new Error('Task has later or uncaptured edits. Review it before archiving.')
    const ignored=await this.git(['ls-files','--others','--ignored','--exclude-standard','-z'],value.path);if(ignored)throw new Error('This workspace contains ignored files. Preserve or remove them explicitly before archiving; UnrealCode will not discard them.')
    const store=new CheckpointStore(value.path,join(this.directory,'snapshot-data')),snapshot=await store.captureSnapshot();if(Object.keys(snapshot.skipped).length)throw new Error('Some task files cannot be captured; archive is blocked')
    return {path:value.path,files:Object.keys(snapshot.files).length,bytes:Object.values(snapshot.files).reduce((total,item)=>total+item.size,0)}
  }
  archive(id:string):Promise<void>{const run=this.serial.then(async()=>{
    await this.archivePreview(id);const value=await this.read(id),store=new CheckpointStore(value.path,join(this.directory,'snapshot-data'))
    const snapshot=await this.source.importSnapshot(store,await store.captureSnapshot()),revision=await this.git(['rev-parse','HEAD'],value.path)
    // The recovery snapshot is persisted before removing the checkout. Session
    // volumes and the task branch remain. No unfinished task is eligible.
    await this.patch(id,current=>{current.archive={snapshot,revision}})
    await this.archivePreview(id)
    const current=await store.captureSnapshot();if(Object.keys(current.skipped).length||Object.keys(current.files).length!==Object.keys(snapshot.files).length||Object.entries(snapshot.files).some(([name,entry])=>current.files[name]?.hash!==entry.hash||current.files[name]?.mode!==entry.mode))throw new Error('Workspace changed during archive preparation')
    await this.git(['worktree','remove','--force',value.path]);await this.update(id,{state:'archived'})
  });this.serial=run.catch(()=>{});return run}
  async restoreArchived(id:string):Promise<TaskWorkspace>{
    const value=await this.read(id);if(value.state!=='archived')return this.view(value);if(!value.archive)throw new Error('Archived task is missing its recovery snapshot')
    if((await this.git(['rev-parse',value.branch]))!==value.archive.revision)throw new Error('The retained task branch changed. Recover the snapshot before reopening this workspace.')
    await fs.mkdir(dirname(value.path),{recursive:true});await this.git(['worktree','add',value.path,value.branch])
    try{await this.writeSnapshot(value.path,value.archive.snapshot);return await this.update(id,{state:'integrated'})}
    catch(error){await this.update(id,{state:'interrupted'});throw error}
  }
  integrate(id: string, paths: string[]): Promise<string> {
    const run = this.serial.then(() => this.apply(id, paths)); this.serial = run.then(() => {}, () => {}); return run
  }
  private async apply(id: string, paths: string[]): Promise<string> {
    if (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length) throw new Error('Select distinct files to integrate')
    const preview = await this.preview(id), value = await this.read(id)
    if (value.state === 'running') throw new Error('Stop active task work before integrating')
    for (const path of paths) { const change = preview.changes.find(item => item.path === path); if (!change || change.conflict) throw new Error(`Later edits conflict with integration: ${path}`) }
    const task = new CheckpointStore(value.path, join(this.directory, 'snapshot-data')), after = await task.captureSnapshot()
    const recoveryStore = this.recoveryStore
    const recovery = await recoveryStore.begin(value.sessionId || id, randomUUID(), 'Recovery before task integration')
    try {
      // Remove old leaves before creating their replacement parent or children.
      const ordered = [...paths].sort((a,b) => Number(!!after.files[a]) - Number(!!after.files[b]))
      for (const path of ordered) {
        const fresh = await this.source.captureSnapshot([path])
        if (fresh.skipped[path] || fresh.files[path]?.hash !== value.baseline.files[path]?.hash || fresh.files[path]?.mode !== value.baseline.files[path]?.mode) throw new Error(`File changed during integration: ${path}`)
        const target = await editorPath(this.project, path), bytes = await task.snapshotBytes(after, path)
        if (bytes === undefined) { await projectDelete(this.project,path,value.baseline.files[path]?.hash||'missing');await projectPrune(this.project,path) }
        else { await projectWrite(this.project,path,bytes,{expected:value.baseline.files[path]?.hash||'missing',mode:after.files[path].mode,replaceDirectory:true}) }
        // Advance only successfully applied paths. Future edits in this task can
        // be reviewed again without discarding unrelated source conflicts.
        const captured = await this.source.captureSnapshot([path])
        await this.patch(id,current=>{if(captured.files[path])current.baseline.files[path]=captured.files[path];else delete current.baseline.files[path]})
      }
      await recoveryStore.finish(recovery)
      const remaining = await this.preview(id)
      await this.update(id,{state:remaining.changes.length || Object.keys(remaining.omitted).length ? 'review' : 'integrated'})
      return recovery
    } catch (error) { await recoveryStore.finish(recovery, `Integration interrupted: ${String(error)}`); throw error }
  }
}
