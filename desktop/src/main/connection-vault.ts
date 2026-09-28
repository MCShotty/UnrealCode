import { safeStorage } from 'electron'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readBoundedJSONSync } from './bounded-file-read'

export interface ConnectionSecrets { get(id: string): Record<string, unknown>; set(id: string, value: Record<string, unknown>): void; remove(id: string): void }

// Values never cross preload or the Docker bridge. Each server has its own slot.
export class ConnectionVault implements ConnectionSecrets {
  private memory = new Map<string, Record<string, unknown>>()
  constructor(private path: string) {}
  private read(): Record<string, string> { if (!existsSync(this.path)) return {}; const value=readBoundedJSONSync<unknown>(this.path,16*1024*1024);if(!value||typeof value!=='object'||Array.isArray(value)||Object.values(value).some(item=>typeof item!=='string'))throw new Error('Saved connection credentials metadata is damaged; original data was preserved');return value as Record<string,string> }
  private write(value: Record<string, string>): void { const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>16*1024*1024)throw new Error('Saved connection credentials exceed the safe metadata limit');mkdirSync(dirname(this.path), { recursive: true }); const temp = `${this.path}.${randomUUID()}.tmp`;try{writeFileSync(temp, encoded, { mode: 0o600 }); renameSync(temp, this.path)}finally{try{unlinkSync(temp)}catch{/* Preserve the original write error. */}} }
  get(id: string): Record<string, unknown> {
    if (this.memory.has(id)) return structuredClone(this.memory.get(id)!)
    const encoded = this.read()[id]
    if (!encoded) return {}
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Reconnect after it becomes available.')
    try { const value=JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64')));if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>1024*1024)throw Error('Invalid decrypted credential');return value } catch { throw new Error('Saved connection credentials cannot be decrypted. Reconnect this server.') }
  }
  set(id: string, value: Record<string, unknown>): void {
    if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>1024*1024)throw Error('Connection credentials must be a bounded object')
    if (!safeStorage.isEncryptionAvailable()) { this.memory.set(id, structuredClone(value)); return }
    const values = this.read(); values[id] = safeStorage.encryptString(JSON.stringify(value)).toString('base64'); this.write(values); this.memory.delete(id)
  }
  remove(id: string): void { const values=this.read();if(Object.hasOwn(values,id)){delete values[id];this.write(values)}this.memory.delete(id) }
}
