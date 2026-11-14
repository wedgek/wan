/**
 * 批量基建：版权→书→户→商品库编号建品→素材→策略，按巨量接口频控并发创建暂停中的智擎项目。
 */
const crypto = require('crypto')
const db = require('../db')
const auth = require('./oceanengineAuth')
const events = require('./oceanengineEvent')
const sites = require('./oceanengineSite')
const titles = require('./oceanengineTitles')
const bids = require('./oceanengineBids')
const accountService = require('./oceanengineAccount')
const products = require('./oceanengineProduct')

const TEMPLATE_BID = accountService.TEMPLATE_BID
const LAUNCH_TIERS = Object.keys(TEMPLATE_BID).sort((a, b) => Number(a) - Number(b))
const PROMO_SELECT = `SELECT p.id, p.path, p.url, p.monitor1, p.monitor2, p.referral_id, p.status, p.source,
         p.name AS promo_name, p.goods_batch_id, b.name AS book_name, rt.name AS recharge_name
       FROM novel_promo_links p
       INNER JOIN novel_books b ON b.id = p.book_id
       LEFT JOIN novel_recharge_templates rt ON rt.batch_id != '' AND rt.batch_id = p.goods_batch_id
         AND IFNULL(NULLIF(rt.source, ''), 'dianzhong') = CASE WHEN p.source = 'changdu' THEN 'changdu' ELSE 'dianzhong' END`

const API = 'https://api.oceanengine.com'
const PROJECT_CREATE = '/open_api/v3.0/std_project/create/'
const PROJECT_STATUS = '/open_api/v3.0/project/status/update/'
const VIDEO_GET = '/open_api/2/file/video/get/'
const EBP_MATERIAL_LIST = '/open_api/v3.0/tools/ebp/material/list/'
const IMAGE_UPLOAD = '/open_api/2/file/image/ad/'
const IMAGE_GET = '/open_api/2/file/image/get/'
const AWEME_AUTH_LIST = '/open_api/2/tools/aweme_auth_list/'
const MICRO_APP_LIST = '/open_api/v3.0/tools/micro_app/list/'
const TEMPLATE_KEY = 'oceanengine.launch.template'
const ACCOUNT_LIMIT = 500
const PROMO_LIMIT = 80
const PRODUCT_LIMIT = 500
const VIDEO_LIMIT_MAX = 200
const CTA_MIN = 2
const CTA_MAX = 4
const CTA_LIMIT = 10
const POINT_MIN = 6
const POINT_MAX = 9
const POINT_LIMIT = 10
const DEFAULT_PRODUCT_NAME = '2026高分小说'
const DEFAULT_SOURCE = '倾心书馆'
const DEFAULT_CALL_TO_ACTIONS = ['立即阅读', '马上阅览', '一键阅读', '点开阅览', '点开全文', '观看全文', '阅读好文', '点开阅读']
const DEFAULT_SELLING_POINTS = [
  '热门小说推荐',
  '优质网文推荐',
  '口碑好文推荐',
  '高分好书推荐',
  '人气好文推荐',
  '精品小说推荐',
  '高分人气好书推荐',
  '高评分热门好文推荐',
]
const DEFAULT_NAME_PATTERN = '{日期}{版权方}-{书名}-{档位}'
const NAME_PATTERN_TOKENS = ['{日期}', '{版权方}', '{书名}', '{档位}']
const ACCOUNT_CONCURRENCY = 12
const PRODUCT_PREP_LIMIT = 3
const PATH_QPS_START = 12
const PATH_QPS_MAX = 18
const PATH_QPS_MIN = 4
const CREATE_ATTEMPTS = 8

const RAW_NUMBER_KEYS = new Set([
  'advertiser_id',
  'asset_id',
  'asset_ids',
  'project_id',
  'product_platform_id',
  'product_id',
  'micro_app_instance_id',
  'instance_id',
  'video_cover_id',
  'image_id',
])

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
    const itemKey = key === 'asset_ids' || key === 'image_ids' ? 'advertiser_id' : ''
    return `[${value.map((item) => stringifyOcean(item, itemKey)).join(',')}]`
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const pathLimiters = new Map()

function limiterState(path) {
  let state = pathLimiters.get(path)
  if (!state) {
    state = { nextAt: 0, qps: PATH_QPS_START, cooledUntil: 0 }
    pathLimiters.set(path, state)
  }
  return state
}

async function waitPathSlot(path) {
  const state = limiterState(path)
  const now = Date.now()
  const gap = Math.max(40, Math.ceil(1000 / Math.max(PATH_QPS_MIN, state.qps)))
  const at = Math.max(now, state.nextAt, state.cooledUntil)
  state.nextAt = at + gap
  if (at > now) await sleep(at - now)
}

function notePathLimit(path, code) {
  const state = limiterState(path)
  if (code === 40100) {
    state.cooledUntil = Date.now() + 2000
    return
  }
  state.qps = Math.max(PATH_QPS_MIN, Math.floor(state.qps * 0.7) || PATH_QPS_MIN)
  state.cooledUntil = Date.now() + (code === 40110 ? 1600 : 1200)
}

function notePathOk(path) {
  const state = limiterState(path)
  if (state.qps < PATH_QPS_MAX) state.qps = Math.min(PATH_QPS_MAX, state.qps + 0.5)
}

async function mapPool(items, limit, worker) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return []
  const results = new Array(list.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(list[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function rateLimited(result) {
  const code = result && result.code
  if (code === 40100 || code === 40110 || code === 40130) return true
  return /限频|40100|40110|40130|请求频率|too many/i.test(String((result && result.error) || ''))
}

function classifyError(result, fallback) {
  const text = String((result && result.error) || fallback || '创建失败').trim()
  const code = result && result.code
  if (/已手动停止/.test(text)) {
    return { kind: 'stopped', retryable: 0, code: '', message: text }
  }
  if (code === 40100 || code === 40110 || code === 40130 || /限频|请求频率|too many/i.test(text)) {
    const label = code === 40130 ? '该广告主触发客户频控' : code === 40100 ? '巨量系统总频控' : '开发者接口频控'
    return { kind: 'rate_limit', retryable: 1, code: String(code || ''), message: `${label}：${text}` }
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|aborted|网络|请求失败/i.test(text)) {
    return { kind: 'network', retryable: 1, code: '', message: text }
  }
  if (/授权|access_token|无权限|权限不足/i.test(text)) {
    return { kind: 'auth', retryable: 0, code: String(code || ''), message: text }
  }
  if (/还没有倾心书馆|还没有付费|还没有落地页|还没有已过审|事件资产|账户还没准备好/i.test(text)) {
    return { kind: 'account', retryable: 1, code: '', message: text }
  }
  if (/对不上|没有对上|商品库里没有|视频已经被前面/i.test(text)) {
    return { kind: 'match', retryable: 0, code: '', message: text }
  }
  return { kind: 'rejected', retryable: 1, code: String(code || ''), message: text }
}

function kindLabel(kind) {
  if (kind === 'rate_limit') return '限频'
  if (kind === 'rejected') return '官方拒绝'
  if (kind === 'account') return '账户未就绪'
  if (kind === 'network') return '网络异常'
  if (kind === 'match') return '未匹配'
  if (kind === 'auth') return '授权失败'
  if (kind === 'stopped') return '已停止'
  return ''
}

function readableLaunchMessage(message) {
  const text = String(message || '').trim()
  if (/native_type/i.test(text)) {
    return '巨量拒绝：创建项目时没有带投放身份。已按「账户信息」补上，重试这批即可。'
  }
  return text
}

function idText(value) {
  const text = String(value == null ? '' : value).trim()
  return text
}

const AGE_OPTIONS = [
  'AGE_BETWEEN_18_23',
  'AGE_BETWEEN_24_30',
  'AGE_BETWEEN_31_40',
  'AGE_BETWEEN_41_49',
  'AGE_ABOVE_50',
]
const HIDE_CONVERTED = ['NO_EXCLUDE', 'PROJECT', 'PROMOTION', 'ADVERTISER', 'CUSTOMER', 'APP', 'ORGANIZATION']
const DELIVERY_MODES = ['PROCEDURAL']
const LANDING_TYPES = ['MICRO_GAME']
const MARKETING_GOALS = ['VIDEO_AND_IMAGE']
const AD_TYPES = ['ALL']
const DELIVERY_MEDIUMS = ['BYTE_APP']
const INVENTORY_CATALOGS = ['UNIVERSAL_SMART']
const BID_TYPES = ['CUSTOM']
const BUDGET_MODES = ['BUDGET_MODE_DAY']
const SCHEDULE_TYPES = ['SCHEDULE_FROM_NOW']
const PRICING_TYPES = ['PRICING_OCPM']
const PRODUCT_SETTINGS = ['SINGLE']

function defaultTemplate() {
  return {
    name: '智擎付费ROI',
    deliveryMode: 'PROCEDURAL',
    landingType: 'MICRO_GAME',
    marketingGoal: 'VIDEO_AND_IMAGE',
    adType: 'ALL',
    deliveryMedium: 'BYTE_APP',
    inventoryCatalog: 'UNIVERSAL_SMART',
    bidType: 'CUSTOM',
    budgetMode: 'BUDGET_MODE_DAY',
    scheduleType: 'SCHEDULE_FROM_NOW',
    pricing: 'PRICING_OCPM',
    productSetting: 'SINGLE',
    bidStrategyId: 0,
    audienceType: 'UNLIMITED',
    goal: '付费ROI',
    budget: 9999,
    bid: 1.28,
    roiGoal: 1.28,
    gender: 'GENDER_UNLIMITED',
    age: [],
    district: 'NONE',
    hideIfConverted: 'NO_EXCLUDE',
    hideIfExists: 'UNLIMITED',
    aigc: 'OFF',
    callToAction: DEFAULT_CALL_TO_ACTIONS[0],
    callToActions: DEFAULT_CALL_TO_ACTIONS.slice(),
    titles: '',
    sellingPoint: DEFAULT_SELLING_POINTS[0],
    sellingPoints: DEFAULT_SELLING_POINTS.slice(),
    productName: DEFAULT_PRODUCT_NAME,
    source: DEFAULT_SOURCE,
    nativeType: 'AWEME',
    awemeId: '',
    awemeName: '',
    comment: 'OFF',
    namePattern: DEFAULT_NAME_PATTERN,
    nameSuffix: '',
    titleLibraryId: 0,
    microAppId: '',
    microAppName: '',
    copyrightOwner: '',
    videoLimit: VIDEO_LIMIT_MAX,
  }
}

function compact(name, file) {
  let text = String(name || '').trim()
  if (file) text = text.replace(/\.[^.]+$/, '')
  return text.replace(/[《》\s_\-—·.。,，、~～]/g, '').toLowerCase()
}

function normalizeCopyright(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/番茄|常读|changdu/i.test(text)) return '番茄'
  if (/点众|dianzhong/i.test(text)) return '点众'
  return text
}

function copyrightOfSource(source) {
  return String(source || '') === 'changdu' ? '番茄' : '点众'
}

function accountMatchesCopyright(account, copyright) {
  const wanted = normalizeCopyright(copyright)
  if (!wanted) return true
  const got = normalizeCopyright(account && account.copyrightOwner)
  if (got === wanted) return true
  return !got && wanted === '点众'
}

function compareAccountName(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh', { numeric: true, sensitivity: 'base' })
}

function sortAccounts(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const tierA = Number(a && a.tier) || 0
    const tierB = Number(b && b.tier) || 0
    if (tierA !== tierB) return tierA - tierB
    return compareAccountName(a && a.name, b && b.name)
  })
}

function orderCopyrights(list) {
  const rows = [...new Set((Array.isArray(list) ? list : []).map(normalizeCopyright).filter(Boolean))]
  const preferred = ['点众', '番茄'].filter((item) => rows.includes(item))
  return preferred.concat(rows.filter((item) => !preferred.includes(item)))
}

function splitPlanName(name) {
  const text = String(name || '').trim()
  const match = text.match(/^(.*[^\d])(\d{1,2})$/)
  if (!match) return { bookName: text, sequence: 1 }
  const bookName = match[1].trim()
  if (compact(bookName).length < 2) return { bookName: text, sequence: 1 }
  return { bookName, sequence: Number(match[2]) }
}

function parseAccountTier(name) {
  const usage = accountService.parseUsage(name)
  return usage.template || ''
}

function bidOfTier(tier) {
  const key = String(tier || '')
  if (TEMPLATE_BID[key]) return Number(TEMPLATE_BID[key])
  return 0
}

function tierGate(allow) {
  const rows = Array.isArray(allow) && allow.length ? allow : LAUNCH_TIERS
  return new Set(rows.map((item) => String(item)))
}

function promoTier(row, allow) {
  const gate = tierGate(allow)
  const named = String((row && (row.recharge_name || row.rechargeName)) || '').trim()
  if (gate.has(named)) return named
  const namedHit = named.match(/(\d+(?:\.\d+)?)/)
  if (namedHit && gate.has(namedHit[1])) return namedHit[1]
  const fromName = String((row && (row.promo_name || row.name)) || '').match(/(\d+(?:\.\d+)?)\s*$/)
  if (fromName && gate.has(fromName[1])) return fromName[1]
  return ''
}

function formatLaunchDate(date = new Date()) {
  return `${date.getMonth() + 1}.${date.getDate()}`
}

function resolveNamePattern(source, fallback = DEFAULT_NAME_PATTERN) {
  const explicit = String((source && source.namePattern) || '').trim().slice(0, 80)
  if (explicit) return explicit
  const suffix = String((source && source.nameSuffix) || '').trim()
  if (suffix && suffix !== '公共') return `${DEFAULT_NAME_PATTERN}${suffix}`
  return fallback
}

function projectName({ account, bookName, pattern }) {
  const date = formatLaunchDate()
  const copyright = String((account && account.copyrightOwner) || '')
  const tier = String((account && account.tier) || '')
  const book = String(bookName || '')
  const raw = resolveNamePattern({ namePattern: pattern }, DEFAULT_NAME_PATTERN)
  const filled = raw
    .replace(/\{日期\}/g, date)
    .replace(/\{版权方\}/g, copyright)
    .replace(/\{档位\}/g, tier)
  if (!filled.includes('{书名}')) return filled.slice(0, 50)
  const parts = filled.split('{书名}')
  const extra = parts.join('').length
  const room = Math.max(1, 50 - extra)
  const clipped = book.length > room ? book.slice(0, room) : book
  return parts.join(clipped).slice(0, 50)
}

function parseBooks(raw) {
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw || '')
  const seen = new Set()
  const books = []
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim().replace(/[《》]/g, '').slice(0, 50)
    const key = compact(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    books.push(name)
  }
  return books
}

function productStatus(status, audit) {
  const auditText = String(audit || '').trim()
  if (auditText === '2' || auditText === 'AUDIT_STATUS_REJECT') return '审核未通过'
  if (auditText && auditText !== '1' && auditText !== 'AUDIT_STATUS_APPROVE') return '审核中'
  const text = String(status == null ? '' : status).trim()
  if (text === '1' || text === 'STATUS_ONLINE') return '可投放'
  if (text === '0' || text === 'STATUS_OFFLINE') return '不可投放'
  return text
}

function productDistance(bookKey, nameKey) {
  if (!bookKey || !nameKey) return -1
  if (nameKey === bookKey) return 0
  if (nameKey.startsWith(bookKey)) {
    const rest = nameKey.slice(bookKey.length)
    if (/^\d+$/.test(rest)) return rest.length
  }
  return -1
}

function sortTiers(list, allow) {
  const gate = tierGate(allow)
  const rows = list == null ? [] : Array.isArray(list) ? list : [...list]
  return [...new Set(rows.map((item) => String(item || '').trim()).filter((item) => gate.has(item)))].sort((a, b) => Number(a) - Number(b))
}

function normalizeTiers(raw) {
  return sortTiers(raw)
}

function libraryScore(product, account) {
  const name = String((product && product.platformName) || '')
  const tier = String((account && account.tier) || '')
  const copyright = String((account && account.copyrightOwner) || '')
  if (tier && (name === `${tier}小说` || name.startsWith(`${tier}小说`))) return 0
  if (copyright && name.includes(copyright) && /小说|书馆/.test(name) && !name.includes('漫剧')) return 1
  if (product && product.enabled) return 2
  return 3
}

function pickProductForAccount(bookKey, account, products) {
  const groups = new Map()
  for (const item of Array.isArray(products) ? products : []) {
    const score = libraryScore(item, account)
    const list = groups.get(score) || []
    list.push(item)
    groups.set(score, list)
  }
  for (const score of [...groups.keys()].sort((a, b) => a - b)) {
    const hit = pickProduct(bookKey, groups.get(score))
    if (hit.product && hit.product.status === '可投放') return hit
  }
  return { product: null, extra: 0, approximate: false }
}

