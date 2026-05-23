/**
 * 模型目录 CRUD + DMXAPI 同步 + 下拉选项
 */
const express = require('express')
const db = require('../db')
const { ok, fail } = require('../utils/response')
const { rowToCatalog, parseJsonField, normalizeVendor, buildCatalogCapabilities, capabilitiesToJson, inferApiProfile } = require('../services/modelCatalogService')
const { listProfileOptions } = require('../services/videoApiProfiles')
const { syncDmxapiModelCatalog } = require('../services/dmxapiModelSync')
const { publishCatalogToStore } = require('../services/catalogPublishService')

const router = express.Router()

const database = () => db.getDb()

router.get('/model-catalog/page', (req, res) => {
  const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const keyword = (req.query.keyword || req.query.name || '').trim()
  const modality = (req.query.modality || '').trim()
  const vendor = (req.query.vendor || '').trim()
  const source = (req.query.source || '').trim()
  const status = req.query.status
  const supportsReferenceVideo = (req.query.supportsReferenceVideo ?? req.query.refVideo ?? '').trim()

  const conds = ['1=1']
  const params = []
  if (keyword) {
    conds.push('(display_name LIKE ? OR api_model_id LIKE ? OR tags LIKE ? OR remark LIKE ?)')
    const q = `%${keyword}%`
    params.push(q, q, q, q)
  }
  if (modality) {
    conds.push('modality = ?')
    params.push(modality)
  }
  if (vendor) {
    conds.push('vendor = ?')
    params.push(vendor)
  }
  if (source) {
    conds.push('source = ?')
    params.push(source)
  }
  if (status !== undefined && status !== '') {
    conds.push('status = ?')
    params.push(Number(status))
  }
  if (supportsReferenceVideo === '1') {
    conds.push("modality = 'video'")
    conds.push(`(json_extract(capabilities_json, '$.supportsReferenceVideo') = 1
      OR capabilities_json LIKE '%"supportsReferenceVideo":true%')`)
  } else if (supportsReferenceVideo === '0') {
    conds.push("modality = 'video'")
    conds.push(`(capabilities_json IS NULL OR capabilities_json = ''
      OR (json_extract(capabilities_json, '$.supportsReferenceVideo') IS NULL
        AND capabilities_json NOT LIKE '%"supportsReferenceVideo":true%')
      OR json_extract(capabilities_json, '$.supportsReferenceVideo') = 0
      OR capabilities_json LIKE '%"supportsReferenceVideo":false%')`)
  }

  const where = conds.join(' AND ')
  const d = database()
  const total = d.prepare(`SELECT COUNT(*) AS c FROM model_catalog WHERE ${where}`).get(...params).c
  const offset = (pageNo - 1) * pageSize
  const rows = d
    .prepare(
      `SELECT id, api_model_id, display_name, modality, vendor, source, status, tags,
              capabilities_json, default_params, remark, api_profile, dmxapi_price_text, dmxapi_price_json,
              datetime(synced_at, 'localtime') AS synced_at,
              datetime(created_at, 'localtime') AS create_time,
              datetime(updated_at, 'localtime') AS update_time,
              (SELECT vm.id FROM video_models vm WHERE vm.api_model_id = model_catalog.api_model_id LIMIT 1) AS store_id
       FROM model_catalog WHERE ${where}
       ORDER BY modality ASC, vendor ASC, api_model_id ASC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset)
  res.json(ok({ list: rows.map(rowToCatalog), total }))
})

router.get('/model-catalog/get', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  const row = database()
    .prepare(
      `SELECT id, api_model_id, display_name, modality, vendor, source, status, tags,
              capabilities_json, default_params, remark, api_profile, dmxapi_price_text, dmxapi_price_json,
              datetime(synced_at, 'localtime') AS synced_at,
              datetime(created_at, 'localtime') AS create_time,
              datetime(updated_at, 'localtime') AS update_time
       FROM model_catalog WHERE id = ?`,
    )
    .get(id)
  if (!row) return res.json(fail(404, '记录不存在'))
  res.json(ok(rowToCatalog(row)))
})

router.get('/model-catalog/vendors', (req, res) => {
  const rows = database()
    .prepare(
      `SELECT vendor, api_model_id FROM model_catalog
       WHERE vendor IS NOT NULL AND TRIM(vendor) != ''`,
    )
    .all()
  const set = new Set()
  for (const r of rows) {
    const v = normalizeVendor(r.vendor, r.api_model_id)
    if (v) set.add(v)
  }
  res.json(ok([...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))))
})

router.get('/model-catalog/options', (req, res) => {
  const modality = (req.query.modality || '').trim()
  const statusRaw = req.query.status
  const conds = ['1=1']
  const params = []
  if (modality) {
    conds.push('modality = ?')
    params.push(modality)
  }
  // 模型商店「从目录选择」默认只展示启用项
  const status = statusRaw !== undefined && statusRaw !== '' ? Number(statusRaw) : 0
  conds.push('status = ?')
  params.push(status)
  const where = conds.join(' AND ')
  const rows = database()
    .prepare(
      `SELECT id, api_model_id, display_name, modality, vendor, capabilities_json, default_params, remark
       FROM model_catalog WHERE ${where}
       ORDER BY api_model_id ASC, id ASC
       LIMIT 500`,
    )
    .all(...params)
  res.json(ok(rows.map(rowToCatalog)))
})

router.get('/model-catalog/profile-options', (req, res) => {
  res.json(ok(listProfileOptions()))
})

router.post('/model-catalog/create', (req, res) => {
  const b = req.body || {}
  const apiModelId = String(b.apiModelId || '').trim()
  const displayName = apiModelId
  if (!apiModelId) return res.json(fail(400, '请填写模型 ID（apiModelId）'))

  let capabilitiesJson = null
  const modality = String(b.modality || 'unknown').trim() || 'unknown'
  if (b.capabilities != null) {
    try {
      capabilitiesJson = capabilitiesToJson(
        buildCatalogCapabilities(apiModelId, modality, '', b.capabilities),
      )
    } catch (_) {
      return res.json(fail(400, 'capabilities 须为合法 JSON 对象'))
    }
  } else if (modality === 'video') {
    capabilitiesJson = capabilitiesToJson(buildCatalogCapabilities(apiModelId, modality))
  }
  let defaultParamsJson = null
  if (b.defaultParams != null) {
    try {
      defaultParamsJson =
        typeof b.defaultParams === 'string' ? b.defaultParams : JSON.stringify(b.defaultParams)
      JSON.parse(defaultParamsJson)
    } catch (_) {
      return res.json(fail(400, 'defaultParams 须为合法 JSON'))
    }
  }

  const d = database()
  const dup = d.prepare('SELECT id FROM model_catalog WHERE api_model_id = ?').get(apiModelId)
  if (dup) return res.json(fail(400, '该模型 ID 已存在于目录中'))

  const apiProfile =
    String(b.apiProfile || '').trim() ||
    (modality === 'video' ? inferApiProfile(apiModelId) : '') ||
    null

  const info = d
    .prepare(
      `INSERT INTO model_catalog (
        api_model_id, display_name, modality, vendor, source, status, tags,
        capabilities_json, default_params, remark, api_profile, updated_at
      ) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      apiModelId,
      displayName,
      modality,
      normalizeVendor(String(b.vendor || '').trim(), apiModelId),
      b.status === 1 ? 1 : 0,
      String(b.tags || '').trim(),
      capabilitiesJson,
      defaultParamsJson,
      String(b.remark || '').trim(),
      apiProfile,
    )
  res.json(ok({ id: info.lastInsertRowid }))
})

