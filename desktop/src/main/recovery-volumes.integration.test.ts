import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { randomBytes,randomUUID } from 'node:crypto'
import { DockerRecoveryVolumes } from './recovery-volumes'
import { Recovery } from './recovery'
import { backendEnvironment } from './child-environment'
import { volumeRecords } from './state-volumes'

const run = promisify(execFile), volumes: string[] = []
let root = ''
const docker = async (...args: string[]) => (await run('docker', args, { windowsHide: true, timeout: 60000, env: backendEnvironment() })).stdout.trim()
afterEach(async () => {
  for (const volume of volumes.splice(0)) await docker('volume', 'rm', volume)
  if (root) await fs.rm(root, { recursive: true, force: true })
})

it.skipIf(process.env.UNREAL_TEST_DOCKER !== '1')('exports, finalizes, migrates and restores real Docker data under app-data virtualization', async () => {
  // AppData deliberately reproduces the redirected Windows launch environment.
  root = await fs.mkdtemp(join(process.env.APPDATA || tmpdir(), 'UnrealCode-recovery-fixture-'))
  const data = join(root, 'profile'), backup = join(root, 'backup'), project = join(root, 'project')
  await fs.mkdir(data); await fs.mkdir(project)
  const volume = `unrealcode-${randomBytes(10).toString('hex')}`; volumes.push(volume)
  await docker('volume', 'create', volume)
  const image = (await docker('image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', 'unrealcode')).split(/\r?\n/).find(name => /^unrealcode:[\w.-]+$/.test(name))
  if (!image) throw new Error('Build the UnrealCode backend image before running Docker recovery integration')
  const seed = `import os,json\nfrom pathlib import Path\np=Path('/state')\n(p/'sessions').mkdir();(p/'sessions'/'日本語.bin').write_bytes(bytes(range(256))*1025)\n(p/'sessions'/'empty').mkdir();(p/'sessions'/'zero').write_bytes(b'')\n(p/'desktop-config').mkdir();(p/'desktop-config'/'fixture.json').write_text(json.dumps(dict(mode='agent',teamEnabled=True,teamManaged=True,baseUrl='http://private')))\n(p/'.unrealcode-migrated').write_text('marker')\n(p/'excluded-secret').write_text('must-not-export')\nfor base,dirs,files in os.walk(p):\n for name in dirs+files: os.chown(os.path.join(base,name),10001,10001)\n`
  await docker('run', '--rm', '--network', 'none', '--user', '0:0', '--entrypoint', 'python3', '--mount', `type=volume,source=${volume},target=/state`, image, '-c', seed)
  await fs.writeFile(join(data, 'settings.json'), JSON.stringify({ recentProjects: [project], trustedProjects: [project], theme: 'dark' }))
  await fs.writeFile(join(data, 'state-volumes.json'), JSON.stringify([{ project, isolated: false, volume }]))
  await fs.writeFile(join(data, 'data-version.json'), JSON.stringify({ schema: 1 }))
  const legacy = join(data, 'workspaces', 'a'.repeat(64)); await fs.mkdir(legacy, { recursive: true }); await fs.writeFile(join(legacy, 'context.json'), '{}')
  const adapter = new DockerRecoveryVolumes(), recovery = new Recovery(data, 'test', adapter)
  expect((await recovery.export(backup)).volumes).toBe(1)
  expect((await recovery.preview(backup)).files).toBeGreaterThan(3)
  const files = join(backup, 'volumes', volume)
  expect(await fs.readFile(join(files, '.unrealcode-migrated'), 'utf8')).toBe('marker')
  expect((await fs.readFile(join(files, 'sessions', '日本語.bin'))).length).toBe(256 * 1025)
  expect(await fs.readdir(files)).not.toContain('excluded-secret')
  const requested=`unrealcode-restore-${randomUUID()}`,directOwner=randomUUID()
  const direct = await adapter.import(files,requested,directOwner); volumes.push(direct)
  expect(direct).toBe(requested)
  expect(await docker('volume','inspect','--format','{{ index .Labels "ai.unrealcode.restore-owner" }}',direct)).toBe(directOwner)
  await expect(adapter.import(files,requested)).rejects.toThrow('already exists')
  const directCopy = join(root, 'direct-copy'); await adapter.export(direct, directCopy)
  expect(await fs.readdir(join(directCopy, 'sessions', 'empty'))).toEqual([])
  expect(await recovery.migrate()).toBeTruthy()
  expect(JSON.parse(await fs.readFile(join(data, 'storage-layout.json'), 'utf8')).version).toBe(1)
  await recovery.restore(backup)
  const registry = JSON.parse(await fs.readFile(join(data, 'state-volumes.json'), 'utf8'))
  const restored = registry[0].volume; volumes.push(restored)
  expect(restored).not.toBe(volume)
  const areas=await fs.readdir(join(data,'recovery'))
  const journalPaths=await Promise.all(areas.map(async name=>{const path=join(data,'recovery',name,'volume-imports.json');return fs.stat(path).then(()=>path,()=>undefined)}))
  const journal=JSON.parse(await fs.readFile(journalPaths.find(Boolean)!,'utf8'))
  expect(journal.volumes[0].owner).toBe(await docker('volume','inspect','--format','{{ index .Labels "ai.unrealcode.restore-owner" }}',restored))
  const exported = join(root, 'restored'); await adapter.export(restored, exported)
  expect(await fs.readFile(join(exported, 'sessions', '日本語.bin'))).toEqual(await fs.readFile(join(files, 'sessions', '日本語.bin')))
  // The unchanged v1 manifest records files, not empty directories.
  expect((await fs.stat(join(exported, 'sessions', 'zero'))).size).toBe(0)
  expect(JSON.parse(await fs.readFile(join(exported, 'desktop-config', 'fixture.json'), 'utf8'))).toMatchObject({ mode: 'ask', teamEnabled: false, teamManaged: false, baseUrl: '' })
  const invalid = join(root, 'invalid'); await fs.mkdir(invalid); await fs.writeFile(join(invalid, 'secrets.json'), 'synthetic forbidden entry')
  const beforeVolumes = (await docker('volume', 'ls', '--format', '{{.Name}}')).split(/\r?\n/).sort()
  await expect(adapter.import(invalid)).rejects.toThrow('Unsupported recovery stream root')
  expect((await docker('volume', 'ls', '--format', '{{.Name}}')).split(/\r?\n/).sort()).toEqual(beforeVolumes)
  await docker('run', '--rm', '--network', 'none', '--user', '0:0', '--entrypoint', 'python3', '--mount', `type=volume,source=${volume},target=/state`, image, '-c', 'import os;os.symlink("/etc/passwd","/state/sessions/unsafe-link")')
  await expect(adapter.export(volume, join(root, 'rejected-export'))).rejects.toThrow()
  expect(await docker('ps', '-aq', '--filter', 'name=unrealcode-recovery-')).toBe('')
}, 120000)

