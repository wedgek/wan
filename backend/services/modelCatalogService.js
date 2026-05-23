/**
 * 模型目录：模态推断、DMXAPI 同步维护
 */
const { mergeRemoteMeta } = require('./dmxapiModelMeta')

function inferModality(apiModelId, hint = '') {
  const id = String(apiModelId || '').toLowerCase()
  const h = String(hint || '').toLowerCase()
  const s = `${id} ${h}`

  if (/seedance|kling|vidu|wan2\.|video|hailuo|pixverse|seedance-2-0-get|happyhorse/.test(s)) return 'video'
  if (/seedream|image|gpt-image|qwen-image|wan.*image|recraft|flux|midjourney|dall/.test(s)) return 'image'
  if (/doubao/.test(s) && !/seedance|seedream/.test(s)) return 'text'
  if (
    /gpt-|claude|gemini|deepseek|qwen|glm|moonshot|kimi|llama|mistral|grok|omni(?!.*image)/.test(s) &&
    !/image|video|seedream|seedance/.test(s)
  ) {
    return 'text'
  }
  if (/transcribe|tts|speech|whisper|music|embedding|rerank|ocr/.test(s)) return 'unknown'
  return 'unknown'
}

function inferVendor(apiModelId) {
  const id = String(apiModelId || '').toLowerCase()
  if (/doubao|seedance|seedream|ep-/.test(id)) return '豆包'
  if (/kling/.test(id)) return '快手'
  if (/gpt|openai|o1|o3|codex/.test(id)) return 'OpenAI'
  if (/claude/.test(id)) return 'Anthropic'
  if (/gemini|imagen/.test(id)) return 'Google'
  if (/deepseek/.test(id)) return 'DeepSeek'
  if (/qwen|wan2|happyhorse/.test(id)) return '阿里云'
  if (/glm|zhipu/.test(id)) return '智谱'
  if (/kimi|moonshot/.test(id)) return '月之暗面'
  if (/hunyuan/.test(id)) return '腾讯'
  if (/vidu/.test(id)) return 'Vidu'
  if (/minimax|hailuo/.test(id)) return 'MiniMax'
  if (/grok|xai/.test(id)) return 'xAI'
  return ''
}

/** 查询类模型（含 kling-v3-get-all） */
function isQueryModelId(apiModelId) {
  const id = String(apiModelId || '').toLowerCase()
  if (!id) return true
  return /-get(?:$|-)/.test(id) || id.endsWith('-get-all')
}

/** Seedance 2.0 / 可灵 / 万相 r2v 等支持「参考视频」；排除 *-get 与专用 *-image2video 端点 */
function inferSupportsReferenceVideo(apiModelId, hint = '') {
  const id = String(apiModelId || '').toLowerCase()
  if (!id || isQueryModelId(id)) return false
  const s = `${id} ${String(hint || '').toLowerCase()}`

  if (/seedance-2[.-]0|doubao-seedance-2[.-]0/.test(s)) return true
  if (/(?:^|[-_/])(?:r2v|reference-video|video-generation)(?:$|[-_/])/.test(id)) return true
  if (/happyhorse.*r2v|wan2\.6-r2v/.test(id)) return true

  if (/kling/.test(id)) {
    if (/-image2video(?:$|-)/.test(id)) return false
    if (/^kling-v(?:2-[56]|3)(?:$|-)/.test(id)) return true
    if (/kling.*omni|kling.*video-generation/.test(id)) return true
  }

  if (/参考视频|reference[\s_-]?video|动作控制|video_list|reference_urls|\br2v\b/.test(s)) return true

  return false
}

function buildCatalogCapabilities(apiModelId, modality, hint = '', overrides = null) {
  const caps = overrides && typeof overrides === 'object' ? { ...overrides } : {}
  if (modality === 'video') {
    if (caps.supportsReferenceVideo === undefined) {
      caps.supportsReferenceVideo = inferSupportsReferenceVideo(apiModelId, hint)
    }
  } else if (caps.supportsReferenceVideo !== undefined) {
    delete caps.supportsReferenceVideo
  }
  return caps
}

