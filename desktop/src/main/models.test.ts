import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'

vi.mock('./settings', () => ({ getKey: () => '' }))
import { discoverModels } from './models'

let server: Server | null = null
afterEach(() => new Promise<void>((resolve) => server?.close(() => { server = null; resolve() }) ?? resolve()))

describe('local model discovery', () => {
  it('reads Ollama native tags and compatible server models', async () => {
    server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(request.url === '/api/tags' ? JSON.stringify({ models: [{ name: 'llama:latest' }] }) : JSON.stringify({ data: [{ id: 'local-model' }] }))
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const root = `http://127.0.0.1:${address.port}`
    expect(await discoverModels('ollama', `${root}/v1`)).toEqual(['llama:latest'])
    expect(await discoverModels('openai-compatible', `${root}/v1`)).toEqual(['local-model'])
  })

  it('rejects public model servers', async () => {
    await expect(discoverModels('openai-compatible', 'https://example.com/v1')).rejects.toThrow(/local or private-network/)
  })
})
