/**
 * 常读分销（番茄小说）推广链接：应用 / 付费面板 / 回传规则 / 创建 / 查询。
 * 签名（文档 1.2.1）：md5(distributor_id + secret_key + ts + params_value)，放在 header-sign / header-ts。
 * CHANGDU_APP_ID 支持多个应用：123:迷机小说,456:其他。充值模板接口不按应用拆分。
 * 接口路径可用 CHANGDU_PATH_* 覆盖；默认对齐常读 IAP Open API。
 */
const crypto = require('crypto')

const DEFAULT_BASE = 'https://openapi.changdupingtai.com'
const SOURCE = 'changdu'
const MEDIA_SOURCES = new Set(['dy', 'ks', 'bd', 'adq', 'tx', 'no_back'])
const MEDIA_SOURCE_CODE = { dy: 1, ks: 3, bd: 1, tx: 4, adq: 4, wx: 4, no_back: 1 }
const DEFAULT_PATHS = {
  apps: '/novelsale/openapi/app/list/v1/',
  payPanels: '/novelsale/openapi/recharge_template/list/v1/',
  boundPackages: '/novelsale/openapi/wx/get_bound_package_list/v1/',
  callbacks: '/novelsale/openapi/callback_config/list/v1/',
  promotions: '/novelsale/openapi/promotion/list/v2/',
  promotionCreate: '/novelsale/openapi/promotion/create/v1',
}

function parseChannels(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return []
  const seen = new Set()
  const out = []
  for (const part of s.split(',')) {
    const item = String(part || '').trim()
    if (!item) continue
    const colon = item.indexOf(':')
    const id = (colon > 0 ? item.slice(0, colon) : item).trim()
    const label = (colon > 0 ? item.slice(colon + 1) : '').trim() || id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label })
  }
  return out
}

function envPath(key, fallback) {
  const s = String(process.env[key] || '').trim()
  if (!s) return fallback
  return s.startsWith('/') ? s : `/${s}`
}

function config() {
  const distributorId = String(process.env.CHANGDU_DISTRIBUTOR_ID || '').trim()
  const secretKey = String(process.env.CHANGDU_SECRET_KEY || '').trim()
  const apps = parseChannels(process.env.CHANGDU_APP_ID)
  const base = String(process.env.CHANGDU_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '')
  const callbackConfigId = String(process.env.CHANGDU_CALLBACK_CONFIG_ID || '').trim()
  const promoNamePrefix = String(process.env.CHANGDU_PROMO_NAME_PREFIX || '番茄-迷机小说-公共配置').trim() || '番茄-迷机小说-公共配置'
  const listMethod = String(process.env.CHANGDU_LIST_METHOD || 'GET').trim().toUpperCase() === 'POST' ? 'POST' : 'GET'
  const paths = {
    apps: envPath('CHANGDU_PATH_APPS', DEFAULT_PATHS.apps),
    payPanels: envPath('CHANGDU_PATH_PAY_PANELS', DEFAULT_PATHS.payPanels),
    boundPackages: envPath('CHANGDU_PATH_BOUND_PACKAGES', DEFAULT_PATHS.boundPackages),
    callbacks: envPath('CHANGDU_PATH_CALLBACKS', DEFAULT_PATHS.callbacks),
    promotions: envPath('CHANGDU_PATH_PROMOTIONS', DEFAULT_PATHS.promotions),
    promotionCreate: envPath('CHANGDU_PATH_PROMOTION_CREATE', DEFAULT_PATHS.promotionCreate),
  }
  return { distributorId, secretKey, apps, base, callbackConfigId, promoNamePrefix, listMethod, paths }
}

function listChannels() {
  return config().apps
}

function findChannel(appId) {
  const id = String(appId || '').trim()
  if (!id) return null
  return listChannels().find((c) => c.id === id) || null
}

function assertConfig() {
  const cfg = config()
  if (!cfg.distributorId || !cfg.secretKey) {
    return { error: '未配置常读接口，请在 backend/.env 填写 CHANGDU_DISTRIBUTOR_ID 与 CHANGDU_SECRET_KEY' }
  }
  if (!cfg.apps.length) {
    return { error: '未填写常读应用，请在 backend/.env 的 CHANGDU_APP_ID 填写，格式如 123:迷机小说' }
  }
  return { cfg }
}

function signKey(distributorId, secretKey, ts, paramsValue) {
  return crypto
    .createHash('md5')
    .update(`${distributorId}${secretKey}${ts}${paramsValue || ''}`, 'utf8')
    .digest('hex')
}

function jsonId(value) {
  const s = String(value == null ? '' : value).trim()
  if (!/^\d+$/.test(s)) return s
  const n = Number(s)
  return String(n) === s ? n : s
}

