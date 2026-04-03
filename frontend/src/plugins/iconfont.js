import { h, defineComponent } from 'vue'
import { iconfontUrl } from '../../config/cdn.config'

// 图标组件缓存
const cache = {}

// PascalCase 转 kebab-case（UserAdd -> user-add）
const toKebabCase = (str) => str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()

// 创建图标组件
function createIcon(name) {
  const iconName = toKebabCase(name)
  return defineComponent({
    name: `Iconfont${name}`,
    render() {
      return h('svg', { class: 'cz-iconfont', 'aria-hidden': 'true' }, [
        h('use', { 'xlink:href': `#icon-${iconName}` })
      ])
    }
  })
}

// 自动发现图标（Proxy）
export const iconfontIcons = new Proxy({}, {
  get(_, name) {
    if (!cache[name]) {
      cache[name] = createIcon(name)
    }
    return cache[name]
  }
})

// 加载 iconfont 脚本
export function loadIconfont() {
  if (!iconfontUrl) return false
  const script = document.createElement('script')
  script.src = iconfontUrl
  script.async = true
  document.head.appendChild(script)
  return true
}

/*
===========================================
iconfont 图标使用说明
===========================================

图标名称规则：iconfont 中的 icon-xxx-yyy 对应 XxxYyy（PascalCase）
例如：icon-user-add -> UserAdd

==================
一、模板中使用（用 $iconfont）
==================

1. 在 el-button 中：
   <el-button :icon="$iconfont.Edit">编辑</el-button>

2. 在 el-input 中：
   <el-input :suffix-icon="$iconfont.Search" />

3. 单独使用（推荐 el-icon 包裹）：
   <el-icon :size="20" color="#4078fc">
     <component :is="$iconfont.Edit" />
   </el-icon>

==================
二、JS 代码中使用（需 import）
==================

import { iconfontIcons } from '@/plugins/iconfont'

const options = [
  { icon: iconfontIcons.Edit },
  { icon: iconfontIcons.Menu },
]

配置文件：config/cdn.config.js -> iconfontUrl
样式文件：src/styles/iconfont.scss
*/