function capabilitiesToJson(caps) {
  if (!caps || typeof caps !== 'object') return null
  const keys = Object.keys(caps)
  return keys.length ? JSON.stringify(caps) : null
}

/** 模型商店 modality：优先目录/显式值，否则按 api_model_id 推断 */
function resolveStoreModality(apiModelId, catalogModality = '', hint = '') {
  const fromCatalog = String(catalogModality || '').trim()
  if (fromCatalog) return fromCatalog
  return inferModality(apiModelId, hint) || 'unknown'
}

function isStoreModalityUnset(modality) {
  return !String(modality ?? '').trim()
}

/** 回填 video_models.modality（仅空值；不覆盖商店里手动设置的模态，含「未分类」） */
function normalizeVideoModelsModality(dbi) {
  try {
    const linked = dbi
      .prepare(
        `UPDATE video_models SET modality = (
           SELECT mc.modality FROM model_catalog mc WHERE mc.id = video_models.catalog_id
         )
         WHERE catalog_id IS NOT NULL
           AND (modality IS NULL OR TRIM(modality) = '')`,
      )
      .run()
    const rows = dbi
      .prepare(
        `SELECT id, api_model_id, modality FROM video_models
         WHERE catalog_id IS NULL
           AND (modality IS NULL OR TRIM(modality) = '')`,
      )
      .all()
    const upd = dbi.prepare('UPDATE video_models SET modality = ? WHERE id = ?')
    let inferred = 0
    for (const r of rows) {
      const next = resolveStoreModality(r.api_model_id)
      if (next && next !== r.modality) {
        upd.run(next, r.id)
        inferred++
      }
    }
    const total = (linked.changes || 0) + inferred
    if (total > 0) {
      console.log(`[db] normalized ${total} video_models modality rows`)
    }
  } catch (e) {
    console.error('[db] normalizeVideoModelsModality', e.message)
  }
}

const CANONICAL_VENDORS = [
  '豆包',
  'OpenAI',
  'Google',
  'Anthropic',
  '阿里云',
  'DeepSeek',
  '智谱',
  '月之暗面',
  '快手',
  '腾讯',
  'MiniMax',
  'Vidu',
  '百度',
  '讯飞',
  '小米',
  'xAI',
  '免费模型',
  'Midjourney',
  'Suno',
]

const VENDOR_ALIASES = [
  [/doubao|seedance|seedream|volc|字节|豆包/i, '豆包'],
  [/openai|gpt-|o1-|o3-|codex/i, 'OpenAI'],
  [/gemini|google|imagen/i, 'Google'],
  [/claude|anthropic/i, 'Anthropic'],
  [/qwen|wan2|通义|阿里|happyhorse|快乐马/i, '阿里云'],
  [/deepseek/i, 'DeepSeek'],
  [/glm|zhipu|智谱/i, '智谱'],
  [/kimi|moonshot|月之暗面/i, '月之暗面'],
  [/kling|快手/i, '快手'],
  [/hunyuan|腾讯|混元/i, '腾讯'],
  [/minimax|海螺|hailuo/i, 'MiniMax'],
  [/vidu/i, 'Vidu'],
  [/baidu|文心/i, '百度'],
  [/xunfei|讯飞|spark/i, '讯飞'],
  [/mimo|小米/i, '小米'],
  [/grok|xai|马斯克/i, 'xAI'],
  [/free|免费/i, '免费模型'],
  [/midjourney|mj_/i, 'Midjourney'],
  [/suno/i, 'Suno'],
]

