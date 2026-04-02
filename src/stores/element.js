import { defineStore } from "pinia"
import zhCn from "element-plus/es/locale/lang/zh-cn"

export const useElementStore = defineStore("element", () => {
  const locale = ref(zhCn)         // 语言

  // ===== 卡片配置 =====
  const card = {
    shadow: 'never', 
  }

  // ===== 消息配置 =====
  const message = {
    max: 3,
    duration: 2500,
  }

  return {
    locale,
    card,
    message,
  }
})
