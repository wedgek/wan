/**
 * 巨量升级版工作台 · 通用版商品库。
 * 输入书名创建商品：分类、主图、品牌沿用该库里已有的一条商品，只改名称。
 */
const db = require('../db')
const auth = require('./oceanengineAuth')

const API = 'https://api.oceanengine.com'
const LIBRARY_LIST = '/open_api/v3.0/dpa/ebp/library/list/'
const PRODUCT_LIST = '/open_api/v3.0/dpa/ebp/product/list/'
const PRODUCT_DETAIL = '/open_api/v3.0/dpa/ebp/product/detail/get/'
const PRODUCT_CREATE = '/open_api/v3.0/dpa/ebp/product/create/'

const DROP_KEYS = new Set([
  'product_id',
  'audit_status',
  'status_name',
  'reject_reason',
  'reason',
  'has_video',
  'video',
  'videos',
  'request_id',
  'code',
  'message',
  'online_time',
  'offline_time',
])

function accountId() {
  return String(process.env.OCEANENGINE_EBP_ACCOUNT_ID || '1863711955555339').trim()
}

function defaultPlatformId() {
  return String(process.env.OCEANENGINE_PLATFORM_ID || '2068752917202714').trim()
}

function parseOceanBody(text) {
  const safe = String(text).replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(safe)
}

const RAW_NUMBER_KEYS = new Set(['account_id', 'platform_id', 'product_platform_id', 'advertiser_id'])

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

function asList(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  for (const key of ['list', 'product_library_list', 'libraries', 'products', 'product_list', 'library_list']) {
    if (Array.isArray(data[key])) return data[key]
  }
  return []
}

