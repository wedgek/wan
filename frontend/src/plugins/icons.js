import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { iconfontIcons, loadIconfont } from './iconfont'

export function registerIcons(app) {
  // Element Plus 图标，使用 $icons.Search
  Object.entries(ElementPlusIconsVue).forEach(([key, component]) => {
    app.component(key, component)
  })
  app.config.globalProperties.$icons = ElementPlusIconsVue

  // iconfont 图标，使用 $iconfont.Search
  if (loadIconfont()) {
    app.config.globalProperties.$iconfont = iconfontIcons
  }
}