it.skipIf(process.env.UNREAL_TEST_DOCKER !== '1')('exports and reattaches a verified volume after restore metadata fails',async()=>{
  root=await fs.mkdtemp(join(process.env.APPDATA||tmpdir(),'UnrealCode-retained-volume-fixture-'))
  const data=join(root,'profile'),rawProject=join(root,'project'),backup=join(root,'backup'),privateCopy=join(root,'private-copy')
  await fs.mkdir(data);await fs.mkdir(rawProject);const project=await fs.realpath(rawProject)
  const image=(await docker('image','ls','--format','{{.Repository}}:{{.Tag}}','unrealcode')).split(/\r?\n/).find(name=>/^unrealcode:[\w.-]+$/.test(name))
  if(!image)throw Error('Build the UnrealCode backend image before running Docker recovery integration')
  const source=`unrealcode-${randomBytes(10).toString('hex')}`;volumes.push(source)
  await docker('volume','create',source)
  await docker('run','--rm','--network','none','--user','0:0','--entrypoint','python3','--mount',`type=volume,source=${source},target=/state`,image,'-c','import os\nfrom pathlib import Path\np=Path("/state/sessions");p.mkdir();(p/"retained.txt").write_text("verified recovery fixture")\nos.chown(p,10001,10001);os.chown(p/"retained.txt",10001,10001)')
  await fs.writeFile(join(data,'settings.json'),JSON.stringify({recentProjects:[project]}))
  await fs.writeFile(join(data,'state-volumes.json'),JSON.stringify([{project,isolated:false,volume:source}]))
  const reportId=randomUUID();await fs.mkdir(join(data,'evaluations'));await fs.writeFile(join(data,'evaluations',`${reportId}.json`),JSON.stringify({id:reportId,arms:'malformed'}))
  const adapter=new DockerRecoveryVolumes(),recovery=new Recovery(data,'test',adapter)
  await recovery.export(backup)
  await expect(recovery.restore(backup)).rejects.toThrow('Invalid evaluation recovery metadata')
  const retained=(await recovery.retainedVolumes()).items[0]
  expect(retained).toMatchObject({status:'present',source,project,exportable:true,attachable:false})
  volumes.push(retained.volume)
  await recovery.exportRetainedVolume(retained.id,privateCopy)
  expect(await fs.readFile(join(privateCopy,'volume','sessions','retained.txt'),'utf8')).toBe('verified recovery fixture')
  await fs.unlink(join(data,'state-volumes.json'))
  expect((await recovery.retainedVolumes()).items[0].attachable).toBe(true)
  await recovery.attachRetainedVolume(retained.id,{volume:retained.volume,project,resolvedProject:retained.resolvedProject!})
  expect(volumeRecords(data)).toEqual([{project,isolated:false,volume:retained.volume}])
  expect((await recovery.retainedVolumes()).items).toEqual([])
},120000)
