/**
 * 巨量新版事件管理：小程序事件资产、已创建事件、按可创建列表添加事件。
 * 资产列表走新接口 all_assets，添加事件走 event_manager/events/create。
 * 账户 ID、资产 ID 超过 JS 安全整数，全程用字符串传递，请求体里再写成无引号数字。
 */
const db = require('../db')
const auth = require('./oceanengineAuth')

const API = 'https://api.oceanengine.com'
const AD = 'https://ad.oceanengine.com'
const ASSET_LIST = '/open_api/2/tools/event/all_assets/list/'
const ASSET_DETAIL = '/open_api/2/tools/event/all_assets/detail/'
const EVENT_CONFIGS = '/open_api/2/event_manager/event_configs/get/'
const AVAILABLE_EVENTS = '/open_api/2/event_manager/available_events/get/'
const EVENT_CREATE = '/open_api/2/event_manager/events/create/'
const ASSET_CREATE = '/open_api/2/event_manager/assets/create/'
const MICRO_APP_LIST = '/open_api/v3.0/tools/micro_app/list/'

const RAW_NUMBER_KEYS = new Set([
  'advertiser_id',
  'asset_id',
  'event_id',
  'asset_ids',
  'instance_id',
])
const MAX_ASSET_PAGES = 5
const PAGE_SIZE = 100

const SHARE_LABELS = {
  MY_CREATIONS: '我创建的',
  SHARING: '共享中',
  SHATE_EXPIRED: '共享失效',
}

const TRACK_LABELS = {
  MINI_PROGRAME_API: '小程序API回传',
  MINI_PROGRAME_SDK: '小程序SDK',
  JSSDK: 'JS埋码',
  EXTERNAL_API: 'API回传',
  XPATH: 'XPath圈选',
  APPLICATION_API: '应用API',
  APPLICATION_SDK: '应用SDK',
  QUICK_APP_API: '快应用API',
  OFFLINE_CALLBACK: '离线回传',
}

function database() {
  return db.getDb()
}

function parseOceanBody(text) {
  const safe = String(text).replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(safe)
}

function stringifyOcean(value, key) {
  if (value == null) return 'null'
  if (Array.isArray(value)) {
    const childKey = key === 'asset_ids' ? 'asset_id' : key
    return `[${value.map((item) => stringifyOcean(item, childKey)).join(',')}]`
  }
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

function queryParam(key, value) {
  if (value == null || value === '') return ''
  return typeof value === 'object' ? stringifyOcean(value, key) : String(value)
}

function idText(value) {
  if (value == null) return ''
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : ''
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rateLimited(message) {
  return /限频|40100|too many|请求频率/i.test(String(message || ''))
}

function decorateError(result) {
  if (!result || !result.error || !result.needScope) return result
  if (/重新授权/.test(result.error)) return result
  return {
    ...result,
    error: `${result.error}。请在巨量应用开通「资产-事件管理」权限后重新授权`,
  }
}

async function oceanFetchOnce(token, method, path, { query, body, base } = {}) {
  const url = new URL((base || API) + path)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue
      url.searchParams.set(key, queryParam(key, value))
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
    return { error: `巨量接口请求失败：${e.message || e}`, network: true }
  }
  let json
  try {
    json = parseOceanBody(await res.text())
  } catch {
    return { error: `巨量接口返回不是 JSON（HTTP ${res.status}）`, network: res.status >= 500 || res.status === 404 }
  }
  if (!json || json.code !== 0) {
    const message = (json && (json.message || json.msg)) || `巨量接口失败（code=${json && json.code}）`
    const needScope = /权限|scope|无权限|permission/i.test(message)
    return { error: message, needScope, raw: json }
  }
  return { data: json.data != null ? json.data : {} }
}

async function oceanFetch(token, method, path, options) {
  const bases = options && options.bases ? options.bases : [options && options.base ? options.base : API]
  let last = { error: '巨量接口请求失败' }
  for (const base of bases) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await oceanFetchOnce(token, method, path, { ...(options || {}), base })
      if (result.error && rateLimited(result.error) && attempt < 2) {
        await sleep(800 * (attempt + 1))
        continue
      }
      last = result
      break
    }
    const tryNextHost = last.network || /不存在|not found|404/i.test(String(last.error || ''))
    if (!last.error || !tryNextHost) break
  }
  return decorateError(last)
}

