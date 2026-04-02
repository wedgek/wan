// 根据 mode 自动选择对应配置
import devConfig from './build/vite.dev'
import testConfig from './build/vite.test'
import prodConfig from './build/vite.prod'
import analyzeConfig from './build/vite.analyze'

export default ({ mode }) => {
  if (mode === 'production') return prodConfig
  if (mode === 'test') return testConfig
  if (mode === 'analyze') return analyzeConfig
  return devConfig
}