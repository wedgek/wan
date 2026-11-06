/**
 * 巨量升级版工作台 · 广告主账户。
 * 列表走 EBP 账户接口，改名走代理商更新接口，头像走 upload + submit。
 */
const db = require('../db')
const auth = require('./oceanengineAuth')

const API = 'https://api.oceanengine.com'
const EBP_LIST = '/open_api/2/ebp/advertiser/list/'
const EBP_ALL_LIST = '/open_api/v3.0/ebp/advertiser_all/list/'
const EBP_LEVEL = '/open_api/2/ebp/level/get/'
const ADVERTISER_INFO = '/open_api/2/advertiser/info/'
const ADVERTISER_PUBLIC = '/open_api/2/advertiser/public_info/'
const AVATAR_GET = '/open_api/2/advertiser/avatar/get/'
const AVATAR_UPLOAD = '/open_api/2/advertiser/avatar/upload/'
const AVATAR_SUBMIT = '/open_api/2/advertiser/avatar/submit/'
const ADVERTISER_UPDATE = '/open_api/2/agent/advertiser/update/'

const RAW_NUMBER_KEYS = new Set(['account_id', 'advertiser_id', 'enterprise_organization_id', 'cc_account_id'])
const INFO_FIELDS = [
  'id',
  'name',
  'status',
  'company',
  'create_time',
  'first_industry_name',
]
const AVATAR_BATCH = 30
const INFO_BATCH = 80
const PAGE_SIZE = 100

let avatarScopeDenied = false

function parseOceanBody(text) {
  const safe = String(text).replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(safe)
}

