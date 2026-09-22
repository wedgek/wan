/**
 * 抖音原链素材解析：先走免费 bugpk，仅 quality=original（或图集）才采用；
 * 失败 / 非原画由服务端付费 muzzz 兜底。付费 token 不离开本进程。
 * 移植自参考项目 douyin原链素材/backend/parser.py 的核心链路（聚合接口）。
 */
const douyinPaid = require('./douyinPaid')

const AGGREGATOR_API = process.env.DOUYIN_AGG_API || 'https://api.bugpk.com/api/douyin'
// 单次请求超时收敛到 12s：IPv4 直连正常 <3s，超过多半是抽风，早失败早重试早让出并发槽
const REQUEST_TIMEOUT_MS = Number(process.env.DOUYIN_TIMEOUT_MS) || 12000
const MAX_CONCURRENT = Number(process.env.DOUYIN_MAX_CONCURRENT) || 6
/**
 * bugpk 聚合接口会随机掐断连接/返回空体（实测单次失败率约 10~15%）。
 * 对这类“抽风”做有限次重试即可把成功率拉到接近 100%；总尝试 = 重试数 + 1。
 */
const MAX_RETRIES = Math.max(0, Number(process.env.DOUYIN_RETRIES) || 2)
const RETRY_BASE_MS = Number(process.env.DOUYIN_RETRY_BASE_MS) || 600

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const URL_PATTERN = /https?:\/\/(?:www\.|v\.)?(?:douyin\.com|iesdouyin\.com)\/[\w\-/?=&%.#]+/i
const URL_PATTERN_G = /https?:\/\/(?:www\.|v\.)?(?:douyin\.com|iesdouyin\.com)\/[\w\-/?=&%.#]+/gi
const AWEME_ID_PATTERN = /(?:\/video\/|\/note\/|\/share\/video\/|modal_id=)(\d{15,25})/

/** 批量拆分：多行 → 每行一个任务；单行含多个链接 → 按链接拆；否则整体一个任务。上限 50 条 */
function splitInputs(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  const lines = raw
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length > 1) return lines.slice(0, 50)
  const urls = raw.match(URL_PATTERN_G) || []
  if (urls.length > 1) return urls.slice(0, 50)
  return [raw]
}

/** 面向用户的可读解析错误；retryable=true 表示是聚合接口抽风、值得重试 */
class DouyinParseError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message)
    this.name = 'DouyinParseError'
    this.retryable = retryable
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 有限次重试：仅对可重试错误（网络抖动 / 非 DouyinParseError / retryable=true）重试，指数退避。
 * 素材本身解析不了（作品已删除/仅本人可见等）标记为不可重试，直接失败，不做无谓等待。
 */
async function withRetry(fn, ctx = '') {
  let lastErr
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const t0 = Date.now()
    try {
      return await fn(attempt)
    } catch (e) {
      lastErr = e
      const retryable = !(e instanceof DouyinParseError) || e.retryable
      const cost = Date.now() - t0
      // 每次尝试都打点：第几次/耗时/是否可重试/错因，方便线上 pm2 logs 直接定位病根
      console.warn(
        `[douyin] ${ctx} attempt#${attempt + 1}/${MAX_RETRIES + 1} ${cost}ms retryable=${retryable} err=${e && e.message}`,
      )
      if (!retryable || attempt === MAX_RETRIES) break
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt))
    }
  }
  throw lastErr
}

/* ============ 并发信号量：限制对第三方接口的同时出站请求数 ============ */
let activeCount = 0
const waiters = []

function acquireSlot() {
  if (activeCount < MAX_CONCURRENT) {
    activeCount += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => waiters.push(resolve))
}

function releaseSlot() {
  const next = waiters.shift()
  if (next) {
    next()
  } else {
    activeCount = Math.max(0, activeCount - 1)
  }
}

/* ============ 工具函数 ============ */

function extractUrl(text) {
  const m = URL_PATTERN.exec(String(text || ''))
  return m ? m[0] : ''
}

