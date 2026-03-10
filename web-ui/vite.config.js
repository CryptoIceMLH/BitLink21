import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

const appVersion = fs.existsSync('./VERSION')
  ? fs.readFileSync('./VERSION', 'utf-8').trim()
  : '0.6.1-ui'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8021',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:40134',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
