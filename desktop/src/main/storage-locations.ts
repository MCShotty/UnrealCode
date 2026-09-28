import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promises as fs } from 'node:fs'
import { readBoundedJSONSync } from './bounded-file-read'

export type StorageLocation = { kind: string; key: string; path: string; createdAt: string }
export type LocationRegistry = { version: 1; locations: StorageLocation[] }
export const timestampName = (date = new Date()): string => date.toISOString().replaceAll(':', '-').replace('T', '_')
const registryFile = (root: string): string => join(root, 'storage-locations.json')
const registryLimit = 16 * 1024 * 1024
function validateRegistry(value: unknown): LocationRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as LocationRegistry).version !== 1 || !Array.isArray((value as LocationRegistry).locations)) throw new Error('Invalid storage location registry')
  const registry = value as LocationRegistry
  const keys = new Set<string>()
  for (const item of registry.locations) {
    if (!item || typeof item !== 'object' || typeof item.kind !== 'string' || typeof item.key !== 'string' || typeof item.path !== 'string' || typeof item.createdAt !== 'string' || item.kind.length > 100 || item.key.length > 4096 || item.path.length > 4096 || isAbsolute(item.path) || /[:\x00-\x1f]/.test(item.path) || item.path.split(/[\\/]/).some(part => !part || part === '..' || part === '.' || /[. ]$/.test(part))) throw new Error('Invalid storage location registry')
    const key = `${item.kind}\0${item.key}`
    if (keys.has(key)) throw new Error('Invalid storage location registry')
    keys.add(key)
  }
  return registry
}
function loaded(path: string): LocationRegistry | undefined {
  return existsSync(path) ? validateRegistry(readBoundedJSONSync<unknown>(path, registryLimit)) : undefined
}
function isPrefix(earlier: LocationRegistry, later: LocationRegistry): boolean {
  return earlier.locations.length <= later.locations.length && earlier.locations.every((item, index) => {
    const other = later.locations[index]
    return item.kind === other.kind && item.key === other.key && item.path === other.path && item.createdAt === other.createdAt
  })
}
export function readLocations(root: string): LocationRegistry {
  const target = registryFile(root), pending = `${target}.pending`, current = loaded(target)
  let next: LocationRegistry | undefined
  try { next = loaded(pending) }
  catch (error) {
    if (!current) throw error
    // Keep the authoritative registry usable; retain the broken pending copy
    // under a dated name for inspection rather than overwriting it.
    const damaged = timestampPath(dirname(pending), '.damaged', new Date(), [])
    renameSync(pending, damaged)
    return current
  }
  if (!next) return current || { version: 1, locations: [] }
  if (!current || isPrefix(current, next) && next.locations.length > current.locations.length) {
    renameSync(pending, target)
    return next
  }
  if (isPrefix(next, current)) { unlinkSync(pending); return current }
  throw new Error('Storage location registry conflicts with an interrupted write; both copies were preserved')
}
export function writeLocations(root: string, value: LocationRegistry): void {
  validateRegistry(value)
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > registryLimit) throw new Error('Saved metadata exceeds its safe size limit; the original file is preserved')
  mkdirSync(root, { recursive: true })
  const target = registryFile(root), temporary = `${target}.pending`
  writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
  renameSync(temporary, target)
}
export function timestampPath(root: string, extension = '', now = new Date(), reserved: string[] = []): string {
  const name = timestampName(now)
  for (let counter = 0; ; counter++) {
    const path = join(root, `${name}${counter ? `-${counter + 1}` : ''}${extension}`)
    if (!existsSync(path) && !reserved.includes(path.toLowerCase())) return path
  }
}
export async function createTimestampDirectory(root:string,now=new Date()):Promise<string>{
  await fs.mkdir(root,{recursive:true})
  for(;;){
    const path=timestampPath(root,'',now)
    try{await fs.mkdir(path,{mode:0o700});return path}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
  }
}
export function lookupStorage(root:string,kind:string,key:string,legacy?:string):string|undefined {
  const registry=readLocations(root)
  const item=registry.locations.find(item=>item.kind===kind&&item.key===key.toLowerCase()) || (legacy&&registry.locations.find(item=>item.kind==='legacy-path'&&item.key===relative(root,legacy).replaceAll('\\','/').toLowerCase()))
  return item?resolve(root,item.path):undefined
}
/** Stable identities are keys. Dates belong only to physical locations. */
export function storageLocation(root: string, kind: string, key: string, legacy?: string, extension = ''): string {
  const registry = readLocations(root), normalized = key.toLowerCase()
  const known = registry.locations.find(item => item.kind === kind && item.key === normalized)
  if (known) return resolve(root, known.path)
  const alias = legacy && registry.locations.find(item => item.kind === 'legacy-path' && item.key === relative(root,legacy).replaceAll('\\','/').toLowerCase())
  if (alias) return resolve(root,alias.path)
  const folder = join(root, kind)
  const path = legacy && existsSync(legacy) ? legacy : timestampPath(folder, extension, new Date(), registry.locations.map(item => resolve(root, item.path).toLowerCase()))
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Storage location leaves the app profile')
  registry.locations.push({ kind, key: normalized, path: rel.replaceAll('\\', '/'), createdAt: new Date().toISOString() })
  mkdirSync(dirname(path), { recursive: true })
  writeLocations(root, registry)
  return path
}
