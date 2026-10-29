import { useAuthStore } from "@/stores/auth"
import { useMenuStore } from "@/stores/menu"
import { addDynamicRoutes } from "@/router"
import { ElMessage } from "element-plus"
import { notifyBackendUnreachable, withTransientRetry } from "@/utils/requestError"

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
    await withTransientRetry(() => authStore.getUserInfo())
  } catch (error) {
    console.error("权限初始化失败:", error)
    // 401 拦截里已经清过会话；网络失败、后端重启不能把本地登录态清掉
    if (!authStore.isLoggedIn) return
    if (force) {
      ElMessage.error("刷新权限失败：" + (error?.message || "请稍后重试"))
    } else {
      notifyBackendUnreachable()
    }
  }

  if (menuStore.menus?.length) {
    addDynamicRoutes(menuStore.menus, { force })
  }
}

