/**
 * 从 DMXAPI GET /v1/models + /api/pricing 同步模型目录
 * 文档：https://doc.dmxapi.cn/model-list.html
 */
const { inferModality, inferVendor, normalizeVendor, buildCatalogCapabilities, capabilitiesToJson, priceJsonToText, inferApiProfile } = require('./modelCatalogService')
const { catalogDisplayName } = require('./catalogDisplayName')
const { fetchDmxapiPricingMap, mergeRemoteMeta } = require('./dmxapiModelMeta')

const API_KEY =
  process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || process.env.DMXAPI_API_KEY || ''
const USER_ID = (process.env.DMXAPI_USER_ID || '').trim()
const BASE = (process.env.DMXAPI_API_BASE || 'https://www.dmxapi.cn/v1').replace(/\/+$/, '')

function pickModelList(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.models)) return data.models
  if (data.data && Array.isArray(data.data.data)) return data.data.data
  return []
}

function normalizeRemoteModel(item) {
  if (typeof item === 'string') {
    return { id: item, name: item, description: '' }
  }
  if (!item || typeof item !== 'object') return null
  const id = String(item.id || item.model || item.name || '').trim()
  if (!id) return null
  return {
    id,
    name: String(item.name || item.display_name || id).trim(),
    description: String(item.description || item.owned_by || item.vendor || '').trim(),
    raw: item,
  }
}

async function fetchDmxapiModels() {
  if (!API_KEY) {
    const err = new Error('未配置 ARK_API_KEY / DMXAPI_API_KEY，无法同步模型列表')
    err.code = 'E_DMXAPI_CONFIG'
    throw err
  }
  const headers = {
    Accept: 'application/json',
    Authorization: API_KEY.startsWith('Bearer ') ? API_KEY : API_KEY,
  }
  if (USER_ID) headers['Rix-Api-User'] = USER_ID

  const res = await fetch(`${BASE}/models`, { method: 'GET', headers })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {
    data = { raw: text }
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error?.message || data.msg)) || text || `HTTP ${res.status}`
    const err = new Error(String(msg))
    err.code = 'E_DMXAPI_HTTP'
    err.status = res.status
    throw err
  }
  return pickModelList(data).map(normalizeRemoteModel).filter(Boolean)
}

/**
 * @param {import('better-sqlite3').Database} dbi
 * @param {Array} remoteList
 * @param {{ map: Map, groupRatio: number }} pricingBundle
 */
function upsertSyncModels(dbi, remoteList, pricingBundle = { map: new Map(), groupRatio: 1 }) {
  const pricingMap = pricingBundle.map || new Map()
  const groupRatio = pricingBundle.groupRatio || 1

  const findManual = dbi.prepare(
    `SELECT id FROM model_catalog WHERE api_model_id = ? AND source = 'manual' LIMIT 1`,
  )
  const findAny = dbi.prepare(`SELECT id, source FROM model_catalog WHERE api_model_id = ? LIMIT 1`)
  const ins = dbi.prepare(
    `INSERT INTO model_catalog (
      api_model_id, display_name, modality, vendor, source, status, tags,
      capabilities_json, default_params, remark, dmxapi_price_text, dmxapi_price_json, raw_meta_json, api_profile, synced_at, updated_at
    ) VALUES (?, ?, ?, ?, 'sync', 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
  const upd = dbi.prepare(
    `UPDATE model_catalog SET display_name = ?, modality = ?, vendor = ?, tags = ?,
      capabilities_json = ?, remark = ?, dmxapi_price_text = ?, dmxapi_price_json = ?,
      raw_meta_json = ?, api_profile = ?, synced_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND source != 'manual'`,
  )

  let inserted = 0
  let updated = 0
  let skippedManual = 0

  for (const m of remoteList) {
    if (findManual.get(m.id)) {
      skippedManual++
      continue
    }

    const pricingEntry = pricingMap.get(m.id) || null
    const modality = inferModality(m.id, m.description)
    const vendor = normalizeVendor(inferVendor(m.id) || m.description.slice(0, 32), m.id)
    const meta = mergeRemoteMeta(m.id, modality, pricingEntry, groupRatio)
    const capabilitiesJson = capabilitiesToJson(
      buildCatalogCapabilities(m.id, modality, meta.hint || m.description),
    )
    const apiProfile = modality === 'video' ? inferApiProfile(m.id) || null : null
    const displayName = catalogDisplayName(m.id)
    const priceJson = priceJsonToText(meta.dmxapiPrice)
    const rawPayload = {
      models: m.raw || { id: m.id },
      pricing: pricingEntry || null,
    }
    const rawJson = JSON.stringify(rawPayload)

    const existing = findAny.get(m.id)
    if (!existing) {
      ins.run(
        m.id,
        displayName,
        modality,
        vendor,
        meta.tags,
        capabilitiesJson,
        null,
        meta.remark,
        meta.dmxapiPriceText,
        priceJson || null,
        rawJson,
        apiProfile,
      )
      inserted++
    } else if (existing.source !== 'manual') {
      upd.run(
        displayName,
        modality,
        vendor,
        meta.tags,
        capabilitiesJson,
        meta.remark,
        meta.dmxapiPriceText,
        priceJson || null,
        rawJson,
        apiProfile,
        existing.id,
      )
      updated++
    } else {
      skippedManual++
    }
  }

  return { inserted, updated, skippedManual, total: remoteList.length }
}

async function syncDmxapiModelCatalog(dbi) {
  const [remoteList, pricingBundle] = await Promise.all([fetchDmxapiModels(), fetchDmxapiPricingMap()])
  const stats = upsertSyncModels(dbi, remoteList, pricingBundle)
  return stats
}

module.exports = {
  fetchDmxapiModels,
  fetchDmxapiPricingMap,
  upsertSyncModels,
  syncDmxapiModelCatalog,
}