function compactProduct(item) {
  if (!item) return null
  return {
    productId: item.productId,
    name: item.name,
    platformId: item.platformId,
    platformName: item.platformName,
    status: item.status,
  }
}

function pickProduct(bookKey, products) {
  const ranked = []
  for (const item of products) {
    const distance = productDistance(bookKey, compact(item.name))
    if (distance < 0) continue
    if (item.status === '不可投放' || item.status === '审核未通过') continue
    ranked.push({ ...item, distance })
  }
  ranked.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    if ((a.status === '可投放') !== (b.status === '可投放')) return a.status === '可投放' ? -1 : 1
    return String(a.platformName).localeCompare(String(b.platformName), 'zh')
  })
  if (!ranked.length) return { product: null, extra: 0, approximate: false }
  return {
    product: ranked[0],
    extra: ranked.filter((item) => item.distance === ranked[0].distance).length - 1,
    approximate: ranked[0].distance > 0,
  }
}

function pickPromo(bookKey, promos) {
  const hits = promos
    .filter((item) => item.active && compact(item.bookName) === bookKey)
    .sort((a, b) => b.id - a.id)
  return { promo: hits[0] || null, extra: Math.max(0, hits.length - 1) }
}

function assignVideos(books, videos) {
  const keys = books.map((name) => ({ name, key: compact(name) })).filter((item) => item.key.length >= 2)
  const byBook = new Map(books.map((name) => [name, []]))
  const ambiguous = []
  const seen = new Set()
  for (const video of videos) {
    if (!video.videoId || seen.has(video.videoId)) continue
    const key = compact(video.filename, true)
    if (!key) continue
    const hits = keys.filter((item) => key === item.key || key.includes(item.key))
    if (!hits.length) continue
    seen.add(video.videoId)
    hits.sort((a, b) => b.key.length - a.key.length)
    const best = hits[0].key.length
    const top = hits.filter((item) => item.key.length === best)
    if (top.length > 1) {
      ambiguous.push({ filename: video.filename, books: top.map((item) => item.name) })
      continue
    }
    byBook.get(top[0].name).push({
      filename: video.filename,
      videoId: video.videoId,
      materialId: video.materialId || '',
      posterUrl: video.posterUrl || '',
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      duration: Number(video.duration) || 0,
    })
  }
  return { byBook, ambiguous }
}

