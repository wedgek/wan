import { defineStore } from "pinia"
import { getStorage, setStorage, removeStorage } from "@/utils/storage"

/** 统一 visible/status 类型，避免 localStorage 里 1 / "0" 导致侧栏过滤与动态路由不一致 */
function normalizeMenuNode(menu) {
  if (!menu || typeof menu !== "object") return menu
  const st = Number(menu.status)
  const next = {
    ...menu,
    visible: menu.visible === true || menu.visible === 1 || menu.visible === "1",
    status: st === 0 ? 0 : st === 1 ? 1 : menu.status,
  }
  if (Array.isArray(menu.children) && menu.children.length) {
    next.children = menu.children.map(normalizeMenuNode)
  }
  return next
}

export const useMenuStore = defineStore("menu", () => {
  const menus = ref([])
  const activeTopMenu = ref(null) 
  const activeSideMenu = ref(null)
  const sidebarCollapsed = ref(false) // 侧边栏折叠状态
  /** 移动端左侧导航抽屉（与桌面侧栏二选一展示） */
  const mobileDrawerOpen = ref(false)

  // 初始化menus
  const initMenus = () => {
    const savedMenus = getStorage("menus")
    if (savedMenus && Array.isArray(savedMenus)) {
      menus.value = savedMenus.map(normalizeMenuNode)
    }
    // 恢复侧边栏折叠状态
    const savedCollapsed = getStorage("sidebarCollapsed")
    if (savedCollapsed !== null) {
      sidebarCollapsed.value = savedCollapsed
    }
  }

  // 设置侧边栏折叠状态
  const setSidebarCollapsed = (collapsed) => {
    sidebarCollapsed.value = collapsed
    setStorage("sidebarCollapsed", collapsed)
  }

  // 切换侧边栏折叠状态
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(!sidebarCollapsed.value)
  }

  const setMobileDrawerOpen = (open) => {
    mobileDrawerOpen.value = !!open
  }

  const toggleMobileDrawer = () => {
    mobileDrawerOpen.value = !mobileDrawerOpen.value
  }

  const setMenus = (menuList) => {
    const list = (menuList || []).map(normalizeMenuNode)
    menus.value = list
    setStorage("menus", list)
    
    // 同步更新 activeTopMenu（从新菜单中找到对应的菜单）
    if (activeTopMenu.value) {
      const updatedMenu = list.find(m => m.id === activeTopMenu.value.id)
      if (updatedMenu) {
        activeTopMenu.value = updatedMenu
      }
    }
  }

  const clearMenus = () => {
    menus.value = []
    activeTopMenu.value = null
    activeSideMenu.value = null
    sidebarCollapsed.value = false
    mobileDrawerOpen.value = false
    removeStorage("menus")
    removeStorage("sidebarCollapsed")
  }

  // 设置导航选中
  const setActiveTopMenu = (menu) => {
    activeTopMenu.value = menu
  }

  // 设置侧边选中
  const setActiveSideMenu = (menuPath) => {
    activeSideMenu.value = menuPath
  }

  /**
   * 检查菜单是否有权限访问
   * status === 0 表示有权限
   */
  const hasPermission = (menu) => {
    return Number(menu.status) === 0
  }

  /**
   * 检查菜单是否应该显示
   * status === 0 且 visible === true 时显示
   */
  const isMenuVisible = (menu) => {
    return hasPermission(menu) && !!menu.visible
  }

  /**
   * 过滤菜单 - 用于路由生成（只过滤无权限的）
   * status !== 0 的菜单不生成路由
   */
  const filterMenusForRoute = (menuList) => {
    if (!menuList?.length) return []
    
    return menuList
      .filter(item => hasPermission(item))
      .map(item => ({
        ...item,
        children: item.children ? filterMenusForRoute(item.children) : null
      }))
  }

  /**
   * 过滤菜单 - 用于显示（过滤无权限和不可见的）
   * status !== 0 或 visible === false 的不显示
   */
  const filterMenusForDisplay = (menuList) => {
    if (!menuList?.length) return []
    
    return menuList
      .filter(item => isMenuVisible(item))
      .map(item => ({
        ...item,
        children: item.children ? filterMenusForDisplay(item.children) : null
      }))
  }

  // 导航栏菜单 - 只显示有权限且 visible 为 true 的顶级菜单
  const topMenus = computed(() => {
    return filterMenusForDisplay(menus.value)
  })
  
  // 侧边栏：完整多级菜单（与后端顶级树一致，不再依赖顶部 Tab 切换）
  const sidebarMenus = computed(() => filterMenusForDisplay(menus.value))

  /**
   * 获取用于路由的菜单（只过滤无权限的）
   */
  const routeMenus = computed(() => {
    return filterMenusForRoute(menus.value)
  })

  /**
   * 递归查找第一个可见的叶子菜单
   * @param {Array} menuList - 菜单列表
   * @param {String} parentPath - 父路径
   * @returns {Object|null} - { menu, fullPath }
   */
  const findFirstVisibleLeafMenu = (menuList, parentPath = '') => {
    if (!menuList?.length) return null
    
    for (const menu of menuList) {
      // 跳过没有权限或不可见的菜单
      if (!isMenuVisible(menu)) continue
      
      // 计算当前菜单的完整路径
      let currentPath = menu.path || ''
      if (!currentPath.startsWith('/')) {
        currentPath = `${parentPath}/${currentPath}`.replace(/\/+/g, '/')
      }
      currentPath = currentPath.replace(/\/$/, '') || '/'
      
      // 获取可见的子菜单
      const visibleChildren = menu.children?.filter(child => isMenuVisible(child)) || []
      
      // 如果有可见的子菜单，递归查找
      if (visibleChildren.length > 0) {
        const found = findFirstVisibleLeafMenu(visibleChildren, currentPath)
        if (found) return found
      }
      
      // 叶子节点或没有可见子菜单
      return { menu, fullPath: currentPath }
    }
    
    return null
  }

  /**
   * 获取顶级菜单下第一个可见的叶子菜单路径
   * @param {Object} topMenu - 顶级菜单
   * @returns {String|null} - 完整路径
   */
  const getFirstVisiblePath = (topMenu) => {
    if (!topMenu) return null
    
    const basePath = topMenu.path?.startsWith('/') 
      ? topMenu.path 
      : `/${topMenu.path || ''}`
    
    // 如果没有子菜单，返回自身路径
    if (!topMenu.children?.length) {
      return basePath.replace(/\/$/, '') || '/'
    }
    
    // 查找第一个可见的叶子菜单
    const found = findFirstVisibleLeafMenu(topMenu.children, basePath)
    return found?.fullPath || basePath.replace(/\/$/, '') || '/'
  }

  // 根据 path 查找所属的顶级菜单
  const findTopMenuByPath = (path) => {
    if (!path) return null

    const cleanPath = path.replace(/\/$/, '')

    const candidates = menus.value.filter(menu => {
      if (menu.parentId !== 0 || !menu.path) return false

      const menuPath = menu.path.replace(/\/$/, '')
      return cleanPath === menuPath || cleanPath.startsWith(menuPath + '/')
    })
    return candidates.sort((a, b) => b.path.length - a.path.length)[0] || null
  }

  /**
   * 检查路径是否有权限访问
   * @param {String} path - 要检查的路径
   * @returns {Boolean}
   */
  const checkPathPermission = (path) => {
    if (!path) return false
    
    const cleanPath = path.replace(/\/$/, '') || '/'
    
    // 递归查找菜单
    const findMenuByPath = (menuList, parentPath = '') => {
      for (const menu of menuList) {
        let currentPath = menu.path || ''
        if (!currentPath.startsWith('/')) {
          currentPath = `${parentPath}/${currentPath}`.replace(/\/+/g, '/')
        }
        currentPath = currentPath.replace(/\/$/, '') || '/'
        
        // 完全匹配
        if (currentPath === cleanPath) {
          return menu
        }
        
        // 继续在子菜单中查找
        if (menu.children?.length && cleanPath.startsWith(currentPath + '/')) {
          const found = findMenuByPath(menu.children, currentPath)
          if (found) return found
        }
      }
      return null
    }
    
    const menu = findMenuByPath(menus.value)
    
    // 如果找不到菜单，默认有权限（可能是静态路由）
    if (!menu) return true
    
    // 检查权限
    return hasPermission(menu)
  }

  return {
    menus,
    topMenus,
    sidebarMenus,
    routeMenus,
    activeTopMenu,
    activeSideMenu,
    sidebarCollapsed,
    initMenus,
    setMenus,
    clearMenus,
    setActiveTopMenu,
    setActiveSideMenu,
    setSidebarCollapsed,
    toggleSidebarCollapsed,
    mobileDrawerOpen,
    setMobileDrawerOpen,
    toggleMobileDrawer,
    findTopMenuByPath,
    hasPermission,
    isMenuVisible,
    findFirstVisibleLeafMenu,
    getFirstVisiblePath,
    checkPathPermission,
  }
})
