import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { durableRoots, safeRelative } from './recovery-files'
import {storageEntries,storageMkdir,openConfinedStream} from './project-fs'

// A private streaming transport, not the on-disk backup format. No host paths
// cross the Docker boundary: MSIX can give the two processes different views.
const chunkBytes = 64 * 1024
const maxLine = 128 * 1024
const maxBytes = 50 * 1024 ** 3
const maxEntries = 250000
const line = (value: object): Buffer => Buffer.from(JSON.stringify(value) + '\n')

class Inventory {
  private paths = new Set<string>()
  private bytes = 0
  add(path: string, size = 0): void {
    safeRelative(path)
    if (!durableRoots.includes(path.split('/')[0])) throw new Error('Unsupported recovery stream root')
    const key = path.toLowerCase()
    if (this.paths.has(key)) throw new Error('Duplicate recovery stream path')
    if (this.paths.size >= maxEntries || !Number.isSafeInteger(size) || size < 0 || (this.bytes += size) > maxBytes) throw new Error('Recovery stream exceeds limits')
    this.paths.add(key)
  }
}

async function* records(source: AsyncIterable<Buffer | string>): AsyncGenerator<Record<string, unknown>> {
  let pending = Buffer.alloc(0)
  for await (const part of source) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
    let start = 0
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start), stop = end < 0 ? chunk.length : end
      if (pending.length + stop - start > maxLine) throw new Error('Recovery stream record is too large')
      pending = Buffer.concat([pending, chunk.subarray(start, stop)])
      if (end < 0) break
      const value = JSON.parse(pending.toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery stream record')
      yield value
      pending = Buffer.alloc(0)
      start = end + 1
    }
  }
  if (pending.length) throw new Error('Incomplete recovery stream record')
}

export async function receiveVolumeFiles(source: Readable | AsyncIterable<Buffer | string>, root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink() || (await fs.readdir(root)).length) throw new Error('Recovery stream requires an empty directory without links')
  const inventory = new Inventory()
  let started = false, completed = false
  let file: { handle: Awaited<ReturnType<typeof openConfinedStream>>; remaining: number; hash: ReturnType<typeof createHash> } | undefined
  try {
    for await (const record of records(source)) {
      if (completed) throw new Error('Unexpected data after recovery stream completion')
      if (!started) {
        if (record.type !== 'start' || record.version !== 1) throw new Error('Unsupported recovery stream version')
        started = true
        continue
      }
      if (file) {
        if (record.type === 'chunk') {
          if (typeof record.data !== 'string' || record.data.length > Math.ceil(chunkBytes / 3) * 4) throw new Error('Invalid recovery chunk')
          const bytes = Buffer.from(record.data, 'base64')
          if (!bytes.length || bytes.length > chunkBytes || bytes.length > file.remaining || bytes.toString('base64') !== record.data) throw new Error('Invalid recovery chunk')
          // FileHandle.write can legally complete a partial write.
          for (let offset = 0; offset < bytes.length;) {
            const { bytesWritten } = await file.handle.write(bytes, offset, bytes.length - offset)
            if (!bytesWritten) throw new Error('Recovery file write made no progress')
            offset += bytesWritten
          }
          file.hash.update(bytes); file.remaining -= bytes.length
        } else if (record.type === 'file-end') {
          if (file.remaining || record.sha256 !== file.hash.digest('hex')) throw new Error('Recovery stream checksum or size mismatch')
          await file.handle.close(); file = undefined
        } else throw new Error('Incomplete recovery file')
        continue
      }
      if (record.type === 'complete') { completed = true; continue }
      if (!['directory', 'file'].includes(String(record.type)) || typeof record.path !== 'string') throw new Error('Invalid recovery stream entry')
      if (record.type === 'file' && typeof record.bytes !== 'number') throw new Error('Invalid recovery file size')
      inventory.add(record.path, record.type === 'file' ? record.bytes as number : 0)
      const parent = dirname(record.path).replaceAll('\\', '/')
      if (parent !== '.') {
        await storageEntries(root,parent)
      }
      if (record.type === 'directory') await storageMkdir(root,record.path)
      else file = { handle: await openConfinedStream(root,record.path,true), remaining: record.bytes as number, hash: createHash('sha256') }
    }
    if (!started || !completed || file) throw new Error('Incomplete recovery stream')
  } finally { await file?.handle.close() }
}

export async function* sendVolumeFiles(root: string): AsyncGenerator<Buffer> {
  const info = await fs.lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Recovery stream source contains a link or is not a directory')
  const inventory = new Inventory()
  yield line({ type: 'start', version: 1 })
  async function* visit(name: string,entry:Awaited<ReturnType<typeof storageEntries>>[number]): AsyncGenerator<Buffer> {
    if(entry.link)throw Error('Recovery stream source contains a link')
    if (entry.directory) {
      inventory.add(name)
      yield line({ type: 'directory', path: name })
      for (const child of (await storageEntries(root,name)).sort((a,b)=>a.name.localeCompare(b.name))) yield* visit(`${name}/${child.name}`,child)
    } else if (entry.regular) {
      inventory.add(name, entry.size)
      yield line({ type: 'file', path: name, bytes: entry.size })
      const handle = await openConfinedStream(root,name), hash = createHash('sha256'), buffer = Buffer.alloc(chunkBytes)
      let remaining = entry.size
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.size !== entry.size) throw new Error('Recovery file changed during transfer')
        while (remaining) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(remaining, chunkBytes), null)
          if (!bytesRead) throw new Error('Recovery file changed during transfer')
          const bytes = buffer.subarray(0, bytesRead)
          hash.update(bytes); remaining -= bytesRead
          yield line({ type: 'chunk', data: bytes.toString('base64') })
        }
        if ((await handle.read(buffer, 0, 1, null)).bytesRead) throw new Error('Recovery file changed during transfer')
      } finally { await handle.close() }
      yield line({ type: 'file-end', sha256: hash.digest('hex') })
    } else throw new Error('Unsupported recovery file')
  }
  for (const item of (await storageEntries(root)).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (!durableRoots.includes(item.name)) throw new Error('Unsupported recovery stream root')
    yield* visit(item.name,item)
  }
  yield line({ type: 'complete' })
}