router.put('/model-catalog/update', (req, res) => {
  const b = req.body || {}
  const id = Number(b.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  const apiModelId = String(b.apiModelId || '').trim()
  const displayName = apiModelId
  if (!apiModelId) return res.json(fail(400, '请填写模型 ID'))

  let capabilitiesJson = null
  const modality = String(b.modality || 'unknown').trim() || 'unknown'
  if (b.capabilities != null) {
    try {
      capabilitiesJson = capabilitiesToJson(
        buildCatalogCapabilities(apiModelId, modality, '', b.capabilities),
      )
    } catch (_) {
      return res.json(fail(400, 'capabilities 须为合法 JSON 对象'))
    }
  } else if (modality === 'video') {
    capabilitiesJson = capabilitiesToJson(buildCatalogCapabilities(apiModelId, modality))
  }
  let defaultParamsJson = null
  if (b.defaultParams != null) {
    try {
      defaultParamsJson =
        typeof b.defaultParams === 'string' ? b.defaultParams : JSON.stringify(b.defaultParams)
      JSON.parse(defaultParamsJson)
    } catch (_) {
      return res.json(fail(400, 'defaultParams 须为合法 JSON'))
    }
  }

  const d = database()
  const row = d.prepare('SELECT id FROM model_catalog WHERE id = ?').get(id)
  if (!row) return res.json(fail(404, '记录不存在'))
  const dup = d.prepare('SELECT id FROM model_catalog WHERE api_model_id = ? AND id != ?').get(apiModelId, id)
  if (dup) return res.json(fail(400, '该模型 ID 已被其他目录条目使用'))

  const apiProfile =
    String(b.apiProfile || '').trim() ||
    (modality === 'video' ? inferApiProfile(apiModelId) : '') ||
    null

  d.prepare(
    `UPDATE model_catalog SET api_model_id = ?, display_name = ?, modality = ?, vendor = ?,
      status = ?, tags = ?, capabilities_json = ?, default_params = ?, remark = ?, api_profile = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    apiModelId,
    displayName,
    String(b.modality || 'unknown').trim() || 'unknown',
    normalizeVendor(String(b.vendor || '').trim(), apiModelId),
    b.status === 1 ? 1 : 0,
    String(b.tags || '').trim(),
    capabilitiesJson,
    defaultParamsJson,
    String(b.remark || '').trim(),
    apiProfile,
    id,
  )
  res.json(ok(true))
})

router.put('/model-catalog/update-status', (req, res) => {
  const { id, status } = req.body || {}
  if (!id) return res.json(fail(400, '缺少 id'))
  const nextStatus = Number(status) === 1 ? 1 : 0
  const d = database()
  const row = d.prepare('SELECT id FROM model_catalog WHERE id = ?').get(Number(id))
  if (!row) return res.json(fail(404, '记录不存在'))
  d.prepare(`UPDATE model_catalog SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    nextStatus,
    Number(id),
  )
  res.json(ok(true))
})

router.put('/model-catalog/batch-update-status', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((id) => id > 0) : []
  if (!ids.length) return res.json(fail(400, '请选择条目'))
  const nextStatus = Number(req.body?.status) === 1 ? 1 : 0
  const d = database()
  const stmt = d.prepare(
    `UPDATE model_catalog SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  )
  let updated = 0
  for (const id of ids) {
    updated += stmt.run(nextStatus, id).changes
  }
  res.json(ok({ updated }))
})

router.post('/model-catalog/batch-publish', (req, res) => {
  const ids = Array.isArray(req.body?.catalogIds)
    ? req.body.catalogIds.map(Number).filter((id) => id > 0)
    : []
  if (!ids.length) return res.json(fail(400, '请选择条目'))

  const d = database()
  const published = []
  const skipped = []
  const failed = []

  for (const id of ids) {
    const result = publishCatalogToStore(d, id)
    if (result.ok) {
      published.push({ id, storeId: result.id })
    } else if (result.duplicate) {
      skipped.push({ id, msg: result.msg })
    } else {
      failed.push({ id, msg: result.msg })
    }
  }

  res.json(
    ok({
      published: published.length,
      skipped: skipped.length,
      failed: failed.length,
      details: { published, skipped, failed },
    }),
  )
})

router.delete('/model-catalog/delete', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  const d = database()
  d.prepare('UPDATE video_models SET catalog_id = NULL WHERE catalog_id = ?').run(id)
  d.prepare('DELETE FROM model_catalog WHERE id = ?').run(id)
  res.json(ok(true))
})

router.post('/model-catalog/sync-dmxapi', async (req, res) => {
  try {
    const stats = await syncDmxapiModelCatalog(database())
    res.json(ok(stats))
  } catch (e) {
    const code = e.code === 'E_DMXAPI_CONFIG' ? 503 : 502
    res.json(fail(code, e.message || '同步失败'))
  }
})

module.exports = router
