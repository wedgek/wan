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

module.exports = {
  resolveDefaultTextModel,
  getPolishTextModelStatus,
}