function idOf(row, keys) {
  for (const key of keys) {
    const value = row && row[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ''
}

async function oceanFetch(token, method, path, { query, body } = {}) {
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
      signal: AbortSignal.timeout(20000),
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

function normalizeLibrary(row) {
  const typeNames = { 11: '小说库', 43: '短剧漫剧库' }
  const rawType = row && (row.store_type != null ? row.store_type : row.product_industry || row.industry)
  return {
    id: idOf(row, ['platform_id', 'product_platform_id', 'library_id', 'id']),
    name: String((row && (row.name || row.platform_name || row.library_name)) || '').trim(),
    industry: typeNames[rawType] || (rawType != null && rawType !== '' ? String(rawType) : ''),
    storeType: Number(row && row.store_type) || 0,
  }
}

async function listLibraries(token, acct = accountId()) {
  const result = await oceanFetch(token, 'GET', LIBRARY_LIST, {
    query: {
      account_id: acct,
      account_type: 'EBP',
      page: 1,
      page_size: 100,
    },
  })
  if (result.error) return result
  const libraries = asList(result.data)
    .map(normalizeLibrary)
    .filter((item) => item.id)
  return { libraries }
}

async function listProductPage(token, platformId, page, pageSize, acct = accountId()) {
  const result = await oceanFetch(token, 'GET', PRODUCT_LIST, {
    query: {
      account_id: acct,
      account_type: 'EBP',
      product_platform_id: platformId,
      page,
      page_size: pageSize,
    },
  })
  if (result.error) return result
  const products = asList(result.data)
  const info = result.data.page_info || result.data.pageInfo || {}
  const totalRaw = info.total_number ?? info.total ?? result.data.total_number ?? result.data.total
  const total = Number(totalRaw)
  return { products, total: Number.isFinite(total) ? total : null }
}

async function listProducts(token, platformId, acct) {
  const page = await listProductPage(token, platformId, 1, 1, acct)
  if (page.error) return page
  return { products: page.products }
}

async function productDetail(token, platformId, productId, acct = accountId()) {
  const result = await oceanFetch(token, 'GET', PRODUCT_DETAIL, {
    query: {
      account_id: acct,
      account_type: 'EBP',
      product_platform_id: platformId,
      product_ids: [productId],
    },
  })
  if (result.error) return result
  const first = asList(result.data)[0] || result.data.product || result.data
  return { product: first }
}

function asFlag(value, fallback) {
  if (value === 0 || value === '0' || value === 'STATUS_OFFLINE') return 0
  if (value === 1 || value === '1' || value === 'STATUS_ONLINE') return 1
  return fallback
}

function cleanBookName(raw) {
  return String(raw || '')
    .replace(/[《》]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .slice(0, 100)
}

function templateInfo(raw) {
  const source = raw && raw.product_info && typeof raw.product_info === 'object' ? raw.product_info : raw
  if (!source || typeof source !== 'object') return null
  const info = {}
  for (const [key, value] of Object.entries(source)) {
    if (DROP_KEYS.has(key) || value == null || value === '') continue
    info[key] = value
  }
  return info
}

function buildProductInfo(bookName, bookId, template) {
  const info = template ? { ...template } : {}
  const previousName = String(info.name || '')
  info.name = bookName
  info.title = bookName
  if (Array.isArray(info.titles) && info.titles.length) info.titles = [bookName]
  if (typeof info.description === 'string' && previousName && info.description.includes(previousName)) {
    info.description = info.description.split(previousName).join(bookName).slice(0, 500)
  } else if (!info.description) {
    info.description = bookName
  }
  info.outer_id = bookId ? `novel-${bookId}` : `novel-${Date.now()}`
  info.status = asFlag(info.status, 1)
  info.stock = asFlag(info.stock, 1)
  const image = String(process.env.OCEANENGINE_PRODUCT_IMAGE_URL || '').trim()
  if (!info.image_url && image) info.image_url = image
  if (!info.profession || typeof info.profession !== 'object' || Array.isArray(info.profession)) {
    info.profession = {}
  }
  if (!info.profession.brand_type_choose) info.profession.brand_type_choose = '无品牌'
  return info
}

function saveRecord(row) {
  db.getDb()
    .prepare(
      `INSERT INTO oceanengine_products (
         book_name, book_id, account_id, platform_id, platform_name, product_id, status, error_message
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.bookName,
      row.bookId || '',
      accountId(),
      row.platformId || '',
      row.platformName || '',
      row.productId || '',
      row.status,
      String(row.error || '').slice(0, 500),
    )
}

async function meta(appPk) {
  const apps = auth.listApps()
  const tokenResult = await auth.getAccessToken(appPk)
  const acct = tokenResult.accountId || accountId()
  const platformFallback = tokenResult.platformId || defaultPlatformId()
  const fallbackLibrary = platformFallback
    ? [{ id: platformFallback, name: '默认商品库', industry: '' }]
    : []
  const base = {
    apps,
    appPk: tokenResult.appPk || (apps[0] && apps[0].id) || null,
    configured: apps.some((item) => item.secretSet),
    authorized: false,
    needAuth: true,
    needScope: false,
    message: tokenResult.error || '',
    accountId: acct,
    defaultPlatformId: platformFallback,
    libraries: fallbackLibrary,
  }
  if (tokenResult.error) return base
  const listed = await listLibraries(tokenResult.token, acct)
  if (listed.error) {
    return {
      ...base,
      authorized: !listed.needScope,
      needScope: !!listed.needScope,
      message: listed.needScope
        ? '应用还没有商品库权限。请到开放平台勾选「查询DPA信息」，保存后再点一次授权。'
        : `商品库列表读取失败：${listed.error}。可以先用默认商品库创建。`,
    }
  }
  const libraries = listed.libraries.length ? listed.libraries : fallbackLibrary
  return { ...base, authorized: true, needAuth: false, message: '', libraries }
}

async function createByBookName(input) {
  const bookName = cleanBookName(input && input.name)
  const bookId = String((input && input.bookId) || '').trim()
  const tokenResult = await auth.getAccessToken(input && input.appPk)
  const acct = tokenResult.accountId || accountId()
  const platformId = String((input && input.platformId) || tokenResult.platformId || defaultPlatformId()).trim()
  if (!bookName) return { error: '请填写书名' }
  if (!/^\d+$/.test(platformId)) return { error: '请选择商品库' }
  if (tokenResult.error) {
    return { error: tokenResult.error, needAuth: !!tokenResult.needAuth }
  }

  const listed = await listProducts(tokenResult.token, platformId, acct)
  if (listed.error) {
    return {
      error: listed.needScope
        ? '应用还没有商品库权限。请到开放平台勾选「查询DPA信息」，保存后再重新授权。'
        : listed.error,
      needScope: !!listed.needScope,
      needAuth: !listed.needScope && /token|授权/i.test(listed.error),
    }
  }

  let template = null
  const first = listed.products[0]
  const templateId = idOf(first, ['product_id', 'id'])
  if (templateId) {
    const detail = await productDetail(tokenResult.token, platformId, templateId, acct)
    template = templateInfo(detail.product || first)
    if (!template) template = templateInfo(first)
  }
  const productInfo = buildProductInfo(bookName, bookId, template)
  if (!productInfo.image_url) {
    return {
      error: '这个商品库里还没有可参考的商品，也没有默认主图。请先在巨量后台手动建一条，或在 .env 配置 OCEANENGINE_PRODUCT_IMAGE_URL',
    }
  }

  const created = await oceanFetch(tokenResult.token, 'POST', PRODUCT_CREATE, {
    body: {
      account_id: acct,
      account_type: 'EBP',
      platform_id: platformId,
      product_info: productInfo,
    },
  })
  if (created.error) {
    saveRecord({
      bookName,
      bookId,
      platformId,
      status: 'error',
      error: created.error,
    })
    return {
      error: created.needScope
        ? '应用还没有商品库权限。请到开放平台勾选「查询DPA信息」，保存后再重新授权。'
        : created.error,
      needScope: !!created.needScope,
    }
  }
  const productId = idOf(created.data, ['product_id', 'id'])
  saveRecord({
    bookName,
    bookId,
    platformId,
    productId,
    status: 'ok',
  })
  console.log('[oceanengine] product created', { platformId, productId, name: bookName.slice(0, 40) })
  if (productId) {
    rememberItems(platformId, '', [
      { productId, name: bookName, status: '1', auditStatus: '', imageUrl: productInfo.image_url || '' },
    ])
  }
  return { productId, name: bookName, platformId }
}

function statusText(value) {
  const s = String(value == null ? '' : value).trim()
  if (s === '1' || s === 'STATUS_ONLINE') return '可投放'
  if (s === '0' || s === 'STATUS_OFFLINE') return '不可投放'
  return s
}

function categoryFields(row) {
  const info = row && row.product_info && typeof row.product_info === 'object' ? row.product_info : row || {}
  return {
    firstCategory: String(info.first_category || '').trim(),
    subCategory: String(info.sub_category || '').trim(),
    thirdCategory: String(info.third_category || '').trim(),
  }
}

function onlineTimeOf(row) {
  const info = row && row.product_info && typeof row.product_info === 'object' ? row.product_info : row || {}
  const value = Number(info.online_time != null ? info.online_time : row && row.online_time)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function presentStatus(status, audit) {
  const auditText = String(audit || '').trim()
  if (auditText === '2' || auditText === 'AUDIT_STATUS_REJECT') return '审核未通过'
  if (auditText && auditText !== '1' && auditText !== 'AUDIT_STATUS_APPROVE') return '审核中'
  return status || ''
}

function normalizeRemoteProduct(row) {
  const info = row && row.product_info && typeof row.product_info === 'object' ? row.product_info : {}
  return {
    productId: idOf(row, ['product_id', 'id']) || idOf(info, ['product_id', 'id']),
    name: String((row && (row.name || row.product_name)) || info.name || '').trim(),
    status: statusText((row && row.status) != null ? row.status : info.status),
    auditStatus: String((row && (row.audit_status || row.auditStatus)) || info.audit_status || '').trim(),
    imageUrl: String((row && (row.image_url || row.imageUrl)) || info.image_url || '').trim(),
    ...categoryFields(row),
    onlineTime: onlineTimeOf(row),
    raw: row,
  }
}

function rememberItems(platformId, platformName, items) {
  const d = db.getDb()
  const up = d.prepare(
    `INSERT INTO oceanengine_catalog_items (
       platform_id, platform_name, product_id, name, status, audit_status, image_url, raw_json,
       first_category, sub_category, third_category, online_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(platform_id, product_id) DO UPDATE SET
       platform_name = CASE WHEN excluded.platform_name != '' THEN excluded.platform_name ELSE oceanengine_catalog_items.platform_name END,
       name = excluded.name,
       status = excluded.status,
       audit_status = excluded.audit_status,
       image_url = excluded.image_url,
       raw_json = CASE WHEN excluded.raw_json != '' THEN excluded.raw_json ELSE oceanengine_catalog_items.raw_json END,
       first_category = CASE WHEN excluded.first_category != '' THEN excluded.first_category ELSE oceanengine_catalog_items.first_category END,
       sub_category = CASE WHEN excluded.sub_category != '' THEN excluded.sub_category ELSE oceanengine_catalog_items.sub_category END,
       third_category = CASE WHEN excluded.third_category != '' THEN excluded.third_category ELSE oceanengine_catalog_items.third_category END,
       online_time = CASE WHEN excluded.online_time > 0 THEN excluded.online_time ELSE oceanengine_catalog_items.online_time END,
       synced_at = datetime('now')`,
  )
  for (const item of items) {
    if (!item.productId) continue
    up.run(
      platformId,
      platformName || '',
      item.productId,
      item.name || '',
      item.status || '',
      item.auditStatus || '',
      item.imageUrl || '',
      item.raw ? JSON.stringify(item.raw).slice(0, 20000) : '',
      item.firstCategory || '',
      item.subCategory || '',
      item.thirdCategory || '',
      item.onlineTime || 0,
    )
  }
}

function replacePlatformItems(platformId, platformName, items) {
  const d = db.getDb()
  const ids = items.map((item) => item.productId).filter(Boolean)
  const tx = d.transaction(() => {
    rememberItems(platformId, platformName, items)
    if (ids.length) {
      const ph = ids.map(() => '?').join(',')
      d.prepare(`DELETE FROM oceanengine_catalog_items WHERE platform_id = ? AND product_id NOT IN (${ph})`).run(
        platformId,
        ...ids,
      )
    } else {
      d.prepare('DELETE FROM oceanengine_catalog_items WHERE platform_id = ?').run(platformId)
    }
    d.prepare(
      `INSERT INTO oceanengine_libraries (platform_id, name, industry, product_count, synced_at)
       VALUES (?, ?, '', ?, datetime('now'))
       ON CONFLICT(platform_id) DO UPDATE SET
         name = CASE WHEN excluded.name != '' THEN excluded.name ELSE oceanengine_libraries.name END,
         product_count = excluded.product_count,
         synced_at = datetime('now')`,
    ).run(platformId, platformName || '', ids.length)
  })
  tx()
}

async function pullPlatform(token, library, acct) {
  const pageSize = 100
  const all = []
  for (let page = 1; page <= 30; page += 1) {
    const result = await listProductPage(token, library.id, page, pageSize, acct)
    if (result.error) return result
    all.push(...result.products.map(normalizeRemoteProduct).filter((item) => item.productId))
    if (!result.products.length) break
    if (result.total != null && page * pageSize >= result.total) break
    if (result.products.length < pageSize) break
  }
  replacePlatformItems(library.id, library.name, all)
  return { count: all.length }
}

async function syncFromOcean(platformId, appPk) {
  const tokenResult = await auth.getAccessToken(appPk)
  if (tokenResult.error) return { error: tokenResult.error, needAuth: !!tokenResult.needAuth }
  const acct = tokenResult.accountId || accountId()
  const listed = await listLibraries(tokenResult.token, acct)
  if (listed.error) {
    return {
      error: listed.needScope
        ? '应用还没有商品库权限。请到开放平台勾选「查询DPA信息」，保存后再重新授权。'
        : listed.error,
      needScope: !!listed.needScope,
    }
  }
  const wanted = String(platformId || '').trim()
  const targets = listed.libraries.filter((item) => !wanted || item.id === wanted)
  if (wanted && !targets.length) return { error: '巨量上没有这个商品库' }
  const libraries = targets.length ? targets : [{ id: wanted || tokenResult.platformId || defaultPlatformId(), name: '' }]
  let count = 0
  for (const library of libraries) {
    const pulled = await pullPlatform(tokenResult.token, library, acct)
    if (pulled.error) return pulled
    count += pulled.count
  }
  const d = db.getDb()
  for (const library of listed.libraries) {
    d.prepare(
      `INSERT INTO oceanengine_libraries (platform_id, name, industry, product_count, synced_at)
       VALUES (?, ?, ?, COALESCE((SELECT product_count FROM oceanengine_libraries WHERE platform_id = ?), 0), datetime('now'))
       ON CONFLICT(platform_id) DO UPDATE SET
         name = excluded.name,
         industry = excluded.industry,
         synced_at = datetime('now')`,
    ).run(library.id, library.name, library.industry || '', library.id)
  }
  console.log('[oceanengine] catalog synced', { libraries: libraries.length, count })
  return { count, libraries: listed.libraries.length }
}

function rememberLibraries(libraries) {
  const rows = (libraries || []).filter((item) => item && item.id)
  if (!rows.length) return
  const d = db.getDb()
  const stmt = d.prepare(
    `INSERT INTO oceanengine_libraries (platform_id, name, industry, product_count, synced_at)
     VALUES (?, ?, ?, COALESCE((SELECT product_count FROM oceanengine_libraries WHERE platform_id = ?), 0), datetime('now'))
     ON CONFLICT(platform_id) DO UPDATE SET
       name = CASE WHEN excluded.name != '' THEN excluded.name ELSE oceanengine_libraries.name END,
       industry = CASE WHEN excluded.industry != '' THEN excluded.industry ELSE oceanengine_libraries.industry END,
       synced_at = datetime('now')`,
  )
  const tx = d.transaction((list) => {
    for (const library of list) stmt.run(library.id, library.name || '', library.industry || '', library.id)
  })
  tx(rows)
}

function localUsage() {
  ensureNovelTemplateSeed()
  const d = db.getDb()
  const stored = d
    .prepare('SELECT platform_id AS id, name, industry FROM oceanengine_libraries ORDER BY name')
    .all()
  if (stored.length && !d.prepare('SELECT COUNT(*) AS n FROM oceanengine_library_prefs').get().n) {
    const ins = d.prepare(
      'INSERT INTO oceanengine_library_prefs (platform_id, enabled, updated_at) VALUES (?, ?, datetime(\'now\'))',
    )
    for (const item of stored) ins.run(item.id, DEFAULT_BUILD_LIBRARIES.includes(item.name) ? 1 : 0)
  }
  const on = new Set(
    d.prepare('SELECT platform_id FROM oceanengine_library_prefs WHERE enabled = 1').all().map((row) => row.platform_id),
  )
  return {
    libraries: stored.map((item) => ({ ...item, enabled: on.has(item.id) })),
    templates: listNovelTemplates(),
    categories: NOVEL_CATEGORIES.map((item) => ({ key: item.key, label: item.label })),
  }
}

function backfillCatalogCategories() {
  const d = db.getDb()
  const pending = d
    .prepare(`SELECT id, raw_json FROM oceanengine_catalog_items WHERE first_category = '' AND raw_json != ''`)
    .all()
  const up = d.prepare(
    'UPDATE oceanengine_catalog_items SET first_category = ?, sub_category = ?, third_category = ? WHERE id = ?',
  )
  if (pending.length) {
    const tx = d.transaction((rows) => {
      for (const row of rows) {
        let parsed
        try {
          parsed = JSON.parse(row.raw_json)
        } catch {
          continue
        }
        const fields = categoryFields(parsed)
        if (!fields.firstCategory && !fields.thirdCategory) continue
        up.run(fields.firstCategory, fields.subCategory, fields.thirdCategory, row.id)
      }
    })
    tx(pending)
  }
  const undated = d.prepare(`SELECT id, raw_json FROM oceanengine_catalog_items WHERE online_time = 0 AND raw_json != ''`).all()
  if (!undated.length) return
  const setTime = d.prepare('UPDATE oceanengine_catalog_items SET online_time = ? WHERE id = ?')
  const fillTime = d.transaction((rows) => {
    for (const row of rows) {
      let parsed
      try {
        parsed = JSON.parse(row.raw_json)
      } catch {
        continue
      }
      const onlineTime = onlineTimeOf(parsed)
      if (onlineTime) setTime.run(onlineTime, row.id)
    }
  })
  fillTime(undated)
}

function listLocal(query) {
  try {
    backfillCatalogCategories()
  } catch (e) {
    console.error('[oceanengine] backfill categories', e.message)
  }
  const pageNo = Math.max(1, parseInt(query && query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query && query.pageSize, 10) || 20))
  const platformId = String((query && query.platformId) || '').trim()
  const keyword = String((query && query.keyword) || '').trim()
  const category = String((query && query.category) || '').trim()
  const status = String((query && query.status) || '').trim()
  const where = []
  const args = []
  if (platformId) {
    where.push('platform_id = ?')
    args.push(platformId)
  }
  if (keyword) {
    where.push('(name LIKE ? OR product_id LIKE ?)')
    args.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (category) {
    const [first, sub, third] = category.split('|')
    where.push('first_category = ? AND sub_category = ? AND third_category = ?')
    args.push(first || '', sub || '', third || '')
  }
  if (status === '可投放') {
    where.push(`status = '可投放' AND (audit_status = '' OR audit_status = '1' OR audit_status = 'AUDIT_STATUS_APPROVE')`)
  } else if (status === '不可投放') {
    where.push(`status = '不可投放'`)
  } else if (status === '审核未通过') {
    where.push(`audit_status IN ('2', 'AUDIT_STATUS_REJECT')`)
  } else if (status === '审核中') {
    where.push(`audit_status != '' AND audit_status NOT IN ('1', '2', 'AUDIT_STATUS_APPROVE', 'AUDIT_STATUS_REJECT')`)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const d = db.getDb()
  const total = d.prepare(`SELECT COUNT(*) AS n FROM oceanengine_catalog_items ${clause}`).get(...args).n
  const rows = d
    .prepare(
      `SELECT platform_id, platform_name, product_id, name, status, audit_status,
              first_category, sub_category, third_category
       FROM oceanengine_catalog_items ${clause}
       ORDER BY CASE WHEN online_time > 0 THEN online_time ELSE 4102444800 END DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (pageNo - 1) * pageSize)
  const libraries = d
    .prepare('SELECT platform_id AS id, name FROM oceanengine_libraries ORDER BY name')
    .all()
  const categories = d
    .prepare(
      `SELECT first_category, sub_category, third_category, COUNT(*) AS n
       FROM oceanengine_catalog_items
       WHERE third_category != ''
       GROUP BY first_category, sub_category, third_category
       ORDER BY n DESC, first_category, sub_category, third_category`,
    )
    .all()
  return {
    list: rows.map((row) => ({
      platformId: row.platform_id,
      platformName: row.platform_name,
      productId: row.product_id,
      name: row.name,
      status: presentStatus(row.status, row.audit_status),
      firstCategory: row.first_category || '',
      subCategory: row.sub_category || '',
      thirdCategory: row.third_category || '',
    })),
    total,
    libraries,
    categories: categories.map((row) => ({
      value: `${row.first_category}|${row.sub_category}|${row.third_category}`,
      label: [row.first_category, row.sub_category, row.third_category].filter(Boolean).join(' / '),
    })),
  }
}

const NOVEL_CATEGORIES = [
  { key: 'ancient', label: '言情 / 古代言情', first_category: '小说', first_category_id: '2004', sub_category: '言情', sub_category_id: '200432', third_category: '古代言情', third_category_id: '20043201' },
  { key: 'modern', label: '言情 / 现代言情', first_category: '小说', first_category_id: '2004', sub_category: '言情', sub_category_id: '200432', third_category: '现代言情', third_category_id: '20043202' },
  { key: 'urban', label: '都市社会 / 都市生活', first_category: '小说', first_category_id: '2004', sub_category: '都市社会', sub_category_id: '200404', third_category: '都市生活', third_category_id: '20040409' },
  { key: 'family', label: '都市社会 / 家庭伦理', first_category: '小说', first_category_id: '2004', sub_category: '都市社会', sub_category_id: '200404', third_category: '家庭伦理', third_category_id: '20040412' },
  { key: 'power', label: '都市社会 / 都市异能', first_category: '小说', first_category_id: '2004', sub_category: '都市社会', sub_category_id: '200404', third_category: '都市异能', third_category_id: '20040410' },
  { key: 'workplace', label: '都市社会 / 都市职场', first_category: '小说', first_category_id: '2004', sub_category: '都市社会', sub_category_id: '200404', third_category: '都市职场', third_category_id: '20040406' },
  { key: 'campus', label: '都市社会 / 青春校园', first_category: '小说', first_category_id: '2004', sub_category: '都市社会', sub_category_id: '200404', third_category: '青春校园', third_category_id: '20040408' },
  { key: 'fantasy', label: '奇幻玄幻 / 东方玄幻', first_category: '小说', first_category_id: '2004', sub_category: '奇幻玄幻', sub_category_id: '200401', third_category: '东方玄幻', third_category_id: '20040109' },
  { key: 'wuxia', label: '武侠仙侠 / 武侠江湖', first_category: '小说', first_category_id: '2004', sub_category: '武侠仙侠', sub_category_id: '200402', third_category: '武侠江湖', third_category_id: '20040206' },
  { key: 'xianxia', label: '武侠仙侠 / 仙侠修真', first_category: '小说', first_category_id: '2004', sub_category: '武侠仙侠', sub_category_id: '200402', third_category: '仙侠修真', third_category_id: '20040207' },
]

const TEMPLATE_SEEDS = [
  { name: '古代言情·男频', categoryKey: 'ancient', gender: '男频书', charCount: '1w-10w', pay: '0', price: '1' },
  { name: '都市生活·女频', categoryKey: 'urban', gender: '女频书', charCount: '1w-10w', pay: '5', price: '10' },
  { name: '都市生活·男频', categoryKey: 'urban', gender: '男频书', charCount: '1w-10w', pay: '3', price: '1' },
  { name: '现代言情·女频', categoryKey: 'modern', gender: '女频书', charCount: '1w-10w', pay: '5', price: '2' },
  { name: '家庭伦理·女频', categoryKey: 'family', gender: '女频书', charCount: '10w-20w', pay: '8', price: '1' },
  { name: '都市异能·男频', categoryKey: 'power', gender: '男频书', charCount: '10w-20w', pay: '10', price: '2' },
  { name: '都市职场·女频', categoryKey: 'workplace', gender: '女频书', charCount: '1w-10w', pay: '5', price: '1' },
  { name: '青春校园·女频', categoryKey: 'campus', gender: '女频书', charCount: '1w-10w', pay: '3', price: '1' },
  { name: '东方玄幻·男频', categoryKey: 'fantasy', gender: '男频书', charCount: '20w+', pay: '10', price: '2' },
  { name: '武侠江湖·男频', categoryKey: 'wuxia', gender: '男频书', charCount: '20w+', pay: '15', price: '1' },
]

const DEFAULT_BUILD_LIBRARIES = ['点众-漫剧库', '点众-iap倾心书馆']

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function shuffle(list) {
  const copy = list.slice()
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = copy[i]
    copy[i] = copy[j]
    copy[j] = current
  }
  return copy
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function storeTypeFromIndustry(industry) {
  if (industry === '短剧漫剧库') return 43
  if (industry === '小说库') return 11
  return 0
}

function localEnabledBuildLibraries() {
  return db
    .getDb()
    .prepare(
      `SELECT l.platform_id AS id, l.name, l.industry
       FROM oceanengine_library_prefs p
       JOIN oceanengine_libraries l ON l.platform_id = p.platform_id
       WHERE p.enabled = 1 AND l.name != ''
       ORDER BY l.name`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      industry: row.industry,
      storeType: storeTypeFromIndustry(row.industry),
    }))
}

function localUsedNames(platformId) {
  return new Set(
    db
      .getDb()
      .prepare(`SELECT name FROM oceanengine_catalog_items WHERE platform_id = ? AND name != ''`)
      .all(platformId)
      .map((row) => row.name),
  )
}

function parseBookNames(raw) {
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw || '')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/[《》]/g, '').slice(0, 50))
}

