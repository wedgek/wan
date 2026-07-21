/**
 * 从模型目录发布到模型商店
 */
const {
  parseJsonField,
  resolveStoreModality,
  inferApiProfile,
  resolveCatalogApiProvider,
  getProfileById,
  mergeConstraints,
  isQueryModelId,
} = require('./modelCatalogService')

function clearOtherDefaults(dbi, keepId, modality = 'video') {
  dbi
    .prepare('UPDATE video_models SET is_default = 0 WHERE id != ? AND modality = ?')
    .run(keepId, modality)
}

function n(v, d = 0) {
  const x = Number(v)
  return Number.isFinite(x) ? x : d
}

/**
 * @returns {{ ok: true, id: number } | { ok: false, msg: string, duplicate?: boolean }}
 */
function publishCatalogToStore(dbi, catalogId, b = {}) {
  const catRow = dbi
    .prepare(
      `SELECT id, api_model_id, display_name, modality, status, tags, capabilities_json, default_params, remark, api_profile, api_provider
       FROM model_catalog WHERE id = ?`,
    )
    .get(Number(catalogId))

  if (!catRow) return { ok: false, msg: '目录条目不存在' }
  if (Number(catRow.status) === 1) return { ok: false, msg: '已停用' }

  if (isQueryModelId(catRow.api_model_id)) {
    return {
      ok: false,
      msg: '查询类模型（*-get）仅用于轮询任务结果，不能上架到视频生成',
    }
  }

  const modality = resolveStoreModality(catRow.api_model_id, catRow.modality)
  const capabilities = parseJsonField(catRow.capabilities_json, {})
  const apiProfile =
    String(b.apiProfile || catRow.api_profile || capabilities.apiProfile || '').trim() ||
    inferApiProfile(catRow.api_model_id)
  const apiProvider = resolveCatalogApiProvider(
    catRow.api_model_id,
    modality,
    apiProfile,
    String(b.apiProvider || catRow.api_provider || capabilities.apiProvider || '').trim(),
  )

  if (modality === 'video' && !apiProfile) {
    return {
      ok: false,
      msg: '无法识别视频 API Profile，请在模型目录中选择 apiProfile 或确认 model id 可被自动推断',
    }
  }

  const profile = getProfileById(apiProfile)
  const mergedCaps = profile ? mergeConstraints(profile, capabilities) : capabilities
  const defaultParams = parseJsonField(catRow.default_params, null)
  const name = String(b.name || catRow.api_model_id).trim()
  const isDef = b.isDefault === true || b.isDefault === 1 ? 1 : 0
  const refVid =
    modality === 'video' &&
    (b.supportsReferenceVideo === true ||
      b.supportsReferenceVideo === 1 ||
      mergedCaps.supportsReferenceVideo)
      ? 1
      : 0

  const dup = dbi.prepare('SELECT id FROM video_models WHERE api_model_id = ? LIMIT 1').get(catRow.api_model_id)
  if (dup && !b.allowDuplicate) {
    return { ok: false, msg: '已在模型商店中', duplicate: true }
  }

  let defaultParamsJson = null
  const params = b.defaultParams != null ? b.defaultParams : defaultParams
  if (params != null && params !== '') {
    try {
      defaultParamsJson = typeof params === 'string' ? params : JSON.stringify(params)
      JSON.parse(defaultParamsJson)
    } catch (_) {
      return { ok: false, msg: 'defaultParams 须为合法 JSON' }
    }
  }

  const newId = dbi.transaction(() => {
    const info = dbi
      .prepare(
        `INSERT INTO video_models (name, api_model_id, catalog_id, modality, tags, sort, status, is_default, remark, default_params, supports_reference_video, api_profile, api_provider)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        catRow.api_model_id,
        Number(catalogId),
        modality,
        String(b.tags || catRow.tags || '').trim() || null,
        Number(b.sort) || 0,
        n(b.status, 0),
        isDef,
        String(b.remark || catRow.remark || '').trim() || null,
        defaultParamsJson,
        refVid,
        apiProfile || null,
        apiProvider || null,
      )
    const id = Number(info.lastInsertRowid)
    if (isDef) {
      clearOtherDefaults(dbi, id, modality)
      dbi.prepare('UPDATE video_models SET is_default = 1 WHERE id = ?').run(id)
    }
    return id
  })()

  return { ok: true, id: newId }
}

module.exports = {
  publishCatalogToStore,
  clearOtherDefaults,
}