/** playwm 为带水印地址；统一走 https */
function cleanUrl(url) {
  return String(url || '')
    .replace('playwm', 'play')
    .replace('http://', 'https://')
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从输入（纯数字 ID / 长链 / 分享文案 / 短链）中解析出 aweme_id
 * @returns {Promise<{ awemeId: string, douyinUrl: string }>}
 */
async function resolveAwemeId(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new DouyinParseError('请输入抖音分享链接或文案')

  if (/^\d{15,25}$/.test(raw)) {
    return { awemeId: raw, douyinUrl: `https://www.douyin.com/video/${raw}` }
  }

  const directId = AWEME_ID_PATTERN.exec(raw)
  if (directId) {
    const url = extractUrl(raw) || `https://www.douyin.com/video/${directId[1]}`
    return { awemeId: directId[1], douyinUrl: url }
  }

  const url = extractUrl(raw)
  if (!url) throw new DouyinParseError('未能从输入中识别到抖音链接，请检查粘贴内容')

  const inUrlId = AWEME_ID_PATTERN.exec(url)
  if (inUrlId) return { awemeId: inUrlId[1], douyinUrl: url }

  // 短链（v.douyin.com）跟随重定向后再从最终 URL 提取 ID
  let finalUrl = url
  try {
    const resp = await fetchWithTimeout(url, {
      redirect: 'follow',
      headers: { 'User-Agent': DESKTOP_UA, Referer: 'https://www.douyin.com/' },
    })
    finalUrl = resp.url || url
  } catch (e) {
    throw new DouyinParseError('短链跳转失败，链接可能已失效')
  }
  const redirectedId = AWEME_ID_PATTERN.exec(finalUrl)
  if (redirectedId) return { awemeId: redirectedId[1], douyinUrl: finalUrl }

  throw new DouyinParseError('跳转后仍未能解析出作品 ID，链接可能已失效')
}

/**
 * 调用 bugpk 聚合接口
 * @returns {Promise<Record<string, any>>} data 节点
 */
async function fetchAggregator(awemeId) {
  const share = `https://www.douyin.com/video/${awemeId}`
  const target = `${AGGREGATOR_API}?url=${encodeURIComponent(share)}`
  let resp
  try {
    resp = await fetchWithTimeout(target, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': DESKTOP_UA,
        Referer: 'https://api.bugpk.com/doc-douyin.html',
      },
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw new DouyinParseError('解析超时，请稍后重试', { retryable: true })
    // 连接被掐断 / 网络抖动（bugpk 常见的 HTTP 000）：可重试。
    // 把底层原因打出来（ETIMEDOUT / ECONNRESET / ENETUNREACH 等），方便区分「本机网络」和「接口业务错误」。
    const cause = e && (e.cause || e)
    const detail = [e && e.message, cause && cause.code, cause && cause.message]
      .filter(Boolean)
      .join(' | ')
    console.warn(`[douyin] aggregator fetch failed aweme=${awemeId} detail=${detail || 'unknown'}`)
    throw new DouyinParseError('聚合接口请求失败，请稍后重试', { retryable: true })
  }
  const text = await resp.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {
    // 返回空体 / 非 JSON：多为抽风，可重试
    throw new DouyinParseError('聚合接口返回异常', { retryable: true })
  }
  if (!data || Number(data.code) !== 200 || !data.data) {
    // code!=200（含“详情接口返回空响应体”等）多为临时性，重试一般能成
    throw new DouyinParseError(`聚合接口返回异常：${(data && data.msg) || '无数据'}`, { retryable: true })
  }
  return data.data
}

/** 从 URL 参数里尝试抓取过期时间（unix 秒），命中返回本地时间字符串，否则 null */
function extractExpiresAt(url) {
  const s = String(url || '')
  if (!s) return null
  let query = ''
  try {
    query = new URL(s).search
  } catch (_) {
    const i = s.indexOf('?')
    query = i >= 0 ? s.slice(i) : ''
  }
  if (!query) return null
  const params = new URLSearchParams(query)
  const keys = ['expire', 'x-expires', 'expires', 'Expires', 'oe']
  for (const k of keys) {
    const v = params.get(k)
    if (!v) continue
    // 十六进制（如 oe）或十进制的 unix 秒
    let sec = /^[0-9]+$/.test(v) ? Number(v) : parseInt(v, 16)
    if (!Number.isFinite(sec) || sec <= 0) continue
    // 毫秒时间戳兜底
    if (sec > 1e12) sec = Math.floor(sec / 1000)
    if (sec < 1e9 || sec > 4e9) continue
    return formatLocal(new Date(sec * 1000))
  }
  return null
}

function formatLocal(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(
    date.getMinutes(),
  )}:${p(date.getSeconds())}`
}

/** 归一化聚合返回结果 */
function buildFromAggregator(awemeId, douyinUrl, data) {
  const author = data.author && typeof data.author === 'object' ? data.author.name || '' : data.author || ''
  const title = data.title || data.desc || ''
  const cover = data.cover || ''
  const type = String(data.type || '').toLowerCase()
  const rawImages = Array.isArray(data.images) ? data.images : []
  const images = rawImages
    .map((it) => (typeof it === 'string' ? it : it && it.url ? it.url : ''))
    .filter((u) => u && String(u).startsWith('http'))
    .map(cleanUrl)

  const isImages = type === 'images' || (images.length > 0 && !data.url)
  let bestUrl = ''
  if (!isImages) {
    const candidates = []
    if (data.url) candidates.push(data.url)
    if (Array.isArray(data.video_backup)) {
      for (const b of data.video_backup) {
        if (b && b.url) candidates.push(b.url)
      }
    }
    bestUrl = cleanUrl(candidates.find((u) => u && String(u).startsWith('http')) || '')
  }

  return {
    awemeId,
    douyinUrl,
    title: String(title || '').trim(),
    author: String(author || '').trim(),
    cover: String(cover || '').trim(),
    mediaType: isImages ? 'images' : 'video',
    isVideo: !isImages,
    resultUrl: bestUrl,
    images,
    quality: isImages ? '' : extractFreeQuality(data),
    source: 'aggregator',
    expiresAt: extractExpiresAt(bestUrl) || (images.length ? extractExpiresAt(images[0]) : null),
  }
}

/** 免费接口 quality 字段：data.quality，兼容一层嵌套；统一小写 */
function extractFreeQuality(data) {
  if (!data || typeof data !== 'object') return ''
  const raw = data.quality ?? data.Quality ?? (data.video && (data.video.quality || data.video.Quality))
  return String(raw || '').trim().toLowerCase()
}

function hasMeta(built) {
  return Boolean(built && (built.cover || built.title || built.author))
}

/**
 * 免费结果是否可直接采用：图集有图即可；视频必须 quality=original 且有地址。
 * 字段缺失一律当非原画。
 */
function isFreeResultAcceptable(built) {
  if (!built) return false
  if (built.mediaType === 'images' && Array.isArray(built.images) && built.images.length) return true
  return built.quality === 'original' && Boolean(built.resultUrl)
}

function formatFallbackMessage(reason, paidMsg) {
  const a = String(reason || '').trim()
  const b = String(paidMsg || '').trim()
  if (a && b) return `${a}，${b}`
  return b || a || '解析失败，请稍后重试'
}

/**
 * 付费兜底：原画优先，没有则取最高档。
 * @param {{ fallbackReason?: string, freeResult?: object }} [opts]
 */
async function parsePaidFallback(awemeId, douyinUrl, opts = {}) {
  const fallbackReason = String(opts.fallbackReason || '').trim()
  const freeResult = opts.freeResult || null
  if (!douyinPaid.isPaidConfigured()) {
    throw new DouyinParseError(formatFallbackMessage(fallbackReason, '未配置付费接口'))
  }
  const share = douyinUrl || (awemeId ? `https://www.douyin.com/video/${awemeId}` : '')
  let data
  let billedAt = ''
  try {
    const paid = await douyinPaid.fetchPaidDetails(share, { logId: opts.logId, userId: opts.userId })
    data = paid && paid.payload
    billedAt = String((paid && paid.billedAt) || '').trim()
  } catch (e) {
    const msg = e && e.message ? e.message : '付费接口解析失败'
    throw new DouyinParseError(formatFallbackMessage(fallbackReason, msg))
  }
  const picked = douyinPaid.pickPaidMedia(data)
  if (!picked) {
    throw new DouyinParseError(formatFallbackMessage(fallbackReason, '付费未返回可用地址'))
  }
  const title = String((data && data.title) || (freeResult && freeResult.title) || '').trim()
  const author = String((freeResult && freeResult.author) || '').trim()
  const cover = String((data && data.cover) || (freeResult && freeResult.cover) || '').trim()
  return {
    awemeId: String((data && data.vid) || awemeId || '').trim(),
    douyinUrl: share,
    title,
    author,
    cover,
    mediaType: 'video',
    isVideo: true,
    resultUrl: picked.url,
    images: [],
    quality: picked.quality,
    source: 'paid',
    paidAt: billedAt,
    expiresAt: extractExpiresAt(picked.url),
  }
}