function allocateName(input, used) {
  const name = String(input || '').trim()
  if (!name || !used.has(name)) return name
  const trailing = name.match(/^(.*?)(\d+)$/)
  if (trailing && trailing[1]) {
    let num = Number(trailing[2]) + 1
    while (used.has(`${trailing[1]}${num}`)) num += 1
    return `${trailing[1]}${num}`.slice(0, 50)
  }
  let num = 2
  while (used.has(`${name}${num}`)) num += 1
  return `${name}${num}`.slice(0, 50)
}

function listCoverUrls() {
  return db
    .getDb()
    .prepare('SELECT url FROM oceanengine_cover_images ORDER BY id DESC')
    .all()
    .map((row) => row.url)
    .filter(Boolean)
}

function buildNovelProduct(name, imageUrl, template) {
  const category = NOVEL_CATEGORIES.find((item) => item.key === template.categoryKey) || NOVEL_CATEGORIES[0]
  const { key, label, ...fields } = category
  return {
    name,
    description: name,
    image_url: imageUrl,
    status: 1,
    stock: 1,
    ...fields,
    profession: {
      category_type: '2',
      char_count: template.charCount || '1w-10w',
      copyright_owner: template.copyrightOwner || '点众',
      monetization_mode: '付费',
      novel_author: template.author || '无名',
      novel_gender: template.gender || '男频书',
      chapter_price: String(template.chapterPrice || '1'),
      pay_start_chapter: String(template.payStartChapter || '0'),
    },
  }
}