function eventFetch(token, method, path, options) {
  return oceanFetch(token, method, path, { ...(options || {}), bases: [AD, API] })
}

function requireAdvertiser(advertiserId) {
  const id = idText(advertiserId)
  if (!id) return { error: '请选择投放账户' }
  const row = database().prepare('SELECT advertiser_id, name FROM oceanengine_advertisers WHERE advertiser_id = ?').get(id)
  return { advertiserId: id, name: (row && row.name) || '' }
}

async function tokenOrError() {
  const token = await auth.getAccessToken()
  if (token.error) return token
  return { token: token.token }
}

function assetRows(data) {
  if (!data) return []
  if (Array.isArray(data.asset_list)) return data.asset_list
  if (Array.isArray(data.list)) return data.list
  return []
}

function eventRows(data) {
  if (!data) return []
  if (Array.isArray(data.event_configs)) return data.event_configs
  if (Array.isArray(data.list)) return data.list
  return []
}

function pageTotal(data, fallback) {
  const info = data && (data.page_info || data.pageInfo)
  const total = info && (info.total_number != null ? info.total_number : info.total)
  const n = Number(total)
  return Number.isFinite(n) ? n : fallback
}

function trackLabel(code) {
  return TRACK_LABELS[code] || code || ''
}

function toEvent(row) {
  const tracks = Array.isArray(row && row.track_types) ? row.track_types.map((item) => String(item)) : []
  const status = String((row && row.debugging_status) || '')
  return {
    eventId: idText(row && row.event_id),
    eventType: String((row && row.event_type) || ''),
    name: String((row && (row.event_cn_name || row.event_type)) || ''),
    description: String((row && row.description) || ''),
    trackTypes: tracks,
    trackLabels: tracks.map(trackLabel).filter(Boolean),
    debuggingStatus: status,
    debuggingLabel: status === 'Active' ? '已激活' : status === 'Inactive' ? '未激活' : '',
    createTime: String((row && row.create_time) || ''),
  }
}

function toAsset(row, detail) {
  const shareType = String((row && row.share_type) || '')
  const extra = detail || {}
  return {
    assetId: idText(row && row.asset_id),
    name: String((row && row.asset_name) || ''),
    assetType: String((row && row.asset_type) || 'MINI_PROGRAME'),
    shareType,
    shareLabel: SHARE_LABELS[shareType] || shareType,
    createTime: String((row && row.create_time) || ''),
    modifyTime: String((row && row.modify_time) || ''),
    microAppId: String(extra.micro_app_id || extra.mini_program_id || ''),
    microAppInstanceId: idText(extra.micro_app_instance_id || extra.instance_id),
    appForceInfo: String((row && row.app_force_info) || ''),
  }
}

async function fetchDetails(token, advertiserId, assetIds) {
  const map = new Map()
  for (let i = 0; i < assetIds.length; i += 50) {
    const chunk = assetIds.slice(i, i + 50)
    const result = await oceanFetch(token, 'GET', ASSET_DETAIL, {
      query: { advertiser_id: advertiserId, asset_ids: chunk },
    })
    if (result.error) return { error: result.error, map }
    for (const row of assetRows(result.data)) {
      const id = idText(row && row.asset_id)
      if (id) map.set(id, row)
    }
  }
  return { map }
}

