import { mergeConfig } from 'vite'
import baseConfig from './vite.base'

export default mergeConfig(baseConfig, {
  mode: 'development',
  server: {
    open: false, 
    cors: true, 
    port: 5173,
  },
  build: {
    sourcemap: 'inline'
  }
})