const PLAYLET_CATEGORIES = [
  {
    first_category: '短剧',
    first_category_id: '2019',
    sub_category: '其他剧情',
    sub_category_id: '201912',
    third_category: '其他',
    third_category_id: '20191201',
  },
  {
    first_category: '短剧',
    first_category_id: '2019',
    sub_category: '都市',
    sub_category_id: '201901',
    third_category: '校园',
    third_category_id: '20190127',
  },
  {
    first_category: '短剧',
    first_category_id: '2019',
    sub_category: '都市',
    sub_category_id: '201901',
    third_category: '其他',
    third_category_id: '20190133',
  },
]

function buildPlayletProduct(name, imageUrl) {
  const title = name.replace(/[《》\s]/g, '').slice(0, 50)
  const category = pickOne(PLAYLET_CATEGORIES)
  return {
    name: title,
    image_url: imageUrl,
    status: 1,
    stock: 1,
    ...category,
    profession: {
      ad_carrier: '["安卓/IOS应用"]',
      category_type: '2',
      copyright_owner: '创漫科技',
      has_paid_content: '["付费变现"]',
      playlet_duration: pickOne(['60', '90', '105']),
      playlet_gender: pickOne(['1', '2']),
      playlet_num: pickOne(['30', '50', '80']),
      start_pay_playlet: pickOne(['1', '5']),
    },
    price_info: { price: pickOne([1, 10]) },
  }
}

