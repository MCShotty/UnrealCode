import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ app: { isPackaged:true,getVersion: () => '0.3.0' } }))
import { backendSourceTag, DockerBridge } from './docker'

let folder = ''
afterEach(() => { if (folder) rmSync(folder, { recursive: true, force: true }); folder = '' })

describe('packaged backend identity', () => {
  it('an explicit rebuild runs the bundled build even when the image tag already exists',async()=>{
    folder=mkdtempSync(join(tmpdir(),'unrealcode-rebuild-'))
    for(const name of ['cmd','harness','internal','desktop/worker','desktop/third-party-licenses'])mkdirSync(join(folder,name),{recursive:true})
    for(const name of ['Dockerfile.desktop','.dockerignore','LICENSE','go.mod','go.sum'])writeFileSync(join(folder,name),name)
    const bridge=new DockerBridge(),commands:string[][]=[]
    const boundary=bridge as unknown as {sourceDirectory():string;hostCA():Promise<string|null>;docker(args:string[]):Promise<string>}
    vi.spyOn(boundary,'sourceDirectory').mockReturnValue(folder)
    vi.spyOn(boundary,'hostCA').mockResolvedValue(null)
    vi.spyOn(boundary,'docker').mockImplementation(async args=>{commands.push(args);return 'image-already-present'})
    await bridge.rebuild()
    expect(commands.some(args=>args[0]==='build'&&args.includes(join(folder,'Dockerfile.desktop')))).toBe(true)
  })
  it('changes the Docker tag when bundled backend source changes at the same app version', () => {
    folder = mkdtempSync(join(tmpdir(), 'unrealcode-backend-tag-'))
    for (const name of ['cmd', 'harness', 'internal', 'desktop/worker', 'desktop/third-party-licenses']) mkdirSync(join(folder, name), { recursive: true })
    for (const name of ['Dockerfile.desktop', '.dockerignore', 'LICENSE', 'go.mod', 'go.sum']) writeFileSync(join(folder, name), name)
    const source = join(folder, 'cmd', 'bridge.go')
    writeFileSync(source, 'first')
    const initial = backendSourceTag(folder, '0.3.0')
    writeFileSync(source, 'second')
    expect(backendSourceTag(folder, '0.3.0')).not.toBe(initial)
    expect(backendSourceTag(folder, '0.3.1')).not.toBe(initial)
    const beforeNotice=backendSourceTag(folder,'0.3.0')
    writeFileSync(join(folder,'desktop/third-party-licenses/NOTICE.txt'),'updated license notice')
    expect(backendSourceTag(folder,'0.3.0')).not.toBe(beforeNotice)
  })
})