// Runs in the existing backend image. Python is already part of that image;
// this does not bundle another runtime or introduce an archive dependency.
export const volumeTransferScript = String.raw`
import os,sys,json,stat,hashlib,base64,re
root='/state'; allowed=json.loads(sys.argv[2]); chunk_size=65536; max_line=131072
seen=set(); total=0
def entry(name,size=0):
 global total
 if not isinstance(name,str) or not name or len(name)>1000 or name.split('/')[0] not in allowed: raise ValueError('Unsupported recovery stream path')
 for part in name.split('/'):
  if not part or part in ('.','..') or re.search(r'[<>:"|?*\\\x00-\x1f]',part) or part.endswith(('.',' ')) or re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)',part,re.I): raise ValueError('Unsafe recovery stream path')
 if name.lower() in seen: raise ValueError('Duplicate recovery stream path')
 if type(size)!=int or size<0 or len(seen)>=250000 or total+size>50*1024**3: raise ValueError('Recovery stream exceeds limits')
 seen.add(name.lower());total+=size
def emit(value): sys.stdout.buffer.write((json.dumps(value,separators=(',',':'))+'\n').encode())
def export(name):
 path=os.path.join(root,name); info=os.lstat(path)
 if stat.S_ISDIR(info.st_mode):
  entry(name);emit(dict(type='directory',path=name))
  for child in sorted(os.listdir(path)): export(name+'/'+child)
 elif stat.S_ISREG(info.st_mode):
  entry(name,info.st_size);emit(dict(type='file',path=name,bytes=info.st_size));h=hashlib.sha256();left=info.st_size
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb') as f:
   opened=os.fstat(f.fileno())
   if not stat.S_ISREG(opened.st_mode) or opened.st_size!=info.st_size or opened.st_ino!=info.st_ino: raise ValueError('Recovery file changed')
   while left:
    data=f.read(min(left,chunk_size))
    if not data: raise ValueError('Recovery file changed')
    left-=len(data);h.update(data);emit(dict(type='chunk',data=base64.b64encode(data).decode()))
   if f.read(1): raise ValueError('Recovery file changed')
  emit(dict(type='file-end',sha256=h.hexdigest()))
 else: raise ValueError('Recovery source contains a link or unsupported file')
def receive():
 if os.listdir(root): raise ValueError('Recovery requires a fresh volume')
 started=False;completed=False;f=None;left=0;h=None;configs=[];owned=[]
 try:
  while True:
   raw=sys.stdin.buffer.readline(max_line+1)
   if not raw: break
   if len(raw)>max_line or not raw.endswith(b'\n'): raise ValueError('Invalid recovery record length')
   r=json.loads(raw)
   if not isinstance(r,dict) or completed: raise ValueError('Invalid recovery stream record')
   kind=r.get('type')
   if not started:
    if kind!='start' or r.get('version')!=1: raise ValueError('Unsupported recovery stream version')
    started=True;continue
   if f is not None:
    if kind=='chunk':
     encoded=r.get('data')
     if not isinstance(encoded,str) or len(encoded)>87384: raise ValueError('Invalid recovery chunk')
     data=base64.b64decode(encoded,validate=True)
     if not data or len(data)>chunk_size or len(data)>left or base64.b64encode(data).decode()!=encoded: raise ValueError('Invalid recovery chunk')
     f.write(data);h.update(data);left-=len(data)
    elif kind=='file-end':
     if left or r.get('sha256')!=h.hexdigest(): raise ValueError('Recovery checksum or size mismatch')
     f.close();f=None
    else: raise ValueError('Incomplete recovery file')
    continue
   if kind=='complete': completed=True;continue
   if kind not in ('directory','file'): raise ValueError('Invalid recovery stream entry')
   name=r.get('path');size=r.get('bytes') if kind=='file' else 0;entry(name,size)
   path=os.path.join(root,name);parent=os.path.dirname(path)
   current=root
   for part in name.split('/')[:-1]:
    current=os.path.join(current,part);s=os.lstat(current)
    if not stat.S_ISDIR(s.st_mode): raise ValueError('Invalid recovery stream parent')
   if kind=='directory': os.mkdir(path,0o700)
   else:
    f=open(path,'xb');os.chmod(path,0o600);left=size;h=hashlib.sha256()
    if name.startswith('desktop-config/'): configs.append(path)
   owned.append(path)
  if not started or not completed or f is not None: raise ValueError('Incomplete recovery stream')
 finally:
  if f is not None: f.close()
 for path in configs:
  if os.stat(path).st_size>8*1024**2: raise ValueError('Session configuration is too large')
  with open(path) as source: value=json.load(source)
  value.update(mode='ask',teamEnabled=False,teamManaged=False,baseUrl='')
  with open(path,'w') as target: json.dump(value,target)
 # Root has only CHOWN, not DAC_OVERRIDE. Keep directories root-owned until
 # their contents are complete, then assign children before their parents.
 for path in reversed(owned): os.chown(path,10001,10001)
if sys.argv[1]=='export':
 emit(dict(type='start',version=1))
 for name in allowed:
  if os.path.lexists(os.path.join(root,name)): export(name)
 emit(dict(type='complete'));sys.stdout.buffer.flush()
elif sys.argv[1]=='import': receive()
else: raise ValueError('Invalid recovery operation')
`
