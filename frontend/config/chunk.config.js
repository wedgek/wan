import path from 'path'

// 分包规则（Vue 与强依赖 Vue 的库同包，避免 defineProperty on non-object 等跨 chunk 问题）
export const chunkRules = {
  manualChunks(id) {
    if (!id.includes('node_modules')) return

    const nid = id.split(path.sep).join('/')
    // Vue 生态 + Element Plus 打在同一包，避免 vendor-other 调用 Vue 时引用不一致
    if (nid.includes('/node_modules/vue/')) return 'vendor-vue'
    if (nid.includes('/node_modules/@vue/')) return 'vendor-vue'
    if (nid.includes('/node_modules/vue-router/')) return 'vendor-vue'
    if (nid.includes('/node_modules/pinia/')) return 'vendor-vue'
    if (nid.includes('/node_modules/element-plus/')) return 'vendor-vue'
    if (nid.includes('/node_modules/@element-plus/')) return 'vendor-vue'

    // 工具库
    if (nid.includes('/node_modules/axios/') ||
      nid.includes('/node_modules/qs/') ||
      nid.includes('/node_modules/lodash-es/') ||
      nid.includes('/node_modules/dayjs/') ||
      nid.includes('/node_modules/mitt/') ||
      nid.includes('/node_modules/classnames/')) {
      return 'vendor-utils'
    }

    if (nid.includes('/node_modules/ali-oss/')) return 'vendor-oss'
    if (nid.includes('/node_modules/@iconify/')) return 'vendor-icons'
    if (nid.includes('/node_modules/nprogress/')) return 'vendor-nprogress'
    if (nid.includes('/node_modules/cropperjs/')) return 'vendor-cropper'

    // 其余 node_modules 不单独拆 vendor-other，随业务 chunk 打进去，避免跨 chunk 调用 Vue
    return undefined
  },
  
  fileNaming: {
    entryFileNames: 'assets/js/[name]-[hash].js',
    chunkFileNames: 'assets/js/[name]-[hash].js',
    assetFileNames: (assetInfo) => {
      const name = assetInfo.name || ''
      if (name.endsWith('.css')) return 'assets/css/[name]-[hash][extname]'
      if (/\.(png|jpe?g|svg|gif|webp)$/.test(name)) return 'assets/img/[name]-[hash][extname]'
      return 'assets/[name]-[hash][extname]'
    }
  }
}