import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    // 自动导入 API（ref / useRouter / ElMessage 等）
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver()],
      dts: false
    }),
    // 自动注册组件（<ElButton /> / <MyComp />）
    Components({
      dirs: ['src/components', 'src/layout','src/views'],
      resolvers: [ElementPlusResolver()],
      deep: false,
      dts: false
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src') 
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`
      }
    }
  },
  optimizeDeps: {
    // 预构建依赖，加快冷启动
    include: ['vue', 'vue-router', 'pinia', 'axios', 'lodash-es', 'dayjs'] 
  }
})
