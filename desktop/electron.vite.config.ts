import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { outDir: 'out/main' } },
  preload: { build: { outDir: 'out/preload' } },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react({})],
    build: { outDir: resolve(__dirname, 'out/renderer') }
  }
})
