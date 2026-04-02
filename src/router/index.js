import { createRouter, createWebHistory } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { useMenuStore } from "@/stores/menu"
import { staticRoutes, routeComponents, notFoundRoute } from "./routes"
import { setupNProgress } from "@/utils/nprogress"

const NProgress = setupNProgress()

const router = createRouter({
  history: createWebHistory(),
  routes: staticRoutes,
})

// 已添加的动态路由名称（用于判断是否已注册 & 移除时使用）
let addedRouteNames = []

// 注册动态路由
export const addDynamicRoutes = (menus, { force = false } = {}) => {
  // 强制刷新：先移除旧路由
  if (force && addedRouteNames.length) {
    addedRouteNames.forEach(name => router.removeRoute(name))
    addedRouteNames = []
  }

  // 已注册过，直接返回
  if (addedRouteNames.length) return

  if (!menus?.length) return

  const processMenu = (menu, parentPath = "") => {
    if (!menu.path) return

    const fullPath = (menu.path.startsWith("/") ? menu.path : `${parentPath}/${menu.path}`)
      .replace(/\/+/g, "/").replace(/\/$/, "") || "/"
    const routeName = fullPath.replace(/\//g, "-").replace(/^-+|-+$/g, "") || `menu-${menu.id}`
    const hasPermission = menu.status === 0

    router.addRoute({
      path: fullPath,
      name: routeName,
      component: hasPermission && menu.componentName ? routeComponents[menu.componentName] : null,
      redirect: hasPermission ? undefined : '/404',
      meta: {
        requiresAuth: true,
        showNavbar: hasPermission,
        showSidebar: hasPermission,
        noPermission: !hasPermission,
        title: menu.name,
        icon: menu.icon,
        keepAlive: menu.keepAlive || false,
        visible: menu.visible,
        status: menu.status,
      },
    })
    addedRouteNames.push(routeName)

    menu.children?.forEach(child => processMenu(child, fullPath))
  }

  menus.forEach(menu => processMenu(menu))

  // 最后添加 404
  if (!router.hasRoute('NotFound')) {
    router.addRoute(notFoundRoute)
  }
}

// 重置动态路由（退出登录时调用）
export const resetDynamicRoutes = () => {
  addedRouteNames.forEach(name => router.removeRoute(name))
  addedRouteNames = []
}

// 清理残留遮罩层
const clearOverlays = () => {
  document.querySelectorAll('.el-overlay').forEach(el => {
    // 只清理包含 dialog 或 message-box 的 overlay
    if (el.querySelector('.el-dialog, .el-message-box')) {
      el.remove()
    }
  })
  document.body.style.overflow = ''
  document.body.classList.remove('el-popup-parent--hidden')
}

// 路由守卫
router.beforeEach(async (to, from, next) => {
  NProgress.start()
  
  // 路由切换时清理残留遮罩
  if (from.path !== to.path) {
    clearOverlays()
  }

  const authStore = useAuthStore()
  const menuStore = useMenuStore()

  // 不需要登录的路由直接放行（requiresAuth 明确为 false）
  if (to.meta?.requiresAuth === false) {
    // 已登录访问登录页，跳转首页
    if (authStore.isLoggedIn && to.path === "/login") {
      NProgress.done()
      return next("/home")
    }
    return next()
  }

  // 未登录访问需要认证的路由（包括未匹配的路由），跳转登录
  if (!authStore.isLoggedIn) {
    NProgress.done()
    return next("/login")
  }

  // 获取用户信息（首次或菜单为空时重新获取）
  if (!authStore.user || !menuStore.menus?.length) {
    try {
      await authStore.getUserInfo()
    } catch (error) {
      console.error("获取用户信息失败:", error)
      authStore.logout()
      NProgress.done()
      return next("/login")
    }
  }

  // 注册动态路由（仅首次）
  if (menuStore.menus?.length && !addedRouteNames.length) {
    addDynamicRoutes(menuStore.menus)
    return next({ ...to, replace: true })
  }

  // 无权限路由
  if (to.meta?.noPermission) {
    NProgress.done()
    return next('/404')
  }

  // 顶部菜单联动
  if (to.meta?.showNavbar) {
    const topMenu = to.path === "/home" ? null : menuStore.findTopMenuByPath(to.path)
    menuStore.setActiveTopMenu(topMenu)
  }

  next()
})

router.afterEach(() => NProgress.done())
router.onError((err) => {
  console.error("路由错误:", err)
  NProgress.done()
})

export default router
