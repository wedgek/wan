import { useAuthStore } from "@/stores/auth"
import { useMenuStore } from "@/stores/menu"
import { addDynamicRoutes } from "@/router"
import { ElMessage } from "element-plus"

// 初始化权限（force: true 时强制刷新路由）
export async function initPermission({ force = false } = {}) {
  const authStore = useAuthStore()
  const menuStore = useMenuStore()

  // 仅首次初始化时从 localStorage 恢复
  if (!force) {
    authStore.initAuth()
    if (!authStore.isLoggedIn) return
  }

  try {
    await authStore.getUserInfo()
    if (menuStore.menus?.length) {
      addDynamicRoutes(menuStore.menus, { force })
    }
  } catch (error) {
    console.error("权限初始化失败:", error)
    if (force) {
      ElMessage.error("刷新权限失败：" + (error?.message || "请稍后重试"))
    } else {
      authStore.clearSession()
    }
  }
}

