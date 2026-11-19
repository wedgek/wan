/**
 * 巨量新版事件管理：小程序事件资产、已创建事件、按可创建列表添加事件。
 * 资产列表走新接口 all_assets，添加事件走 event_manager/events/create。
 * 账户 ID、资产 ID 超过 JS 安全整数，全程用字符串传递，请求体里再写成无引号数字。
 */
const db = require('../db')
const auth = require('./oceanengineAuth')
const accounts = require('./oceanengineAccount')

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

async function createEvent({ advertiserId, assetId, eventId, trackType, appId, assetName }) {
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
  markEventAdded({
    appId,
    advertiserId: account.advertiserId,
    assetId: asset,
    assetName,
    eventName: match.name,
  })
  return { eventId: event, name: match.name, trackType: track }
}

const BATCH_EVENT_NAMES = ['付费', '付费ROI']
const BATCH_TRACK = 'MINI_PROGRAME_API'
const BATCH_LIMIT = 100
const TARGET_APP_ID = 'ttc525b3985a10dae401'
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

function categoryText(tagInfo) {
  if (!tagInfo) return ''
  let data = tagInfo
  if (typeof tagInfo === 'string') {
    try {
      data = JSON.parse(tagInfo)
    } catch {
      return ''
    }
  }
  const names = []
  let node = data
  while (node && typeof node === 'object') {
    if (node.category_name) names.push(String(node.category_name))
    node = Array.isArray(node.categories) ? node.categories[0] : null
  }
  return names.filter((item) => item && item !== '小程序').join(' / ')
}

function toMiniApp(row) {
  return {
    instanceId: idText(row && (row.instance_id || row.micro_app_instance_id)),
    appId: String((row && (row.app_id || row.micro_app_id)) || ''),
    name: String((row && (row.name || row.micro_app_name || row.remark)) || ''),
    auditStatus: String((row && (row.audit_status || row.status || row.auditStatus)) || ''),
    remark: String((row && row.remark) || ''),
    category: categoryText(row && row.tag_info),
    createTime: String((row && row.create_time) || ''),
    modifyTime: String((row && row.modify_time) || ''),
    reason: String((row && row.reason) || ''),
    ebpAsset: Boolean(row && row.is_ebp_asset),
  }
}

function pickMiniApp(list, target) {
  const accepted = (list || []).filter((item) => item.instanceId && (!item.auditStatus || item.auditStatus === 'AUDIT_ACCEPTED'))
  const appId = String((target && target.appId) || '').trim()
  const name = String((target && target.name) || '').trim()
  if (appId || name) {
    return (
      accepted.find((item) => appId && item.appId === appId) ||
      accepted.find((item) => name && item.name && (item.name === name || item.name.includes(name) || name.includes(item.name))) ||
      null
    )
  }
  return (
    accepted.find((item) => item.appId === TARGET_APP_ID) ||
    accepted.find((item) => item.name.includes(TARGET_APP_NAME)) ||
    (accepted.length === 1 ? accepted[0] : null)
  )
}

