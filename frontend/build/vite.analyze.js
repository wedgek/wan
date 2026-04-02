import { mergeConfig } from 'vite'
import testConfig from './vite.test'
import { visualizer } from 'rollup-plugin-visualizer'

export default mergeConfig(testConfig, {
  mode: 'analyze',
  plugins: [
    // 打包分析插件
    visualizer({
      open: true,  // 不自动打开浏览器
      gzipSize: true,  // 显示gzip大小
      brotliSize: true,  // 显示brotli大小
      filename: 'dist/stats.html',  // 分析文件输出位置
      template: 'treemap',  // 使用树图展示(sunburst, treemap, network)
    })
  ]
})