async function batchCreate(input) {
  const books = parseBookNames(input && (input.names != null ? input.names : input.text))
  if (!books.length) return { error: '请填写书名，多本用换行隔开' }
  const images = listCoverUrls()
  if (!images.length) return { error: '请先在「产品图」上传图片' }

  const tokenResult = await auth.getAccessToken(input && input.appPk)
  if (tokenResult.error) return { error: tokenResult.error, needAuth: !!tokenResult.needAuth }
  const acct = tokenResult.accountId || accountId()
  let selected = localEnabledBuildLibraries()
  if (!selected.length || selected.some((item) => !item.storeType)) {
    const listed = await listLibraries(tokenResult.token, acct)
    if (listed.error) return { error: listed.error }
    rememberLibraries(listed.libraries)
    selected = enabledLibraries(listed.libraries)
  }
  if (!selected.length) return { error: '请先在「商品库」里打开要使用的商品库' }
  const templates = enabledNovelTemplates()
  if (selected.some((item) => item.storeType !== 43) && !templates.length) {
    return { error: '请先在「小说搭建模板」里打开至少一个模板' }
  }

  const templateByBook = new Map()
  const deck = shuffle(templates)
  let templateCursor = 0
  for (const book of books) {
    if (!deck.length || templateByBook.has(book)) continue
    templateByBook.set(book, deck[templateCursor % deck.length])
    templateCursor += 1
  }

  const jobs = []
  for (const library of selected) {
    const used = localUsedNames(library.id)
    for (const book of books) {
      const finalName = allocateName(book, used)
      used.add(finalName)
      jobs.push({
        library,
        book,
        finalName,
        imageUrl: pickOne(images),
        template: library.storeType === 43 ? null : templateByBook.get(book),
      })
    }
  }

  const results = await mapPool(jobs, 4, (job) => createCatalogProduct(tokenResult.token, acct, job))
  return { results }
}

