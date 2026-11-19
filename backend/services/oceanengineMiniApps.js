const db = require('../db')
const auth = require('./oceanengineAuth')

const AUDIT_LABEL = {
  AUDIT_ACCEPTED: '审核通过',
  AUDIT_REJECTED: '审核拒绝',
  AUDITING: '审核中',
  AUDIT_AUDITING: '审核中',
}

function database() {
  return db.getDb()
}

function toPublic(row) {
  const auditStatus = row.audit_status || ''
  return {
    appId: row.app_id,
    name: row.name || '',
    copyrightOwner: row.copyright_owner || '',
    auditStatus,
    auditLabel: AUDIT_LABEL[auditStatus] || (auditStatus ? auditStatus : '—'),
    remark: row.remark || '',
    category: row.category || '',
    createTime: row.ocean_create_time || '',
    modifyTime: row.ocean_modify_time || '',
    reason: row.reason || '',
    ebpAsset: Number(row.ebp_asset) === 1,
    addedAt: row.synced_at || '',
  }
}

function list() {
  return database()
    .prepare(
      `SELECT app_id, name, copyright_owner, audit_status, remark, category, ocean_create_time, ocean_modify_time, reason, ebp_asset, synced_at
       FROM oceanengine_mini_apps ORDER BY name, app_id`,
    )
    .all()
    .map(toPublic)
}

function savedIds() {
  return new Set(database().prepare('SELECT app_id FROM oceanengine_mini_apps').all().map((row) => row.app_id))
}

function sampleAdvertisers() {
  const rows = database()
    .prepare(`SELECT advertiser_id, copyright_owner FROM oceanengine_advertisers WHERE in_use = 1`)
    .all()
  const picked = []
  const seen = new Set()
  for (const row of rows) {
    const key = row.copyright_owner || ''
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(row.advertiser_id)
  }
  for (const row of rows) {
    if (picked.length >= 6) break
    if (!picked.includes(row.advertiser_id)) picked.push(row.advertiser_id)
  }
  return picked.slice(0, 6)
}

async function searchOcean(keyword) {
  const text = String(keyword || '').trim()
  const events = require('./oceanengineEvent')
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const ids = sampleAdvertisers()
  if (!ids.length) return { error: '还没有正在使用的账户，没法读取巨量上的小程序' }
  const map = new Map()
  const failed = []
  for (const advertiserId of ids) {
    const listed = await events.listByteMiniApps(tokenResult.token, advertiserId)
    if (listed.error) {
      failed.push(listed.error)
      continue
    }
    for (const item of listed.list || []) {
      if (!item.appId || map.has(item.appId)) continue
      map.set(item.appId, item)
    }
  }
  if (!map.size && failed.length) return { error: failed[0] }
  const added = savedIds()
  let list = [...map.values()]
  if (text) {
    list = list.filter((item) => item.name.includes(text) || item.appId.includes(text))
  }
  list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
  return {
    list: list.map((item) => ({
      appId: item.appId,
      name: item.name,
      auditStatus: item.auditStatus || '',
      auditLabel: AUDIT_LABEL[item.auditStatus] || (item.auditStatus ? item.auditStatus : '—'),
      remark: item.remark || '',
      category: item.category || '',
      createTime: item.createTime || '',
      modifyTime: item.modifyTime || '',
      reason: item.reason || '',
      ebpAsset: !!item.ebpAsset,
      added: added.has(item.appId),
    })),
    warning: failed[0] || '',
  }
}