function pythonQuote(value) {
  let out = '"'
  for (const ch of String(value)) {
    const c = ch.codePointAt(0)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || c > 0x7e) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

function pythonJsonDumps(obj) {
  const body = Object.keys(obj)
    .map((key) => {
      const value = obj[key]
      let dumped = 'null'
      if (typeof value === 'number' && Number.isFinite(value)) dumped = String(value)
      else if (typeof value === 'boolean') dumped = value ? 'true' : 'false'
      else if (value != null) dumped = pythonQuote(value)
      return `${pythonQuote(key)}: ${dumped}`
    })
    .join(', ')
  return `{${body}}`
}

function paramsValueOf(param, method) {
  if (method === 'POST') return pythonJsonDumps(param)
  const keys = Object.keys(param)
    .filter((key) => param[key] != null && param[key] !== '')
    .sort()
  if (!keys.length) return ''
  return `${keys.map((key) => String(param[key])).join('|')}|`
}

function mediaSourceCode(raw) {
  const s = String(raw || 'dy').trim().toLowerCase()
  if (/^\d+$/.test(s)) return Number(s)
  return MEDIA_SOURCE_CODE[s] || 1
}

function normalizeMediaSource(raw) {
  const s = String(raw || 'dy').trim().toLowerCase()
  return MEDIA_SOURCES.has(s) ? s : 'dy'
}

function pickRemoteList(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  const keys = [
    'list',
    'records',
    'rows',
    'items',
    'app_list',
    'apps',
    'promotion_list',
    'promotions',
    'iaa_list',
    'iaa_config_list',
    'result',
    'callback_list',
    'callback_config_list',
    'configs',
  ]
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k]
  }
  if (data.data && data.data !== data) return pickRemoteList(data.data)
  return []
}

function isSuccessCode(code) {
  return code === 0 || code === 1 || code === '0' || code === '1' || code === 200 || code === '200'
}

function parseChangduBody(text) {
  const safe = String(text).replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(safe)
}

function errorMessage(json, httpStatus) {
  if (!json || typeof json !== 'object') return `常读接口失败（HTTP ${httpStatus}）`
  return (
    json.msg ||
    json.message ||
    json.error ||
    (json.extra && json.extra.error) ||
    `常读接口失败（code=${json.code}）`
  )
}

async function requestJson(path, extra = {}, method, distributorId) {
  const ready = assertConfig()
  if (ready.error) return { error: ready.error }
  const verb = String(method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
  const { secretKey } = ready.cfg
  const id = String(distributorId || ready.cfg.distributorId).trim()
  const ts = String(Math.floor(Date.now() / 1000))
  const param = {}
  if (verb === 'POST') param.distributor_id = jsonId(id)
  else param.distributor_id = id
  for (const [k, v] of Object.entries(extra)) {
    if (v == null || v === '') continue
    param[k] = v
  }
  const paramsValue = paramsValueOf(param, verb)
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'header-sign': signKey(id, secretKey, ts, paramsValue),
    'header-ts': ts,
  }
  const url = new URL(`${ready.cfg.base}${path}`)
  let body
  if (verb === 'GET') {
    for (const key of Object.keys(param).sort()) {
      url.searchParams.set(key, String(param[key]))
    }
  } else {
    body = paramsValue
  }
  let res
  try {
    res = await fetch(url, { method: verb, headers, body })
  } catch (e) {
    return { error: `常读接口请求失败：${e.message || e}` }
  }
  let json
  try {
    json = parseChangduBody(await res.text())
  } catch {
    return { error: `常读接口返回不是 JSON（HTTP ${res.status}）` }
  }
  const code = json && json.code
  if (!isSuccessCode(code)) {
    return { error: errorMessage(json, res.status), raw: json }
  }
  return { data: json.data != null ? json.data : json, raw: json }
}

function listMethod() {
  return config().listMethod
}

async function listApps() {
  const remote = await requestJson(config().paths.apps, {}, listMethod())
  if (remote.error) return remote
  return { data: pickRemoteList(remote.data), raw: remote.raw }
}

async function listBoundChannels(appId) {
  const pageSize = 50
  const all = []
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const remote = await requestJson(
      config().paths.boundPackages,
      { app_id: appId, page_index: pageIndex, page_size: pageSize },
      'GET',
    )
    if (remote.error) return pageIndex === 0 ? remote : { data: all }
    const items = (remote.raw && remote.raw.wx_package_info_open_list) || []
    all.push(...items)
    const total = Number(remote.raw && remote.raw.total)
    if (items.length < pageSize || (Number.isFinite(total) && all.length >= total)) break
  }
  return { data: all }
}

