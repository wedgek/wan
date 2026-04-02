/**
 * 将扁平数组转换为树形结构
 * @param {Array} list - 扁平数组
 * @param {Object} options - 配置项
 * @param {string} options.id - id字段名，默认'id'
 * @param {string} options.parentId - parentId字段名，默认'parentId'
 * @param {string} options.children - children字段名，默认'children'
 * @param {number|string} options.rootId - 根节点id，默认0
 * @returns {Array} 树形结构数组
 */
export function createTree(list, options = {}) {
  const {
    id = 'id',
    parentId = 'parentId',
    children = 'children',
    rootId = 0,
  } = options

  if (!Array.isArray(list) || list.length === 0) {
    return []
  }

  // 创建映射表
  const map = {}
  const result = []

  // 第一遍遍历：创建映射
  list.forEach((item) => {
    map[item[id]] = { ...item, [children]: [] }
  })

  // 第二遍遍历：构建树形结构
  list.forEach((item) => {
    const node = map[item[id]]
    const parent = map[item[parentId]]

    if (item[parentId] === rootId || item[parentId] === null || item[parentId] === undefined || !parent) {
      // 根节点
      result.push(node)
    } else {
      // 子节点
      if (!parent[children]) {
        parent[children] = []
      }
      parent[children].push(node)
    }
  })

  return result
}