function splitMiniPath(path) {
  const text = String(path || '').trim()
  if (!text || /^https?:/i.test(text)) return { page: '', query: '' }
  const mark = text.indexOf('?')
  if (mark < 0) return { page: text.replace(/^\//, ''), query: '' }
  return { page: text.slice(0, mark).replace(/^\//, ''), query: text.slice(mark + 1) }
}

function titleLines(raw) {
  return titles.parseTitleLines(raw).titles.slice(0, 30)
}

function phraseLines(raw, limit) {
  const chunks = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/\r?\n/)
  const list = []
  const seen = new Set()
  for (const chunk of chunks) {
    const text = String(chunk || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    list.push(text)
    if (limit && list.length >= limit) break
  }
  return list
}

function productTitle(template, book) {
  const named = String((template && template.productName) || '').trim()
  if (named) return named.slice(0, 20)
  return String((book && (book.bookName || book.name)) || '').slice(0, 20)
}

function adSource(template) {
  const raw = String((template && (template.source || template.microAppName)) || DEFAULT_SOURCE).trim()
  const text = raw.slice(0, 10)
  return text.length >= 2 ? text : DEFAULT_SOURCE
}

function normalizePhrases(source, keys, min, max, limit, fallback) {
  let raw
  for (const key of keys) {
    if (source[key] != null && source[key] !== '') {
      raw = source[key]
      break
    }
  }
  const list = phraseLines(raw, limit).map((item) => item.slice(0, max)).filter(Boolean)
  if (list.length) return list
  return fallback ? [fallback] : []
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function normalizeTemplate(input) {
  const source = input && typeof input === 'object' ? input : {}
  const base = defaultTemplate()
  const goal = source.goal === '付费' ? '付费' : '付费ROI'
  const legacy = source.namePattern == null
  const budget = Number(source.budget)
  const bid = source.bid == null || source.bid === '' ? null : Number(source.bid)
  const roiRaw = source.roiGoal == null || source.roiGoal === '' ? bid : Number(source.roiGoal)
  const roiGoal = Number.isFinite(roiRaw) ? roiRaw : base.roiGoal
  const callToActions = normalizePhrases(source, ['callToActions', 'callToAction'], CTA_MIN, CTA_MAX, CTA_LIMIT, base.callToActions[0])
  const sellingPoints = normalizePhrases(source, ['sellingPoints', 'sellingPoint'], POINT_MIN, POINT_MAX, POINT_LIMIT, base.sellingPoints[0])
  const callToAction = callToActions[0] || base.callToAction
  const sellingPoint = sellingPoints[0] || base.sellingPoint
  const productName = String(source.productName != null ? source.productName : base.productName).trim().slice(0, 20)
  const converted = pickEnum(source.hideIfConverted, HIDE_CONVERTED, base.hideIfConverted)
  const namePattern = resolveNamePattern(source, base.namePattern)
  const titleLibraryId = Number(source.titleLibraryId) || 0
  const microAppId = String(source.microAppId || '').trim()
  const microAppName = String(source.microAppName || '').trim()
  const copyrightOwner = String(source.copyrightOwner || '').trim().slice(0, 20)
  const brand = String(source.source || base.source || microAppName || '').trim().slice(0, 10)
  const gender = pickEnum(source.gender, ['GENDER_UNLIMITED', 'GENDER_MALE', 'GENDER_FEMALE'], base.gender)
  const age = Array.isArray(source.age) ? source.age.filter((item) => AGE_OPTIONS.includes(item)) : []
  const district = pickEnum(source.district, ['NONE', 'REGION'], base.district)
  const custom = source.audienceType === 'CUSTOM' || gender !== 'GENDER_UNLIMITED' || age.length || district !== 'NONE'
  return {
    name: String(source.name || base.name).trim().slice(0, 40) || base.name,
    deliveryMode: pickEnum(source.deliveryMode, DELIVERY_MODES, base.deliveryMode),
    landingType: pickEnum(source.landingType, LANDING_TYPES, base.landingType),
    marketingGoal: pickEnum(source.marketingGoal, MARKETING_GOALS, base.marketingGoal),
    adType: pickEnum(source.adType, AD_TYPES, base.adType),
    deliveryMedium: pickEnum(source.deliveryMedium, DELIVERY_MEDIUMS, base.deliveryMedium),
    inventoryCatalog: pickEnum(source.inventoryCatalog, INVENTORY_CATALOGS, base.inventoryCatalog),
    bidType: pickEnum(source.bidType, BID_TYPES, base.bidType),
    budgetMode: pickEnum(source.budgetMode, BUDGET_MODES, base.budgetMode),
    scheduleType: pickEnum(source.scheduleType, SCHEDULE_TYPES, base.scheduleType),
    pricing: pickEnum(source.pricing, PRICING_TYPES, base.pricing),
    productSetting: pickEnum(source.productSetting, PRODUCT_SETTINGS, base.productSetting),
    bidStrategyId: Number(source.bidStrategyId) || 0,
    audienceType: custom ? 'CUSTOM' : 'UNLIMITED',
    goal,
    budget: Number.isFinite(budget) ? (legacy && budget === 300 ? 9999 : budget) : base.budget,
    bid: goal === '付费ROI' ? roiGoal : Number.isFinite(bid) ? bid : null,
    roiGoal,
    gender: custom ? gender : 'GENDER_UNLIMITED',
    age: custom ? age : [],
    district: custom ? district : 'NONE',
    hideIfConverted: converted,
    hideIfExists: pickEnum(source.hideIfExists, ['UNLIMITED', 'FILTER', 'TARGETING'], base.hideIfExists),
    aigc: source.aigc === 'ON' ? 'ON' : 'OFF',
    callToAction,
    callToActions,
    titles: titleLines(source.titles).join('\n'),
    sellingPoint,
    sellingPoints,
    productName,
    source: brand,
    nativeType: source.nativeType === 'ACCOUNT' ? 'ACCOUNT' : 'AWEME',
    awemeId: idText(source.awemeId),
    awemeName: String(source.awemeName || '').trim().slice(0, 30),
    comment: legacy ? 'OFF' : source.comment === 'ON' ? 'ON' : 'OFF',
    namePattern,
    nameSuffix: '',
    titleLibraryId,
    microAppId,
    microAppName,
    copyrightOwner,
    videoLimit: VIDEO_LIMIT_MAX,
  }
}

function templateIssues(template, options = {}) {
  const issues = []
  const lines = titleLines(template.titles)
  if (!Number.isFinite(template.budget) || template.budget < 300) issues.push('日预算至少 300')
  if (template.goal === '付费ROI') {
    const roi = template.roiGoal != null ? template.roiGoal : template.bid
    if (roi == null || roi < 0.01 || roi > 5) issues.push('ROI 系数要在 0.01 到 5 之间')
  }
  if (!options.skipTitles && !template.titleLibraryId) {
    if (!lines.length) issues.push('请选择标题包')
    const bad = lines.find((title) => !titles.validTitle(title))
    if (bad) issues.push('每条标题要在 5 到 55 个字，不要带话题标签')
  }
  const ctas = template.callToActions || phraseLines(template.callToAction, CTA_LIMIT)
  const points = template.sellingPoints || phraseLines(template.sellingPoint, POINT_LIMIT)
  if (!ctas.length) issues.push('请填写行动号召')
  else if (ctas.some((item) => item.length < CTA_MIN || item.length > CTA_MAX)) issues.push(`每条行动号召要在 ${CTA_MIN} 到 ${CTA_MAX} 个字`)
  if (!points.length) issues.push('请填写产品卖点')
  else if (points.some((item) => item.length < POINT_MIN || item.length > POINT_MAX)) issues.push(`每条产品卖点要在 ${POINT_MIN} 到 ${POINT_MAX} 个字`)
  if (template.source.length < 2 || template.source.length > 10) issues.push('自定义抖音号昵称要在 2 到 10 个字')
  if (template.productName && (template.productName.length < 1 || template.productName.length > 20)) issues.push('产品名称要在 1 到 20 个字')
  if (!template.microAppId) issues.push('请选择投放载体')
  return issues
}

function readLegacyTemplate() {
  const raw = db.getAppSetting(TEMPLATE_KEY, '')
  if (!raw) return defaultTemplate()
  try {
    return normalizeTemplate(JSON.parse(raw))
  } catch {
    return defaultTemplate()
  }
}

function strategySummary(config) {
  const bits = []
  bits.push(config.goal === '付费ROI' ? `付费ROI ${config.roiGoal != null ? config.roiGoal : config.bid}` : '付费')
  bits.push(`日预算 ${config.budget}`)
  const bidPlan = bids.resolve(config.bidStrategyId)
  bits.push(bidPlan ? `出价 ${bidPlan.name}` : '出价按档位')
  if (config.microAppName) bits.push(config.microAppName)
  if (config.productName) bits.push(config.productName)
  if (config.source && config.source !== config.microAppName) bits.push(`来源 ${config.source}`)
  if (config.nativeType === 'ACCOUNT') bits.push('投放身份 账户信息')
  else bits.push(config.awemeName ? `抖音号 ${config.awemeName}` : '抖音号 按户授权')
  bits.push(config.namePattern || DEFAULT_NAME_PATTERN)
  if (config.titleLibraryId) bits.push('已绑标题包')
  if (config.audienceType === 'CUSTOM') bits.push('自定义定向')
  return bits.join(' · ')
}

function mapStrategy(row) {
  let config = defaultTemplate()
  try {
    config = normalizeTemplate(JSON.parse(row.config || '{}'))
  } catch {
    config = defaultTemplate()
  }
  const name = row.name || config.name
  return {
    id: row.id,
    ...config,
    name,
    summary: strategySummary({ ...config, name }),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

function getStrategy(id) {
  const row = database()
    .prepare(`SELECT id, name, config, created_at, updated_at FROM oceanengine_launch_strategies WHERE id = ?`)
    .get(Number(id) || 0)
  return row ? mapStrategy(row) : null
}

function listStrategies() {
  return database()
    .prepare(`SELECT id, name, config, created_at, updated_at FROM oceanengine_launch_strategies ORDER BY id`)
    .all()
    .map(mapStrategy)
}

function insertStrategy(name, config) {
  const inserted = database()
    .prepare(
      `INSERT INTO oceanengine_launch_strategies (name, config, created_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))`,
    )
    .run(name, JSON.stringify(config))
  return getStrategy(inserted.lastInsertRowid)
}

function migrateStrategies() {
  const count = database().prepare(`SELECT COUNT(*) AS n FROM oceanengine_launch_strategies`).get()
  if (count && Number(count.n) > 0) return
  const legacy = readLegacyTemplate()
  insertStrategy(legacy.name || '智擎付费ROI', legacy)
}

function isGenericStrategyName(name) {
  const text = String(name || '').trim()
  return !text || text === '智擎付费ROI' || text === '未命名策略'
}

function composeStrategyName(config, fallback) {
  const suggested = String((config && config.microAppName) || '').trim().slice(0, 40)
  const raw = String(fallback || '').trim()
  if (isGenericStrategyName(raw)) return suggested || raw || '未命名策略'
  return raw.slice(0, 40)
}

function createStrategy(input) {
  migrateStrategies()
  const config = normalizeTemplate(input)
  const name = composeStrategyName(config, (input && input.name) || config.name)
  return insertStrategy(name, { ...config, name })
}

function updateStrategy(id, input) {
  migrateStrategies()
  const current = getStrategy(id)
  if (!current) return { error: '没有这条策略' }
  const config = normalizeTemplate({ ...current, ...(input || {}) })
  const name = composeStrategyName(config, input && input.name != null ? input.name : current.name)
  database()
    .prepare(`UPDATE oceanengine_launch_strategies SET name = ?, config = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, JSON.stringify({ ...config, name }), current.id)
  return getStrategy(current.id)
}

function removeStrategy(id) {
  migrateStrategies()
  const current = getStrategy(id)
  if (!current) return { error: '没有这条策略' }
  database().prepare(`DELETE FROM oceanengine_launch_strategies WHERE id = ?`).run(current.id)
  return { id: current.id }
}

function saveTemplate(input) {
  migrateStrategies()
  const first = listStrategies()[0]
  if (!first) return createStrategy(input)
  return updateStrategy(first.id, input)
}

function loadProducts() {
  return database()
    .prepare(
      `SELECT c.platform_id, c.platform_name, c.product_id, c.name, c.status, c.audit_status,
              COALESCE(p.enabled, 0) AS enabled
       FROM oceanengine_catalog_items c
       LEFT JOIN oceanengine_library_prefs p ON p.platform_id = c.platform_id
       WHERE c.name != '' AND c.product_id != ''`,
    )
    .all()
    .map((row) => ({
      platformId: row.platform_id,
      platformName: row.platform_name || '',
      productId: row.product_id,
      name: row.name,
      status: productStatus(row.status, row.audit_status),
      enabled: Number(row.enabled) === 1,
    }))
}

function mapPromo(row, allow) {
  const monitor = [row.monitor1, row.monitor2].find((item) => /^https?:\/\//i.test(String(item || '').trim())) || ''
  const tier = promoTier(row, allow)
  return {
    id: row.id,
    bookName: row.book_name || '',
    path: row.path || row.url || '',
    monitor: String(monitor || '').trim(),
    referralId: row.referral_id || '',
    source: row.source === 'changdu' ? 'changdu' : 'dianzhong',
    copyright: copyrightOfSource(row.source),
    active: row.status !== 'inactive',
    rechargeName: String(row.recharge_name || '').trim() || tier,
    tier,
    bid: bidOfTier(tier) || '',
  }
}

function compactPromo(promo) {
  if (!promo) return null
  const mini = promo.page ? { page: promo.page, query: promo.query } : splitMiniPath(promo.path)
  if (!mini.page) return null
  return {
    id: promo.id,
    path: promo.path,
    page: mini.page,
    query: mini.query,
    monitor: promo.monitor,
    referralId: promo.referralId,
    tier: promo.tier || '',
    rechargeName: promo.rechargeName || promo.tier || '',
    bid: promo.bid || bidOfTier(promo.tier),
  }
}

function matchPromo(list, account) {
  const rows = Array.isArray(list) ? list : []
  if (!rows.length) return null
  const tier = String((account && account.tier) || '')
  if (tier) return rows.find((item) => item.tier === tier) || null
  return rows.length === 1 ? rows[0] : null
}

function searchBooks(keyword, copyright) {
  const text = String(keyword || '').trim()
  const wanted = normalizeCopyright(copyright)
  const where = ['1=1']
  const args = []
  if (text) {
    where.push('(b.name LIKE ? OR b.external_book_id LIKE ?)')
    args.push(`%${text}%`, `%${text}%`)
  }
  let promoJoin = `LEFT JOIN novel_promo_links p ON p.book_id = b.id AND p.status != 'inactive'`
  if (wanted === '番茄') promoJoin += ` AND p.source = 'changdu'`
  else if (wanted === '点众') promoJoin += ` AND IFNULL(p.source, '') != 'changdu'`
  const having = text ? '' : 'HAVING COUNT(p.id) > 0'
  return database()
    .prepare(
      `SELECT b.id, b.external_book_id AS externalBookId, b.name AS bookName,
              GROUP_CONCAT(DISTINCT IFNULL(rt.name, '')) AS tiers,
              GROUP_CONCAT(DISTINCT CASE WHEN p.id IS NULL THEN NULL WHEN p.source = 'changdu' THEN '番茄' ELSE '点众' END) AS copyrights
       FROM novel_books b
       ${promoJoin}
       LEFT JOIN novel_recharge_templates rt ON rt.batch_id != '' AND rt.batch_id = p.goods_batch_id
         AND IFNULL(NULLIF(rt.source, ''), 'dianzhong') = CASE WHEN p.source = 'changdu' THEN 'changdu' ELSE 'dianzhong' END
       WHERE ${where.join(' AND ')}
       GROUP BY b.id
       ${having}
       ORDER BY MAX(p.id) DESC, b.last_seen_at DESC, b.id DESC
       LIMIT 50`,
    )
    .all(...args)
    .map((row) => ({
      id: row.id,
      externalBookId: String(row.externalBookId || '').trim(),
      bookName: row.bookName || '',
      tiers: sortTiers(String(row.tiers || '').split(',')),
      copyrights: orderCopyrights(String(row.copyrights || '').split(',')),
    }))
}

function loadPromosByBook(bookName, allow) {
  const name = String(bookName || '').trim()
  if (!name) return []
  return database()
    .prepare(
      `${PROMO_SELECT}
       WHERE p.status != 'inactive' AND b.name = ?
       ORDER BY p.id DESC`,
    )
    .all(name)
    .map((row) => mapPromo(row, allow))
}

function searchPromos(keyword) {
  const text = String(keyword || '').trim()
  const where = [`p.status != 'inactive'`]
  const args = []
  if (text) {
    where.push('(b.name LIKE ? OR p.referral_id LIKE ?)')
    args.push(`%${text}%`, `%${text}%`)
  }
  return database()
    .prepare(
      `${PROMO_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY p.id DESC
       LIMIT 80`,
    )
    .all(...args)
    .map(mapPromo)
}

function searchVideos(keyword) {
  const text = String(keyword || '').trim()
  const where = [`status = 'success'`, `video_id != ''`]
  const args = []
  if (text) {
    where.push('filename LIKE ?')
    args.push(`%${text}%`)
  }
  return database()
    .prepare(
      `SELECT filename, video_id, material_id
       FROM oceanengine_upload_records
       WHERE ${where.join(' AND ')}
       ORDER BY id DESC
       LIMIT 80`,
    )
    .all(...args)
    .map((row) => ({
      filename: row.filename || '',
      videoId: row.video_id,
      materialId: row.material_id || '',
    }))
}

function loadVideosByIds(ids) {
  const wanted = []
  const seen = new Set()
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    wanted.push(id)
  }
  if (!wanted.length) return []
  const known = new Map(loadVideos().map((item) => [item.videoId, item]))
  return wanted.map((id) => known.get(id)).filter(Boolean)
}

function loadPromosByIds(ids) {
  if (!ids.length) return []
  const ph = ids.map(() => '?').join(',')
  const rows = database()
    .prepare(
      `${PROMO_SELECT}
       WHERE p.id IN (${ph}) AND p.status != 'inactive'`,
    )
    .all(...ids)
    .map(mapPromo)
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  return ids.map((id) => byId.get(String(id))).filter(Boolean)
}

function mapLaunchLibrary(item) {
  return {
    id: item.id,
    name: item.name,
    industry: item.industry || '',
    storeType: item.storeType || 0,
    preferred: /自动搭建/.test(item.name || ''),
  }
}

function sortLaunchLibraries(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const prefA = a.preferred ? 0 : 1
    const prefB = b.preferred ? 0 : 1
    if (prefA !== prefB) return prefA - prefB
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh')
  })
}

function loadLibraries() {
  const flagged = products.withLaunchFlags(products.localStoredLibraries())
  return sortLaunchLibraries(flagged.filter((item) => item.launch).map(mapLaunchLibrary))
}

function loadVideos() {
  return database()
    .prepare(
      `SELECT filename, video_id, material_id
       FROM oceanengine_upload_records
       WHERE status = 'success' AND video_id != ''
       ORDER BY id DESC
       LIMIT 3000`,
    )
    .all()
    .map((row) => ({
      filename: row.filename || '',
      videoId: row.video_id,
      materialId: row.material_id || '',
    }))
}

function loadAccounts() {
  return sortAccounts(
    database()
      .prepare(
        `SELECT advertiser_id, name, company, copyright_owner, avatar_url
         FROM oceanengine_advertisers
         WHERE in_use = 1
         ORDER BY name, advertiser_id
         LIMIT 500`,
      )
      .all()
      .map((row) => {
        const usage = accountService.parseUsage(row.name)
        const avatar = String(row.avatar_url || '').trim()
        return {
          advertiserId: row.advertiser_id,
          name: row.name || '',
          company: row.company || '',
          copyrightOwner: normalizeCopyright(row.copyright_owner) || row.copyright_owner || '',
          avatarUrl: avatar && avatar !== '-' ? avatar : '',
          tier: usage.template || parseAccountTier(row.name),
          bid: usage.bid ? Number(usage.bid) : bidOfTier(usage.template),
        }
      }),
  )
}

function loadActivePromos() {
  return database()
    .prepare(
      `${PROMO_SELECT}
       WHERE p.status != 'inactive'
       ORDER BY p.id DESC
       LIMIT 5000`,
    )
    .all()
    .map(mapPromo)
}

function selectedAccounts(ids) {
  const wanted = []
  const seen = new Set()
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    wanted.push(id)
  }
  const known = new Map(loadAccounts().map((item) => [item.advertiserId, item]))
  const accounts = []
  const missing = []
  for (const id of wanted) {
    const row = known.get(id)
    if (!row) missing.push(id)
    else accounts.push(row)
  }
  return { accounts, missing }
}

function productModeOf(input) {
  return input && input.productMode === 'fresh' ? 'fresh' : 'reuse'
}

function presentProductPlan(plan) {
  const names = (plan && plan.names) || []
  return {
    platformId: (plan && plan.platformId) || '',
    bookName: (plan && plan.bookName) || '',
    count: (plan && plan.count) || 0,
    mode: (plan && plan.mode) || 'reuse',
    reuseCount: (plan && plan.reuseCount) || 0,
    createCount: (plan && plan.createCount) || 0,
    existingCount: (plan && plan.existingCount) || 0,
    usedMax: (plan && plan.usedMax) || 0,
    used: Boolean(plan && plan.used),
    from: (plan && plan.from) || 0,
    to: (plan && plan.to) || 0,
    firstName: names[0] || '',
    lastName: names.length ? names[names.length - 1] : '',
    names,
  }
}

function presentProductOption(plan) {
  const view = presentProductPlan(plan)
  delete view.names
  return view
}

function buildPreview({ bookName, promos, accounts, accountTotal, selectedTiers, availableTiers, template, materials, materialPool, ambiguous, extra = {} }) {
  const bidPlan = bids.resolve(template && template.bidStrategyId)
  const priceOf = (tier) => bids.bidFor(bidPlan, tier)
  const bookKey = compact(bookName)
  const promoList = (promos || []).map(compactPromo).filter(Boolean)
  const videoList = (materials || []).slice(0, VIDEO_LIMIT_MAX)
  const conflicts = (ambiguous || []).filter((row) => (row.books || []).some((name) => compact(name) === bookKey || name === bookName))
  const bookMessages = []
  let bookStatus = 'ready'
  const bookBlock = (text) => {
    bookStatus = 'block'
    bookMessages.push(text)
  }
  const bookWarn = (text) => {
    if (bookStatus !== 'block') bookStatus = 'warn'
    bookMessages.push(text)
  }
  if (!promoList.length) bookBlock('没有对上书名的推广链接')
  if (promoList.length && promoList.every((promo) => !promo.monitor)) bookWarn('没有监测链接')
  if (!videoList.length) {
    bookBlock(conflicts.length ? '视频和别的书重名，没有放进来' : extra.videoNotice || '巨量线上素材库里没有对上这本书的视频')
  } else if (materialPool > VIDEO_LIMIT_MAX) {
    bookWarn(`匹配到 ${materialPool} 条视频，计划最多带 ${VIDEO_LIMIT_MAX} 条`)
  }
  for (const row of conflicts) bookWarn(`「${row.filename}」同时像多本书，已跳过`)

  const resolvedPool = sortAccounts(accounts || []).map((account) => {
    const promo = matchPromo(promoList, account)
    const bid = priceOf(account.tier)
    return {
      ...account,
      bid,
      product: null,
      promo,
      ready: Boolean(promo && bid),
    }
  })
  const suggestedIds = uniqueIds(extra.suggestedIds, ACCOUNT_LIMIT)
  const requestedPick = uniqueIds(extra.pickedIds, ACCOUNT_LIMIT)
  const pickedSet = new Set(Array.isArray(extra.pickedIds) ? requestedPick : suggestedIds)
  const resolvedAccounts = sortAccounts(resolvedPool.filter((item) => pickedSet.has(idText(item.advertiserId))))
  const library = (extra.libraries || loadLibraries()).find((item) => item.id === extra.platformId) || null
  if (!library) bookWarn('还没选商品库，确认后才会按编号创建商品')

  const book = {
    name: bookName,
    bookName,
    status: bookStatus,
    messages: bookMessages,
    product: null,
    promo: promoList[0] || null,
    promoList,
    promoTiers: sortTiers(promoList.map((item) => item.tier)),
    materials: videoList,
    materialCount: videoList.length,
  }

  const templateMessages = templateIssues(template, { skipTitles: extra.skipTitles })
  const tierRows = []
  let readyJobs = 0
  let failJobs = 0
  for (const tier of selectedTiers) {
    const bid = priceOf(tier)
    const promo = promoList.find((item) => item.tier === tier) || null
    const rows = resolvedPool.filter((item) => item.tier === tier)
    const pickedRows = rows.filter((item) => pickedSet.has(idText(item.advertiserId)))
    const messages = []
    let status = bookStatus === 'block' ? 'block' : 'ready'
    const block = (text) => {
      status = 'block'
      messages.push(text)
    }
    const warn = (text) => {
      if (status !== 'block') status = 'warn'
      messages.push(text)
    }
    if (!promo) block('没有这一档的推广链接')
    if (!rows.length) block('没有这一档的在投账户')
    else if (!pickedRows.length) warn('这一档还没勾选账户')
    if (!bid) block('没有这一档的出价规则')
    if (bookStatus === 'block') {
      for (const text of bookMessages) {
        if (!messages.includes(text)) messages.push(text)
      }
    }
    const sampleAccount = pickedRows[0] || rows[0]
    const sampleName = sampleAccount
      ? projectName({ account: sampleAccount, bookName, pattern: template.namePattern })
      : ''
    let jobs = 0
    for (const account of pickedRows) {
      if (status === 'block' || bookStatus === 'block' || !promo || !bid) {
        failJobs += 1
        continue
      }
      readyJobs += 1
      jobs += 1
    }
    tierRows.push({
      tier,
      bid,
      promo,
      accounts: rows.map((item) => ({
        advertiserId: item.advertiserId,
        name: item.name,
        avatarUrl: item.avatarUrl || '',
        bid: priceOf(item.tier),
        productName: '',
        ready: Boolean(item.ready),
      })),
      accountCount: pickedRows.length,
      poolCount: rows.length,
      product: null,
      libraries: library ? [library.name] : [],
      jobs,
      projectName: sampleName,
      status,
      messages,
    })
  }
  const productMode = extra.productMode === 'fresh' ? 'fresh' : 'reuse'
  const emptyPlan = {
    names: [],
    usedMax: 0,
    from: 0,
    to: 0,
    used: false,
    count: 0,
    platformId: '',
    bookName,
    mode: productMode,
    reuseCount: 0,
    createCount: 0,
    existingCount: 0,
  }
  const reusePlan = library ? products.assignLaunchProducts(library.id, bookName, readyJobs, 'reuse') : emptyPlan
  const freshPlan = library ? products.assignLaunchProducts(library.id, bookName, readyJobs, 'fresh') : emptyPlan
  const productPlan = productMode === 'fresh' ? freshPlan : reusePlan
  const notices = []
  if (extra.videoNotice && videoList.length) notices.push(extra.videoNotice)
  if (accountTotal > ACCOUNT_LIMIT) {
    notices.push(`同档位在投户有 ${accountTotal} 个，一次最多带 ${ACCOUNT_LIMIT} 个。一户一条计划，可删可增。`)
  }
  if (resolvedAccounts.length && bookStatus !== 'block' && !readyJobs) {
    templateMessages.push('勾选的档位对不上在投账户或推广链接。')
  }
  if (!extra.strategyId) templateMessages.push('还没选策略模板')
  return {
    bookName,
    availableTiers,
    selectedTiers,
    tiers: tierRows,
    books: [book],
    accounts: resolvedAccounts,
    strategyName: template.name,
    namePattern: template.namePattern || DEFAULT_NAME_PATTERN,
    titleLibraryId: extra.titleLibraryId || 0,
    titleLibraryName: extra.titleLibraryName || '',
    templateMessages,
    notices,
    tierSummary: tierRows.map((item) => ({ tier: item.tier, bid: item.bid, accounts: item.accountCount })),
    roiGoal: template.roiGoal != null ? template.roiGoal : template.bid,
    accountTotal,
    accountCount: resolvedAccounts.length,
    accountLimit: ACCOUNT_LIMIT,
    suggestedAccountIds: suggestedIds.length ? suggestedIds : resolvedAccounts.map((item) => idText(item.advertiserId)).filter(Boolean),
    videoCount: videoList.length,
    videoSource: extra.videoSource || '',
    videos: videoList.map((item) => ({
      filename: item.filename,
      videoId: item.videoId,
      posterUrl: item.posterUrl || '',
      width: item.width || 0,
      height: item.height || 0,
    })),
    copyrightOwner: extra.copyrightOwner || '',
    library,
    productPlan: presentProductPlan(productPlan),
    productOptions: (reusePlan.existingCount || 0) > 0
      ? [presentProductOption(reusePlan), presentProductOption(freshPlan)]
      : [],
    confirm: {
      bookName,
      copyrightOwner: extra.copyrightOwner || '',
      strategyName: template.name,
      bidStrategyName: bidPlan ? bidPlan.name : '',
      microAppName: template.microAppName || '',
      productName: template.productName || '',
      source: template.source || '',
      titleLibraryName: extra.titleLibraryName || '',
      roiGoal: template.roiGoal != null ? template.roiGoal : template.bid,
      budget: template.budget,
      namePattern: template.namePattern || DEFAULT_NAME_PATTERN,
      callToActions: template.callToActions || [],
      sellingPoints: template.sellingPoints || [],
      libraryName: library ? library.name : '',
      productFrom: productPlan.from,
      productTo: productPlan.to,
      productSample: (productPlan.names && productPlan.names[0]) || '',
      productMode: productPlan.mode || productMode,
      reuseCount: productPlan.reuseCount || 0,
      createCount: productPlan.createCount || 0,
    },
    productCount: productPlan.count,
    jobs: readyJobs,
    readyJobs,
    failJobs,
    ready: readyJobs > 0 && !templateMessages.length && bookStatus !== 'block' && Boolean(library),
  }
}

function mapTask(task) {
  const extra = database()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM oceanengine_launch_task_items WHERE task_id = ?`,
    )
    .get(task.id)
  const phase = taskPhase(task.id)
  return {
    id: task.id,
    status: task.status,
    added: task.added,
    failed: task.failed,
    total: Number(extra && extra.total) || Number(task.added || 0) + Number(task.failed || 0),
    pending: Number(extra && extra.pending) || 0,
    bookCount: task.book_count,
    accountCount: task.account_count,
    strategyName: task.strategy_name || '',
    name: task.name || '',
    productLibrary: task.product_library || '',
    productSpan: task.product_span || '',
    phase: (phase && phase.phase) || '',
    phaseDone: (phase && phase.done) || 0,
    phaseTotal: (phase && phase.total) || 0,
    createdAt: task.created_at || '',
  }
}

function mapTaskItem(row) {
  const kind = row.error_kind || ''
  const payload = parsePayload(row.payload)
  const book = payload.book || {}
  return {
    id: row.id,
    advertiserId: row.advertiser_id,
    accountName: row.account_name,
    bookName: book.bookName || row.book_name,
    productName: (book.product && book.product.name) || book.name || '',
    projectId: row.project_id,
    promotionId: row.promotion_id,
    promoPath: row.promo_path || '',
    materialCount: Number(row.material_count) || 0,
    status: row.status,
    message: readableLaunchMessage(row.message),
    reason: readableLaunchMessage(row.message),
    errorCode: row.error_code || '',
    errorKind: kind,
    errorKindLabel: kindLabel(kind),
    retryable: Number(row.retryable) === 1 || row.status === 'fail',
  }
}

function taskDraft(id) {
  const taskId = Number(id) || 0
  const task = database()
    .prepare(`SELECT id, strategy_name, snapshot FROM oceanengine_launch_tasks WHERE id = ?`)
    .get(taskId)
  if (!task) return null
  const snapshot = parsePayload(task.snapshot)
  const template = snapshot.template || {}
  const rows = database()
    .prepare(`SELECT advertiser_id, payload FROM oceanengine_launch_task_items WHERE task_id = ? ORDER BY id`)
    .all(taskId)
  const advertiserIds = []
  const tiers = []
  const videoIds = []
  const seenAccounts = new Set()
  const seenTiers = new Set()
  const seenVideos = new Set()
  let bookName = String(snapshot.bookName || '').trim()
  let platformName = ''
  for (const row of rows) {
    const payload = parsePayload(row.payload)
    const accountId = idText(payload.advertiserId || row.advertiser_id)
    if (accountId && !seenAccounts.has(accountId)) {
      seenAccounts.add(accountId)
      advertiserIds.push(accountId)
    }
    const tier = String(payload.tier || '').trim()
    if (tier && !seenTiers.has(tier)) {
      seenTiers.add(tier)
      tiers.push(tier)
    }
    const book = payload.book || {}
    if (!bookName) bookName = String(book.bookName || '').trim()
    if (!platformName && book.product && book.product.platformName) platformName = book.product.platformName
    for (const material of book.materials || []) {
      const videoId = idText(material && material.videoId)
      if (!videoId || seenVideos.has(videoId)) continue
      seenVideos.add(videoId)
      videoIds.push(videoId)
    }
  }
  tiers.sort((a, b) => Number(a) - Number(b))
  let copyright = normalizeCopyright(snapshot.copyrightOwner || '')
  if (!copyright && advertiserIds.length) {
    const owner = database()
      .prepare(`SELECT copyright_owner FROM oceanengine_advertisers WHERE advertiser_id = ?`)
      .get(advertiserIds[0])
    copyright = normalizeCopyright(owner && owner.copyright_owner)
  }
  return {
    id: task.id,
    strategyId: Number(snapshot.strategyId) || Number(template.strategyId) || 0,
    strategyName: task.strategy_name || template.name || '',
    bookName,
    copyright,
    tiers,
    advertiserIds,
    platformId: String(snapshot.platformId || '').trim(),
    platformName,
    videoIds,
    titleLibraryId: Number(snapshot.titleLibraryId) || Number(template.titleLibraryId) || 0,
    productMode: snapshot.productMode === 'fresh' ? 'fresh' : 'reuse',
  }
}

function trailingProductNo(name) {
  const match = String(name || '').match(/-(\d+)$/)
  return match ? Number(match[1]) : 0
}

function productSpanText(plan, bookName) {
  const source = plan || {}
  const book = String(source.bookName || bookName || '').trim()
  const names = Array.isArray(source.names) ? source.names : []
  const first = String(source.firstName || names[0] || '')
  const last = String(source.lastName || (names.length ? names[names.length - 1] : '') || '')
  const nameFrom = trailingProductNo(first)
  const nameTo = trailingProductNo(last)
  let from = Number(source.from) || nameFrom
  let to = Number(source.to) || nameTo
  if (nameFrom && (!from || nameFrom < from)) from = nameFrom
  if (nameTo && (!to || nameTo > to)) to = nameTo
  if (book && from && to) return from === to ? `${book}-${from}` : `${book}-${from}～${to}`
  if (first && last) return first === last ? first : `${first}～${last}`
  return first
}

function libraryNameOf(platformId) {
  const id = String(platformId || '').trim()
  if (!id) return ''
  const row = database().prepare(`SELECT name FROM oceanengine_libraries WHERE platform_id = ?`).get(id)
  return String((row && row.name) || '').trim()
}

function rememberProductUse(taskId, snapshotText) {
  const snap = typeof snapshotText === 'string' ? parsePayload(snapshotText) : snapshotText || {}
  const plan = snap.productPlan || {}
  const library = libraryNameOf(snap.platformId || plan.platformId)
  const span = productSpanText(plan, snap.bookName)
  database()
    .prepare(`UPDATE oceanengine_launch_tasks SET product_library = ?, product_span = ? WHERE id = ?`)
    .run(library, span, taskId)
  return { library, span }
}

function backfillProductUse() {
  const rows = database()
    .prepare(`SELECT id, snapshot FROM oceanengine_launch_tasks WHERE product_library = '' AND product_span = '' AND snapshot != ''`)
    .all()
  for (const row of rows) rememberProductUse(row.id, row.snapshot)
}

function buildTaskName(bookName) {
  return String(bookName || '').trim().slice(0, 40) || '未命名书'
}

function backfillTaskNames() {
  const rows = database()
    .prepare(
      `SELECT id, name, snapshot FROM oceanengine_launch_tasks
       WHERE name = '' OR name GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'`,
    )
    .all()
  if (!rows.length) return
  const update = database().prepare(`UPDATE oceanengine_launch_tasks SET name = ? WHERE id = ?`)
  for (const row of rows) {
    const snap = parsePayload(row.snapshot)
    const name = buildTaskName(snap.bookName)
    if (name !== row.name) update.run(name, row.id)
  }
}

function listTasks(query) {
  backfillTaskNames()
  backfillProductUse()
  const pageSize = Math.min(100, Math.max(1, Number(query && query.pageSize) || 20))
  const page = Math.max(1, Number(query && query.page) || 1)
  const keyword = String((query && (query.keyword || query.q)) || '').trim()
  const where = []
  const args = []
  if (keyword) {
    where.push(`(name LIKE ? OR strategy_name LIKE ? OR created_at LIKE ? OR product_library LIKE ? OR product_span LIKE ? OR CAST(id AS TEXT) = ?)`)
    args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, keyword)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = Number(database().prepare(`SELECT COUNT(*) AS n FROM oceanengine_launch_tasks ${whereSql}`).get(...args).n) || 0
  const rows = database()
    .prepare(
      `SELECT id, name, status, added, failed, book_count, account_count, strategy_name, created_at, product_library, product_span
       FROM oceanengine_launch_tasks ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)
  const active = database()
    .prepare(
      `SELECT id, name, status, added, failed, book_count, account_count, strategy_name, created_at, product_library, product_span
       FROM oceanengine_launch_tasks
       WHERE status IN ('running', 'preparing', 'ready')
       ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'preparing' THEN 1 ELSE 2 END, id
       LIMIT 1`,
    )
    .get()
  return {
    list: rows.map(mapTask),
    total,
    page,
    pageSize,
    active: active ? mapTask(active) : null,
  }
}

function recentTask() {
  const task = database()
    .prepare(
      `SELECT id, name, status, added, failed, book_count, account_count, strategy_name, created_at, product_library, product_span
       FROM oceanengine_launch_tasks ORDER BY id DESC LIMIT 1`,
    )
    .get()
  if (!task) return null
  const items = database()
    .prepare(
      `SELECT * FROM oceanengine_launch_task_items WHERE task_id = ? ORDER BY id`,
    )
    .all(task.id)
    .map(mapTaskItem)
  return { ...mapTask(task), items }
}

let settled = false

function interruptedTasks() {
  const running = database()
    .prepare(`SELECT id, snapshot FROM oceanengine_launch_tasks WHERE status = 'running' ORDER BY id DESC`)
    .all()
  if (running.length) return [running[0]]
  const recent = database()
    .prepare(
      `SELECT id, snapshot FROM oceanengine_launch_tasks
       WHERE status = 'fail' AND added = 0 AND failed = 0
         AND created_at >= datetime('now', '-15 minutes')
       ORDER BY id DESC LIMIT 1`,
    )
    .get()
  if (!recent) return []
  const counts = database()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS other
       FROM oceanengine_launch_task_items WHERE task_id = ?`,
    )
    .get(recent.id)
  if (!counts || !Number(counts.pending) || Number(counts.other)) return []
  return [recent]
}

function settleInterrupted() {
  if (settled) return
  settled = true
  try {
    const active = database()
      .prepare(
        `SELECT id, status, snapshot FROM oceanengine_launch_tasks
         WHERE status IN ('running', 'preparing', 'ready', 'queued')
         ORDER BY id`,
      )
      .all()
    for (const task of active) {
      const snapshot = parsePayload(task.snapshot)
      const template = snapshot.template ? normalizeTemplate(snapshot.template) : null
      if (!template) {
        finishTask(task.id, 'fail')
        continue
      }
      if (task.status === 'preparing' || (task.status === 'running' && pendingProductNames(task.id).length)) {
        if (task.status !== 'preparing') {
          database()
            .prepare(`UPDATE oceanengine_launch_tasks SET status = 'preparing', updated_at = datetime('now') WHERE id = ?`)
            .run(task.id)
        }
        console.log('[oceanengine] launch resume products', { taskId: task.id })
        startProduct(task.id)
        continue
      }
      if (task.status === 'running') {
        console.log('[oceanengine] launch resume plans', { taskId: task.id })
        startPlans(task.id)
      }
    }
    kickQueues()
  } catch (e) {
    settled = false
    console.error('[oceanengine] launch settle', e.message)
  }
}

async function options() {
  settleInterrupted()
  migrateStrategies()
  const accounts = loadAccounts()
  const books = searchBooks('')
  let libraries = loadLibraries()
  try {
    const remote = await products.refreshLibraries()
    if (remote && remote.length) {
      libraries = sortLaunchLibraries(products.withLaunchFlags(remote).filter((item) => item.launch).map(mapLaunchLibrary))
    }
  } catch (e) {
    console.error('[oceanengine] launch libraries', e.message)
  }
  const taskPage = listTasks({ page: 1, pageSize: 20 })
  return {
    accounts,
    copyrights: orderCopyrights([
      '点众',
      '番茄',
      ...accounts.map((item) => item.copyrightOwner),
      ...books.flatMap((item) => item.copyrights || []),
    ]),
    tiers: LAUNCH_TIERS.slice(),
    bidStrategies: bids.list(),
    strategies: listStrategies(),
    titleLibraries: titles.listLibraries(),
    books,
    libraries,
    tasks: taskPage.list,
    taskTotal: taskPage.total,
  }
}

function uniqueIds(raw, limit) {
  const ids = []
  const seen = new Set()
  for (const value of Array.isArray(raw) ? raw : []) {
    const id = idText(value)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (limit && ids.length >= limit) break
  }
  return ids
}

function pickFetchedVideos(list, rawIds) {
  const all = Array.isArray(list) ? list : []
  if (!Array.isArray(rawIds)) return { videos: all, notice: '' }
  const wanted = uniqueIds(rawIds, VIDEO_LIMIT_MAX)
  if (!wanted.length) return { videos: [], notice: '没有勾选要投放的线上视频' }
  const byId = new Map(all.map((item) => [idText(item.videoId), item]).filter((row) => row[0]))
  const videos = wanted.map((id) => byId.get(id)).filter(Boolean)
  if (!videos.length) return { videos: [], notice: '勾选的线上视频已经不在素材库里，请重新对照' }
  if (videos.length < wanted.length) {
    return { videos, notice: `有 ${wanted.length - videos.length} 条勾选的视频已经不在线上素材库` }
  }
  return { videos, notice: '' }
}

async function preview(input) {
  migrateStrategies()
  const strategy = getStrategy(Number(input && input.strategyId))
  const template = strategy || { ...defaultTemplate(), name: '' }
  const bookName = String((input && input.bookName) || '').trim()
  if (!bookName) return { error: '请选择要投的书' }
  const copyright = normalizeCopyright((input && input.copyrightOwner) || '')
  const bidPlan = bids.resolve(template.bidStrategyId)
  const tierAllow = bids.tierKeys(bidPlan)
  const allPromos = loadPromosByBook(bookName, tierAllow).filter((item) => !copyright || item.copyright === copyright)
  if (!allPromos.length) {
    return { error: copyright ? `没有《${bookName}》在「${copyright}」的推广链接` : `没有《${bookName}》的推广链接` }
  }
  const availableTiers = sortTiers(allPromos.map((item) => item.tier), tierAllow)
  const requested = sortTiers(input && input.tiers, tierAllow)
  const selectedTiers = (requested.length ? requested : availableTiers).filter((item) => availableTiers.includes(item))
  if (!selectedTiers.length) return { error: '请勾选要投的档位' }
  const promos = allPromos.filter((item) => selectedTiers.includes(item.tier))
  const pool = loadAccounts().filter((item) => {
    if (!accountMatchesCopyright(item, copyright)) return false
    return selectedTiers.includes(item.tier)
  })
  if (!pool.length) return { error: copyright ? `没有「${copyright}」同档位的在投账户` : '没有同档位的在投账户' }
  const suggested = sortAccounts(pool).slice(0, ACCOUNT_LIMIT)
  const hasPick = Array.isArray(input && input.advertiserIds)
  const requestedIds = hasPick ? uniqueIds(input.advertiserIds, ACCOUNT_LIMIT) : []
  const pickedAccounts = hasPick
    ? requestedIds.map((id) => pool.find((item) => idText(item.advertiserId) === id)).filter(Boolean)
    : suggested
  const fetched = await fetchBookVideos(bookName)
  const videoPick = pickFetchedVideos(fetched.videos || [], input && input.videoIds)
  const materials = videoPick.videos
  const titleLibraryId = Number(input && input.titleLibraryId) || Number(template.titleLibraryId) || 0
  const usableLibraries = titles.listLibraries().filter((item) => item.usable || item.titleCount > 0)
  let titleLibrary = null
  if (titleLibraryId) {
    titleLibrary = titles.getLibrary(titleLibraryId)
    if (strategy && !titleLibrary) return { error: '策略绑定的标题包不存在' }
    if (strategy && titleLibrary && !titleLibrary.titleCount) return { error: '策略绑定的标题包里没有可用标题' }
  } else if (usableLibraries.length) {
    titleLibrary = titles.getLibrary(usableLibraries[0].id) || usableLibraries[0]
  }
  const libraries = loadLibraries()
  const platformId = String((input && input.platformId) || '').trim()
  return buildPreview({
    bookName,
    promos,
    accounts: pool,
    accountTotal: pool.length,
    selectedTiers,
    availableTiers,
    template,
    materials,
    materialPool: (fetched.videos || []).length || materials.length,
    ambiguous: fetched.ambiguous || [],
    extra: {
      skipTitles: Boolean(titleLibrary),
      titleLibraryId: titleLibrary ? titleLibrary.id : 0,
      titleLibraryName: titleLibrary ? titleLibrary.name : '',
      videoSource: fetched.source || 'online',
      videoNotice: videoPick.notice || fetched.notice || '',
      pickedIds: pickedAccounts.map((item) => idText(item.advertiserId)).filter(Boolean),
      suggestedIds: suggested.map((item) => idText(item.advertiserId)).filter(Boolean),
      platformId,
      productMode: productModeOf(input),
      libraries,
      strategyId: strategy ? strategy.id : 0,
      copyrightOwner: copyright,
    },
  })
}

function fatalOcean(message) {
  return /授权|access_token|无权限|权限不足/i.test(String(message || ''))
}

async function oceanSend(token, method, path, { query, body } = {}) {
  const url = new URL(API + path)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue
      url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
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
      signal: AbortSignal.timeout(30000),
    })
  } catch (e) {
    return { error: `巨量接口请求失败：${e.message || e}` }
  }
  let json
  try {
    json = parseOceanBody(await res.text())
  } catch {
    return { error: `巨量返回不是 JSON（HTTP ${res.status}）` }
  }
  if (!json || json.code !== 0) {
    const code = json && json.code
    return {
      error: (json && (json.message || json.msg)) || `巨量接口失败（code=${code}）`,
      code,
      data: json && json.data,
    }
  }
  return { data: json.data != null ? json.data : {} }
}

function mapOnlineVideo(row) {
  const filename = String((row && (row.material_name || row.filename || row.name || row.title)) || '').trim()
  const videoId = idText((row && (row.video_id || row.videoId || row.id)) || '')
  if (!filename || !videoId || /^https?:/i.test(videoId)) return null
  return {
    filename,
    videoId,
    materialId: idText((row && (row.material_id || row.materialId)) || ''),
    posterUrl: String((row && (row.poster_url || row.posterUrl || row.url)) || '').trim(),
    width: Number((row && row.width) || 0),
    height: Number((row && row.height) || 0),
    duration: Number((row && row.duration) || 0),
  }
}

const videoCache = new Map()
const VIDEO_CACHE_TTL = 3 * 60 * 1000

async function fetchBookVideos(bookName) {
  const name = String(bookName || '').trim()
  const empty = { videos: [], source: 'online', notice: '' }
  if (!name) return empty
  const cached = videoCache.get(name)
  if (cached && Date.now() - cached.at < VIDEO_CACHE_TTL) return cached.data
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return { videos: [], source: 'online', notice: `没连上巨量线上素材：${tokenResult.error}` }
  const orgId = String(tokenResult.accountId || '').trim()
  if (!orgId) return { videos: [], source: 'online', notice: '没有工作台组织 ID，拉不到线上素材' }
  const online = []
  const seen = new Set()
  let page = 1
  let totalPage = 1
  while (page <= totalPage && page <= 8 && online.length < VIDEO_LIMIT_MAX) {
    const result = await oceanSend(tokenResult.token, 'GET', EBP_MATERIAL_LIST, {
      query: {
        account_id: orgId,
        material_range: 'all',
        filtering: { material_name: name },
        page,
        page_size: 50,
      },
    })
    if (result.error) {
      return {
        videos: [],
        source: 'online',
        notice: `线上素材拉取失败：${result.error}`,
      }
    }
    const data = result.data || {}
    const nested = data.data && typeof data.data === 'object' ? data.data : data
    const list = nested.videos || nested.list || data.videos || data.list || []
    for (const row of list) {
      const mapped = mapOnlineVideo(row)
      if (!mapped || seen.has(mapped.videoId)) continue
      seen.add(mapped.videoId)
      online.push(mapped)
      if (online.length >= VIDEO_LIMIT_MAX) break
    }
    const info = nested.page_info || nested.pageInfo || data.page_info || data.pageInfo || {}
    totalPage = Number(info.total_page || info.totalPage || 1) || 1
    if (!list.length) break
    page += 1
  }
  const assigned = assignVideos([name], online)
  let videos = assigned.byBook.get(name) || []
  let notice = ''
  if (!videos.length && online.length) {
    videos = online.slice(0, VIDEO_LIMIT_MAX)
    notice = `线上按「${name}」搜到 ${online.length} 条，文件名不完全等于书名，请核对后再搭建。`
  }
  const data = { videos, source: 'online', notice, ambiguous: assigned.ambiguous }
  videoCache.set(name, { at: Date.now(), data })
  return data
}

async function oceanSendRetry(token, method, path, options) {
  let last = { error: '巨量接口失败' }
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    await waitPathSlot(path)
    last = await oceanSend(token, method, path, options)
    if (!last.error) {
      notePathOk(path)
      return last
    }
    if (!rateLimited(last) || attempt === CREATE_ATTEMPTS - 1) return last
    notePathLimit(path, last.code)
    await sleep(Math.min(5000, 500 * (attempt + 1) + (last.code === 40100 ? 1500 : 0)))
  }
  return last
}

function targetMini(template) {
  return {
    appId: String((template && template.microAppId) || '').trim(),
    name: String((template && template.microAppName) || '').trim(),
  }
}

function matchesMini(rowAppId, rowName, appId, appName) {
  const id = String(appId || '').trim()
  const name = String(appName || '').trim()
  const rid = String(rowAppId || '').trim()
  const rname = String(rowName || '')
  if (id && rid && id === rid) return true
  if (name && rname && (rname === name || rname.includes(name))) return true
  return false
}

function pickAsset(list, appId, appName) {
  const rows = Array.isArray(list) ? list : []
  return (
    rows.find((item) => item.assetId && matchesMini(item.microAppId, item.name, appId, appName)) ||
    null
  )
}

function hasEvent(list, kind) {
  return (list || []).some((item) => {
    if (kind === 'roi') return item.eventType === 'purchase_roi' || String(item.name || '').includes('ROI')
    return item.eventType === 'active_pay' || item.name === '付费'
  })
}

async function findMiniInstance(token, advertiserId, appId, appName) {
  for (const searchType of ['SHARE_ONLY', 'CREATE_ONLY']) {
    const result = await oceanSendRetry(token, 'GET', MICRO_APP_LIST, {
      query: {
        advertiser_id: advertiserId,
        filtering: { audit_status: 'AUDIT_ACCEPTED', search_type: searchType },
        page: 1,
        page_size: 100,
      },
    })
    if (result.error) continue
    const list = (result.data && (result.data.list || result.data.micro_app_list)) || []
    const found = list.find((row) => {
      const rowAppId = String((row && (row.app_id || row.micro_app_id)) || '')
      const name = String((row && (row.name || row.micro_app_name || row.remark)) || '')
      return matchesMini(rowAppId, name, appId, appName)
    })
    const instanceId = idText(found && (found.instance_id || found.micro_app_instance_id))
    if (instanceId) return { instanceId, appId: String((found && (found.app_id || found.micro_app_id)) || appId) }
  }
  return null
}

function uniqueCopyrights(accounts) {
  return [...new Set((accounts || []).map((item) => String(item.copyrightOwner || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'zh'),
  )
}

function sampleAccounts(list, limit = 10) {
  const rows = Array.isArray(list) ? list : []
  if (rows.length <= limit) return rows
  const picked = []
  const seen = new Set()
  const take = (index) => {
    const i = Math.max(0, Math.min(rows.length - 1, Number(index) || 0))
    if (seen.has(i)) return
    seen.add(i)
    picked.push(rows[i])
  }
  const byCopyright = new Map()
  rows.forEach((item, index) => {
    const key = String(item.copyrightOwner || '').trim()
    if (!byCopyright.has(key)) byCopyright.set(key, index)
  })
  for (const index of byCopyright.values()) take(index)
  take(0)
  take(rows.length - 1)
  const step = Math.max(1, Math.floor(rows.length / limit))
  for (let i = 0; i < rows.length && picked.length < limit; i += step) take(i)
  return picked
}

async function listMiniApps() {
  const accounts = loadAccounts()
  const map = new Map()
  const add = (appId, name) => {
    const id = String(appId || '').trim()
    if (!id) return
    const label = String(name || '').trim()
    const current = map.get(id)
    if (!current) map.set(id, { appId: id, name: label || id })
    else if (label && (!current.name || current.name === current.appId)) current.name = label
  }
  try {
    const tokenResult = await auth.getAccessToken()
    if (!tokenResult.error && tokenResult.token) {
      const listed = await Promise.all(sampleAccounts(accounts).map((account) => events.listByteMiniApps(tokenResult.token, account.advertiserId)))
      for (const result of listed) {
        if (result.error) continue
        for (const item of result.list || []) add(item.appId, item.name)
      }
    }
  } catch (e) {
    console.error('[oceanengine] list mini apps', e.message)
  }
  return {
    list: [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh')),
    copyrights: uniqueCopyrights(accounts),
  }
}

const siteCache = new Map()
const readyCache = new Map()
const taskPhases = new Map()
const awemeCache = new Map()

function noteTaskPhase(taskId, phase, done, total) {
  taskPhases.set(Number(taskId), { phase, done, total, at: Date.now() })
}

function taskPhase(taskId) {
  return taskPhases.get(Number(taskId)) || null
}

async function siteForAccount(token, advertiserId) {
  const hit = siteCache.get(advertiserId)
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.value
  const found = await sites.listCreatedSites(token, advertiserId)
  const value = found.error
    ? { advertiserId, total: 0, sites: [], error: found.error }
    : { advertiserId, total: found.total, sites: found.list, error: '' }
  if (!value.error) siteCache.set(advertiserId, { at: Date.now(), value })
  return value
}

function wantsAweme(template) {
  return !template || template.nativeType !== 'ACCOUNT'
}

function awemePrefer(template) {
  return {
    id: idText(template && template.awemeId),
    name: String((template && template.awemeName) || '').trim(),
  }
}

function awemeIdOf(row) {
  return idText((row && (row.aweme_id || row.awemeId)) || '')
}

function awemeNameOf(row) {
  return String((row && (row.aweme_name || row.awemeName)) || '').trim()
}

function awemeRows(data) {
  if (!data) return []
  if (Array.isArray(data.list)) return data.list
  if (Array.isArray(data.aweme_auth_list)) return data.aweme_auth_list
  return []
}

function authorizedAwemePool(rows) {
  const authorized = (rows || []).filter((row) => {
    const status = String((row && (row.auth_status || row.authStatus)) || '').toUpperCase()
    return status === 'AUTHRIZED' || status === 'AUTHORIZED'
  })
  const accounts = authorized.filter((row) => {
    const type = String((row && (row.auth_type || row.authType)) || '').toUpperCase()
    return !type || type === 'AWEME_ACCOUNT'
  })
  const pool = accounts.length ? accounts : authorized
  const unique = []
  const seen = new Set()
  for (const row of pool) {
    const id = awemeIdOf(row)
    if (!id || seen.has(id)) continue
    seen.add(id)
    unique.push(row)
  }
  return unique
}

function pickAweme(rows, prefer) {
  const pool = authorizedAwemePool(rows)
  const preferId = idText(prefer && prefer.id)
  if (preferId) {
    const hit = pool.find((row) => awemeIdOf(row) === preferId)
    if (hit) return hit
  }
  if (pool.length === 1) return pool[0]
  const name = String((prefer && prefer.name) || '').trim()
  if (name) return pool.find((row) => awemeNameOf(row).includes(name)) || null
  return null
}

function awemeNameList(rows) {
  const names = []
  const seen = new Set()
  for (const row of rows || []) {
    const name = awemeNameOf(row)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= 5) break
  }
  return names.join('、')
}

function awemeSampleAccount() {
  const latest = database().prepare(`SELECT id FROM oceanengine_launch_tasks ORDER BY id DESC LIMIT 1`).get()
  if (latest) {
    const row = database()
      .prepare(
        `SELECT advertiser_id, account_name
         FROM oceanengine_launch_task_items
         WHERE task_id = ? AND advertiser_id != ''
         ORDER BY id
         LIMIT 1`,
      )
      .get(latest.id)
    if (row && row.advertiser_id) {
      return { advertiserId: idText(row.advertiser_id), name: row.account_name || idText(row.advertiser_id) }
    }
  }
  const account = loadAccounts()[0]
  if (!account) return null
  return { advertiserId: account.advertiserId, name: account.name || account.advertiserId }
}

async function fetchAwemeRows(token, advertiserId, send = oceanSend) {
  const listed = await send(token, 'GET', AWEME_AUTH_LIST, {
    query: {
      advertiser_id: advertiserId,
      filtering: { auth_status: ['AUTHRIZED'], auth_type: ['AWEME_ACCOUNT'] },
      page: 1,
      page_size: 100,
    },
  })
  let rows = listed.error ? [] : awemeRows(listed.data)
  if (rows.length) return { rows, error: '' }
  const fallback = await send(token, 'GET', AWEME_AUTH_LIST, {
    query: { advertiser_id: advertiserId, page: 1, page_size: 100 },
  })
  if (!fallback.error) return { rows: awemeRows(fallback.data), error: '' }
  return { rows: [], error: listed.error || fallback.error }
}

async function listAwemes() {
  const account = awemeSampleAccount()
  if (!account) return { list: [], accountName: '', advertiserId: '', error: '还没有在用的投放账户' }
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) {
    return { list: [], accountName: account.name, advertiserId: account.advertiserId, error: tokenResult.error }
  }
  const fetched = await fetchAwemeRows(tokenResult.token, account.advertiserId)
  const list = authorizedAwemePool(fetched.rows).map((row) => ({
    awemeId: awemeIdOf(row),
    awemeName: awemeNameOf(row),
  }))
  return {
    list,
    accountName: account.name,
    advertiserId: account.advertiserId,
    error: list.length ? '' : fetched.error || `投放户「${account.name}」没有已授权的抖音号`,
  }
}

async function awemeForAccount(token, advertiserId, template) {
  const prefer = awemePrefer(template)
  const cacheKey = `${advertiserId}|${prefer.id}|${prefer.name}`
  const hit = awemeCache.get(cacheKey)
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.value
  const fetched = await fetchAwemeRows(token, advertiserId, oceanSendRetry)
  const rows = fetched.rows
  if (!rows.length && fetched.error) return { error: fetched.error }
  const picked = pickAweme(rows, prefer)
  if (!picked) {
    const names = awemeNameList(authorizedAwemePool(rows))
    const wanted = prefer.name || prefer.id
    if (names && wanted) return { error: `这个户的抖音号是「${names}」，和策略里的「${wanted}」不一致` }
    if (names) return { error: `这个户有多个抖音号（${names}），请在策略里选择要用的那个` }
    return { error: wanted ? `这个户没有已授权的抖音号「${wanted}」` : '这个户没有已授权的抖音号' }
  }
  const value = {
    error: '',
    awemeId: idText(picked.aweme_id || picked.awemeId),
    awemeName: String(picked.aweme_name || picked.awemeName || '').trim(),
  }
  if (!value.awemeId) return { error: '这个户的抖音号授权里没有抖音号 ID' }
  awemeCache.set(cacheKey, { at: Date.now(), value })
  return value
}

async function accountReady(token, account, template, siteMap) {
  const mini = targetMini(template)
  const base = { advertiserId: account.advertiserId, accountName: account.name || account.advertiserId }
  if (!mini.appId) return { ...base, error: '请先在策略里选择投放载体' }
  const cacheKey = `${account.advertiserId}|${mini.appId}|${template.goal || ''}`
  const cached = readyCache.get(cacheKey)
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.ready
  const sitePromise = siteMap && siteMap.has(account.advertiserId)
    ? Promise.resolve(siteMap.get(account.advertiserId))
    : siteForAccount(token, account.advertiserId)
  const awemePromise = wantsAweme(template)
    ? awemeForAccount(token, account.advertiserId, template)
    : Promise.resolve({ error: '', awemeId: '', awemeName: '' })
  const [site, assets, aweme] = await Promise.all([
    sitePromise,
    events.listMiniProgramAssets(account.advertiserId),
    awemePromise,
  ])
  if (assets.error) return { ...base, error: assets.error }
  const asset = pickAsset(assets.list, mini.appId, mini.name)
  if (!asset) return { ...base, error: `这个户还没有「${mini.name}」事件资产` }
  const created = await events.listCreatedEvents(account.advertiserId, asset.assetId)
  if (created.error) return { ...base, error: created.error }
  if (!hasEvent(created.list, 'pay')) return { ...base, error: '这个户还没有付费事件' }
  if (template.goal === '付费ROI' && !hasEvent(created.list, 'roi')) return { ...base, error: '这个户还没有付费ROI事件' }
  if (site && site.error) return { ...base, error: site.error }
  const page = site && site.sites && site.sites[0]
  if (!page || !page.pageUrl) return { ...base, error: '这个户还没有落地页' }
  let instanceId = asset.microAppInstanceId || ''
  let appId = asset.microAppId || mini.appId
  if (!instanceId) {
    const found = await findMiniInstance(token, account.advertiserId, mini.appId, mini.name)
    if (!found) return { ...base, error: `这个户还没有已过审的「${mini.name}」` }
    instanceId = found.instanceId
    appId = found.appId || appId
  }
  if (wantsAweme(template) && aweme.error) return { ...base, error: aweme.error }
  const ready = {
    ...base,
    error: '',
    assetId: asset.assetId,
    instanceId,
    appId,
    siteUrl: page.pageUrl,
    awemeId: aweme.awemeId,
    awemeName: aweme.awemeName || '',
  }
  readyCache.set(cacheKey, { at: Date.now(), ready })
  return ready
}

async function downloadBytes(url) {
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch (e) {
    return { error: `下载封面失败：${e.message || e}` }
  }
  if (!res.ok) return { error: '下载封面失败' }
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length < 32) return { error: '封面是空的' }
  return { buffer, mime: res.headers.get('content-type') || 'image/jpeg' }
}

async function uploadImage(token, advertiserId, buffer, filename, mime) {
  let last = { error: '上传封面失败' }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitPathSlot(IMAGE_UPLOAD)
    const form = new FormData()
    form.append('advertiser_id', advertiserId)
    form.append('upload_type', 'UPLOAD_BY_FILE')
    form.append('image_signature', crypto.createHash('md5').update(buffer).digest('hex'))
    form.append('filename', filename)
    form.append('image_file', new Blob([buffer], { type: mime || 'image/jpeg' }), filename)
    let res
    try {
      res = await fetch(API + IMAGE_UPLOAD, {
        method: 'POST',
        headers: { 'Access-Token': token },
        body: form,
        signal: AbortSignal.timeout(30000),
      })
    } catch (e) {
      last = { error: `上传封面失败：${e.message || e}` }
      if (attempt === 3) return last
      continue
    }
    let json
    try {
      json = parseOceanBody(await res.text())
    } catch {
      return { error: `上传封面失败（HTTP ${res.status}）` }
    }
    if (!json || json.code !== 0) {
      last = { error: (json && (json.message || json.msg)) || '上传封面失败', code: json && json.code }
      if (!rateLimited(last) || attempt === 3) return last
      notePathLimit(IMAGE_UPLOAD, last.code)
      continue
    }
    notePathOk(IMAGE_UPLOAD)
    const imageId = idText((json.data && (json.data.id || json.data.image_id)) || '')
    if (!imageId) return { error: '封面已上传，但没有图片 ID' }
    return { imageId }
  }
  return last
}

async function videoCover(token, advertiserId, video) {
  const found = await oceanSendRetry(token, 'GET', VIDEO_GET, {
    query: {
      advertiser_id: advertiserId,
      filtering: { video_ids: [video.videoId] },
      page: 1,
      page_size: 1,
    },
  })
  if (found.error) return { error: found.error }
  const row = ((found.data && found.data.list) || [])[0]
  if (!row) return { error: '这个户的素材库里没有这条视频' }
  const poster = String(row.poster_url || row.posterUrl || '').trim()
  if (!poster) return { error: '视频没有封面' }
  const file = await downloadBytes(poster)
  if (file.error) return file
  const uploaded = await uploadImage(token, advertiserId, file.buffer, 'cover.jpg', file.mime)
  if (uploaded.error) return uploaded
  const width = Number(row.width) || 0
  const height = Number(row.height) || 0
  const vertical = !(width && height) || height >= width
  return {
    videoId: video.videoId,
    coverId: uploaded.imageId,
    imageMode: vertical ? 'CREATIVE_IMAGE_MODE_VIDEO_VERTICAL' : 'CREATIVE_IMAGE_MODE_VIDEO',
  }
}

const PRODUCT_IMAGE_COUNT = 10
const accountImageCache = new Map()

function shuffleRows(rows) {
  const copy = rows.slice()
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = copy[i]
    copy[i] = copy[j]
    copy[j] = current
  }
  return copy
}

async function listAccountImages(token, advertiserId, filtering) {
  const listed = await oceanSendRetry(token, 'GET', IMAGE_GET, {
    query: {
      advertiser_id: advertiserId,
      ...(filtering ? { filtering } : {}),
      page: 1,
      page_size: 20,
    },
  })
  if (listed.error) return []
  const data = listed.data || {}
  return data.list || data.images || []
}

async function productImages(token, advertiserId) {
  const cached = accountImageCache.get(advertiserId)
  if (cached) return cached
  let rows = await listAccountImages(token, advertiserId, { width: 108, height: 108 })
  if (!rows.length) {
    const all = await listAccountImages(token, advertiserId)
    rows = all.filter((row) => {
      const width = Number(row && row.width) || 0
      const height = Number(row && row.height) || 0
      return width >= 108 && width === height
    })
  }
  const imageIds = []
  const seen = new Set()
  for (const row of shuffleRows(rows)) {
    const id = idText(row && (row.id || row.image_id))
    if (!id || seen.has(id)) continue
    seen.add(id)
    imageIds.push(id)
    if (imageIds.length >= PRODUCT_IMAGE_COUNT) break
  }
  const result = { imageIds, error: '' }
  accountImageCache.set(advertiserId, result)
  return result
}

function hardMaterialReject(message) {
  return /极端相似|不支持投放|审核不通过|已删除不可修改|检测结果未过|视频不存在|视频不可用/.test(String(message || ''))
}

function namedMaterialIds(message) {
  const ids = new Set()
  const text = String(message || '')
  const re = /\d{16,20}/g
  let match = re.exec(text)
  while (match) {
    ids.add(match[0])
    match = re.exec(text)
  }
  return ids
}

function rejectedVideoIds(result, videos) {
  const named = namedMaterialIds(result && result.error)
  if (!named.size) return []
  const found = []
  for (const item of videos || []) {
    const videoId = String(item.video_id || '')
    const materialId = String(item.material_id || '')
    if (!videoId) continue
    if (named.has(materialId) || named.has(videoId)) found.push(videoId)
  }
  return found
}

function oceanVideos(videos) {
  return (videos || []).map((item) => ({
    video_id: item.video_id,
    image_mode: item.image_mode || videoImageMode(item.width, item.height),
  }))
}

function videoImageMode(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (w && h && w > h) return 'CREATIVE_IMAGE_MODE_VIDEO'
  return 'CREATIVE_IMAGE_MODE_VIDEO_VERTICAL'
}

async function lookupVideoSize(token, advertiserId, videoId) {
  const found = await oceanSendRetry(token, 'GET', VIDEO_GET, {
    query: {
      advertiser_id: advertiserId,
      filtering: { video_ids: [videoId] },
      page: 1,
      page_size: 1,
    },
  })
  const row = found && found.data && ((found.data.list || [])[0])
  return {
    width: Number(row && row.width) || 0,
    height: Number(row && row.height) || 0,
  }
}

function stamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function launchName(bookName, mark, tail) {
  const extra = `${mark}${tail || ''}`
  const room = Math.max(1, 50 - extra.length)
  return `${String(bookName || '').slice(0, room)}${extra}`
}

function stdProjectBody({ account, book, template, ready, name, videos, imageIds, adTitles }) {
  const deep = template.goal === '付费ROI'
  const titleList = Array.isArray(adTitles) && adTitles.length ? adTitles : titleLines(template.titles)
  const productImageIds = (Array.isArray(imageIds) ? imageIds : []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, PRODUCT_IMAGE_COUNT)
  const materials = {
    video_material_list: videos,
    title_material_list: titleList.map((title) => ({ title })),
    call_to_action_buttons: template.callToActions || phraseLines(template.callToAction, CTA_LIMIT),
    external_url_material_list: [ready.siteUrl],
    mini_program_info: {
      app_id: ready.appId || template.microAppId,
      start_path: book.promo.page,
      ...(book.promo.query ? { params: book.promo.query } : {}),
    },
    product_info: {
      titles: [productTitle(template, book)],
      selling_points: template.sellingPoints || phraseLines(template.sellingPoint, POINT_LIMIT),
      ...(productImageIds.length ? { image_ids: productImageIds } : {}),
    },
    source: adSource(template),
  }
  const body = {
    advertiser_id: account.advertiserId,
    name,
    ad_type: template.adType || 'ALL',
    landing_type: template.landingType || 'MICRO_GAME',
    marketing_goal: template.marketingGoal || 'VIDEO_AND_IMAGE',
    delivery_medium: template.deliveryMedium || 'BYTE_APP',
    delivery_mode: template.deliveryMode || 'PROCEDURAL',
    delivery_type: template.deliveryType || 'NORMAL',
    product_platform_id: book.product.platformId,
    product_id: book.product.productId,
    external_action: 'AD_CONVERT_TYPE_PAY',
    asset_id: ready.assetId,
    instance_id: ready.instanceId,
    schedule_type: template.scheduleType || 'SCHEDULE_FROM_NOW',
    bid_type: template.bidType || 'CUSTOM',
    budget_mode: template.budgetMode || 'BUDGET_MODE_DAY',
    budget: Math.max(Number(template.budget) || 300, 300),
    inventory_catalog: template.inventoryCatalog || 'UNIVERSAL_SMART',
    audience_type: template.audienceType || 'UNLIMITED',
    district: template.district || 'NONE',
    pricing: template.pricing || 'PRICING_OCPM',
    native_type: wantsAweme(template) && ready.awemeId ? 'AWEME' : 'ACCOUNT',
    ...(wantsAweme(template) && ready.awemeId ? { aweme_id: ready.awemeId } : {}),
    is_comment_disable: template.comment === 'ON' ? 'ON' : 'OFF',
    source: adSource(template),
    project_materials: materials,
  }
  const cpaBid = Number(account.bid) || bidOfTier(account.tier) || 0
  const roiGoal = Number(template.roiGoal != null ? template.roiGoal : template.bid) || 1.28
  if (cpaBid) body.cpa_bid = cpaBid
  if (deep) {
    body.deep_external_action = 'AD_CONVERT_TYPE_PURCHASE_ROI'
    body.deep_bid_type = 'ROI_COEFFICIENT'
    body.roi_goal = roiGoal
  }
  if (template.hideIfConverted && template.hideIfConverted !== 'NO_EXCLUDE') {
    body.hide_if_converted = template.hideIfConverted
  }
  if (template.hideIfExists && template.hideIfExists !== 'UNLIMITED') {
    body.hide_if_exists = template.hideIfExists
  }
  if (template.aigc === 'ON') body.aigc_dynamic_creative_switch = 'ON'
  if (template.audienceType === 'CUSTOM') {
    body.audience = {
      gender: template.gender || 'GENDER_UNLIMITED',
      district: template.district || 'NONE',
    }
    if (template.age && template.age.length) body.audience.age = template.age
  }
  if (book.promo && book.promo.monitor) body.action_track_url = [book.promo.monitor]
  return body
}

function projectBody(account, book, template, ready, name) {
  const optimize = {
    asset_ids: [ready.assetId],
    external_action: 'AD_CONVERT_TYPE_PAY',
  }
  const delivery = {
    schedule_type: 'SCHEDULE_FROM_NOW',
    bid_type: 'CUSTOM',
    budget_mode: 'BUDGET_MODE_DAY',
    budget: template.budget,
    pricing: 'PRICING_OCPM',
  }
  const cpaBid = Number(account.bid) || bidOfTier(account.tier) || 0
  if (cpaBid) delivery.cpa_bid = cpaBid
  if (template.goal === '付费ROI') {
    optimize.deep_external_action = 'AD_CONVERT_TYPE_PURCHASE_ROI'
    delivery.deep_bid_type = 'ROI_COEFFICIENT'
    delivery.roi_goal = Number(template.roiGoal != null ? template.roiGoal : template.bid) || 1.28
  }
  const body = {
    advertiser_id: account.advertiserId,
    name,
    operation: 'DISABLE',
    landing_type: 'MICRO_GAME',
    marketing_goal: 'VIDEO_AND_IMAGE',
    ad_type: 'ALL',
    delivery_mode: 'MANUAL',
    micro_promotion_type: 'BYTE_APP',
    micro_app_instance_id: ready.instanceId,
    optimize_goal: optimize,
    delivery_range: { inventory_catalog: 'UNIVERSAL_SMART' },
    delivery_setting: delivery,
    audience: { district: 'NONE' },
    related_product: {
      product_setting: 'SINGLE',
      product_platform_id: book.product.platformId,
      product_id: book.product.productId,
    },
  }
  if (book.promo && book.promo.monitor) body.track_url_setting = { action_track_url: [book.promo.monitor] }
  return body
}

function promotionBody({ account, projectId, book, template, videos, ready, imageId, name }) {
  const materials = {
    video_material_list: videos,
    title_material_list: titleLines(template.titles).map((title) => ({ title })),
    call_to_action_buttons: template.callToActions || phraseLines(template.callToAction, CTA_LIMIT),
    external_url_material_list: [ready.siteUrl],
    mini_program_info: {
      app_id: ready.appId || template.microAppId,
      start_path: book.promo.page,
      ...(book.promo.query ? { params: book.promo.query } : {}),
    },
  }
  if (imageId) {
    materials.product_info = {
      titles: [productTitle(template, book)],
      image_ids: [imageId],
      selling_points: template.sellingPoints || phraseLines(template.sellingPoint, POINT_LIMIT),
    }
  }
  return {
    advertiser_id: account.advertiserId,
    project_id: projectId,
    name,
    operation: 'DISABLE',
    source: template.source || template.microAppName,
    promotion_materials: materials,
  }
}

function jobPayload(account, book) {
  return JSON.stringify({
    advertiserId: account.advertiserId,
    accountName: account.name || account.advertiserId,
    tier: account.tier || '',
    bid: Number(account.bid) || bidOfTier(account.tier) || 0,
    book,
  })
}

function parsePayload(text) {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return {}
  }
}

function openTask(userId, accounts, books, strategyName, snapshot, taskStatus = 'queued') {
  const status = taskStatus === 'running' ? 'running' : 'queued'
  const inserted = database()
    .prepare(
      `INSERT INTO oceanengine_launch_tasks (
         user_id, status, book_count, account_count, strategy_name, snapshot, added, failed, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))`,
    )
    .run(Number(userId) || 0, status, books.length, accounts.length, strategyName || '', snapshot || '')
  const id = Number(inserted.lastInsertRowid)
  const row = database().prepare(`SELECT created_at, snapshot FROM oceanengine_launch_tasks WHERE id = ?`).get(id)
  const snap = parsePayload(row && row.snapshot)
  const name = buildTaskName(snap.bookName)
  database().prepare(`UPDATE oceanengine_launch_tasks SET name = ? WHERE id = ?`).run(name, id)
  rememberProductUse(id, snap)
  return id
}

function refreshCounts(taskId) {
  const counts = database()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'added' THEN 1 ELSE 0 END) AS added,
         SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) AS failed
       FROM oceanengine_launch_task_items WHERE task_id = ?`,
    )
    .get(taskId)
  database()
    .prepare(`UPDATE oceanengine_launch_tasks SET added = ?, failed = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(Number(counts && counts.added) || 0, Number(counts && counts.failed) || 0, taskId)
}

