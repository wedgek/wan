/**
 * 模型商店：解析默认文本模型（用于提示词润色等）
 */

const ENV_FALLBACK_MODEL = () => (process.env.PROMPT_POLISH_MODEL || '').trim()

function findDefaultTextModelRow(dbi) {
  const textOnly = "status = 0 AND modality = 'text'"
  return dbi
    .prepare(
      `SELECT id, name, api_model_id FROM video_models WHERE ${textOnly} AND is_default = 1 ORDER BY sort ASC, id ASC LIMIT 1`,
    )
    .get()
}

/** 是否已配置可用于润色的默认文本模型（仅默认项或 env 兜底） */
function getPolishTextModelStatus(dbi) {
  const row = findDefaultTextModelRow(dbi)
  if (row) {
    return {
      available: true,
      modelName: row.name || '',
      apiModelId: String(row.api_model_id || '').trim(),
      source: 'store',
    }
  }
  const envModel = ENV_FALLBACK_MODEL()
  if (envModel) {
    return {
      available: true,
      modelName: envModel,
      apiModelId: envModel,
      source: 'env',
    }
  }
  return { available: false }
}

function resolveDefaultTextModel(dbi) {
  const row = findDefaultTextModelRow(dbi)
  if (row) {
    return {
      id: row.id,
      name: row.name || '',
      apiModelId: String(row.api_model_id || '').trim(),
      source: 'store',
    }
  }

  const envModel = ENV_FALLBACK_MODEL()
  if (envModel) {
    return {
      id: null,
      name: envModel,
      apiModelId: envModel,
      source: 'env',
    }
  }

  const err = new Error('请先在模型商店上架并设置默认文本模型')
  err.code = 'E_TEXT_MODEL_CONFIG'
  throw err
}

function parseJsonField(raw, fallback = {}) {
  if (!raw || !String(raw).trim()) return fallback
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : fallback
  } catch (_) {
    return fallback
  }
}

/** 从 model id / catalog capabilities 推断是否支持图片输入 */
function inferSupportsVision(apiModelId, catalogCaps = {}) {
  if (catalogCaps.supportsVision === true) return true
  if (catalogCaps.supportsVision === false) return false
  const id = String(apiModelId || '').toLowerCase()
  if (
    /gpt-4o|gpt-4-turbo|gpt-4\.1|claude-3|claude-4|gemini|qwen-vl|qwen2-vl|glm-4v|vision|omni|gpt-5|o1|o3|o4/.test(
      id,
    )
  ) {
    return true
  }
  return false
}

function listEnabledTextModels(dbi) {
  const rows = dbi
    .prepare(
      `SELECT vm.id, vm.name, vm.api_model_id, vm.is_default, mc.vendor AS catalog_vendor,
              mc.capabilities_json AS catalog_capabilities_json
       FROM video_models vm
       LEFT JOIN model_catalog mc ON mc.id = vm.catalog_id
       WHERE vm.status = 0 AND vm.modality = 'text'
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
      supportsVision: inferSupportsVision(apiModelId, caps),
    }
  })
}

function resolveTextModelById(dbi, modelId) {
  const id = Number(modelId)
  if (!id) {
    const err = new Error('缺少模型 ID')
    err.code = 'E_TEXT_MODEL'
    throw err
  }
  const row = dbi
    .prepare(
      `SELECT vm.id, vm.name, vm.api_model_id, mc.capabilities_json AS catalog_capabilities_json
       FROM video_models vm
       LEFT JOIN model_catalog mc ON mc.id = vm.catalog_id
       WHERE vm.id = ? AND vm.status = 0 AND vm.modality = 'text'`,
    )
    .get(id)
  if (!row) {
    const err = new Error('文本模型不存在或未启用')
    err.code = 'E_TEXT_MODEL'
    throw err
  }
  const caps = parseJsonField(row.catalog_capabilities_json, {})
  const apiModelId = String(row.api_model_id || '').trim()
  if (!apiModelId) {
    const err = new Error('模型未配置 API 模型名')
    err.code = 'E_TEXT_MODEL'
    throw err
  }
  return {
    id: row.id,
    name: row.name || apiModelId,
    apiModelId,
    supportsVision: inferSupportsVision(apiModelId, caps),
  }
}

module.exports = {
  resolveDefaultTextModel,
  getPolishTextModelStatus,
  listEnabledTextModels,
  resolveTextModelById,
  inferSupportsVision,
  parseJsonField,
}