async function listTemplatesForDistributor(distributorId) {
  const pageSize = 50
  const all = []
  for (let pageIndex = 0; pageIndex < 40; pageIndex += 1) {
    const remote = await requestJson(
      config().paths.payPanels,
      { page_index: pageIndex, page_size: pageSize },
      'GET',
      distributorId,
    )
    if (remote.error) return pageIndex === 0 ? remote : { data: all }
    const items = pickRemoteList(remote.data)
    all.push(...items)
    const total = Number(remote.raw && remote.raw.total)
    if (items.length < pageSize || (Number.isFinite(total) && all.length >= total)) break
  }
  return { data: all }
}

async function listPayPanels(input = {}) {
  const wanted = String(input.appId || input.channelId || '').trim()
  const apps = config().apps.filter((app) => !wanted || app.id === wanted)
  if (!apps.length) return { error: '应用不在已配置列表中' }
  const all = []
  const warnings = []
  for (const app of apps) {
    const bound = await listBoundChannels(app.id)
    if (bound.error) {
      warnings.push(`${app.label}：${bound.error}`)
      continue
    }
    const seen = new Set()
    for (const channel of bound.data || []) {
      const distributorId = String(channel.distributor_id || '').trim()
      if (!distributorId || seen.has(distributorId)) continue
      seen.add(distributorId)
      const remote = await listTemplatesForDistributor(distributorId)
      if (remote.error) {
        warnings.push(`${app.label}/${channel.nick_name || distributorId}：${remote.error}`)
        continue
      }
      for (const item of remote.data || []) {
        all.push({ ...item, app_id: app.id, channel_nick: channel.nick_name || '' })
      }
    }
  }
  if (!all.length && warnings.length) return { error: warnings.join('；') }
  return { data: all, warnings }
}

async function listCallbackConfigs(input = {}) {
  const appId = String(input.appId || input.channelId || '').trim()
  if (!appId) return { error: '请选择应用' }
  const remote = await requestJson(config().paths.callbacks, { app_id: appId }, listMethod())
  if (remote.error) return remote
  return { data: pickRemoteList(remote.data), raw: remote.raw }
}

function pickCallbackId(item) {
  if (!item || typeof item !== 'object') return ''
  return String(
    item.callback_config_id ||
      item.callbackConfigId ||
      item.callback_id ||
      item.config_id ||
      item.id ||
      '',
  ).trim()
}

function pickCallbackName(item) {
  if (!item || typeof item !== 'object') return ''
  return String(item.name || item.title || item.callback_name || item.config_name || '').trim()
}

async function resolveCallbackConfigId(appId) {
  const fromEnv = config().callbackConfigId
  if (fromEnv) return fromEnv
  const remote = await listCallbackConfigs({ appId })
  if (remote.error) return { error: remote.error }
  const items = remote.data || []
  const named = items.find((x) => /公共/.test(pickCallbackName(x)))
  if (named) return pickCallbackId(named)
  if (items[0]) return pickCallbackId(items[0])
  return '0'
}

async function createReferral(input) {
  const bookId = String(input.bookId || '').trim()
  const name = String(input.name || '').trim()
  const appId = String(input.appId || input.channelId || '').trim()
  if (!appId) return { error: '请选择应用' }
  if (!bookId) return { error: '缺少书籍ID' }
  if (!name) return { error: '请填写链接名称' }
  const chapterIdx = Math.min(20, Math.max(1, parseInt(input.chapterIdx, 10) || 1))
  let callbackConfigId = String(input.callbackConfigId || '').trim()
  if (!callbackConfigId) {
    const resolved = await resolveCallbackConfigId(appId)
    if (typeof resolved === 'string') callbackConfigId = resolved
  }
  const extra = {
    book_id: bookId,
    index: chapterIdx,
    promotion_name: legalPromoName(name),
    media_source: mediaSourceCode(input.mediaSource),
  }
  const templateId = String(input.batchId || input.iaaConfigId || '').trim()
  if (templateId) extra.recharge_template_id = jsonId(templateId)
  if (callbackConfigId && callbackConfigId !== '0') extra.ad_callback_config_id = jsonId(callbackConfigId)
  return requestJson(config().paths.promotionCreate, extra, 'POST', input.distributorId)
}

async function listReferrals(input = {}) {
  const appId = String(input.appId || input.channelId || '').trim()
  if (!appId && !input.distributorId) return { error: '请选择应用' }
  const page = Math.max(1, parseInt(input.page, 10) || 1)
  const size = Math.min(50, Math.max(1, parseInt(input.size, 10) || 50))
  const extra = {
    page_index: page - 1,
    page_size: size,
  }
  if (input.offset != null && input.offset !== '') extra.offset = input.offset
  if (input.bookId) extra.book_id = String(input.bookId).trim()
  if (input.referralId) extra.promotion_id = String(input.referralId).trim()
  if (input.startTime) extra.start_time = String(input.startTime).trim()
  if (input.endTime) extra.end_time = String(input.endTime).trim()
  return requestJson(config().paths.promotions, extra, listMethod(), input.distributorId)
}