/** 统一厂商名（解决 OpenAI/openai、MiniMax/minimax 等重复） */
function normalizeVendor(vendor, apiModelId = '') {
  const inferred = inferVendor(apiModelId)
  if (inferred) return inferred

  const v = String(vendor || '').trim()
  const id = String(apiModelId || '')

  if (v) {
    for (const key of CANONICAL_VENDORS) {
      if (key.toLowerCase() === v.toLowerCase()) return key
    }
    for (const [re, key] of VENDOR_ALIASES) {
      if (re.test(v)) return key
    }
  }

  for (const [re, key] of VENDOR_ALIASES) {
    if (re.test(id)) return key
  }

  return v
}

/** 将库内已有 vendor 归一化（热升级一次即可） */
function normalizeModelCatalogVendors(dbi) {
  try {
    const rows = dbi.prepare('SELECT id, api_model_id, vendor FROM model_catalog').all()
    const upd = dbi.prepare('UPDATE model_catalog SET vendor = ? WHERE id = ?')
    let changed = 0
    for (const r of rows) {
      const next = normalizeVendor(r.vendor, r.api_model_id)
      if (next && next !== r.vendor) {
        upd.run(next, r.id)
        changed++
      }
    }
    if (changed > 0) {
      console.log(`[db] normalized ${changed} model_catalog vendor rows`)
    }
  } catch (e) {
    console.error('[db] normalizeModelCatalogVendors', e.message)
  }
}

/** 同步项 capabilities_json 推断（含参考视频）；并回写已关联的商店记录 */
function normalizeModelCatalogCapabilities(dbi) {
  try {
    const rows = dbi
      .prepare(
        `SELECT id, api_model_id, modality, capabilities_json, source, tags, remark
         FROM model_catalog WHERE source != 'manual'`,
      )
      .all()
    const updCat = dbi.prepare('UPDATE model_catalog SET capabilities_json = ? WHERE id = ?')
    const updStore = dbi.prepare(
      'UPDATE video_models SET supports_reference_video = ? WHERE catalog_id = ?',
    )
    let changed = 0
    for (const r of rows) {
      const existing = parseJsonField(r.capabilities_json, {})
      const base = { ...existing }
      delete base.supportsReferenceVideo
      const hint = [r.remark, r.tags].filter(Boolean).join(' ')
      const next = buildCatalogCapabilities(r.api_model_id, r.modality, hint, base)
      const nextJson = capabilitiesToJson(next)
      const prevJson = r.capabilities_json ? JSON.stringify(existing) : null
      if (nextJson !== prevJson) {
        updCat.run(nextJson, r.id)
        changed++
      }
      if (r.modality === 'video') {
        updStore.run(next.supportsReferenceVideo ? 1 : 0, r.id)
      }
    }
    if (changed > 0) {
      console.log(`[db] normalized ${changed} model_catalog capabilities rows`)
    }
  } catch (e) {
    console.error('[db] normalizeModelCatalogCapabilities', e.message)
  }
}

/** 同步项：从 raw_meta / 本地规则补全 tags、说明、DMXAPI 价格文案 */
function normalizeModelCatalogSyncMeta(dbi) {
  try {
    const rows = dbi
      .prepare(
        `SELECT id, api_model_id, modality, tags, remark, dmxapi_price_text, dmxapi_price_json, raw_meta_json
         FROM model_catalog WHERE source = 'sync'`,
      )
      .all()
    const upd = dbi.prepare(
      `UPDATE model_catalog SET tags = ?, remark = ?, dmxapi_price_text = ?, dmxapi_price_json = ? WHERE id = ?`,
    )
    let changed = 0
    for (const r of rows) {
      const raw = parseJsonField(r.raw_meta_json, {})
      const pricingEntry = raw?.pricing || null
      const meta = mergeRemoteMeta(r.api_model_id, r.modality, pricingEntry, 1)
      const tags = String(r.tags || '').trim() || meta.tags
      const remark = String(r.remark || '').trim() || meta.remark
      const dmxapiPriceText = String(r.dmxapi_price_text || '').trim() || meta.dmxapiPriceText
      const priceJson = priceJsonToText(meta.dmxapiPrice)
      const prevPriceJson = r.dmxapi_price_json || ''
      if (
        tags !== (r.tags || '') ||
        remark !== (r.remark || '') ||
        dmxapiPriceText !== (r.dmxapi_price_text || '') ||
        priceJson !== prevPriceJson
      ) {
        upd.run(tags, remark, dmxapiPriceText, priceJson || null, r.id)
        changed++
      }
    }
    if (changed > 0) {
      console.log(`[db] normalized ${changed} model_catalog sync meta rows`)
    }
  } catch (e) {
    console.error('[db] normalizeModelCatalogSyncMeta', e.message)
  }
}

