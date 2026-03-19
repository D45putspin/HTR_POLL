import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  server: {
    proxy: {
      '/api': {
        target: 'https://node1.testnet.hathor.network',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/v1a'),
        secure: false,
      },
    },
  },
})