function legalPromoName(name) {
  return String(name || '')
    .replace(/\./g, '-')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function publicConfigPromoName(templateName, appName) {
  const app = legalPromoName(appName)
  const prefix = app ? legalPromoName(`番茄-${app}-公共配置`) : legalPromoName(config().promoNamePrefix)
  const n = legalPromoName(templateName)
  return legalPromoName(n ? `${prefix}-${n}` : prefix)
}

async function templateDistributorMap(appId) {
  const bound = await listBoundChannels(appId)
  if (bound.error) return bound
  const map = {}
  for (const channel of bound.data || []) {
    const distributorId = String(channel.distributor_id || '').trim()
    if (!distributorId) continue
    const remote = await listTemplatesForDistributor(distributorId)
    if (remote.error) continue
    for (const item of remote.data || []) {
      const templateId = String(item.recharge_template_id || item.id || '').trim()
      if (templateId) map[templateId] = distributorId
    }
  }
  return { data: map }
}

function isRealBookName(name) {
  const n = String(name || '').trim()
  return Boolean(n && !n.startsWith('番茄-') && !n.startsWith('常读-') && !n.startsWith('点众-'))
}

function parseBookIds(raw) {
  const seen = new Set()
  const out = []
  for (const part of String(raw == null ? '' : raw).split(/[\s,，;；]+/)) {
    const id = String(part || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function flattenPromotionItem(item) {
  if (!item || typeof item !== 'object' || !item.promotion_info) return item
  const info = item.promotion_info || {}
  const delivery = item.delivery || {}
  const book = item.book_info || {}
  const appName = item.package && item.package.package_name
  let promotionName = String(info.promotion_name || '')
  if (appName && promotionName.includes('迷机小说')) promotionName = promotionName.replace(/迷机小说/g, appName)
  const promotionUrl = String(info.promotion_url || '').trim()
  return {
    promotion_id: info.promotion_id,
    promotion_name: promotionName,
    path: promotionUrl,
    url: promotionUrl,
    monitor1: info.monitor_url || '',
    monitor2: info.promotion_http_url || '',
    book_id: book.book_id != null && book.book_id !== '' ? String(book.book_id) : '',
    book_name: book.book_name || '',
    chapter_index: book.chapter_order,
    iaa_config_id: delivery.recharge_template_id,
    callback_config_id: delivery.ad_callback_config_id || '',
    media_source: delivery.media_source,
    create_time: info.create_time,
  }
}

function normalizePromotionItem(item, extra = {}) {
  if (item == null) return extra
  if (typeof item === 'number' || typeof item === 'string') {
    return { ...extra, promotion_id: item, referralId: item }
  }
  if (typeof item !== 'object') return extra
  if (item.promotion_info) return normalizePromotionItem(flattenPromotionItem(item), extra)
  const page = String(
    item.path ||
      item.page ||
      item.start_page ||
      item.launch_page ||
      item.miniPath ||
      item.mini_path ||
      item.url ||
      item.link ||
      '',
  ).trim()
  const query = String(
    item.query ||
      item.start_param ||
      item.launch_query ||
      item.params ||
      item.query_string ||
      item.startParam ||
      '',
  ).trim()
  const pageOnly = page.split('?')[0]
  const path = query ? `${pageOnly}?${query.replace(/^\?/, '')}` : page
  const referralId = String(
    item.promotion_id || item.promotionId || item.referralId || item.referral_id || item.id || '',
  ).trim()
  return {
    ...extra,
    ...item,
    referralId,
    promotion_id: referralId,
    path,
    bookId: item.book_id || item.bookId || extra.bookId,
    bookName: item.book_name || item.bookName || item.title || extra.bookName,
    name: item.promotion_name || item.promotionName || item.name || extra.name,
    iaa_config_id: item.iaa_config_id || item.iaaConfigId || item.iaa_id || extra.iaa_config_id,
    callback_config_id: item.callback_config_id || item.callbackConfigId || extra.callback_config_id,
    chapterIdx: item.index || item.chapter_index || item.chapterIdx || extra.chapterIdx,
    mediaSource: normalizeMediaSource(item.media_source || item.mediaSource || extra.mediaSource || 'dy'),
  }
}

module.exports = {
  SOURCE,
  MEDIA_SOURCES,
  parseChannels,
  config,
  listChannels,
  findChannel,
  assertConfig,
  signKey,
  paramsValueOf,
  normalizeMediaSource,
  mediaSourceCode,
  pickRemoteList,
  publicConfigPromoName,
  legalPromoName,
  templateDistributorMap,
  isRealBookName,
  parseBookIds,
  normalizePromotionItem,
  listApps,
  listPayPanels,
  listBoundChannels,
  listCallbackConfigs,
  resolveCallbackConfigId,
  createReferral,
  listReferrals,
}
