/**
 * 模型商店：图像生成模型（modality=image）
 */

const { parseJsonField } = require('./textModelService')

function inferSupportsImageEdit(apiModelId, catalogCaps = {}) {
  if (catalogCaps.supportsImageEdit === true) return true
  if (catalogCaps.supportsImageEdit === false) return false
  const id = String(apiModelId || '').toLowerCase()
  return /seedream|seededit|gpt-image|flux|qwen-image|wan.*image|recraft|midjourney|dall|image-edit|i2i/.test(
    id,
  )
}

function listEnabledImageModels(dbi) {
  const rows = dbi
    .prepare(
      `SELECT vm.id, vm.name, vm.api_model_id, vm.is_default, mc.vendor AS catalog_vendor,
              mc.capabilities_json AS catalog_capabilities_json
       FROM video_models vm
       LEFT JOIN model_catalog mc ON mc.id = vm.catalog_id
       WHERE vm.status = 0 AND vm.modality = 'image'
       ORDER BY vm.sort ASC, vm.id ASC`,
    )
    .all()
  return rows.map((r) => {
    const caps = parseJsonField(r.catalog_capabilities_json, {})
    const apiModelId = String(r.api_model_id || '').trim()
    return {
      id: r.id,
      name: r.name || apiModelId,
      apiModelId,
      isDefault: r.is_default === 1,
      vendor: String(r.catalog_vendor || '').trim(),
      supportsImageEdit: inferSupportsImageEdit(apiModelId, caps),
    }
  })
}

function resolveImageModelById(dbi, modelId) {
  const id = Number(modelId)
  if (!id) {
    const err = new Error('缺少图像模型 ID')
    err.code = 'E_IMAGE_MODEL'
    throw err
  }
  const row = dbi
    .prepare(
      `SELECT vm.id, vm.name, vm.api_model_id, mc.capabilities_json AS catalog_capabilities_json
       FROM video_models vm
       LEFT JOIN model_catalog mc ON mc.id = vm.catalog_id
       WHERE vm.id = ? AND vm.status = 0 AND vm.modality = 'image'`,
    )
    .get(id)
  if (!row) {
    const err = new Error('图像模型不存在或未启用')
    err.code = 'E_IMAGE_MODEL'
    throw err
  }
  const caps = parseJsonField(row.catalog_capabilities_json, {})
  const apiModelId = String(row.api_model_id || '').trim()
  if (!apiModelId) {
    const err = new Error('模型未配置 API 模型名')
    err.code = 'E_IMAGE_MODEL'
    throw err
  }
  return {
    id: row.id,
    name: row.name || apiModelId,
    apiModelId,
    supportsImageEdit: inferSupportsImageEdit(apiModelId, caps),
  }
}

module.exports = {
  listEnabledImageModels,
  resolveImageModelById,
  inferSupportsImageEdit,
}