function stringifyOcean(value, key) {
  if (value == null) return 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stringifyOcean(item)).join(',')}]`
  if (typeof value === 'object') {
    const parts = []
    for (const [childKey, item] of Object.entries(value)) {
      if (item === undefined) continue
      parts.push(`${JSON.stringify(childKey)}:${stringifyOcean(item, childKey)}`)
    }
    return `{${parts.join(',')}}`
  }
  if (typeof value === 'string' && RAW_NUMBER_KEYS.has(key) && /^\d+$/.test(value)) return value
  return JSON.stringify(value)
}

function idOf(row, keys) {
  for (const key of keys) {
    const value = row && row[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function asList(data, keys) {
  if (!data) return []
  if (Array.isArray(data)) return data
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key]
  }
  return []
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nameWeight(value) {
  let n = 0
  for (const ch of String(value || '')) {
    n += /[\u4e00-\u9fff]/.test(ch) ? 2 : 1
  }
  return n
}

async function oceanFetch(token, method, path, { query, body, timeout = 20000 } = {}) {
  const url = new URL(API + path)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue
      url.searchParams.set(key, typeof value === 'object' ? stringifyOcean(value) : String(value))
    }
  }
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Access-Token': token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? stringifyOcean(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
  } catch (e) {
    return { error: `巨量接口请求失败：${e.message || e}` }
  }
  let json
  try {
    json = parseOceanBody(await res.text())
  } catch {
    return { error: `巨量接口返回不是 JSON（HTTP ${res.status}）` }
  }
  if (!json || json.code !== 0) {
    const message = (json && (json.message || json.msg)) || `巨量接口失败（code=${json && json.code}）`
    const needScope = /权限|scope|无权限|permission/i.test(message)
    return { error: message, needScope, raw: json }
  }
  return { data: json.data != null ? json.data : {} }
}

async function oceanUpload(token, advertiserId, buffer, filename, mime) {
  const form = new FormData()
  form.append('advertiser_id', String(advertiserId))
  form.append(
    'image_file',
    new Blob([Uint8Array.from(buffer)], { type: mime || 'image/jpeg' }),
    filename || 'avatar.jpg',
  )
  let res
  try {
    res = await fetch(API + AVATAR_UPLOAD, {
      method: 'POST',
      headers: { 'Access-Token': token },
      body: form,
      signal: AbortSignal.timeout(30000),
    })
  } catch (e) {
    return { error: `上传头像失败：${e.message || e}` }
  }
  let json
  try {
    json = parseOceanBody(await res.text())
  } catch {
    return { error: `巨量接口返回不是 JSON（HTTP ${res.status}）` }
  }
  if (!json || json.code !== 0) {
    const message = (json && (json.message || json.msg)) || `上传头像失败（code=${json && json.code}）`
    return { error: message, needScope: /权限|scope|无权限|permission/i.test(message), raw: json }
  }
  const data = (json && json.data) || {}
  const imageId = idOf(data, ['image_id', 'imageId'])
  if (!imageId) return { error: '上传成功但未返回 image_id' }
  return { imageId, data }
}

function database() {
  return db.getDb()
}

function statusLabel(value) {
  const raw = String(value || '').trim()
  if (!raw || raw === 'STATUS_ENABLE' || raw === 'STATUS_CONFIRM' || raw === 'STATUS_OK') return '已授权'
  if (raw === 'STATUS_DISABLE' || raw === 'STATUS_LIMIT' || raw === 'STATUS_PUNISH') return '已禁用'
  if (/待审|PENDING|CONFIRMING/i.test(raw)) return '待审核'
  return '已授权'
}

function pickCreateTime(row) {
  const raw = idOf(row, ['create_time', 'created_time', 'ctime'])
  if (!raw) return ''
  const n = Number(raw)
  if (Number.isFinite(n) && n > 1000000000) {
    const ms = n > 1e12 ? n : n * 1000
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) {
      const p = (v) => String(v).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }
  }
  return String(raw).replace('T', ' ').slice(0, 19)
}

function normalizeAccount(row, fallback) {
  const advertiserId = idOf(row, ['account_id', 'advertiser_id', 'id'])
  return {
    advertiserId,
    name: String((row && (row.account_name || row.name || row.advertiser_name)) || (fallback && fallback.name) || '').trim(),
    company: String((row && (row.company || row.company_name || row.customer_name)) || (fallback && fallback.company) || '').trim(),
    status: String((row && (row.status || row.advertiser_status)) || (fallback && fallback.status) || '').trim(),
    orgId: idOf(row, ['enterprise_organization_id', 'organization_id', 'org_id']) || (fallback && fallback.orgId) || '',
    orgName: String((row && (row.organization_name || row.org_name || row.team_name)) || (fallback && fallback.orgName) || '').trim(),
    createTime: pickCreateTime(row) || (fallback && fallback.createTime) || '',
  }
}

function upsertAccounts(appPk, orgId, orgName, rows) {
  const d = database()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const stmt = d.prepare(
    `INSERT INTO oceanengine_advertisers (
       advertiser_id, app_pk, name, company, status, avatar_url, org_id, org_name, create_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)
     ON CONFLICT(advertiser_id) DO UPDATE SET
       app_pk = excluded.app_pk,
       name = CASE WHEN excluded.name != '' THEN excluded.name ELSE oceanengine_advertisers.name END,
       company = CASE WHEN excluded.company != '' THEN excluded.company ELSE oceanengine_advertisers.company END,
       status = CASE WHEN excluded.status != '' THEN excluded.status ELSE oceanengine_advertisers.status END,
       org_id = CASE WHEN excluded.org_id != '' THEN excluded.org_id ELSE oceanengine_advertisers.org_id END,
       org_name = CASE WHEN excluded.org_name != '' THEN excluded.org_name ELSE oceanengine_advertisers.org_name END,
       create_time = CASE WHEN excluded.create_time != '' THEN excluded.create_time ELSE oceanengine_advertisers.create_time END,
       synced_at = excluded.synced_at`,
  )
  const ids = []
  const tx = d.transaction((list) => {
    for (const row of list) {
      if (!row.advertiserId) continue
      ids.push(row.advertiserId)
      stmt.run(
        row.advertiserId,
        appPk || 0,
        row.name || '',
        row.company || '',
        row.status || '',
        row.orgId || orgId || '',
        row.orgName || orgName || '',
        row.createTime || '',
        now,
      )
    }
  })
  tx(rows)
  return ids
}

function removeMissing(appPk, keepIds, keepInUse) {
  const d = database()
  const protect = keepInUse ? ' AND in_use = 0' : ''
  if (!keepIds.length) {
    d.prepare(`DELETE FROM oceanengine_advertisers WHERE app_pk = ?${protect}`).run(appPk)
    return
  }
  const ph = keepIds.map(() => '?').join(',')
  d.prepare(`DELETE FROM oceanengine_advertisers WHERE app_pk = ?${protect} AND advertiser_id NOT IN (${ph})`).run(appPk, ...keepIds)
}

function updateLocalName(advertiserId, name) {
  database()
    .prepare(`UPDATE oceanengine_advertisers SET name = ?, synced_at = datetime('now') WHERE advertiser_id = ?`)
    .run(name, advertiserId)
}

function updateLocalAvatar(advertiserId, avatarUrl) {
  database()
    .prepare(`UPDATE oceanengine_advertisers SET avatar_url = ?, synced_at = datetime('now') WHERE advertiser_id = ?`)
    .run(avatarUrl || '', advertiserId)
}

function markAvatarChecked(advertiserId) {
  database()
    .prepare(`UPDATE oceanengine_advertisers SET avatar_url = CASE WHEN avatar_url = '' THEN '-' ELSE avatar_url END WHERE advertiser_id = ?`)
    .run(advertiserId)
}

async function fetchOrgName(token, orgId) {
  if (!orgId) return ''
  const result = await oceanFetch(token, 'GET', EBP_LEVEL, {
    query: { enterprise_organization_id: orgId },
  })
  if (result.error) return ''
  const data = result.data || {}
  return String(data.team_name || data.name || data.organization_name || '').trim()
}

function pageInfo(data) {
  const info = (data && data.page_info) || {}
  return {
    page: Number(info.page) || 1,
    pageSize: Number(info.page_size) || PAGE_SIZE,
    totalPage: Number(info.total_page) || 0,
    totalNumber: Number(info.total_number) || 0,
  }
}

function tooManyAccounts(result) {
  const message = String((result && result.error) || '')
  return /1w|10000|超过|超量|too many|limit/i.test(message)
}

async function fetchEbpPage(token, path, orgId, page, traverse = true) {
  return oceanFetch(token, 'GET', path, {
    query: {
      enterprise_organization_id: orgId,
      account_source: 'AD',
      ...(traverse ? { filtering: { query_type: 'TRAVERSE' } } : {}),
      page,
      page_size: PAGE_SIZE,
    },
  })
}

async function fetchAllAccounts(token, orgId) {
  const strategies = [
    { path: EBP_LIST, traverse: true },
    { path: EBP_LIST, traverse: false },
    { path: EBP_ALL_LIST, traverse: false },
  ]
  let chosen = null
  let first = null
  let lastError = null
  for (const strategy of strategies) {
    first = await fetchEbpPage(token, strategy.path, orgId, 1, strategy.traverse)
    if (!first.error) {
      chosen = strategy
      break
    }
    lastError = first
    if (strategy.path === EBP_LIST && !tooManyAccounts(first) && !first.needScope) continue
  }
  if (!chosen) return lastError || { error: '拉取账户列表失败' }
  const collected = asList(first.data, ['account_list', 'list', 'advertiser_list'])
  let info = pageInfo(first.data)
  let total = info.totalNumber || collected.length
  let page = 2
  while (page <= 120) {
    if (info.totalPage && page > info.totalPage) break
    if (!info.totalPage && collected.length < PAGE_SIZE) break
    const result = await fetchEbpPage(token, chosen.path, orgId, page, chosen.traverse)
    if (result.error) break
    const list = asList(result.data, ['account_list', 'list', 'advertiser_list'])
    collected.push(...list)
    info = pageInfo(result.data)
    total = info.totalNumber || collected.length
    if (!list.length || list.length < PAGE_SIZE) break
    page += 1
    await sleep(150)
  }
  return { accounts: collected, total: total || collected.length }
}

function infoRows(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  for (const key of ['list', 'advertiser_list', 'data']) {
    if (Array.isArray(data[key])) return data[key]
  }
  if (typeof data === 'object') {
    const values = Object.values(data)
    if (values.length && values.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      return values
    }
  }
  return []
}

async function fetchAdvertiserInfo(token, ids) {
  const details = new Map()
  for (let i = 0; i < ids.length; i += INFO_BATCH) {
    const chunk = ids.slice(i, i + INFO_BATCH)
    let result = await oceanFetch(token, 'GET', ADVERTISER_INFO, {
      query: { advertiser_ids: chunk, fields: INFO_FIELDS },
    })
    if (result.error) {
      result = await oceanFetch(token, 'GET', ADVERTISER_PUBLIC, {
        query: { advertiser_ids: chunk },
      })
    }
    if (result.error) {
      if (result.needScope) return { details, error: result.error, needScope: true }
      continue
    }
    for (const row of infoRows(result.data)) {
      const item = normalizeAccount(row)
      if (item.advertiserId) details.set(item.advertiserId, item)
    }
    if (i + INFO_BATCH < ids.length) await sleep(120)
  }
  return { details }
}

function avatarUrlOf(data) {
  if (!data) return ''
  const nested = data.avatar_info || data.avatar || data
  for (const key of ['web_url', 'audit_web_url', 'avatar_url', 'image_url', 'url']) {
    const value = nested && nested[key]
    if (value && /^https?:\/\//i.test(String(value))) return String(value).trim()
  }
  return ''
}

async function enrichAvatars(token, ids) {
  if (avatarScopeDenied || !ids.length) return
  const queue = ids.filter((id) => id)
  const concurrency = 3
  let cursor = 0
  async function pull() {
    const index = cursor
    cursor += 1
    return index < queue.length ? queue[index] : ''
  }
  async function fetchAvatar(advertiserId) {
    let result = await oceanFetch(token, 'GET', AVATAR_GET, {
      query: { advertiser_id: advertiserId },
    })
    if (result.error && /频繁|请求过多|too many|rate|限流|系统繁忙/i.test(result.error)) {
      await sleep(600)
      result = await oceanFetch(token, 'GET', AVATAR_GET, {
        query: { advertiser_id: advertiserId },
      })
    }
    return result
  }
  async function worker() {
    while (!avatarScopeDenied) {
      const advertiserId = await pull()
      if (!advertiserId) return
      const result = await fetchAvatar(advertiserId)
      if (result.needScope) {
        avatarScopeDenied = true
        return
      }
      if (result.error) continue
      const url = avatarUrlOf(result.data)
      if (url && /^https?:\/\//i.test(url)) updateLocalAvatar(advertiserId, url)
      else markAvatarChecked(advertiserId)
      await sleep(80)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
}

const TEMPLATE_BID = {
  '1.9': '2.1',
  '2.9': '3.1',
  '3.9': '4.1',
  '9.9': '13',
  '29.9': '31',
  '39.9': '41',
}

function parseUsage(name) {
  const text = String(name || '').trim()
  const novel = text.match(/^(.+?)-?点众小说(\d+(?:\.\d+)?)/)
  if (novel) {
    const template = novel[2]
    return { subject: novel[1], template, bid: TEMPLATE_BID[template] || '' }
  }
  const parts = text.split('-').map((item) => item.trim()).filter(Boolean)
  if (parts[0] === '侠客行' && parts[1]) return { subject: parts[1], template: '', bid: '' }
  return { subject: '', template: '', bid: '' }
}

function usableAvatar(url) {
  const value = String(url || '').trim()
  if (!value || value === '-') return ''
  if (!/byteimg\.com/i.test(value)) return value
  const match = value.match(/[?&]x-expires=(\d+)/)
  if (!match || Number(match[1]) * 1000 < Date.now() + 10 * 60 * 1000) return ''
  return value
}

function toPublic(row) {
  const usage = parseUsage(row.name)
  return {
    advertiserId: row.advertiser_id,
    name: row.name || '',
    company: row.company || '',
    status: row.status || '',
    statusLabel: statusLabel(row.status),
    avatarUrl: usableAvatar(row.avatar_url),
    orgId: row.org_id || '',
    orgName: row.org_name || '',
    createTime: row.create_time || '',
    syncedAt: row.synced_at || '',
    inUse: Number(row.in_use) === 1,
    subject: usage.subject,
    template: usage.template,
    bid: usage.bid,
    copyrightOwner: row.copyright_owner || '',
  }
}

function listLocal(query) {
  const pool = String((query && query.scope) || '') === 'pool'
  const pageNo = Math.max(1, parseInt(query && query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query && query.pageSize, 10) || 20))
  const keyword = String((query && query.keyword) || '').trim()
  const subject = String((query && query.subject) || '').trim()
  const template = String((query && query.template) || '').trim()
  const copyright = String((query && query.copyright) || '').trim()
  const d = database()
  if (pool && keyword.length < 2) {
    return { list: [], total: 0, subjects: [], templates: [], copyrights: [], copyrightCounts: {}, usingTotal: usingCount(d) }
  }
  const where = [pool ? 'in_use = 0' : 'in_use = 1']
  const args = []
  if (keyword) {
    where.push('(name LIKE ? OR advertiser_id LIKE ?)')
    args.push(`%${keyword}%`, `%${keyword}%`)
  }
  const rows = d
    .prepare(
      `SELECT advertiser_id, name, company, status, avatar_url, org_id, org_name, create_time, synced_at, in_use, copyright_owner
       FROM oceanengine_advertisers
       WHERE ${where.join(' AND ')}`,
    )
    .all(...args)
    .map(toPublic)
  const copyrights = [...new Set(rows.map((row) => row.copyrightOwner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  const copyrightCounts = {}
  for (const row of rows) {
    const key = row.copyrightOwner || ''
    copyrightCounts[key] = (copyrightCounts[key] || 0) + 1
  }
  let list = rows
  if (copyright === '__unset__') list = list.filter((row) => !row.copyrightOwner)
  else if (copyright) list = list.filter((row) => row.copyrightOwner === copyright)
  const subjects = [...new Set(list.map((row) => row.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  const templates = [...new Set(list.map((row) => row.template).filter(Boolean))].sort((a, b) => Number(a) - Number(b))
  if (subject) list = list.filter((row) => row.subject === subject)
  if (template) list = list.filter((row) => row.template === template)
  list.sort((a, b) => {
    const byCopyright = a.copyrightOwner.localeCompare(b.copyrightOwner, 'zh')
    if (byCopyright) return byCopyright
    const bySubject = a.subject.localeCompare(b.subject, 'zh')
    if (bySubject) return bySubject
    const byTemplate = (Number(a.template) || 0) - (Number(b.template) || 0)
    if (byTemplate) return byTemplate
    return a.name.localeCompare(b.name, 'zh')
  })
  const start = (pageNo - 1) * pageSize
  return {
    list: list.slice(start, start + pageSize),
    total: list.length,
    subjects,
    templates,
    copyrights,
    copyrightCounts,
    usingTotal: usingCount(d),
  }
}

function usingCount(d) {
  return d.prepare('SELECT COUNT(*) AS n FROM oceanengine_advertisers WHERE in_use = 1').get().n
}

function setUsing(ids, using) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter((id) => /^\d+$/.test(id)))]
  if (!clean.length) return { error: '请选择账户' }
  const ph = clean.map(() => '?').join(',')
  const info = database()
    .prepare(`UPDATE oceanengine_advertisers SET in_use = ? WHERE advertiser_id IN (${ph})`)
    .run(using ? 1 : 0, ...clean)
  return { count: info.changes }
}

async function searchOceanAccounts({ keyword, pageNo, pageSize } = {}) {
  const text = String(keyword || '').trim()
  if (text.length < 2) return { error: '请输入至少两个字，例如点众小说' }
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const orgId = String(tokenResult.accountId || '').trim()
  if (!orgId) return { error: '还没有工作台组织 ID' }
  const page = Math.max(1, parseInt(pageNo, 10) || 1)
  const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))
  const result = await oceanFetch(tokenResult.token, 'GET', EBP_LIST, {
    query: {
      enterprise_organization_id: orgId,
      account_source: 'AD',
      filtering: { account_name: text, query_type: 'TRAVERSE' },
      page,
      page_size: size,
    },
  })
  if (result.error) return result
  const rows = asList(result.data, ['account_list', 'list', 'advertiser_list']).map((row) => normalizeAccount(row))
  const info = pageInfo(result.data)
  const ids = rows.map((row) => row.advertiserId).filter(Boolean)
  const used = new Set()
  if (ids.length) {
    const ph = ids.map(() => '?').join(',')
    const existing = database()
      .prepare(`SELECT advertiser_id FROM oceanengine_advertisers WHERE in_use = 1 AND advertiser_id IN (${ph})`)
      .all(...ids)
    for (const item of existing) used.add(item.advertiser_id)
  }
  return {
    list: rows.filter((row) => row.advertiserId).map((row) => ({
      advertiserId: row.advertiserId,
      name: row.name,
      inUse: used.has(row.advertiserId),
      ...parseUsage(row.name),
    })),
    total: info.totalNumber || rows.length,
    page,
    pageSize: size,
  }
}

function rememberImported(appPk, orgId, rows) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      advertiserId: String((row && row.advertiserId) || '').trim(),
      name: String((row && row.name) || '').trim(),
    }))
    .filter((row) => /^\d+$/.test(row.advertiserId))
  if (!clean.length) return { error: '请选择账户' }
  upsertAccounts(appPk || 0, orgId || '', '', clean)
  fillKnownCopyright()
  return setUsing(clean.map((row) => row.advertiserId), true)
}

async function importSelectedAccounts(rows) {
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  return rememberImported(tokenResult.appPk, tokenResult.accountId, rows)
}

async function importOceanSearch(keyword) {
  const text = String(keyword || '').trim()
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const orgId = String(tokenResult.accountId || '').trim()
  const collected = []
  const seen = new Set()
  let page = 1
  let total = 0
  let failed = ''
  const size = 20
  while (page <= 50) {
    const found = await searchOceanAccounts({ keyword: text, pageNo: page, pageSize: size })
    if (found.error) {
      failed = found.error
      break
    }
    total = found.total || total
    for (const row of found.list) {
      if (!row.advertiserId || row.inUse || seen.has(row.advertiserId)) continue
      seen.add(row.advertiserId)
      collected.push(row)
    }
    const fetched = (page - 1) * size + found.list.length
    if (!found.list.length || fetched >= total) break
    page += 1
    await sleep(120)
  }
  if (!collected.length) {
    return { error: failed || (total ? '这些账户已经在使用中' : '巨量没有匹配的账户') }
  }
  const saved = rememberImported(tokenResult.appPk, orgId, collected)
  if (saved.error) return saved
  console.log('[oceanengine] ocean import', { keyword: text, count: saved.count, total, failed })
  return failed ? { count: saved.count, total, warning: failed } : { count: saved.count, total }
}

async function listPage(query) {
  const page = listLocal(query)
  if (String((query && query.scope) || '') === 'pool') return page
  const missing = page.list.filter((row) => !row.avatarUrl).map((row) => row.advertiserId)
  if (!missing.length || avatarScopeDenied) return page
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return page
  await enrichAvatars(tokenResult.token, missing)
  return listLocal(query)
}

async function syncFromOcean(appPk) {
  avatarScopeDenied = false
  const tokenResult = await auth.getAccessToken(appPk)
  if (tokenResult.error) return tokenResult
  const orgId = String(tokenResult.accountId || '').trim()
  if (!orgId) return { error: '还没有工作台组织 ID，请先到巨量配置里填写' }
  const listed = await fetchAllAccounts(tokenResult.token, orgId)
  if (listed.error) return listed
  const raw = listed.accounts || []
  const orgName = (await fetchOrgName(tokenResult.token, orgId)) || ''
  const basics = raw.map((row) => normalizeAccount(row, { orgId, orgName })).filter((row) => row.advertiserId)
  if (!basics.length) {
    removeMissing(tokenResult.appPk, [])
    return { count: 0, message: '巨量工作台下没有广告主账户' }
  }
  const info = await fetchAdvertiserInfo(
    tokenResult.token,
    basics.map((row) => row.advertiserId),
  )
  const merged = basics.map((row) => {
    const extra = info.details.get(row.advertiserId)
    if (!extra) return row
    return {
      ...row,
      name: extra.name || row.name,
      company: extra.company || row.company,
      status: extra.status || row.status,
      createTime: extra.createTime || row.createTime,
      orgName: extra.orgName || row.orgName,
    }
  })
  const ids = upsertAccounts(tokenResult.appPk, orgId, orgName, merged)
  const truncated = basics.length >= 10000 || (listed.total || 0) >= 10000
  removeMissing(tokenResult.appPk, ids, truncated)
  const using = await refreshUsingDetails(tokenResult.token, tokenResult.appPk, orgId, orgName)
  console.log('[oceanengine] advertisers synced', { count: ids.length, orgId, truncated, using: using.count })
  return { count: ids.length, needScope: info.needScope || using.needScope || false }
}

async function refreshUsingDetails(token, appPk, orgId, orgName) {
  const rows = database()
    .prepare(
      `SELECT advertiser_id, name, company, status, org_id, org_name, create_time
       FROM oceanengine_advertisers WHERE in_use = 1`,
    )
    .all()
  if (!rows.length) return { count: 0 }
  const info = await fetchAdvertiserInfo(
    token,
    rows.map((row) => row.advertiser_id),
  )
  const merged = rows.map((row) => {
    const extra = info.details.get(row.advertiser_id)
    return {
      advertiserId: row.advertiser_id,
      name: (extra && extra.name) || row.name || '',
      company: (extra && extra.company) || row.company || '',
      status: (extra && extra.status) || row.status || '',
      orgId: (extra && extra.orgId) || row.org_id || orgId || '',
      orgName: (extra && extra.orgName) || row.org_name || orgName || '',
      createTime: (extra && extra.createTime) || row.create_time || '',
    }
  })
  upsertAccounts(appPk, orgId, orgName, merged)
  return { count: merged.length, needScope: info.needScope || false }
}

function cleanIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter((id) => /^\d+$/.test(id)))]
}

function fillKnownCopyright() {
  database()
    .prepare(
      `UPDATE oceanengine_advertisers SET copyright_owner = '点众'
       WHERE copyright_owner = '' AND name LIKE '%点众小说%'`,
    )
    .run()
}

async function syncOnline(advertiserIds) {
  avatarScopeDenied = false
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const orgId = String(tokenResult.accountId || '').trim()
  let ids = cleanIds(advertiserIds)
  if (!ids.length) {
    ids = database()
      .prepare('SELECT advertiser_id FROM oceanengine_advertisers WHERE in_use = 1')
      .all()
      .map((row) => row.advertiser_id)
  }
  if (!ids.length) return { error: '没有要同步的账户' }
  const ph = ids.map(() => '?').join(',')
  const current = database()
    .prepare(
      `SELECT advertiser_id, name, company, status, org_id, org_name, create_time, avatar_url
       FROM oceanengine_advertisers WHERE advertiser_id IN (${ph})`,
    )
    .all(...ids)
  const byId = new Map(current.map((row) => [row.advertiser_id, row]))
  const known = ids.filter((id) => byId.has(id))
  if (!known.length) return { error: '这些账户还没导入' }
  const info = await fetchAdvertiserInfo(tokenResult.token, known)
  const merged = known.map((id) => {
    const row = byId.get(id)
    const extra = info.details.get(id)
    return {
      advertiserId: id,
      name: (extra && extra.name) || row.name || '',
      company: (extra && extra.company) || row.company || '',
      status: (extra && extra.status) || row.status || '',
      orgId: (extra && extra.orgId) || row.org_id || orgId || '',
      orgName: (extra && extra.orgName) || row.org_name || '',
      createTime: (extra && extra.createTime) || row.create_time || '',
    }
  })
  upsertAccounts(tokenResult.appPk, orgId, '', merged)
  fillKnownCopyright()
  const avatarIds = known.filter((id) => !usableAvatar(byId.get(id).avatar_url))
  await enrichAvatars(tokenResult.token, avatarIds)
  console.log('[oceanengine] online synced', { count: known.length, avatarDenied: avatarScopeDenied })
  return { count: known.length, needScope: info.needScope || avatarScopeDenied || false }
}

function setCopyright(ids, copyrightOwner) {
  const clean = cleanIds(ids)
  const name = String(copyrightOwner || '').trim()
  if (!clean.length) return { error: '请选择账户' }
  if (!name) return { error: '请填写版权方' }
  if (name.length > 20) return { error: '版权方名称过长' }
  const ph = clean.map(() => '?').join(',')
  const info = database()
    .prepare(`UPDATE oceanengine_advertisers SET copyright_owner = ? WHERE advertiser_id IN (${ph})`)
    .run(name, ...clean)
  return { count: info.changes, copyrightOwner: name }
}

function normalizeItems(items) {
  const out = []
  const seen = new Set()
  for (const item of items || []) {
    const advertiserId = String((item && (item.advertiserId || item.advertiser_id)) || '').trim()
    const name = String((item && item.name) || '').trim()
    if (!advertiserId || seen.has(advertiserId)) continue
    seen.add(advertiserId)
    out.push({ advertiserId, name })
  }
  return out
}

async function renameAccounts(body) {
  const items = normalizeItems(body && body.items)
  if (!items.length) return { error: '请选择要改名的账户' }
  if (items.length > AVATAR_BATCH) return { error: `一次最多修改 ${AVATAR_BATCH} 个账户` }
  for (const item of items) {
    const weight = nameWeight(item.name)
    if (!item.name) return { error: `账户 ${item.advertiserId} 的新名称为空` }
    if (weight < 2 || weight > 40) {
      return { error: `账户 ${item.advertiserId} 名称长度需 2–40（一个中文算 2）` }
    }
  }
  const tokenResult = await auth.getAccessToken(body && body.appPk)
  if (tokenResult.error) return tokenResult
  const results = []
  let success = 0
  let audit = 0
  let fail = 0
  for (const item of items) {
    const result = await oceanFetch(tokenResult.token, 'POST', ADVERTISER_UPDATE, {
      body: { advertiser_id: item.advertiserId, name: item.name },
    })
    if (result.error) {
      fail += 1
      results.push({ advertiserId: item.advertiserId, name: item.name, ok: false, error: result.error })
    } else {
      const needAudit = Number(result.data && result.data.need_audit) === 1
      if (needAudit) audit += 1
      else success += 1
      updateLocalName(item.advertiserId, item.name)
      results.push({
        advertiserId: item.advertiserId,
        name: item.name,
        ok: true,
        audit: needAudit,
        error: needAudit ? '已提交，等待审核' : '',
      })
    }
    await sleep(120)
  }
  return { results, success, audit, fail }
}

function guessImageMeta(url, buffer) {
  const head = buffer && buffer.length >= 4 ? buffer.subarray(0, 4) : Buffer.alloc(0)
  const lower = String(url || '').toLowerCase()
  if (head[0] === 0x89 || lower.includes('.png')) return { mime: 'image/png', name: 'avatar.png' }
  if ((head[0] === 0x42 && head[1] === 0x4d) || lower.includes('.bmp')) return { mime: 'image/bmp', name: 'avatar.bmp' }
  return { mime: 'image/jpeg', name: 'avatar.jpg' }
}

async function downloadImage(imageUrl) {
  const url = String(imageUrl || '').trim()
  if (!url) return { error: '请先上传头像' }
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch (e) {
    return { error: `下载头像失败：${e.message || e}` }
  }
  if (!res.ok) return { error: `下载头像失败（HTTP ${res.status}）` }
  const buffer = Buffer.from(await res.arrayBuffer())
  if (!buffer.length) return { error: '头像文件是空的' }
  if (buffer.length > 5 * 1024 * 1024) return { error: '头像不能超过 5MB' }
  return { buffer, ...guessImageMeta(url, buffer) }
}

async function updateAvatars(body) {
  const ids = []
  const seen = new Set()
  for (const id of (body && body.advertiserIds) || []) {
    const advertiserId = String(id || '').trim()
    if (!advertiserId || seen.has(advertiserId)) continue
    seen.add(advertiserId)
    ids.push(advertiserId)
  }
  if (!ids.length) return { error: '请选择要换头像的账户' }
  if (ids.length > AVATAR_BATCH) return { error: `一次最多更换 ${AVATAR_BATCH} 个账户头像` }
  const image = await downloadImage(body && body.imageUrl)
  if (image.error) return image
  const tokenResult = await auth.getAccessToken(body && body.appPk)
  if (tokenResult.error) return tokenResult
  const results = []
  let success = 0
  let fail = 0
  for (const advertiserId of ids) {
    const uploaded = await oceanUpload(tokenResult.token, advertiserId, image.buffer, image.name, image.mime)
    if (uploaded.error) {
      fail += 1
      results.push({ advertiserId, ok: false, error: uploaded.error })
      await sleep(120)
      continue
    }
    const submitted = await oceanFetch(tokenResult.token, 'POST', AVATAR_SUBMIT, {
      body: { advertiser_id: advertiserId, image_id: uploaded.imageId },
    })
    if (submitted.error) {
      fail += 1
      results.push({ advertiserId, ok: false, error: submitted.error })
    } else {
      success += 1
      updateLocalAvatar(advertiserId, String((body && body.imageUrl) || ''))
      results.push({ advertiserId, ok: true, error: '' })
    }
    await sleep(150)
  }
  return { results, success, fail }
}

module.exports = {
  listLocal,
  listPage,
  setUsing,
  searchOceanAccounts,
  importSelectedAccounts,
  importOceanSearch,
  syncFromOcean,
  refreshUsingDetails,
  syncOnline,
  setCopyright,
  renameAccounts,
  updateAvatars,
  nameWeight,
}