function addSelected(items, copyrightOwner) {
  const copyright = String(copyrightOwner || '').trim()
  if (!copyright) return { error: '请先选择版权方' }
  if (copyright.length > 20) return { error: '版权方名称过长' }
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => ({
      appId: String((item && item.appId) || '').trim(),
      name: String((item && item.name) || '').trim(),
      auditStatus: String((item && item.auditStatus) || '').trim(),
      remark: String((item && item.remark) || '').trim(),
      category: String((item && item.category) || '').trim(),
      createTime: String((item && item.createTime) || '').trim(),
      modifyTime: String((item && item.modifyTime) || '').trim(),
      reason: String((item && item.reason) || '').trim(),
      ebpAsset: item && item.ebpAsset ? 1 : 0,
    }))
    .filter((item) => item.appId)
  if (!rows.length) return { error: '请选择小程序' }
  const stmt = database().prepare(`
    INSERT INTO oceanengine_mini_apps (
      app_id, name, copyright_owner, audit_status, remark, category, ocean_create_time, ocean_modify_time, reason, ebp_asset, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(app_id) DO UPDATE SET
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE oceanengine_mini_apps.name END,
      copyright_owner = excluded.copyright_owner,
      audit_status = CASE WHEN excluded.audit_status != '' THEN excluded.audit_status ELSE oceanengine_mini_apps.audit_status END,
      remark = excluded.remark,
      category = excluded.category,
      ocean_create_time = excluded.ocean_create_time,
      ocean_modify_time = excluded.ocean_modify_time,
      reason = excluded.reason,
      ebp_asset = excluded.ebp_asset,
      synced_at = datetime('now')
  `)
  const tx = database().transaction((list) => {
    for (const item of list) {
      stmt.run(
        item.appId,
        item.name,
        copyright,
        item.auditStatus,
        item.remark,
        item.category,
        item.createTime,
        item.modifyTime,
        item.reason,
        item.ebpAsset,
      )
    }
  })
  tx(rows)
  return { count: rows.length, list: list() }
}

function remove(appIds) {
  const ids = [...new Set((Array.isArray(appIds) ? appIds : []).map((id) => String(id || '').trim()).filter(Boolean))]
  if (!ids.length) return { error: '请选择要移除的小程序' }
  const ph = ids.map(() => '?').join(',')
  const info = database().prepare(`DELETE FROM oceanengine_mini_apps WHERE app_id IN (${ph})`).run(...ids)
  return { count: info.changes, list: list() }
}

function setCopyright(appId, copyrightOwner) {
  const id = String(appId || '').trim()
  const name = String(copyrightOwner || '').trim()
  if (!id) return { error: '请选择小程序' }
  if (!name) return { error: '请选择版权方' }
  if (name.length > 20) return { error: '版权方名称过长' }
  const info = database()
    .prepare(`UPDATE oceanengine_mini_apps SET copyright_owner = ? WHERE app_id = ?`)
    .run(name, id)
  if (!info.changes) return { error: '列表里没有这个小程序' }
  return { appId: id, copyrightOwner: name }
}

async function fillAudit() {
  const current = list()
  if (!current.length) return current
  const events = require('./oceanengineEvent')
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return current
  const found = new Map()
  for (const advertiserId of sampleAdvertisers()) {
    const listed = await events.listByteMiniApps(tokenResult.token, advertiserId, { auditStatus: '' })
    if (listed.error) continue
    for (const item of listed.list || []) {
      if (item.appId) found.set(item.appId, item)
    }
  }
  const stmt = database().prepare(`
    UPDATE oceanengine_mini_apps
    SET audit_status = ?, remark = ?, category = ?, ocean_create_time = ?, ocean_modify_time = ?, reason = ?, ebp_asset = ?
    WHERE app_id = ?
  `)
  for (const row of current) {
    const hit = found.get(row.appId)
    if (!hit) continue
    stmt.run(
      hit.auditStatus || row.auditStatus || '',
      hit.remark || '',
      hit.category || '',
      hit.createTime || '',
      hit.modifyTime || '',
      hit.reason || '',
      hit.ebpAsset ? 1 : 0,
      row.appId,
    )
  }
  return list()
}

module.exports = {
  list,
  fillAudit,
  searchOcean,
  addSelected,
  remove,
  setCopyright,
}