function pickEventAsset(list, target) {
  const assets = list || []
  const appId = String((target && target.appId) || '').trim()
  const name = String((target && target.name) || '').trim()
  if (appId || name) {
    return (
      assets.find((item) => appId && item.microAppId === appId) ||
      assets.find((item) => name && String(item.name || '').includes(name)) ||
      null
    )
  }
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

async function listByteMiniApps(token, advertiserId, options = {}) {
  const auditStatus = options.auditStatus === undefined ? 'AUDIT_ACCEPTED' : options.auditStatus
  const map = new Map()
  let lastError = ''
  for (const searchType of ['CREATE_ONLY', 'SHARE_ONLY']) {
    const filtering = { search_type: searchType }
    if (auditStatus) filtering.audit_status = auditStatus
    const result = await oceanFetch(token, 'GET', MICRO_APP_LIST, {
      query: {
        advertiser_id: advertiserId,
        filtering,
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
  const found = pickEventAsset(again.list, mini)
  if (!found) return { error: '事件资产已提交，但没有读到资产 ID' }
  return { asset: found }
}

async function ensureMiniEventAsset(token, account, target) {
  const wanted = target && (target.appId || target.name) ? target : { appId: TARGET_APP_ID, name: TARGET_APP_NAME }
  const label = wanted.name || wanted.appId
  const assets = await loadMiniAssets(token, account.advertiserId, false)
  if (assets.error) return assets
  const existing = pickEventAsset(assets.list, wanted)
  if (existing) return { asset: existing, created: false }
  const apps = await listByteMiniApps(token, account.advertiserId)
  if (apps.error) return apps
  const mini = pickMiniApp(apps.list, wanted)
  if (!mini) return { error: `这个户还没有已过审的「${label}」，请先把小程序共享到这个户` }
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

function nowText() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function namesJson(names) {
  const list = []
  const seen = new Set()
  for (const item of Array.isArray(names) ? names : []) {
    const name = String(item || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    list.push(name)
  }
  return JSON.stringify(list)
}

function parseNames(text) {
  if (!text) return []
  try {
    const data = JSON.parse(text)
    return Array.isArray(data) ? data.map((item) => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function saveEventSnapshot(appId, row) {
  const advertiserId = idText(row && row.advertiserId)
  const app = String(appId || '').trim()
  if (!advertiserId || !app) return
  const current = database()
    .prepare('SELECT asset_names, matched_count FROM oceanengine_event_status WHERE advertiser_id = ? AND app_id = ?')
    .get(advertiserId, app)
  const names = Array.isArray(row && row.assetNames) ? namesJson(row.assetNames) : (current && current.asset_names) || '[]'
  const matchedCount = row && row.matchedCount != null ? Number(row.matchedCount) || 0 : (current && current.matched_count) || 0
  database()
    .prepare(
      `INSERT INTO oceanengine_event_status (
         advertiser_id, app_id, asset_id, asset_name, asset_names, matched_count, pay, roi, error, synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(advertiser_id, app_id) DO UPDATE SET
         asset_id = excluded.asset_id,
         asset_name = excluded.asset_name,
         asset_names = excluded.asset_names,
         matched_count = excluded.matched_count,
         pay = excluded.pay,
         roi = excluded.roi,
         error = excluded.error,
         synced_at = excluded.synced_at`,
    )
    .run(
      advertiserId,
      app,
      String((row && row.assetId) || ''),
      String((row && row.assetName) || ''),
      names,
      matchedCount,
      row && row.pay ? 1 : 0,
      row && row.roi ? 1 : 0,
      String((row && row.error) || ''),
      nowText(),
    )
}

function mergeEventSnapshot(appId, row) {
  const advertiserId = idText(row && row.advertiserId)
  const app = String(appId || '').trim()
  if (!advertiserId || !app) return
  const current = database()
    .prepare(
      `SELECT asset_id, asset_name, pay, roi, error
       FROM oceanengine_event_status WHERE advertiser_id = ? AND app_id = ?`,
    )
    .get(advertiserId, app)
  const pay = row.pay == null ? (current ? current.pay : 0) : row.pay ? 1 : 0
  const roi = row.roi == null ? (current ? current.roi : 0) : row.roi ? 1 : 0
  saveEventSnapshot(app, {
    advertiserId,
    assetId: row.assetId || (current && current.asset_id) || '',
    assetName: row.assetName || (current && current.asset_name) || '',
    pay,
    roi,
    error: row.error == null ? (current && current.error) || '' : row.error,
  })
}

function markEventAdded({ appId, advertiserId, assetId, assetName, eventName }) {
  const event = normalizeEventName(eventName)
  if (event !== '付费' && event !== '付费ROI') return
  mergeEventSnapshot(appId, {
    advertiserId,
    assetId,
    assetName,
    pay: event === '付费' ? 1 : null,
    roi: event === '付费ROI' ? 1 : null,
    error: '',
  })
}

function rememberBatchEvents(appId, results) {
  const grouped = new Map()
  for (const row of results || []) {
    const advertiserId = idText(row && row.advertiserId)
    if (!advertiserId) continue
    const item = grouped.get(advertiserId) || {
      advertiserId,
      assetId: '',
      assetName: '',
      pay: null,
      roi: null,
      error: '',
      ok: false,
    }
    if (row.assetId) item.assetId = String(row.assetId)
    if (row.assetName && row.assetName !== '—') item.assetName = String(row.assetName)
    const eventName = normalizeEventName(row.eventName)
    if (row.status === 'added' || row.status === 'skip') {
      item.ok = true
      if (eventName === '付费') item.pay = 1
      if (eventName === '付费ROI') item.roi = 1
    } else if (row.status === 'fail' && !item.error) {
      item.error = String(row.message || '添加失败')
    }
    grouped.set(advertiserId, item)
  }
  for (const item of grouped.values()) {
    mergeEventSnapshot(appId, {
      advertiserId: item.advertiserId,
      assetId: item.assetId,
      assetName: item.assetName,
      pay: item.pay,
      roi: item.roi,
      error: item.ok || item.assetId ? '' : item.error,
    })
  }
}

function assetNameList(list) {
  const names = []
  const seen = new Set()
  for (const item of list || []) {
    const name = String((item && item.name) || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function matchedAssets(list, target) {
  const name = String((target && target.name) || '').trim()
  const appId = String((target && target.appId) || '').trim()
  return (list || []).filter((item) => {
    if (appId && item.microAppId === appId) return true
    return !!(name && String(item.name || '').includes(name))
  })
}

async function summarizeOne(token, advertiserId, target) {
  const base = { advertiserId, assetId: '', assetName: '', assetNames: [], matchedCount: 0, pay: false, roi: false, error: '' }
  const assets = await loadMiniAssets(token, advertiserId, false)
  if (assets.error) return { ...base, error: assets.error }
  const names = assetNameList(assets.list)
  const matched = matchedAssets(assets.list, target)
  const asset = pickEventAsset(matched.length ? matched : [], target) || (matched.length ? matched[0] : null)
  const found = { ...base, assetNames: names, matchedCount: matched.length }
  if (!asset) return found
  const created = await eventFetch(token, 'GET', EVENT_CONFIGS, {
    query: { advertiser_id: advertiserId, asset_id: asset.assetId, sort_type: 'DESC' },
  })
  const named = { ...found, assetId: asset.assetId, assetName: asset.name || asset.assetId }
  if (created.error) return { ...named, error: created.error }
  const events = eventRows(created.data).map(toEvent)
  return {
    ...named,
    pay: !!findTargetEvent(events, '付费'),
    roi: !!findTargetEvent(events, '付费ROI'),
  }
}

function readTarget(input) {
  const appId = String((input && input.appId) || '').trim()
  const name = String((input && input.name) || '').trim()
  if (!appId) return { error: '请选择小程序' }
  return { appId, name }
}

async function summarizeAccountEvents(advertiserIds, target) {
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
  const wanted = readTarget(target)
  if (wanted.error) return wanted
  const token = await tokenOrError()
  if (token.error) return token
  const list = await mapLimit(ids, 3, (id) => summarizeOne(token.token, id, wanted))
  return { list }
}

const SYNC_LIMIT = 10

function listSyncAdvertiserIds(copyright) {
  const name = String(copyright || '').trim()
  if (!name) return { error: '请选择版权方' }
  const page = accounts.listSortedUsingIds(name)
  return { advertiserIds: page.advertiserIds || [], total: page.total || 0 }
}

function readLocalEventStatus(advertiserIds, appId) {
  const app = String(appId || '').trim()
  if (!app) return { error: '请选择小程序' }
  const ids = []
  const seen = new Set()
  for (const raw of Array.isArray(advertiserIds) ? advertiserIds : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  const map = new Map()
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400)
    if (!chunk.length) continue
    const marks = chunk.map(() => '?').join(',')
    const rows = database()
      .prepare(
        `SELECT advertiser_id, asset_id, asset_name, asset_names, matched_count, pay, roi, error, synced_at
         FROM oceanengine_event_status
         WHERE app_id = ? AND advertiser_id IN (${marks})`,
      )
      .all(app, ...chunk)
    for (const row of rows) map.set(row.advertiser_id, row)
  }
  return {
    list: ids.map((id) => {
      const hit = map.get(id)
      if (!hit) return { advertiserId: id, synced: false, assetId: '', assetName: '', assetNames: [], matchedCount: 0, pay: false, roi: false, error: '', syncedAt: '' }
      return {
        advertiserId: id,
        synced: true,
        assetId: hit.asset_id || '',
        assetName: hit.asset_name || '',
        assetNames: parseNames(hit.asset_names),
        matchedCount: Number(hit.matched_count) || 0,
        pay: !!Number(hit.pay),
        roi: !!Number(hit.roi),
        error: hit.error || '',
        syncedAt: hit.synced_at || '',
      }
    }),
  }
}

let syncJob = null

function syncJobView() {
  if (!syncJob) {
    return { running: false, done: 0, total: 0, failed: 0, stopped: false, stopRequested: false, copyright: '', appId: '', name: '', error: '', active: [] }
  }
  return {
    running: !!syncJob.running,
    done: syncJob.done,
    total: syncJob.total,
    failed: syncJob.failed,
    stopped: !!syncJob.stopped,
    stopRequested: !!syncJob.stopRequested,
    copyright: syncJob.copyright,
    appId: syncJob.appId,
    name: syncJob.name,
    error: syncJob.error || '',
    active: [...syncJob.active],
  }
}

async function runSyncJob(ids, wanted) {
  const token = await tokenOrError()
  if (token.error) {
    syncJob.running = false
    syncJob.error = token.error
    return
  }
  let next = 0
  const worker = async () => {
    while (next < ids.length) {
      if (syncJob.stopRequested) return
      const index = next
      next += 1
      const advertiserId = ids[index]
      syncJob.active.add(advertiserId)
      try {
        const result = await summarizeOneSaved(token.token, advertiserId, wanted)
        if (result && result.error) syncJob.failed += 1
      } catch (e) {
        syncJob.failed += 1
        console.error('[oceanengine] event sync one', advertiserId, e.message)
      } finally {
        syncJob.active.delete(advertiserId)
        syncJob.done += 1
      }
    }
  }
  await Promise.all([worker(), worker()])
  syncJob.running = false
  syncJob.stopped = !!syncJob.stopRequested
  syncJob.active.clear()
  console.log('[oceanengine] event sync job', {
    done: syncJob.done,
    total: syncJob.total,
    failed: syncJob.failed,
    stopped: syncJob.stopped,
    appId: wanted.appId,
  })
}

function startSyncJob({ copyright, appId, name, advertiserIds } = {}) {
  if (syncJob && syncJob.running) return syncJobView()
  const wanted = readTarget({ appId, name })
  if (wanted.error) return wanted
  const picked = []
  const seen = new Set()
  for (const raw of Array.isArray(advertiserIds) ? advertiserIds : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    picked.push(id)
  }
  const ids = picked.length ? picked : null
  const listed = ids ? null : listSyncAdvertiserIds(copyright)
  if (listed && listed.error) return listed
  const queue = ids || (listed && listed.advertiserIds) || []
  if (!queue.length) return { error: picked.length ? '请选择账户' : '当前版权方下没有正在使用的账户' }
  syncJob = {
    running: true,
    stopped: false,
    stopRequested: false,
    done: 0,
    failed: 0,
    total: queue.length,
    copyright: String(copyright || '').trim(),
    appId: wanted.appId,
    name: wanted.name,
    error: '',
    active: new Set(),
  }
  runSyncJob(queue, wanted).catch((e) => {
    console.error('[oceanengine] event sync job', e)
    if (!syncJob) return
    syncJob.running = false
    syncJob.error = e.message || '同步失败'
    syncJob.active.clear()
  })
  return syncJobView()
}

function stopSyncJob() {
  if (!syncJob || !syncJob.running) return { error: '没有正在进行的同步' }
  syncJob.stopRequested = true
  return syncJobView()
}

async function summarizeOneSaved(token, advertiserId, target) {
  await sleep(300)
  let result = await summarizeOne(token, advertiserId, target)
  for (let attempt = 0; attempt < 3 && result.error && rateLimited(result.error); attempt += 1) {
    await sleep(2000 * (attempt + 1))
    result = await summarizeOne(token, advertiserId, target)
  }
  saveSyncedResult(target.appId, result)
  return result
}

function saveSyncedResult(appId, row) {
  if (row && row.error) {
    const advertiserId = idText(row.advertiserId)
    const app = String(appId || '').trim()
    const current = advertiserId && app
      ? database()
          .prepare(
            `SELECT error FROM oceanengine_event_status WHERE advertiser_id = ? AND app_id = ?`,
          )
          .get(advertiserId, app)
      : null
    if (current && !current.error) return
  }
  saveEventSnapshot(appId, row)
}

async function syncAccountEvents(advertiserIds, target) {
  const ids = []
  const seen = new Set()
  for (const raw of Array.isArray(advertiserIds) ? advertiserIds : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (!ids.length) return { error: '请选择账户' }
  if (ids.length > SYNC_LIMIT) return { error: `一次最多同步 ${SYNC_LIMIT} 个账户` }
  const wanted = readTarget(target)
  if (wanted.error) return wanted
  const token = await tokenOrError()
  if (token.error) return token
  const list = await mapLimit(ids, 2, (id) => summarizeOneSaved(token.token, id, wanted))
  console.log('[oceanengine] event sync', { count: list.length, appId: wanted.appId })
  return { list }
}

async function batchAddEvents({ text, eventNames, advertiserIds, appId, name } = {}) {
  const names = (Array.isArray(eventNames) ? eventNames : BATCH_EVENT_NAMES)
    .map((item) => normalizeEventName(item))
    .filter((item) => BATCH_EVENT_NAMES.includes(item))
  const picked = BATCH_EVENT_NAMES.filter((item) => names.includes(item))
  if (!picked.length) return { error: '请至少选择付费或付费ROI' }
  const wanted = readTarget({ appId, name })
  if (wanted.error) return wanted
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
    const ready = await ensureMiniEventAsset(token.token, account, wanted)
    if (ready.error) {
      results.push(resultRow(account, { message: ready.error }))
      if (fatalEventError(ready.error)) stopped = ready.error
      continue
    }
    if (ready.created) {
      results.push(resultRow(account, {
        assetId: ready.asset.assetId,
        assetName: ready.asset.name || wanted.name,
        eventName: '事件资产',
        status: 'added',
        message: '已新建小程序事件资产',
      }))
    }
    stopped = await addEventsInOrder(token.token, account, ready.asset, picked, results)
  }
  rememberBatchEvents(wanted.appId, results)
  console.log('[oceanengine] batch events', { accounts: resolved.accounts.length, appId: wanted.appId, stopped: !!stopped })
  return summarize(results, { stopped })
}

module.exports = {
  listAccountOptions,
  listMiniProgramAssets,
  listByteMiniApps,
  listCreatedEvents,
  listAvailableEvents,
  createEvent,
  batchAddEvents,
  summarizeAccountEvents,
  listSyncAdvertiserIds,
  readLocalEventStatus,
  startSyncJob,
  stopSyncJob,
  syncJobView,
  syncAccountEvents,
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
