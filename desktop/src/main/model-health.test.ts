import { afterEach, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
vi.mock('./settings', () => ({ getKey: () => '' }))
import { modelHealth } from './model-health'
let server: Server | undefined
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())) })
it('keeps discovery separate from explicit response tests and reports metadata without assuming active allocation', async () => {
  const paths: string[] = []
  server = createServer((req, res) => { paths.push(req.url!); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url === '/api/tags' ? { models: [{ name: 'test' }] } : req.url === '/api/show' ? { capabilities: ['tools'], model_info: { 'general.architecture': 'test', 'test.context_length': 8192 } } : { response: 'OK', prompt_eval_count: 5, eval_count: 1 })) })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve)); const address = server.address() as { port: number }
  const endpoint = `http://127.0.0.1:${address.port}`
  const discovery = await modelHealth('ollama', endpoint, 'test', false)
  expect(paths).toEqual(['/api/tags', '/api/show'])
  expect(discovery.contextLimit).toBe(8192); expect(discovery.contextSource).toContain('not the active')
  const response = await modelHealth('ollama', endpoint, 'test', true)
  expect(response.response).toBe('OK'); expect(response.inputTokens).toBe(5)
})
it('rejects embedded credentials and public endpoints', async () => {
  await expect(modelHealth('ollama', 'http://user:secret@localhost:1', 'test', false)).rejects.toThrow('embedded')
  await expect(modelHealth('ollama', 'https://example.com', 'test', false)).rejects.toThrow('local')
})