function listAccountOptions(keyword) {
  const text = String(keyword || '').trim()
  const where = []
  const args = []
  if (text) {
    where.push('(name LIKE ? OR advertiser_id LIKE ?)')
    args.push(`%${text}%`, `%${text}%`)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = database()
    .prepare(
      `SELECT advertiser_id, name
       FROM oceanengine_advertisers ${clause}
       ORDER BY name, advertiser_id
       LIMIT 50`,
    )
    .all(...args)
  return rows.map((row) => ({
    advertiserId: row.advertiser_id,
    name: row.name || '',
  }))
}

async function listCreatedEvents(advertiserId, assetId) {
  const account = requireAdvertiser(advertiserId)
  if (account.error) return account
  const asset = idText(assetId)
  if (!asset) return { error: '请选择事件资产' }
  const token = await tokenOrError()
  if (token.error) return token
  const result = await eventFetch(token.token, 'GET', EVENT_CONFIGS, {
    query: {
      advertiser_id: account.advertiserId,
      asset_id: asset,
      sort_type: 'DESC',
    },
  })
  if (result.error) return result
  return { list: eventRows(result.data).map(toEvent).filter((row) => row.eventId) }
}

async function listAvailableEvents(advertiserId, assetId) {
  const account = requireAdvertiser(advertiserId)
  if (account.error) return account
  const asset = idText(assetId)
  if (!asset) return { error: '请选择事件资产' }
  const token = await tokenOrError()
  if (token.error) return token
  const result = await eventFetch(token.token, 'GET', AVAILABLE_EVENTS, {
    query: { advertiser_id: account.advertiserId, asset_id: asset },
  })
  if (result.error) return result
  return { list: eventRows(result.data).map(toEvent).filter((row) => row.eventId) }
}

async function createEvent({ advertiserId, assetId, eventId, trackType }) {
  const account = requireAdvertiser(advertiserId)
  if (account.error) return account
  const asset = idText(assetId)
  const event = idText(eventId)
  const track = String(trackType || '').trim()
  if (!asset) return { error: '请选择事件资产' }
  if (!event) return { error: '请选择要添加的事件' }
  if (!track) return { error: '请选择回传方式' }

  const available = await listAvailableEvents(account.advertiserId, asset)
  if (available.error) return available
  const match = (available.list || []).find((item) => item.eventId === event)
  if (!match) return { error: '这个事件当前不能添加，请刷新后再试' }
  if (!match.trackTypes.includes(track)) return { error: '这个事件不支持所选回传方式' }

  const token = await tokenOrError()
  if (token.error) return token
  const result = await eventFetch(token.token, 'POST', EVENT_CREATE, {
    body: {
      advertiser_id: account.advertiserId,
      asset_id: asset,
      event_id: event,
      track_types: [track],
    },
  })
  if (result.error) return result
  console.log('[oceanengine] event created', { advertiserId: account.advertiserId, assetId: asset, eventId: event, track })
  return { eventId: event, name: match.name, trackType: track }
}

const BATCH_EVENT_NAMES = ['付费', '付费ROI']
const BATCH_TRACK = 'MINI_PROGRAME_API'
const BATCH_LIMIT = 100
const TARGET_APP_ID = 'ttc326b59b5c10bae401'
const TARGET_APP_NAME = '倾心书馆'
const EVENT_TYPES = {
  付费: ['active_pay'],
  付费ROI: ['purchase_roi'],
}

function findTargetEvent(list, name) {
  const named = findEventByName(list, name)
  if (named) return named
  const types = EVENT_TYPES[normalizeEventName(name)] || []
  return (list || []).find((item) => types.includes(item.eventType)) || null
}

function miniRows(data) {
  if (!data) return []
  if (Array.isArray(data.list)) return data.list
  if (Array.isArray(data.micro_app_list)) return data.micro_app_list
  return []
}

function toMiniApp(row) {
  return {
    instanceId: idText(row && (row.instance_id || row.micro_app_instance_id)),
    appId: String((row && (row.app_id || row.micro_app_id)) || ''),
    name: String((row && (row.name || row.micro_app_name || row.remark)) || ''),
    auditStatus: String((row && row.audit_status) || ''),
  }
}

function pickMiniApp(list) {
  const accepted = (list || []).filter((item) => item.instanceId && (!item.auditStatus || item.auditStatus === 'AUDIT_ACCEPTED'))
  return (
    accepted.find((item) => item.appId === TARGET_APP_ID) ||
    accepted.find((item) => item.name.includes(TARGET_APP_NAME)) ||
    (accepted.length === 1 ? accepted[0] : null)
  )
}

function pickEventAsset(list) {
  const assets = list || []
  return (
    assets.find((item) => item.microAppId === TARGET_APP_ID) ||
    assets.find((item) => String(item.name || '').includes(TARGET_APP_NAME)) ||
    null
  )
}

function normalizeEventName(name) {
  return String(name || '').replace(/\s+/g, '')
}

function findEventByName(list, name) {
  const target = normalizeEventName(name)
  if (!target) return null
  return (list || []).find((item) => normalizeEventName(item.name) === target) || null
}

function splitAccountTokens(text) {
  const seen = new Set()
  const tokens = []
  for (const part of String(text || '').split(/[\r\n,，;；\t]+/)) {
    const line = part.trim()
    if (!line) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push(line)
  }
  return tokens
}

function resolveAccounts(text, rows) {
  const tokens = splitAccountTokens(text)
  if (!tokens.length) return { error: '请先粘贴账户，一行一个' }
  if (tokens.length > BATCH_LIMIT) return { error: `一次最多 ${BATCH_LIMIT} 个账户` }
  const list = Array.isArray(rows) ? rows : []
  const byId = new Map()
  const byName = new Map()
  for (const row of list) {
    const advertiserId = idText(row && (row.advertiserId || row.advertiser_id))
    if (!advertiserId) continue
    const item = { advertiserId, name: String((row && (row.name || row.accountName)) || '').trim() }
    byId.set(advertiserId, item)
    if (!item.name) continue
    if (!byName.has(item.name)) byName.set(item.name, [])
    byName.get(item.name).push(item)
  }
  const accounts = []
  const unresolved = []
  const used = new Set()
  for (const line of tokens) {
    let match = null
    if (/^\d+$/.test(line)) {
      match = byId.get(line) || { advertiserId: line, name: '' }
    } else {
      const idInLine = line.match(/(\d{8,})/)
      if (idInLine && byId.get(idInLine[1])) match = byId.get(idInLine[1])
      if (!match) {
        const named = byName.get(line) || []
        if (named.length > 1) {
          unresolved.push({ line, error: '有多个同名账户，请改用账户 ID' })
          continue
        }
        match = named[0] || null
      }
      if (!match) {
        unresolved.push({ line, error: '账户管理里没有这个账户，请先同步' })
        continue
      }
    }
    if (used.has(match.advertiserId)) continue
    used.add(match.advertiserId)
    accounts.push({ ...match, line })
  }
  return { accounts, unresolved }
}

function resolveAccountLines(text) {
  const rows = database().prepare('SELECT advertiser_id, name FROM oceanengine_advertisers').all()
  return resolveAccounts(text, rows)
}

function accountLabelOf(account) {
  if (account.name) return `${account.name}（${account.advertiserId}）`
  return account.advertiserId || account.line || ''
}

function resultRow(account, extra) {
  return {
    advertiserId: (account && account.advertiserId) || '',
    accountName: account ? accountLabelOf(account) : '',
    assetId: '',
    assetName: '',
    eventName: '',
    status: 'fail',
    message: '',
    ...extra,
  }
}

function fatalEventError(message) {
  return /授权|access_token|无权限|权限不足|重新授权/i.test(String(message || ''))
}

async function loadMiniAssets(token, advertiserId, withDetail) {
  const assets = []
  let total = 0
  for (let page = 1; page <= MAX_ASSET_PAGES; page += 1) {
    const result = await oceanFetch(token, 'GET', ASSET_LIST, {
      query: {
        advertiser_id: advertiserId,
        filtering: { asset_type: 'MINI_PROGRAME' },
        page,
        page_size: PAGE_SIZE,
      },
    })
    if (result.error) return result
    const rows = assetRows(result.data)
    total = pageTotal(result.data, assets.length + rows.length)
    assets.push(...rows)
    if (!rows.length || assets.length >= total) break
  }
  const ids = assets.map((row) => idText(row && row.asset_id)).filter(Boolean)
  let details = { map: new Map() }
  if (withDetail && ids.length) details = await fetchDetails(token, advertiserId, ids)
  const list = assets
    .map((row) => toAsset(row, details.map && details.map.get(idText(row && row.asset_id))))
    .filter((row) => row.assetId)
  return {
    list,
    total: total || list.length,
    truncated: total > list.length,
    detailError: details.error || '',
  }
}

async function listMiniProgramAssets(advertiserId) {
  const account = requireAdvertiser(advertiserId)
  if (account.error) return account
  const token = await tokenOrError()
  if (token.error) return token
  return loadMiniAssets(token.token, account.advertiserId, true)
}

async function ensureEvent(token, account, asset, eventName, createdList, availableList) {
  const base = {
    advertiserId: account.advertiserId,
    accountName: accountLabelOf(account),
    assetId: asset.assetId,
    assetName: asset.name || asset.assetId,
    eventName,
  }
  const had = findTargetEvent(createdList, eventName)
  if (had) return { ...base, status: 'skip', message: '已有，跳过' }
  const match = findTargetEvent(availableList, eventName)
  if (!match) {
    const message = normalizeEventName(eventName) === '付费ROI'
      ? '付费ROI是深度事件，需要先有付费。这次没有拿到可添加项'
      : `没有可添加的「${eventName}」`
    return { ...base, status: 'fail', message }
  }
  if (!match.trackTypes.includes(BATCH_TRACK)) {
    return { ...base, status: 'fail', message: `「${eventName}」不支持小程序API回传` }
  }
  const result = await eventFetch(token, 'POST', EVENT_CREATE, {
    body: {
      advertiser_id: account.advertiserId,
      asset_id: asset.assetId,
      event_id: match.eventId,
      track_types: [BATCH_TRACK],
    },
  })
  if (result.error) return { ...base, status: 'fail', message: result.error }
  console.log('[oceanengine] event created', {
    advertiserId: account.advertiserId,
    assetId: asset.assetId,
    eventId: match.eventId,
    track: BATCH_TRACK,
    batch: true,
  })
  return { ...base, status: 'added', message: '已添加' }
}

async function listByteMiniApps(token, advertiserId) {
  const map = new Map()
  let lastError = ''
  for (const searchType of ['CREATE_ONLY', 'SHARE_ONLY']) {
    const result = await oceanFetch(token, 'GET', MICRO_APP_LIST, {
      query: {
        advertiser_id: advertiserId,
        filtering: { audit_status: 'AUDIT_ACCEPTED', search_type: searchType },
        page: 1,
        page_size: 100,
      },
    })
    if (result.error) {
      lastError = result.error
      continue
    }
    for (const row of miniRows(result.data).map(toMiniApp)) {
      if (row.instanceId) map.set(row.instanceId, row)
    }
  }
  if (!map.size && lastError) return { error: lastError }
  return { list: [...map.values()] }
}

async function createMiniEventAsset(token, account, mini) {
  const result = await eventFetch(token, 'POST', ASSET_CREATE, {
    body: {
      advertiser_id: account.advertiserId,
      asset_type: 'MINI_PROGRAME',
      mini_program_asset: {
        mini_program_id: mini.appId,
        mini_program_name: mini.name || TARGET_APP_NAME,
        instance_id: mini.instanceId,
        mini_program_type: 'BYTE_APP',
      },
    },
  })
  if (result.error) return result
  const assetId = idText(result.data && result.data.asset_id)
  if (assetId) {
    return {
      asset: {
        assetId,
        name: mini.name || TARGET_APP_NAME,
        microAppId: mini.appId,
        microAppInstanceId: mini.instanceId,
      },
    }
  }
  const again = await loadMiniAssets(token, account.advertiserId, false)
  if (again.error) return again
  const found = pickEventAsset(again.list)
  if (!found) return { error: '事件资产已提交，但没有读到资产 ID' }
  return { asset: found }
}

async function ensureMiniEventAsset(token, account) {
  const assets = await loadMiniAssets(token, account.advertiserId, false)
  if (assets.error) return assets
  const existing = pickEventAsset(assets.list)
  if (existing) return { asset: existing, created: false }
  if (assets.list.length) return { error: '这个户已有别的小程序事件资产，没有倾心书馆' }
  const apps = await listByteMiniApps(token, account.advertiserId)
  if (apps.error) return apps
  const mini = pickMiniApp(apps.list)
  if (!mini) {
    return { error: '这个户还没有已过审的倾心书馆，请先把小程序共享到这个户' }
  }
  const created = await createMiniEventAsset(token, account, mini)
  if (created.error) return created
  return { asset: created.asset, created: true }
}

async function addEventsInOrder(token, account, asset, names, results) {
  let stopped = ''
  for (const eventName of names) {
    const created = await eventFetch(token, 'GET', EVENT_CONFIGS, {
      query: { advertiser_id: account.advertiserId, asset_id: asset.assetId, sort_type: 'DESC' },
    })
    if (created.error) {
      results.push(resultRow(account, { assetId: asset.assetId, assetName: asset.name || asset.assetId, eventName, message: created.error }))
      if (fatalEventError(created.error)) stopped = created.error
      break
    }
    const available = await eventFetch(token, 'GET', AVAILABLE_EVENTS, {
      query: { advertiser_id: account.advertiserId, asset_id: asset.assetId },
    })
    if (available.error) {
      results.push(resultRow(account, { assetId: asset.assetId, assetName: asset.name || asset.assetId, eventName, message: available.error }))
      if (fatalEventError(available.error)) stopped = available.error
      break
    }
    const row = await ensureEvent(
      token,
      account,
      asset,
      eventName,
      eventRows(created.data).map(toEvent),
      eventRows(available.data).map(toEvent),
    )
    results.push(row)
    if (row.status === 'fail' && fatalEventError(row.message)) {
      stopped = row.message
      break
    }
  }
  return stopped
}

function summarize(results, extra) {
  return {
    results,
    added: results.filter((row) => row.status === 'added').length,
    skipped: results.filter((row) => row.status === 'skip').length,
    failed: results.filter((row) => row.status === 'fail').length,
    ...extra,
  }
}

const STATUS_LIMIT = 20

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length)
  let next = 0
  const size = Math.min(limit, items.length)
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        out[index] = await worker(items[index])
      }
    }),
  )
  return out
}