async function fetchFreeBuilt(awemeId, douyinUrl) {
  return withRetry(async () => {
    await acquireSlot()
    try {
      const data = await fetchAggregator(awemeId)
      const built = buildFromAggregator(awemeId, douyinUrl, data)
      if (!built.resultUrl && !built.images.length) {
        // 已经拿到封面/标题/作者，只差视频地址 → 聚合接口返回残缺（抽风），值得重试；
        // 连封面/标题都没有才更像作品真被删/仅本人可见，标记不可重试直接失败。
        throw new DouyinParseError(
          hasMeta(built)
            ? '素材地址暂时为空（接口抽风），请稍后重试'
            : '未解析到可用素材地址，作品可能已被删除或仅本人可见',
          { retryable: hasMeta(built) },
        )
      }
      return built
    } finally {
      releaseSlot()
    }
  }, `aweme=${awemeId}`)
}

/**
 * 解析入口：输入分享文案/链接，返回归一化素材信息。
 * @param {string} text
 * @returns {Promise<object>}
 * @throws {DouyinParseError}
 */
/**
 * @param {string} text
 * @param {{ onBeforePaid?: () => boolean, logId?: number, userId?: number }} [hooks]
 *   onBeforePaid 返回 false 则不再打付费（同条记录已扣过 / 正在扣）。
 */
