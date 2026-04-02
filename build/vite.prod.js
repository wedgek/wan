import { mergeConfig, loadEnv } from 'vite'
import importToCDN from 'vite-plugin-cdn-import'
import progress from 'vite-plugin-progress';
import baseConfig from './vite.base'
import { chunkRules } from '../config/chunk.config'
import { cdnModules, cdnExternal, cdnGlobals, cdnExclude } from '../config/cdn.config'

const env = loadEnv('prod', process.cwd(), '')
const useCDN = env.VITE_USE_CDN === 'true'

export default mergeConfig(baseConfig, {
  mode: 'production',
  plugins: [
    importToCDN({
      modules: useCDN ? cdnModules : [],
    }),
    progress()
  ],
  optimizeDeps: {
    exclude: useCDN ? cdnExclude : []
  },
  build: {
    sourcemap: false,     
    target: 'esnext',
    chunkSizeWarningLimit: 1000,
    minify: 'esbuild',    
    cssCodeSplit: true,  
    brotliSize: false,
    rollupOptions: {
      external: useCDN ? cdnExternal : [],
      output: {
        globals: useCDN ? cdnGlobals : {},
        manualChunks: chunkRules.manualChunks,
        ...chunkRules.fileNaming,
      }
    }
  }
})
