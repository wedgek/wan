/**
 * 将侧边栏可见菜单树打平为可搜索的叶子项（路径算法与 sidebar/menu-item 一致）
 */

/** icon 为 Element Plus Icons 注册名（与菜单管理里存的一致），在前端解析为组件 */
export const NAV_SEARCH_STATIC_ENTRIES = [
  { id: "static-home", name: "工作台", fullPath: "/home", icon: "Odometer" },
  { id: "static-profile", name: "个人中心", fullPath: "/profile", icon: "User" },
]

function visibleChildren(menu) {
  if (!menu.children?.length) return []
  return menu.children.filter((c) => c.status === 0 && c.visible === true)
}

export function flattenSidebarMenusForSearch(menus, basePath = "", ancestors = []) {
  const out = []
  if (!menus?.length) return out

  for (const menu of menus) {
    let path = menu.path || String(menu.id)
    if (!path.startsWith("/")) {
      path = `${basePath}/${path}`.replace(/\/+/g, "/")
    }
    const children = visibleChildren(menu)
    if (children.length > 0) {
      out.push(...flattenSidebarMenusForSearch(children, path, [...ancestors, menu.name]))
    } else {
      out.push({
        id: menu.id,
        name: menu.name,
        fullPath: path,
        icon: menu.icon || null,
      })
    }
  }
  return out
}

/**
 * 动态菜单优先，静态条目仅补充尚未出现的 path（避免重复）
 */
export function mergeNavSearchItems(dynamicItems, staticEntries = NAV_SEARCH_STATIC_ENTRIES) {
  const byPath = new Map()
  for (const item of dynamicItems) {
    byPath.set(item.fullPath, item)
  }
  for (const item of staticEntries) {
    if (!byPath.has(item.fullPath)) {
      byPath.set(item.fullPath, item)
    }
  }
  return Array.from(byPath.values()).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "zh-Hans-CN"),
  )
}

export function filterNavSearchItems(items, query) {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => {
    const hay = [item.name, item.fullPath, item.breadcrumb].filter(Boolean).join("\n").toLowerCase()
    return hay.includes(q)
  })
}
