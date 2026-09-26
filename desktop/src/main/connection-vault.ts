import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface ConnectionSecrets { get(id: string): Record<string, unknown>; set(id: string, value: Record<string, unknown>): void; remove(id: string): void }

// Values never cross preload or the Docker bridge. Each server has its own slot.
export class ConnectionVault implements ConnectionSecrets {
  private memory = new Map<string, Record<string, unknown>>()
  constructor(private path: string) {}
  private read(): Record<string, string> { if (!existsSync(this.path)) return {}; return JSON.parse(readFileSync(this.path, 'utf8')) }
  private write(value: Record<string, string>): void { mkdirSync(dirname(this.path), { recursive: true }); const temp = `${this.path}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); renameSync(temp, this.path) }
  get(id: string): Record<string, unknown> {
    if (this.memory.has(id)) return structuredClone(this.memory.get(id)!)
    const encoded = this.read()[id]
    if (!encoded) return {}
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Reconnect after it becomes available.')
    try { return JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64'))) } catch { throw new Error('Saved connection credentials cannot be decrypted. Reconnect this server.') }
  }
  set(id: string, value: Record<string, unknown>): void {
    if (!safeStorage.isEncryptionAvailable()) { this.memory.set(id, structuredClone(value)); return }
    const values = this.read(); values[id] = safeStorage.encryptString(JSON.stringify(value)).toString('base64'); this.write(values); this.memory.delete(id)
  }
  remove(id: string): void { this.memory.delete(id); const values = this.read(); delete values[id]; this.write(values) }
}