/** 同步项 display_name 与 api_model_id 对齐 */
function normalizeModelCatalogDisplayNames(dbi) {
  try {
    const r = dbi
      .prepare(
        `UPDATE model_catalog SET display_name = api_model_id
         WHERE source != 'manual' AND display_name != api_model_id`,
      )
      .run()
    if (r.changes > 0) {
      console.log(`[db] aligned ${r.changes} model_catalog display_name to api_model_id`)
    }
  } catch (e) {
    console.error('[db] normalizeModelCatalogDisplayNames', e.message)
  }
}

function priceJsonToText(json) {
  if (!json) return ''
  try {
    return JSON.stringify(json)
  } catch (_) {
    return ''
  }
}

function priceJsonFromText(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch (_) {
    return null
  }
}

function parseJsonField(raw, fallback = null) {
  if (raw == null || raw === '') return fallback
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch (_) {
    return fallback
  }
}

function formatTime(ts) {
  if (ts == null || ts === '') return ''
  return String(ts).replace('T', ' ').slice(0, 19)
}

function rowToCatalog(r) {
  if (!r) return null
  const capabilities = parseJsonField(r.capabilities_json, {})
  const defaultParams = parseJsonField(r.default_params, null)
  const modality = r.modality || 'unknown'
  return {
    id: r.id,
    apiModelId: r.api_model_id || '',
    displayName: r.display_name || '',
    modality,
    vendor: r.vendor || '',
    source: r.source || 'manual',
    status: r.status ?? 0,
    tags: r.tags || '',
    capabilities,
    supportsReferenceVideo: modality === 'video' && !!capabilities.supportsReferenceVideo,
    defaultParams,
    remark: r.remark || '',
    dmxapiPriceText: r.dmxapi_price_text || '',
    dmxapiPrice: priceJsonFromText(r.dmxapi_price_json),
    publishedToStore: !!(r.store_id),
    storeId: r.store_id ? Number(r.store_id) : null,
    syncedAt: formatTime(r.synced_at),
    createTime: formatTime(r.create_time),
    updateTime: formatTime(r.update_time),
  }
}

/** 移除历史内置精选（已由 DMXAPI 同步替代） */
function purgeModelCatalogSeed(dbi) {
  try {
    dbi
      .prepare(
        `UPDATE video_models SET catalog_id = NULL
         WHERE catalog_id IN (SELECT id FROM model_catalog WHERE source = 'seed')`,
      )
      .run()
    const r = dbi.prepare(`DELETE FROM model_catalog WHERE source = 'seed'`).run()
    if (r.changes > 0) {
      console.log(`[db] purged ${r.changes} model_catalog seed rows`)
    }
  } catch (e) {
    console.error('[db] purgeModelCatalogSeed', e.message)
  }
}

module.exports = {
  inferModality,
  inferVendor,
  inferSupportsReferenceVideo,
  isQueryModelId,
  buildCatalogCapabilities,
  capabilitiesToJson,
  resolveStoreModality,
  isStoreModalityUnset,
  normalizeVendor,
  parseJsonField,
  formatTime,
  rowToCatalog,
  priceJsonFromText,
  priceJsonToText,
  purgeModelCatalogSeed,
  normalizeModelCatalogVendors,
  normalizeModelCatalogDisplayNames,
  normalizeModelCatalogCapabilities,
  normalizeModelCatalogSyncMeta,
  normalizeVideoModelsModality,
}
