/**
 * 模型目录列表展示名：直接使用模型 ID，不做美化
 */
function catalogDisplayName(apiModelId, displayName = '') {
  const id = String(apiModelId || '').trim()
  if (id) return id
  return String(displayName || '').trim()
}

module.exports = {
  catalogDisplayName,
}
