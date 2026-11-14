/**
 * 常读分销（番茄小说）推广链接：应用 / 付费面板 / 回传规则 / 创建 / 查询。
 * 签名：md5(distributor_id + secret_key + ts) 小写。密钥只读环境变量。
 * CHANGDU_APP_ID 支持多个应用：123:迷机小说,456:其他
 * 接口路径可用 CHANGDU_PATH_* 覆盖；默认对齐常读开放接口 novelsale/openapi。
 */
const crypto = require('crypto')

const DEFAULT_BASE = 'https://www.changdupingtai.com'
const SOURCE = 'changdu'
const MEDIA_SOURCES = new Set(['dy', 'ks', 'bd', 'adq', 'tx', 'no_back'])
const DEFAULT_PATHS = {
  apps: '/novelsale/openapi/app/list/v1/',
  payPanels: '/novelsale/openapi/iaa_config/list/v1/',
  callbacks: '/novelsale/openapi/callback_config/list/v1/',
  promotions: '/novelsale/openapi/promotion/list/v1/',
  promotionCreate: '/novelsale/openapi/promotion/create/v1/',
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

function signKey(distributorId, secretKey, ts) {
  return crypto.createHash('md5').update(`${distributorId}${secretKey}${ts}`).digest('hex')
}

function authParams() {
  const { distributorId, secretKey } = config()
  const ts = String(Math.floor(Date.now() / 1000))
  return {
    distributor_id: distributorId,
    ts,
    sign: signKey(distributorId, secretKey, ts),
  }
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

async function requestJson(path, extra = {}, method) {
  const ready = assertConfig()
  if (ready.error) return { error: ready.error }
  const verb = String(method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
  const auth = authParams()
  const payload = { ...auth, ...extra }
  const url = new URL(`${ready.cfg.base}${path}`)
  if (verb === 'GET') {
    for (const [k, v] of Object.entries(payload)) {
      if (v == null || v === '') continue
      url.searchParams.set(k, String(v))
    }
  } else {
    for (const [k, v] of Object.entries(auth)) {
      url.searchParams.set(k, String(v))
    }
  }
  let res
  try {
    res = await fetch(url, {
      method: verb,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: verb === 'POST' ? JSON.stringify(payload) : undefined,
    })
  } catch (e) {
    return { error: `常读接口请求失败：${e.message || e}` }
  }
  let json
  try {
    json = await res.json()
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

async function listPayPanels(input = {}) {
  const appId = String(input.appId || input.channelId || '').trim()
  if (!appId) return { error: '请选择应用' }
  const remote = await requestJson(config().paths.payPanels, { app_id: appId }, listMethod())
  if (remote.error) return remote
  return { data: pickRemoteList(remote.data), raw: remote.raw }
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
    if (resolved && resolved.error) return resolved
    callbackConfigId = String(resolved || '0')
  }
  const extra = {
    app_id: appId,
    book_id: bookId,
    index: chapterIdx,
    promotion_name: name.slice(0, 60),
    iaa_config_id: String(input.batchId || input.iaaConfigId || '').trim(),
    callback_config_id: callbackConfigId,
  }
  if (!extra.iaa_config_id) delete extra.iaa_config_id
  return requestJson(config().paths.promotionCreate, extra, 'POST')
}

async function listReferrals(input = {}) {
  const appId = String(input.appId || input.channelId || '').trim()
  if (!appId) return { error: '请选择应用' }
  const extra = {
    app_id: appId,
    page: Math.max(1, parseInt(input.page, 10) || 1),
    page_index: Math.max(1, parseInt(input.page, 10) || 1),
    page_size: Math.min(200, Math.max(1, parseInt(input.size, 10) || 100)),
    size: Math.min(200, Math.max(1, parseInt(input.size, 10) || 100)),
  }
  if (input.bookId) extra.book_id = String(input.bookId).trim()
  if (input.referralId) extra.promotion_id = String(input.referralId).trim()
  if (input.startTime) extra.start_time = String(input.startTime).trim()
  if (input.endTime) extra.end_time = String(input.endTime).trim()
  return requestJson(config().paths.promotions, extra, listMethod())
}

function publicConfigPromoName(templateName) {
  const prefix = config().promoNamePrefix
  const n = String(templateName || '').trim()
  return (n ? `${prefix}-${n}` : prefix).slice(0, 60)
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

function normalizePromotionItem(item, extra = {}) {
  if (item == null) return extra
  if (typeof item === 'number' || typeof item === 'string') {
    return { ...extra, promotion_id: item, referralId: item }
  }
  if (typeof item !== 'object') return extra
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
  normalizeMediaSource,
  pickRemoteList,
  publicConfigPromoName,
  isRealBookName,
  parseBookIds,
  normalizePromotionItem,
  listApps,
  listPayPanels,
  listCallbackConfigs,
  resolveCallbackConfigId,
  createReferral,
  listReferrals,
}