async function createCatalogProduct(token, acct, job) {
  const { library, book, finalName, imageUrl, template } = job
  const productInfo = library.storeType === 43
    ? buildPlayletProduct(finalName, imageUrl)
    : buildNovelProduct(finalName, imageUrl, template)
  const created = await oceanFetch(token, 'POST', PRODUCT_CREATE, {
    body: {
      account_id: acct,
      account_type: 'EBP',
      platform_id: library.id,
      product_info: productInfo,
    },
  })
  if (created.error) {
    saveRecord({ bookName: finalName, platformId: library.id, platformName: library.name, status: 'error', error: created.error })
    return { book, libraryId: library.id, libraryName: library.name, name: finalName, error: created.error }
  }
  const productId = idOf(created.data, ['product_id', 'id'])
  rememberItems(library.id, library.name, [
    {
      productId,
      name: productInfo.name,
      status: '可投放',
      auditStatus: '',
      imageUrl,
      firstCategory: productInfo.first_category || '',
      subCategory: productInfo.sub_category || '',
      thirdCategory: productInfo.third_category || '',
    },
  ])
  saveRecord({
    bookName: productInfo.name,
    platformId: library.id,
    platformName: library.name,
    productId,
    status: 'ok',
  })
  return {
    book,
    libraryId: library.id,
    libraryName: library.name,
    name: productInfo.name,
    renamed: productInfo.name !== book,
    productId,
  }
}