async function summarizeOne(token, advertiserId) {
  const base = { advertiserId, assetId: '', assetName: '', pay: false, roi: false, error: '' }
  const assets = await loadMiniAssets(token, advertiserId, false)
  if (assets.error) return { ...base, error: assets.error }
  const asset = pickEventAsset(assets.list)
  if (!asset) {
    if (assets.list.length) return { ...base, error: '没有倾心书馆事件资产' }
    return base
  }
  const created = await eventFetch(token, 'GET', EVENT_CONFIGS, {
    query: { advertiser_id: advertiserId, asset_id: asset.assetId, sort_type: 'DESC' },
  })
  const named = { ...base, assetId: asset.assetId, assetName: asset.name || asset.assetId }
  if (created.error) return { ...named, error: created.error }
  const events = eventRows(created.data).map(toEvent)
  return {
    ...named,
    pay: !!findTargetEvent(events, '付费'),
    roi: !!findTargetEvent(events, '付费ROI'),
  }
}

async function summarizeAccountEvents(advertiserIds) {
  const ids = []
  const seen = new Set()
  for (const raw of Array.isArray(advertiserIds) ? advertiserIds : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (!ids.length) return { error: '请选择账户' }
  if (ids.length > STATUS_LIMIT) return { error: `一次最多查询 ${STATUS_LIMIT} 个账户的事件` }
  const token = await tokenOrError()
  if (token.error) return token
  const list = await mapLimit(ids, 3, (id) => summarizeOne(token.token, id))
  return { list }
}

async function batchAddEvents({ text, eventNames, advertiserIds } = {}) {
  const names = (Array.isArray(eventNames) ? eventNames : BATCH_EVENT_NAMES)
    .map((name) => normalizeEventName(name))
    .filter((name) => BATCH_EVENT_NAMES.includes(name))
  const picked = BATCH_EVENT_NAMES.filter((name) => names.includes(name))
  if (!picked.length) return { error: '请至少选择付费或付费ROI' }
  const direct = (Array.isArray(advertiserIds) ? advertiserIds : []).map((id) => idText(id)).filter(Boolean)
  const resolved = direct.length ? resolveAccountLines(direct.join('\n')) : resolveAccountLines(text)
  if (resolved.error) return resolved
  if (!resolved.accounts.length && resolved.unresolved.length) {
    return summarize(resolved.unresolved.map((item) => resultRow({ line: item.line }, { accountName: item.line, message: item.error })))
  }
  const token = await tokenOrError()
  if (token.error) return token

  const results = resolved.unresolved.map((item) => resultRow({ line: item.line }, { accountName: item.line, message: item.error }))
  let stopped = ''
  for (const account of resolved.accounts) {
    if (stopped) break
    const ready = await ensureMiniEventAsset(token.token, account)
    if (ready.error) {
      results.push(resultRow(account, { message: ready.error }))
      if (fatalEventError(ready.error)) stopped = ready.error
      continue
    }
    if (ready.created) {
      results.push(resultRow(account, {
        assetId: ready.asset.assetId,
        assetName: ready.asset.name || TARGET_APP_NAME,
        eventName: '事件资产',
        status: 'added',
        message: '已新建小程序事件资产',
      }))
    }
    stopped = await addEventsInOrder(token.token, account, ready.asset, picked, results)
  }
  console.log('[oceanengine] batch events', { accounts: resolved.accounts.length, stopped: !!stopped })
  return summarize(results, { stopped })
}

module.exports = {
  listAccountOptions,
  listMiniProgramAssets,
  listCreatedEvents,
  listAvailableEvents,
  createEvent,
  batchAddEvents,
  summarizeAccountEvents,
  stringifyOcean,
  queryParam,
  toAsset,
  toEvent,
  resolveAccounts,
  findEventByName,
  findTargetEvent,
  pickMiniApp,
  pickEventAsset,
}