async function parse(text, hooks = {}) {
  const { awemeId, douyinUrl } = await resolveAwemeId(text)
  let freeResult = null
  let fallbackReason = ''

  try {
    // 并发槽“每次尝试才占、退避等待时释放”：单条卡住/重试不会长期占死并发
    freeResult = await fetchFreeBuilt(awemeId, douyinUrl)
  } catch (e) {
    const isKnown = e instanceof DouyinParseError
    // 不可重试（已删/仅本人可见等）不走付费，避免白烧次数
    if (isKnown && !e.retryable) throw e
    fallbackReason = isKnown ? e.message : '免费接口请求失败'
    return runPaidAfterHook(awemeId, douyinUrl, { fallbackReason, hooks })
  }

  if (isFreeResultAcceptable(freeResult)) return freeResult

  fallbackReason = freeResult.mediaType === 'images' ? '免费图集无可用地址' : '免费非原画'
  return runPaidAfterHook(awemeId, douyinUrl, { fallbackReason, freeResult, hooks })
}

function runPaidAfterHook(awemeId, douyinUrl, { fallbackReason, freeResult = null, hooks = {} } = {}) {
  if (typeof hooks.onBeforePaid === 'function' && hooks.onBeforePaid() === false) {
    throw new DouyinParseError(formatFallbackMessage(fallbackReason, '付费兜底已在处理中，请稍后'))
  }
  return parsePaidFallback(awemeId, douyinUrl, {
    fallbackReason,
    freeResult,
    logId: hooks.logId,
    userId: hooks.userId,
  })
}

module.exports = {
  parse,
  parsePaidFallback,
  splitInputs,
  resolveAwemeId,
  buildFromAggregator,
  fetchAggregator,
  isFreeResultAcceptable,
  hasMeta,
  DouyinParseError,
  extractExpiresAt,
  AGGREGATOR_API,
}
