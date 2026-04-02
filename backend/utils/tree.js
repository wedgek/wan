/**
 * 扁平列表 → 树（parentId 指向父 id，根 parentId=0）
 */
function buildTree(items, { idKey = 'id', parentKey = 'parentId', childrenKey = 'children' } = {}) {
  const map = new Map()
  const roots = []
  for (const item of items) {
    map.set(item[idKey], { ...item, [childrenKey]: [] })
  }
  for (const item of items) {
    const node = map.get(item[idKey])
    const pid = item[parentKey]
    if (pid === 0 || pid === '0' || pid == null || pid === '') {
      roots.push(node)
    } else {
      const parent = map.get(pid)
      if (parent) parent[childrenKey].push(node)
      else roots.push(node)
    }
  }
  const prune = (nodes) => {
    nodes.forEach((n) => {
      if (n[childrenKey].length) prune(n[childrenKey])
      else delete n[childrenKey]
    })
  }
  prune(roots)
  return roots
}

module.exports = { buildTree }
