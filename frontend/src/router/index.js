import { createRouter, createWebHistory } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import { useMenuStore } from "@/stores/menu"
import { staticRoutes, routeComponents, notFoundRoute } from "./routes"
import { setupNProgress } from "@/utils/nprogress"

const NProgress = setupNProgress()

/** 与 routes.js 中 notFoundRoute.name 一致，勿写成 NotFound（否则会重复注册多个 catch-all，首点动态页无法匹配） */
const NOT_FOUND_NAME = notFoundRoute.name

const router = createRouter({
  history: createWebHistory(),
  routes: staticRoutes,
})

// 已添加的动态路由名称（用于判断是否已注册 & 移除时使用）
let addedRouteNames = []

function collectMenuComponentNames(menus, out = new Set()) {
  if (!menus?.length) return out
  for (const m of menus) {
    const key = m.componentName
    if (key && typeof routeComponents[key] === "function") out.add(key)
    if (m.children?.length) collectMenuComponentNames(m.children, out)
  }
  return out
}

/** 登录后后台预拉取菜单页 chunk，避免首点侧栏才请求模块时出现长时间进度条/跳转失败感 */
export function prefetchMenuRouteChunks(menus) {
  const names = collectMenuComponentNames(menus)
  for (const key of names) {
    routeComponents[key]().catch(() => {})
  }
}

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

  if (router.hasRoute(NOT_FOUND_NAME)) {
    router.removeRoute(NOT_FOUND_NAME)
  }

  const processMenu = (menu, parentPath = "") => {
    if (!menu.path) return

    const fullPath = (menu.path.startsWith("/") ? menu.path : `${parentPath}/${menu.path}`)
      .replace(/\/+/g, "/").replace(/\/$/, "") || "/"
    const routeName = fullPath.replace(/\//g, "-").replace(/^-+|-+$/g, "") || `menu-${menu.id}`
    const hasPermission = menu.status === 0
    const load = menu.componentName ? routeComponents[menu.componentName] : null

    router.addRoute({
      path: fullPath,
      name: routeName,
      component: hasPermission && load ? load : null,
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

  router.addRoute(notFoundRoute)
  prefetchMenuRouteChunks(menus)
}

// 重置动态路由（退出登录时调用）
export const resetDynamicRoutes = () => {
  addedRouteNames.forEach(name => router.removeRoute(name))
  addedRouteNames = []
  if (router.hasRoute(NOT_FOUND_NAME)) {
    router.removeRoute(NOT_FOUND_NAME)
  }
}

// 路由守卫
router.beforeEach(async (to, from, next) => {
  NProgress.start()

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

  next()
})

router.afterEach(() => {
  NProgress.done()
})
router.onError((err) => {
  console.error("路由错误:", err)
  NProgress.done()
})

export default router
