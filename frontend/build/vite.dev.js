import { mergeConfig } from 'vite'
import baseConfig from './vite.base'

export default mergeConfig(baseConfig, {
  mode: 'development',
  server: {
    open: false,
    cors: true,
    port: 5173,
    proxy: {
      '/admin-api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: 'inline'
  }
})