async function refreshCreated(platformId, productIds, appPk) {
  const id = String(platformId || '').trim()
  const wanted = new Set(
    (Array.isArray(productIds) ? productIds : []).map((item) => String(item || '').trim()).filter(Boolean),
  )
  if (!id || !wanted.size) return { count: 0 }
  const tokenResult = await auth.getAccessToken(appPk)
  if (tokenResult.error) return { count: 0 }
  const acct = tokenResult.accountId || accountId()
  const page = await listProductPage(tokenResult.token, id, 1, 100, acct)
  if (page.error) return { count: 0 }
  const items = page.products
    .map(normalizeRemoteProduct)
    .filter((item) => item.productId && wanted.has(item.productId))
  if (!items.length) return { count: 0 }
  const library = db.getDb().prepare('SELECT name FROM oceanengine_libraries WHERE platform_id = ?').get(id)
  rememberItems(id, (library && library.name) || '', items)
  return { count: items.length }
}

function ensureNovelTemplateSeed() {
  const d = db.getDb()
  const existing = new Set(d.prepare('SELECT name FROM oceanengine_novel_templates').all().map((row) => row.name))
  const ins = d.prepare(
    `INSERT INTO oceanengine_novel_templates (
       name, category_key, gender, char_count, copyright_owner, author, pay_start_chapter, chapter_price, enabled
     ) VALUES (?, ?, ?, ?, '点众', '无名', ?, ?, 1)`,
  )
  for (const item of TEMPLATE_SEEDS) {
    if (existing.has(item.name)) continue
    ins.run(item.name, item.categoryKey, item.gender, item.charCount, item.pay, item.price)
  }
}

function templateRow(row) {
  const category = NOVEL_CATEGORIES.find((item) => item.key === row.category_key) || NOVEL_CATEGORIES[0]
  return {
    id: row.id,
    name: row.name,
    categoryKey: row.category_key,
    categoryLabel: category.label,
    gender: row.gender,
    charCount: row.char_count,
    copyrightOwner: row.copyright_owner,
    author: row.author,
    payStartChapter: row.pay_start_chapter,
    chapterPrice: row.chapter_price,
    enabled: row.enabled !== 0,
  }
}

function listNovelTemplates() {
  ensureNovelTemplateSeed()
  return db.getDb().prepare('SELECT * FROM oceanengine_novel_templates ORDER BY id').all().map(templateRow)
}

function enabledNovelTemplates() {
  return listNovelTemplates().filter((item) => item.enabled)
}

