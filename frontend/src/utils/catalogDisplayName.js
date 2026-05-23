/**
 * 模型目录列表：模型名称列直接展示 apiModelId
 */
export function formatCatalogDisplayLabel(_displayName, apiModelId) {
  const id = String(apiModelId || '').trim()
  return id || '—'
}

export function getCatalogDisplayTooltip(displayName, apiModelId) {
  const id = String(apiModelId || '').trim()
  const name = String(displayName || '').trim()
  if (name && name !== id) return `模型 ID：${id}\n备注名称：${name}`
  return id
}
