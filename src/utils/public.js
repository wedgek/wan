import qs from "qs";
// 日期快捷选项
export const shortcuts = [
  {
    text: '最近一周',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24 * 7)
      return [start, end]
    },
  },
  {
    text: '最近一个月',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24 * 30)
      return [start, end]
    },
  },
  {
    text: '最近三个月',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24 * 90)
      return [start, end]
    },
  },
]

// 分页配置
export const pagination = {
  currentPage: 1,
  pageSize: 20,
  pageSizes: [10, 20, 50, 100],
  layout: 'total, sizes, prev, pager, next, jumper',
  total: 0,
}

// URL编码参数
export function urlEncode(params) {
  return qs.stringify(params, { allowDots: true })
}

// 复制文本到剪贴板（优先使用现代API，降级到execCommand）
export async function copyText(text, showMsg = true) {
  if (!text) {
    showMsg && ElMessage('复制内容为空')
    return false
  }
  
  let success = false
  
  // 优先使用 navigator.clipboard（需要 HTTPS 或 localhost）
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      success = true
    } catch {}
  }
  
  // 降级方案：execCommand
  if (!success) {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;'
    document.body.appendChild(textarea)
    textarea.select()
    
    try {
      document.execCommand('copy')
      success = true
    } catch {}
    
    document.body.removeChild(textarea)
  }
  
  showMsg && (success ? ElMessage.success('已复制') : ElMessage.error('复制失败'))
  return success
}

