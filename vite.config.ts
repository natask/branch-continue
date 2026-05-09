import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'

export default defineConfig({
  base: process.env.BRANCH_CONTINUE_MOBILE_OTA === '1' ? './' : undefined,
  plugins: [react(), wasm(), topLevelAwait()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
  esbuild: {
    target: 'esnext',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      agentation: path.resolve(__dirname, './node_modules/agentation/dist/index.mjs'),
    },
  },
  optimizeDeps: {
    exclude: ['wa-sqlite'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  worker: {
    format: 'es',
  },
})