function writeItem(taskId, item, options) {
  const isFail = item.status === 'fail'
  const classified = isFail ? classifyError({ error: item.message, code: item.errorCode }, item.message) : null
  const payload = item.payload || ''
  const promoPath = item.promoPath || ''
  const materialCount = Number(item.materialCount) || 0
  const message = String((classified && classified.message) || item.message || '').slice(0, 500)
  const errorCode = isFail ? (classified && classified.code) || item.errorCode || '' : ''
  const errorKind = isFail ? (classified && classified.kind) || '' : ''
  const retryable = isFail ? (classified ? classified.retryable : 1) : 0
  if (item.id) {
    database()
      .prepare(
        `UPDATE oceanengine_launch_task_items SET
           project_id = ?, promotion_id = ?, promo_path = ?, material_count = ?, status = ?, message = ?,
           payload = CASE WHEN ? != '' THEN ? ELSE payload END,
           error_code = ?, error_kind = ?, retryable = ?
         WHERE id = ?`,
      )
      .run(
        item.projectId || '',
        item.promotionId || '',
        promoPath,
        materialCount,
        item.status || 'fail',
        message,
        payload,
        payload,
        errorCode,
        errorKind,
        retryable,
        item.id,
      )
  } else {
    const inserted = database()
      .prepare(
        `INSERT INTO oceanengine_launch_task_items (
           task_id, advertiser_id, account_name, book_name, project_id, promotion_id, promo_path, material_count,
           status, message, payload, error_code, error_kind, retryable, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        taskId,
        item.advertiserId || '',
        item.accountName || '',
        item.bookName || '',
        item.projectId || '',
        item.promotionId || '',
        promoPath,
        materialCount,
        item.status || 'fail',
        message,
        payload,
        errorCode,
        errorKind,
        retryable,
      )
    item.id = Number(inserted.lastInsertRowid)
  }
  if (!options || !options.skipRefresh) refreshCounts(taskId)
  return item.id
}

function launchBook(book) {
  const materials = Array.isArray(book && book.materials)
    ? book.materials.map((item) => ({
        videoId: item.videoId || '',
        materialId: item.materialId || '',
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
      }))
    : []
  return {
    name: book && book.name,
    bookName: (book && (book.bookName || book.name)) || '',
    promo: (book && book.promo) || null,
    product: (book && book.product) || null,
    materials,
    materialCount: materials.length,
  }
}

function seedJobs(taskId, specs) {
  const tx = database().transaction((list) => {
    for (const spec of list) writeItem(taskId, spec, { skipRefresh: true })
  })
  tx(specs)
  refreshCounts(taskId)
}

function finishTask(taskId, status) {
  database()
    .prepare(`UPDATE oceanengine_launch_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, taskId)
  if (status === 'running' || status === 'queued' || status === 'preparing' || status === 'ready') return
  kickQueues()
}

function loadTaskSnapshot(taskId) {
  const row = database().prepare(`SELECT snapshot FROM oceanengine_launch_tasks WHERE id = ?`).get(taskId)
  return parsePayload(row && row.snapshot)
}

function taskById(id) {
  const taskId = Number(id) || 0
  const task = database()
    .prepare(
      `SELECT id, name, status, added, failed, book_count, account_count, strategy_name, created_at, product_library, product_span
       FROM oceanengine_launch_tasks WHERE id = ?`,
    )
    .get(taskId)
  if (!task) return null
  const items = database()
    .prepare(`SELECT * FROM oceanengine_launch_task_items WHERE task_id = ? ORDER BY id`)
    .all(taskId)
    .map(mapTaskItem)
  const failItems = items.filter((row) => row.status === 'fail')
  const kinds = {}
  for (const row of failItems) {
    const key = row.errorKind || 'rejected'
    kinds[key] = (kinds[key] || 0) + 1
  }
  return {
    ...mapTask(task),
    total: items.length,
    pending: items.filter((row) => row.status === 'pending').length,
    failKinds: kinds,
    preparingProducts: items.some((row) => row.status === 'pending' && row.message === '正在创建商品'),
    phase: (taskPhase(task.id) && taskPhase(task.id).phase) || '',
    phaseDone: (taskPhase(task.id) && taskPhase(task.id).done) || 0,
    phaseTotal: (taskPhase(task.id) && taskPhase(task.id).total) || 0,
    items,
  }
}

function seedJob(taskId, account, book, status, extra) {
  const classified = status === 'fail' ? classifyError({ error: extra && extra.message }, extra && extra.message) : null
  return writeItem(taskId, {
    advertiserId: account.advertiserId,
    accountName: account.name,
    bookName: book.name,
    promoPath: (book.promo && (book.promo.referralId || book.promo.path)) || '',
    materialCount: (book.materials && book.materials.length) || 0,
    status,
    message: (classified && classified.message) || (extra && extra.message) || '',
    payload: jobPayload(account, launchBook(book)),
    errorCode: classified && classified.code,
    errorKind: classified && classified.kind,
    retryable: classified ? classified.retryable : 0,
  })
}

async function executePending(taskId, template, token) {
  const rows = database()
    .prepare(`SELECT * FROM oceanengine_launch_task_items WHERE task_id = ? AND status = 'pending' ORDER BY id`)
    .all(taskId)
  if (!rows.length) return
  const jobs = rows.map((row) => {
    const payload = parsePayload(row.payload)
    const account = {
      advertiserId: payload.advertiserId || row.advertiser_id,
      name: payload.accountName || row.account_name,
      tier: payload.tier || accountService.parseUsage(payload.accountName || row.account_name).template,
      bid: payload.bid || bidOfTier(payload.tier),
    }
    return { row, account, book: payload.book || { name: row.book_name, materials: [] } }
  })
  const accounts = []
  const seen = new Set()
  for (const job of jobs) {
    if (seen.has(job.account.advertiserId)) continue
    seen.add(job.account.advertiserId)
    accounts.push(job.account)
  }
  let stopped = ''
  const jobsByAccount = new Map()
  for (const job of jobs) {
    const list = jobsByAccount.get(job.account.advertiserId) || []
    list.push(job)
    jobsByAccount.set(job.account.advertiserId, list)
  }
  const snapshot = loadTaskSnapshot(taskId)
  const advertiserCool = new Map()
  let prepared = 0
  let createdCount = 0
  let loggedFails = 0
  noteTaskPhase(taskId, 'prepare', 0, accounts.length)
  console.log('[oceanengine] launch start', { taskId, accounts: accounts.length, jobs: jobs.length })
  const blockedVideos = new Set()
  const modeByVideo = new Map()
  const missingSize = []
  for (const job of jobs) {
    for (const material of (job.book && job.book.materials) || []) {
      const videoId = material.videoId
      if (!videoId || modeByVideo.has(videoId) || missingSize.includes(videoId)) continue
      if (Number(material.width) && Number(material.height)) modeByVideo.set(videoId, videoImageMode(material.width, material.height))
      else missingSize.push(videoId)
    }
  }
  if (missingSize.length && accounts[0]) {
    await mapPool(missingSize, 4, async (videoId) => {
      const size = await lookupVideoSize(token, accounts[0].advertiserId, videoId)
      modeByVideo.set(videoId, videoImageMode(size.width, size.height))
    })
  }
  async function runJob(job, ready, image) {
    const { row, account, book } = job
    const base = {
      id: row.id,
      advertiserId: account.advertiserId,
      accountName: account.name,
      bookName: book.name,
      promoPath: (book.promo && (book.promo.referralId || book.promo.path)) || row.promo_path || '',
      materialCount: (book.materials && book.materials.length) || Number(row.material_count) || 0,
      payload: row.payload,
    }
    if (taskStopped(taskId)) {
      writeItem(taskId, { ...base, status: 'fail', message: '已手动停止' })
      return
    }
    if (stopped) {
      writeItem(taskId, { ...base, status: 'fail', message: stopped })
      return
    }
    const coolUntil = advertiserCool.get(account.advertiserId) || 0
    if (coolUntil > Date.now()) await sleep(coolUntil - Date.now())
    if (!ready || ready.error) {
      writeItem(taskId, { ...base, status: 'fail', message: (ready && ready.error) || '账户还没准备好' })
      return
    }
    const allVideos = (book.materials || []).map((material) => ({
      video_id: material.videoId,
      material_id: material.materialId || '',
      width: Number(material.width) || 0,
      height: Number(material.height) || 0,
      image_mode: modeByVideo.get(material.videoId) || videoImageMode(material.width, material.height),
    })).filter((item) => item.video_id)
    const skipped = allVideos.filter((item) => blockedVideos.has(item.video_id)).length
    let videos = allVideos.filter((item) => !blockedVideos.has(item.video_id))
    let adTitles = titleLines(template.titles)
    let titleNote = ''
    if (snapshot.titleLibraryId) {
      const picked = titles.pickFromLibrary(snapshot.titleLibraryId)
      if (picked.error) {
        writeItem(taskId, { ...base, status: 'fail', message: picked.error })
        return
      }
      adTitles = picked.titles
      titleNote = picked.groupName ? ` · ${picked.groupName}` : ''
    }
    if (!adTitles.length) {
      writeItem(taskId, { ...base, status: 'fail', message: '没有可用标题' })
      return
    }
    const cpaBid = Number(account.bid) || bidOfTier(account.tier)
    if (!cpaBid) {
      writeItem(taskId, { ...base, status: 'fail', message: '这个户没有对应档位的出价' })
      return
    }
    if (!book.promo || !book.promo.page) {
      writeItem(taskId, { ...base, status: 'fail', message: '没有对上档位的推广链接' })
      return
    }
    if (!book.product || !book.product.productId) {
      writeItem(taskId, { ...base, status: 'fail', message: '商品还没准备好' })
      return
    }
    let dropped = 0
    let createdProject = null
    for (let round = 0; round < 5; round += 1) {
      if (taskStopped(taskId)) {
        writeItem(taskId, { ...base, status: 'fail', message: '已手动停止' })
        return
      }
      if (!videos.length) {
        writeItem(taskId, { ...base, status: 'fail', message: '素材都没通过，没有可提交的视频' })
        return
      }
      createdProject = await oceanSendRetry(token, 'POST', PROJECT_CREATE, {
        body: stdProjectBody({
          account,
          book,
          template,
          ready,
          name: projectName({
            account,
            bookName: book.bookName || book.name,
            pattern: template.namePattern,
          }),
          videos: oceanVideos(videos),
          imageIds: (image && image.imageIds) || [],
          adTitles,
        }),
      })
      if (!createdProject.error) break
      const bad = rejectedVideoIds(createdProject, videos)
      if (!hardMaterialReject(createdProject.error) || !bad.length) {
        if (loggedFails < 5) {
          loggedFails += 1
          console.log('[oceanengine] launch reject', {
            taskId,
            advertiserId: account.advertiserId,
            code: createdProject.code || '',
            error: createdProject.error,
          })
        }
        if (fatalOcean(createdProject.error)) stopped = createdProject.error
        if (createdProject.code === 40130) advertiserCool.set(account.advertiserId, Date.now() + 1600)
        writeItem(taskId, { ...base, status: 'fail', message: createdProject.error, errorCode: createdProject.code })
        return
      }
      for (const id of bad) blockedVideos.add(id)
      const next = videos.filter((item) => !bad.includes(item.video_id))
      dropped += videos.length - next.length
      videos = next
    }
    if (!createdProject || createdProject.error) {
      writeItem(taskId, { ...base, status: 'fail', message: (createdProject && createdProject.error) || '创建失败' })
      return
    }
    const projectId = idText(createdProject.data && createdProject.data.project_id)
    createdCount += 1
    if (createdCount === 1 || createdCount % 25 === 0) {
      console.log('[oceanengine] launch project', { taskId, projectId, done: createdCount })
    }
    const opened = await oceanSendRetry(token, 'POST', PROJECT_STATUS, {
      body: {
        advertiser_id: account.advertiserId,
        data: [{ project_id: projectId, opt_status: 'ENABLE' }],
      },
    })
    writeItem(taskId, {
      ...base,
      projectId,
      status: 'added',
      message: (opened.error ? `已创建，开启失败：${opened.error}` : '已创建并开启')
        + (account.tier ? ` · ${account.tier}档出价${cpaBid}` : '')
        + (book.product && book.product.name ? ` · ${book.product.name}` : '')
        + (ready.awemeName ? ` · 抖音号${ready.awemeName}` : '')
        + (image && image.imageIds && image.imageIds.length ? ` · 产品图${image.imageIds.length}张` : '')
        + (dropped ? ` · 剔除${dropped}条不可投素材后再提交` : '')
        + (skipped ? ` · 跳过${skipped}条已确认不可投素材` : '')
        + titleNote,
    })
  }
  await mapPool(accounts, ACCOUNT_CONCURRENCY, async (account) => {
    const mine = jobsByAccount.get(account.advertiserId) || []
    if (taskStopped(taskId)) {
      for (const job of mine) await runJob(job, null, null)
      return
    }
    let ready = { advertiserId: account.advertiserId, error: stopped || '账户还没准备好' }
    let image = { imageIds: [] }
    if (!stopped) {
      try {
        const pair = await Promise.all([
          accountReady(token, account, template, null),
          productImages(token, account.advertiserId).catch((e) => {
            console.error('[oceanengine] launch image', e.message)
            return { error: e.message || '产品图没有传上巨量', imageIds: [] }
          }),
        ])
        ready = pair[0]
        image = pair[1] || { imageIds: [] }
      } catch (e) {
        ready = { advertiserId: account.advertiserId, error: e.message || '账户核对失败' }
      }
      if (ready.error && fatalOcean(ready.error)) stopped = ready.error
    }
    prepared += 1
    noteTaskPhase(taskId, 'prepare', prepared, accounts.length)
    for (const job of jobsByAccount.get(account.advertiserId) || []) {
      await runJob(job, ready, image)
    }
  })
}

async function runPending(taskId, template, token) {
  try {
    await executePending(taskId, template, token)
    if (taskStopped(taskId)) {
      markStopped(taskId)
      finishTask(taskId, 'stopped')
      stopFlags.delete(Number(taskId))
      console.log('[oceanengine] launch stopped', { taskId })
      return
    }
    const autoIds = database()
      .prepare(
        `SELECT id FROM oceanengine_launch_task_items
         WHERE task_id = ? AND status = 'fail' AND error_kind IN ('rate_limit', 'network')`,
      )
      .all(taskId)
      .map((row) => row.id)
    if (autoIds.length) {
      database()
        .prepare(
          `UPDATE oceanengine_launch_task_items
           SET status = 'pending', message = '自动重试中', error_code = '', error_kind = '', retryable = 1
           WHERE task_id = ? AND id IN (${autoIds.map(() => '?').join(',')})`,
        )
        .run(taskId, ...autoIds)
      refreshCounts(taskId)
      await executePending(taskId, template, token)
    }
    const leftover = database()
      .prepare(`SELECT id FROM oceanengine_launch_task_items WHERE task_id = ? AND status = 'pending'`)
      .all(taskId)
    for (const row of leftover) {
      writeItem(taskId, { id: row.id, status: 'fail', message: '任务结束时仍未创建成功' })
    }
    const counts = database()
      .prepare(`SELECT added, failed FROM oceanengine_launch_tasks WHERE id = ?`)
      .get(taskId)
    if (taskStopped(taskId)) {
      markStopped(taskId)
      finishTask(taskId, 'stopped')
      stopFlags.delete(Number(taskId))
      console.log('[oceanengine] launch stopped', { taskId })
      return
    }
    const added = Number(counts && counts.added) || 0
    const failed = Number(counts && counts.failed) || 0
    finishTask(taskId, added && failed ? 'partial' : added ? 'done' : 'fail')
    console.log('[oceanengine] launch', { taskId, added, failed, autoRetry: autoIds.length })
  } catch (e) {
    if (taskStopped(taskId)) {
      markStopped(taskId)
      finishTask(taskId, 'stopped')
      return
    }
    console.error('[oceanengine] launch', e.message)
    finishTask(taskId, 'fail')
  }
}

const stopFlags = new Set()
const stopControllers = new Map()
const productWorkers = new Set()
const planWorkers = new Set()

function taskStopped(taskId) {
  return stopFlags.has(Number(taskId))
}

function markStopped(taskId) {
  database()
    .prepare(
      `UPDATE oceanengine_launch_task_items
       SET status = 'fail', message = '已手动停止', error_code = '', error_kind = 'stopped', retryable = 0
       WHERE task_id = ? AND status = 'pending'`,
    )
    .run(taskId)
  refreshCounts(taskId)
}

function stopTask(taskId) {
  const id = Number(taskId) || 0
  const task = database().prepare('SELECT id, status FROM oceanengine_launch_tasks WHERE id = ?').get(id)
  if (!task) return { error: '没有这批投放' }
  if (!['queued', 'preparing', 'ready', 'running'].includes(task.status)) return { error: '这批已经结束' }
  stopFlags.add(id)
  const ctrl = stopControllers.get(id)
  if (ctrl) ctrl.abort()
  const released = task.status === 'running' || task.status === 'preparing'
  productWorkers.delete(id)
  planWorkers.delete(id)
  markStopped(id)
  finishTask(id, 'stopped')
  console.log('[oceanengine] launch stop', { taskId: id, was: task.status })
  return { id, status: 'stopped', released }
}

function watchStall(id) {
  return setInterval(() => {
    if (taskStopped(id)) return
    const phase = taskPhase(id)
    const beat = phase && phase.at ? phase.at : 0
    if (!beat || Date.now() - beat < 3 * 60 * 1000) return
    console.error('[oceanengine] launch stall', { taskId: id, phase: phase && phase.phase, done: phase && phase.done })
    stopTask(id)
  }, 15000)
}

function kickProductQueue() {
  while (productWorkers.size < PRODUCT_PREP_LIMIT) {
    const next = database()
      .prepare(`SELECT id FROM oceanengine_launch_tasks WHERE status = 'queued' ORDER BY id LIMIT 1`)
      .get()
    if (!next) return
    const changed = database()
      .prepare(`UPDATE oceanengine_launch_tasks SET status = 'preparing', updated_at = datetime('now') WHERE id = ? AND status = 'queued'`)
      .run(next.id)
    if (!changed.changes) continue
    console.log('[oceanengine] launch products start', { taskId: next.id })
    startProduct(next.id)
  }
}

function kickPlanQueue() {
  if (planWorkers.size) return
  const running = database()
    .prepare(`SELECT id FROM oceanengine_launch_tasks WHERE status = 'running' ORDER BY id LIMIT 1`)
    .get()
  if (running) {
    if (productWorkers.has(running.id)) return
    if (!planWorkers.has(running.id)) {
      console.log('[oceanengine] launch plans resume', { taskId: running.id })
      startPlans(running.id)
    }
    return
  }
  const next = database()
    .prepare(`SELECT id FROM oceanengine_launch_tasks WHERE status = 'ready' ORDER BY id LIMIT 1`)
    .get()
  if (!next || productWorkers.has(next.id)) return
  const changed = database()
    .prepare(`UPDATE oceanengine_launch_tasks SET status = 'running', updated_at = datetime('now') WHERE id = ? AND status = 'ready'`)
    .run(next.id)
  if (!changed.changes) return
  console.log('[oceanengine] launch plans start', { taskId: next.id })
  startPlans(next.id)
}

function kickQueues() {
  kickProductQueue()
  kickPlanQueue()
}

setInterval(() => {
  try {
    kickQueues()
  } catch (e) {
    console.error('[oceanengine] launch queue', e.message)
  }
}, 5000).unref()

function markReady(taskId) {
  const changed = database()
    .prepare(`UPDATE oceanengine_launch_tasks SET status = 'ready', updated_at = datetime('now') WHERE id = ? AND status = 'preparing'`)
    .run(taskId)
  if (!changed.changes) return
  console.log('[oceanengine] launch products ready', { taskId })
}

function pendingRows(taskId) {
  return database()
    .prepare(
      `SELECT id, payload, promo_path, material_count
       FROM oceanengine_launch_task_items WHERE task_id = ? AND status = 'pending' ORDER BY id`,
    )
    .all(taskId)
}

function plannedProduct(row) {
  const payload = parsePayload(row && row.payload)
  const book = payload.book || {}
  return { payload, book, product: book.product || {} }
}

function pendingProductNames(taskId) {
  const names = []
  for (const row of pendingRows(taskId)) {
    const { product } = plannedProduct(row)
    if (!product.productId && product.name) names.push(product.name)
  }
  return names
}

function markPreparingProducts(taskId) {
  const ids = []
  for (const row of pendingRows(taskId)) {
    const { product } = plannedProduct(row)
    if (!product.productId && product.name) ids.push(row.id)
  }
  if (!ids.length) return 0
  database()
    .prepare(`UPDATE oceanengine_launch_task_items SET message = '正在创建商品' WHERE id IN (${ids.map(() => '?').join(',')})`)
    .run(...ids)
  return ids.length
}

function failUnbound(taskId, message) {
  for (const row of pendingRows(taskId)) {
    const { product } = plannedProduct(row)
    if (product.productId) continue
    writeItem(taskId, {
      id: row.id,
      status: 'fail',
      message: message || '商品没有创建成功',
      promoPath: row.promo_path,
      materialCount: row.material_count,
      payload: row.payload,
    })
  }
}

function bindReadyProducts(taskId, readyProducts, errors) {
  const byName = new Map()
  for (const item of readyProducts || []) {
    if (item && item.name && item.productId) byName.set(item.name, item)
  }
  const errorByName = new Map()
  for (const item of errors || []) {
    if (item && item.name) errorByName.set(item.name, item.error || '商品没有创建成功')
  }
  const update = database().prepare(
    `UPDATE oceanengine_launch_task_items SET payload = ?, book_name = ?, message = '' WHERE id = ?`,
  )
  for (const row of pendingRows(taskId)) {
    const { payload, book, product } = plannedProduct(row)
    if (product.productId) continue
    const ready = byName.get(product.name)
    if (!ready) {
      writeItem(taskId, {
        id: row.id,
        status: 'fail',
        message: errorByName.get(product.name) || '商品没有创建成功',
        promoPath: row.promo_path,
        materialCount: row.material_count,
        payload: row.payload,
      })
      continue
    }
    book.name = ready.name
    book.product = compactProduct(ready)
    payload.book = book
    update.run(JSON.stringify(payload), ready.name, row.id)
  }
}

function loadTaskTemplate(taskId) {
  const snapshot = loadTaskSnapshot(taskId)
  const template = snapshot.template ? normalizeTemplate(snapshot.template) : null
  return { snapshot, template }
}

function startProduct(taskId) {
  const id = Number(taskId) || 0
  if (!id || productWorkers.has(id) || planWorkers.has(id)) return
  stopFlags.delete(id)
  productWorkers.add(id)
  const { template } = loadTaskTemplate(id)
  if (!template) {
    productWorkers.delete(id)
    finishTask(id, 'fail')
    return
  }
  auth.getAccessToken().then((tokenResult) => {
    if (tokenResult.error) {
      productWorkers.delete(id)
      console.error('[oceanengine] launch products', tokenResult.error)
      finishTask(id, 'fail')
      return
    }
    prepareProducts(id, tokenResult.token, tokenResult.accountId || '').catch((e) => {
      console.error('[oceanengine] launch products', e.message)
      finishTask(id, 'fail')
    })
  }).catch((e) => {
    productWorkers.delete(id)
    console.error('[oceanengine] launch products', e.message)
    finishTask(id, 'fail')
  })
}

function startPlans(taskId) {
  const id = Number(taskId) || 0
  if (!id || planWorkers.has(id)) return
  stopFlags.delete(id)
  planWorkers.add(id)
  const { template } = loadTaskTemplate(id)
  if (!template) {
    planWorkers.delete(id)
    finishTask(id, 'fail')
    return
  }
  auth.getAccessToken().then((tokenResult) => {
    if (tokenResult.error) {
      planWorkers.delete(id)
      console.error('[oceanengine] launch plans', tokenResult.error)
      finishTask(id, 'fail')
      return
    }
    runPlans(id, template, tokenResult.token).catch((e) => {
      console.error('[oceanengine] launch plans', e.message)
      finishTask(id, 'fail')
    })
  }).catch((e) => {
    planWorkers.delete(id)
    console.error('[oceanengine] launch plans', e.message)
    finishTask(id, 'fail')
  })
}

async function prepareProducts(taskId, token, accountId) {
  const id = Number(taskId)
  const ctrl = new AbortController()
  stopControllers.set(id, ctrl)
  const stallTimer = watchStall(id)
  try {
    if (taskStopped(id)) {
      markStopped(id)
      finishTask(id, 'stopped')
      return
    }
    const names = [...new Set(pendingProductNames(taskId))]
    noteTaskPhase(id, 'products', 0, names.length)
    if (names.length) {
      const snapshot = loadTaskSnapshot(taskId)
      const created = await products.createNamedProducts({
        platformId: snapshot.platformId,
        bookName: snapshot.bookName,
        names,
        copyrightOwner: snapshot.copyrightOwner || '',
        token,
        accountId: accountId || '',
        signal: ctrl.signal,
        shouldStop: () => taskStopped(id),
        onProgress: (done, total) => noteTaskPhase(taskId, 'products', done, total),
      })
      if (taskStopped(id) || created.stopped) {
        markStopped(id)
        finishTask(id, 'stopped')
        return
      }
      if (created.error) failUnbound(taskId, created.error)
      else bindReadyProducts(taskId, created.products || [], created.errors || [])
    }
    if (taskStopped(id)) {
      markStopped(id)
      finishTask(id, 'stopped')
      return
    }
    if (!pendingRows(id).length) {
      const counts = database().prepare(`SELECT added, failed FROM oceanengine_launch_tasks WHERE id = ?`).get(id)
      const added = Number(counts && counts.added) || 0
      const failed = Number(counts && counts.failed) || 0
      finishTask(id, added && failed ? 'partial' : added ? 'done' : 'fail')
      return
    }
    markReady(id)
  } catch (e) {
    console.error('[oceanengine] launch products', e.message)
    if (taskStopped(id)) {
      markStopped(id)
      finishTask(id, 'stopped')
      return
    }
    failUnbound(taskId, e.message || '准备商品失败')
    for (const row of pendingRows(taskId)) {
      writeItem(taskId, {
        id: row.id,
        status: 'fail',
        message: e.message || '准备商品失败',
        promoPath: row.promo_path,
        materialCount: row.material_count,
        payload: row.payload,
      })
    }
    finishTask(taskId, 'fail')
  } finally {
    clearInterval(stallTimer)
    stopControllers.delete(id)
    productWorkers.delete(id)
    stopFlags.delete(id)
    kickQueues()
  }
}

async function runPlans(taskId, template, token) {
  const id = Number(taskId)
  const ctrl = new AbortController()
  stopControllers.set(id, ctrl)
  const stallTimer = watchStall(id)
  try {
    if (taskStopped(id)) {
      markStopped(id)
      finishTask(id, 'stopped')
      return
    }
    noteTaskPhase(id, 'prepare', 0, 1)
    await runPending(taskId, template, token)
  } catch (e) {
    console.error('[oceanengine] launch plans', e.message)
    if (taskStopped(id)) {
      markStopped(id)
      finishTask(id, 'stopped')
      return
    }
    finishTask(id, 'fail')
  } finally {
    clearInterval(stallTimer)
    stopControllers.delete(id)
    planWorkers.delete(id)
    stopFlags.delete(id)
    kickQueues()
  }
}

async function submit(input, userId) {
  settleInterrupted()
  migrateStrategies()
  const strategy = getStrategy(Number(input && input.strategyId))
  if (!strategy) return { error: '请选择策略模板' }
  const platformId = String((input && input.platformId) || '').trim()
  if (!platformId) return { error: '请选择商品库' }
  const plan = await preview(input)
  if (plan.error) return plan
  const issues = (plan.templateMessages || []).filter((text) => text !== '还没选策略模板')
  if (issues.length) return { error: issues[0] }
  if (!plan.accounts.length) return { error: '请选择投放账户' }
  if (!plan.books.length) return { error: '没有可投放的书' }
  const readyBooks = plan.books.filter((row) => row.status !== 'block')
  const blockedBooks = plan.books.filter((row) => row.status === 'block')
  if (!readyBooks.length) {
    const blocked = blockedBooks[0]
    return { error: blocked ? `《${blocked.bookName || blocked.name}》${blocked.messages[0]}` : '对不上链接或视频' }
  }
  const readyAccounts = sortAccounts(plan.accounts).filter((account) => {
    const bid = Number(account.bid) || bidOfTier(account.tier)
    const promo = account.promo || matchPromo(readyBooks[0] && readyBooks[0].promoList, account)
    return Boolean(account.tier && promo && bid)
  })
  if (!readyAccounts.length) return { error: '勾选的户对不上推广链接或出价' }
  const template = normalizeTemplate(strategy)
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const mode = productModeOf(input)
  const jobs = []
  for (const account of sortAccounts(plan.accounts)) {
    const bid = Number(account.bid) || bidOfTier(account.tier)
    for (const book of blockedBooks) {
      jobs.push({
        account,
        book,
        status: 'fail',
        message: (book.messages && book.messages[0]) || '对不上链接或素材',
      })
    }
    for (const book of readyBooks) {
      const promo = account.promo || matchPromo(book.promoList, account)
      if (!account.tier) {
        jobs.push({ account, book, status: 'fail', message: '账户名里没有充值档位，对不上出价' })
        continue
      }
      if (!promo) {
        jobs.push({ account, book, status: 'fail', message: `这个户是 ${account.tier} 档，没有对应充值模板的链接` })
        continue
      }
      if (!bid) {
        jobs.push({ account, book, status: 'fail', message: `没有 ${account.tier} 档的出价规则` })
        continue
      }
      jobs.push({ account: { ...account, bid }, book: { ...book, promo }, status: 'pending' })
    }
  }
  const pendingJobs = jobs.filter((job) => job.status === 'pending')
  if (!pendingJobs.length) return { error: '勾选的户对不上推广链接或出价' }
  const assignment = products.assignLaunchProducts(platformId, plan.bookName, pendingJobs.length, mode)
  if (assignment.slots.length < pendingJobs.length) return { error: '商品编号不够分给这一批计划' }
  const libraryName = (plan.library && plan.library.name) || ''
  const snapshot = JSON.stringify({
    template,
    strategyId: strategy.id,
    bookName: plan.bookName,
    copyrightOwner: plan.copyrightOwner || (input && input.copyrightOwner) || '',
    platformId,
    titleLibraryId: plan.titleLibraryId || 0,
    productMode: assignment.mode,
    productPlan: presentProductPlan(assignment),
  })
  const taskId = openTask(userId, plan.accounts, plan.books, strategy.name || plan.strategyName, snapshot)
  const specs = []
  let slotIndex = 0
  for (const job of jobs) {
    if (job.status !== 'pending') {
      specs.push({
        advertiserId: job.account.advertiserId,
        accountName: job.account.name,
        bookName: job.book.name,
        promoPath: (job.book.promo && (job.book.promo.referralId || job.book.promo.path)) || '',
        materialCount: (job.book.materials && job.book.materials.length) || 0,
        status: 'fail',
        message: job.message,
        payload: jobPayload(job.account, launchBook(job.book)),
      })
      continue
    }
    const slot = assignment.slots[slotIndex] || null
    slotIndex += 1
    const product = slot && slot.productId
      ? compactProduct({ ...slot, platformName: slot.platformName || libraryName, status: '可投放' })
      : {
          productId: '',
          name: (slot && slot.name) || '',
          platformId,
          platformName: (slot && slot.platformName) || libraryName,
          status: '准备中',
        }
    const book = launchBook({ ...job.book, name: product.name || job.book.name, product })
    specs.push({
      advertiserId: job.account.advertiserId,
      accountName: job.account.name,
      bookName: book.name,
      promoPath: (book.promo && (book.promo.referralId || book.promo.path)) || '',
      materialCount: book.materialCount,
      status: 'pending',
      message: product.productId ? '' : '正在创建商品',
      payload: jobPayload({ ...job.account, bid: job.account.bid }, book),
    })
  }
  seedJobs(taskId, specs)
  const preparingProducts = pendingProductNames(taskId).length > 0
  kickQueues()
  const queuedRow = database().prepare('SELECT status FROM oceanengine_launch_tasks WHERE id = ?').get(taskId)
  const status = (queuedRow && queuedRow.status) || 'queued'
  return {
    id: taskId,
    status,
    queued: status === 'queued',
    jobs: plan.jobs,
    failJobs: plan.failJobs,
    preparingProducts,
    productMode: assignment.mode,
  }
}

function retry(input, userId) {
  settleInterrupted()
  migrateStrategies()
  const taskId = Number(input && input.taskId) || 0
  const task = database().prepare(`SELECT id, snapshot, status FROM oceanengine_launch_tasks WHERE id = ?`).get(taskId)
  if (!task) return { error: '没有这批投放' }
  if (['running', 'queued', 'preparing', 'ready'].includes(task.status)) return { error: '这批还在进行' }
  const snapshot = parsePayload(task.snapshot)
  const template = snapshot.template ? normalizeTemplate(snapshot.template) : null
  if (!template) return { error: '这批任务没有保存创建参数，请重新搭建' }
  const wanted = uniqueIds(input && input.itemIds, 4000)
  const failed = database()
    .prepare(`SELECT * FROM oceanengine_launch_task_items WHERE task_id = ? AND status = 'fail'`)
    .all(taskId)
  const picked = wanted.length ? failed.filter((row) => wanted.includes(String(row.id))) : failed
  if (!picked.length) return { error: '请选择要重试的失败记录' }
  const ready = picked.filter((row) => row.payload)
  if (!ready.length) return { error: '选中的记录没有足够信息重试，请重新搭建' }
  const ids = ready.map((row) => row.id)
  database()
    .prepare(
      `UPDATE oceanengine_launch_task_items
       SET status = 'pending', message = '排队中', project_id = '', error_code = '', error_kind = '', retryable = 1
       WHERE task_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    )
    .run(taskId, ...ids)
  const needsProducts = pendingProductNames(taskId).length > 0
  database()
    .prepare(`UPDATE oceanengine_launch_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(needsProducts ? 'queued' : 'ready', taskId)
  refreshCounts(taskId)
  if (needsProducts) markPreparingProducts(taskId)
  kickQueues()
  const queuedRow = database().prepare('SELECT status FROM oceanengine_launch_tasks WHERE id = ?').get(taskId)
  return {
    id: taskId,
    status: (queuedRow && queuedRow.status) || (needsProducts ? 'queued' : 'ready'),
    queued: !queuedRow || queuedRow.status === 'queued' || queuedRow.status === 'ready',
    jobs: ids.length,
    preparingProducts: needsProducts,
    userId: Number(userId) || 0,
  }
}

module.exports = {
  options,
  listMiniApps,
  listAwemes,
  preview,
  searchBooks,
  searchPromos,
  searchVideos,
  saveTemplate,
  listStrategies,
  getStrategy,
  createStrategy,
  updateStrategy,
  removeStrategy,
  submit,
  retry,
  stopTask,
  taskById,
  taskDraft,
  listTasks,
  parseBooks,
  pickProduct,
  pickPromo,
  assignVideos,
  compact,
  splitPlanName,
  projectName,
  normalizeTemplate,
  templateIssues,
  splitMiniPath,
  resumeInterrupted: settleInterrupted,
}