function saveNovelTemplate(input) {
  ensureNovelTemplateSeed()
  const name = String((input && input.name) || '').trim()
  if (!name) return { error: '请填写模板名称' }
  const categoryKey = NOVEL_CATEGORIES.some((item) => item.key === input.categoryKey) ? input.categoryKey : 'ancient'
  const gender = ['男频书', '女频书', '其他'].includes(input.gender) ? input.gender : '男频书'
  const charCount = ['1w-10w', '10w-20w', '20w+'].includes(input.charCount) ? input.charCount : '1w-10w'
  const copyrightOwner = String(input.copyrightOwner || '点众').trim().slice(0, 100) || '点众'
  const author = String(input.author || '无名').trim().slice(0, 100) || '无名'
  const payStartChapter = String(input.payStartChapter ?? '0').replace(/\D/g, '').slice(0, 4) || '0'
  const chapterPrice = String(input.chapterPrice ?? '1').replace(/\D/g, '').slice(0, 4) || '1'
  const id = Number(input.id) || 0
  const d = db.getDb()
  if (id) {
    d.prepare(
      `UPDATE oceanengine_novel_templates
       SET name = ?, category_key = ?, gender = ?, char_count = ?, copyright_owner = ?, author = ?,
           pay_start_chapter = ?, chapter_price = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(name, categoryKey, gender, charCount, copyrightOwner, author, payStartChapter, chapterPrice, id)
    return { id }
  }
  const info = d
    .prepare(
      `INSERT INTO oceanengine_novel_templates (
         name, category_key, gender, char_count, copyright_owner, author, pay_start_chapter, chapter_price, enabled
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(name, categoryKey, gender, charCount, copyrightOwner, author, payStartChapter, chapterPrice)
  return { id: Number(info.lastInsertRowid) }
}

function setNovelTemplateEnabled(id, enabled) {
  db.getDb()
    .prepare('UPDATE oceanengine_novel_templates SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(enabled ? 1 : 0, id)
  return { id }
}

function deleteNovelTemplate(id) {
  db.getDb().prepare('DELETE FROM oceanengine_novel_templates WHERE id = ?').run(id)
  return true
}

function enabledLibraries(libraries) {
  const d = db.getDb()
  const prefs = d.prepare('SELECT platform_id, enabled FROM oceanengine_library_prefs').all()
  if (!prefs.length) {
    const ins = d.prepare(
      'INSERT INTO oceanengine_library_prefs (platform_id, enabled, updated_at) VALUES (?, ?, datetime(\'now\'))',
    )
    for (const item of libraries) {
      ins.run(item.id, DEFAULT_BUILD_LIBRARIES.includes(item.name) ? 1 : 0)
    }
  } else {
    const known = new Set(prefs.map((row) => row.platform_id))
    const ins = d.prepare(
      'INSERT OR IGNORE INTO oceanengine_library_prefs (platform_id, enabled, updated_at) VALUES (?, 0, datetime(\'now\'))',
    )
    for (const item of libraries) {
      if (!known.has(item.id)) ins.run(item.id)
    }
  }
  const on = new Set(
    d.prepare('SELECT platform_id FROM oceanengine_library_prefs WHERE enabled = 1').all().map((row) => row.platform_id),
  )
  return libraries.filter((item) => on.has(item.id))
}

function librarySettings(libraries) {
  enabledLibraries(libraries)
  const on = new Set(
    db.getDb().prepare('SELECT platform_id FROM oceanengine_library_prefs WHERE enabled = 1').all().map((row) => row.platform_id),
  )
  return libraries.map((item) => ({ ...item, enabled: on.has(item.id) }))
}

function setLibraryEnabled(platformId, enabled) {
  const id = String(platformId || '').trim()
  if (!id) return { error: '缺少商品库' }
  db.getDb()
    .prepare(
      `INSERT INTO oceanengine_library_prefs (platform_id, enabled, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(platform_id) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`,
    )
    .run(id, enabled ? 1 : 0)
  return { id, enabled: !!enabled }
}

async function settings(appPk, options) {
  if (options && options.usageOnly) return localUsage()
  const templates = listNovelTemplates()
  const apps = auth.listApps()
  const tokenResult = await auth.getAccessToken(appPk)
  const base = {
    apps,
    appPk: tokenResult.appPk || (apps[0] && apps[0].id) || null,
    authorized: !tokenResult.error,
    message: tokenResult.error || '',
    libraries: [],
    templates,
    categories: NOVEL_CATEGORIES.map((item) => ({ key: item.key, label: item.label })),
  }
  if (options && options.authOnly) return base
  if (tokenResult.error) return base
  const acct = tokenResult.accountId || accountId()
  const listed = await listLibraries(tokenResult.token, acct)
  if (listed.error) return { ...base, authorized: false, message: listed.error }
  rememberLibraries(listed.libraries)
  return { ...base, libraries: librarySettings(listed.libraries) }
}

module.exports = {
  meta,
  createByBookName,
  syncFromOcean,
  listLocal,
  batchCreate,
  refreshCreated,
  listNovelTemplates,
  saveNovelTemplate,
  setNovelTemplateEnabled,
  deleteNovelTemplate,
  librarySettings,
  setLibraryEnabled,
  settings,
  parseBookNames,
  allocateName,
  cleanBookName,
  buildProductInfo,
  DEFAULT_BUILD_LIBRARIES,
}
