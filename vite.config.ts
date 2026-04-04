import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { uploadPlugin } from './vite-upload-plugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const gatewayUrl = env.VITE_GATEWAY_URL || 'http://127.0.0.1:18789'
  const syncUrl = env.VITE_SYNC_URL?.replace('ws://', 'http://').replace('wss://', 'https://') || 'http://127.0.0.1:5858'

  return {
    plugins: [react(), uploadPlugin()],
    server: {
      host: '0.0.0.0',
      allowedHosts: ['temple'],
      proxy: {
        '/hooks': {
          target: gatewayUrl,
          changeOrigin: true,
        },
        '/connect': {
          target: syncUrl,
          ws: true,
          changeOrigin: true,
        },
        '/uploads': {
          target: syncUrl,
          changeOrigin: true,
        },
      },
    },
    preview: {
      allowedHosts: ['temple'],
    },
  }
})
