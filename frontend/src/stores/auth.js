import router, { resetDynamicRoutes } from "@/router"
import { defineStore } from "pinia"
import { loginApi, getUserInfoApi } from "@/api/auth"
import { getStorage, setStorage, removeStorage } from "@/utils/storage"
import { useMenuStore } from "@/stores/menu.js"

export const useAuthStore = defineStore("auth", () => {
  const user = ref(null)
  const token = ref("")
  /** 与 access 一并刷新，仅用于调试；业务上从 localStorage 读即可 */
  const refreshToken = ref("")
  const permissions = ref([])
  const roles = ref([])
  const roleNames = ref([])

  /** 清会话与动态路由，不跳转（供路由未 install 时复用） */
  const clearSession = () => {
    token.value = ""
    refreshToken.value = ""
    user.value = null
    permissions.value = []
    roles.value = []
    roleNames.value = []

    removeStorage("token")
    removeStorage("refreshToken")
    removeStorage("user")
    removeStorage("permissions")
    removeStorage("roles")
    removeStorage("roleNames")

    const menuStore = useMenuStore()
    menuStore.clearMenus()
    resetDynamicRoutes()
  }

  // 初始化auth
  const initAuth = () => {
    const savedToken = getStorage("token")
    const savedUser = getStorage("user")
    const savedPermissions = getStorage("permissions")
    const savedRoles = getStorage("roles")
    const savedRoleNames = getStorage("roleNames")

    const menuStore = useMenuStore()

    if (savedToken) {
      menuStore.initMenus()
      token.value = savedToken
      refreshToken.value = getStorage("refreshToken") || ""
      user.value = savedUser
      permissions.value = savedPermissions || []
      roles.value = savedRoles || []
      roleNames.value = savedRoleNames || []
    } else {
      menuStore.clearMenus()
    }
  }

  // 登录
  const login = async (data) => {
    try {
      const result = await loginApi(data)
      if (result?.code === 0) {
        setTokenPair(result.data)
        return result.data
      }else {
        throw new Error(result?.msg || '登录失败，请检查账号和密码')
      }
    } catch (error) {
      console.error("登录失败:", error)
      throw new Error(error.message || '登录出错，请稍后重试')
    }
  }

  // 获取用户信息
  const getUserInfo = async () => {
    try {
      const result = await getUserInfoApi()

      if (result?.code === 0) {
        user.value = result.data.user
        permissions.value = result.data.permissions || []
        roles.value = result.data.roles || []
        roleNames.value = result.data.roleNames || []

        setStorage("user", result.data.user)
        setStorage("permissions", result.data.permissions || [])
        setStorage("roles", result.data.roles || [])
        setStorage("roleNames", result.data.roleNames || [])

        // 同步菜单数据
        const menuStore = useMenuStore()
        menuStore.setMenus(result.data.menus || [])

        return result.data
      } else {
        throw new Error(result?.msg || '获取用户信息失败')
      }
    } catch (error) {
      console.error("获取用户信息失败：", error)
      throw new Error(error)
    }
  }

  const setTokenPair = (data) => {
    if (!data?.accessToken) return
    token.value = data.accessToken
    setStorage("token", data.accessToken)
    if (data.refreshToken != null && data.refreshToken !== "") {
      refreshToken.value = data.refreshToken
      setStorage("refreshToken", data.refreshToken)
    }
  }

  // 登出
  const logout = () => {
    clearSession()
    router.replace("/login")
  }

  // 常用判断【是否登录、按钮权限、角色权限】
  const isLoggedIn = computed(() => !!token.value)
  const hasPermission = (permission) => permissions.value.includes(permission)
  const hasRole = (role) => roles.value.includes(role)

  return {
    user,
    token,
    refreshToken,
    permissions,
    roles,
    roleNames,
    initAuth,
    clearSession,
    setTokenPair,
    login,
    logout,
    getUserInfo,
    isLoggedIn,
    hasPermission,
    hasRole,
  }
})
