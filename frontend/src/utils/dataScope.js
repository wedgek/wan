/** 角色数据权限范围（与 roles.data_scope 一致） */
export const DATA_SCOPE_OPTIONS = [
  { value: 1, label: '全部' },
  { value: 2, label: '指定部门' },
  { value: 4, label: '所在部门及以下' },
  { value: 5, label: '仅本人' },
]

const LEGACY_SCOPE_LABELS = {
  3: '所在部门',
}

export function dataScopeLabel(scope) {
  const n = Number(scope)
  const hit = DATA_SCOPE_OPTIONS.find((o) => o.value === n)
  if (hit) return hit.label
  if (LEGACY_SCOPE_LABELS[n]) return LEGACY_SCOPE_LABELS[n]
  return '未配置'
}

/** 列表展示：类型 + 指定部门名称 */
export function formatRoleDataScopeText(row) {
  const label = dataScopeLabel(row?.dataScope)
  if (Number(row?.dataScope) === 2) {
    const names = row?.dataScopeDeptNames
    if (Array.isArray(names) && names.length) {
      return `${label}：${names.join('、')}`
    }
    const ids = row?.dataScopeDeptIds
    if (Array.isArray(ids) && ids.length) {
      return `${label} · ${ids.length} 个部门`
    }
    return `${label} · 未选部门`
  }
  return label
}
