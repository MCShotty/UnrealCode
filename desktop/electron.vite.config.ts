import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

export default defineConfig({
  main: { plugins: [{ name: 'main-workers', generateBundle() { for (const name of ['history-worker.cjs', 'activity-projection.cjs', 'mcp-schema-worker.cjs']) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(resolve(__dirname, 'src/main', name)) }) } }], build: { outDir: 'out/main' } },
  preload: { build: { outDir: 'out/preload' } },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react({})],
    build: { outDir: resolve(__dirname, 'out/renderer') }
  }
})
