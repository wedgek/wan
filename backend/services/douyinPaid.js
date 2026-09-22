/**
 * 付费解析兜底（muzzz）：仅服务端持有 token（DOUYIN_PAID_TOKEN），前端永不接触。
 * details 扣次；check 只查额度。不复用历史结果，每次 details 都算一次。
 */

const PAID_API = process.env.DOUYIN_PAID_API || 'https://api-v1-exe.muzzz.cn/detail/users'
const REQUEST_TIMEOUT_MS = Number(process.env.DOUYIN_PAID_TIMEOUT_MS) || 15000
const MAX_CONCURRENT = Math.max(1, Number(process.env.DOUYIN_PAID_MAX_CONCURRENT) || 2)
const NETWORK_RETRIES = 1

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const PAID_CODE_MSG = {
  '-1': '付费接口去水印失败',
  '-2': '付费接口不支持该平台',
  '-3': '付费解析次数不足，请充值',
  '-9': '作品不存在或无法访问',
}

class PaidApiError extends Error {
  constructor(message, { code = 0, retryable = false } = {}) {
    super(message)
    this.name = 'PaidApiError'
    this.code = Number(code) || 0
    this.retryable = Boolean(retryable)
  }
}

function isPaidConfigured() {
  return Boolean(String(process.env.DOUYIN_PAID_TOKEN || '').trim())
}

function paidToken() {
  return String(process.env.DOUYIN_PAID_TOKEN || '').trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

/* ============ 低并发：付费接口单独限流，避免突发批量烧次数 ============ */
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

async function postPaid(body) {
  if (!isPaidConfigured()) {
    throw new PaidApiError('未配置付费接口', { retryable: false })
  }
  let resp
  try {
    resp = await fetchWithTimeout(PAID_API, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'User-Agent': DESKTOP_UA,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...body, token: paidToken() }),
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw new PaidApiError('付费接口超时', { retryable: true })
    throw new PaidApiError('付费接口请求失败', { retryable: true })
  }
  const text = await resp.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {
    throw new PaidApiError('付费接口返回异常', { retryable: true })
  }
  if (!data || typeof data !== 'object') {
    throw new PaidApiError('付费接口返回异常', { retryable: true })
  }
  return data
}

async function postPaidWithRetry(body, ctx = '') {
  await acquireSlot()
  try {
    let lastErr
    for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt += 1) {
      try {
        return await postPaid(body)
      } catch (e) {
        lastErr = e
        const retryable = e instanceof PaidApiError ? e.retryable : true
        console.warn(
          `[douyin-paid] ${ctx} attempt#${attempt + 1}/${NETWORK_RETRIES + 1} retryable=${retryable} err=${e && e.message}`,
        )
        if (!retryable || attempt === NETWORK_RETRIES) break
        await sleep(600 * (attempt + 1))
      }
    }
    throw lastErr || new PaidApiError('付费接口请求失败')
  } finally {
    releaseSlot()
  }
}

function throwIfBusinessError(data, ctx) {
  const code = Number(data && data.code)
  if (code === 0) return
  const mapped = PAID_CODE_MSG[String(code)] || (data && data.msg) || '付费接口解析失败'
  console.warn(`[douyin-paid] ${ctx} business code=${code} msg=${mapped}`)
  throw new PaidApiError(mapped, { code, retryable: false })
}

/**
 * 从 video_list 选档：原画优先，否则按 1080p > 720p > 其它。
 * @returns {{ url: string, quality: string, level: string } | null}
 */
function pickPaidVideo(videoList) {
  const items = (Array.isArray(videoList) ? videoList : []).filter(
    (it) => it && it.url && String(it.url).startsWith('http'),
  )
  if (!items.length) return null
  items.sort((a, b) => scoreLevel(b.level) - scoreLevel(a.level))
  const best = items[0]
  return { url: cleanUrl(best.url), quality: normalizeQuality(best.level), level: String(best.level || '') }
}

function scoreLevel(level) {
  const s = String(level || '')
  if (/原画|original/i.test(s)) return 10000
  const m = s.match(/(\d{3,4})\s*p/i)
  if (m) return Number(m[1])
  return 0
}

function normalizeQuality(level) {
  const s = String(level || '')
  if (/原画|original/i.test(s)) return 'original'
  const m = s.match(/(\d{3,4})\s*p/i)
  if (m) return `${m[1]}p`
  const stripped = s.replace(/\([^)]*\)/g, '').trim()
  return stripped || 'unknown'
}

/** 解析：优先 video_list 选档，没有则退回 data.url */
function pickPaidMedia(data) {
  const fromList = pickPaidVideo(data && data.video_list)
  if (fromList) return fromList
  const url = data && data.url
  if (url && String(url).startsWith('http')) {
    return { url: cleanUrl(url), quality: 'unknown', level: '' }
  }
  return null
}

/**
 * 调用付费 details，返回 data 节点。
 * @param {string} url 抖音作品链接
 */
async function fetchPaidDetails(url) {
  const share = String(url || '').trim()
  if (!share) throw new PaidApiError('付费解析缺少作品链接')
  const data = await postPaidWithRetry({ url: share, type: 'details' }, `details`)
  throwIfBusinessError(data, 'details')
  if (!data.data || typeof data.data !== 'object') {
    throw new PaidApiError('付费接口未返回数据', { retryable: true })
  }
  return data.data
}

/** 查询额度：{ total_count, remainder, used_count } */
async function checkQuota() {
  const data = await postPaidWithRetry({ type: 'check' }, 'check')
  throwIfBusinessError(data, 'check')
  const node = data.data && typeof data.data === 'object' ? data.data : {}
  return {
    total_count: Number(node.total_count) || 0,
    remainder: Number(node.remainder) || 0,
    used_count: Number(node.used_count) || 0,
  }
}

module.exports = {
  isPaidConfigured,
  fetchPaidDetails,
  checkQuota,
  pickPaidVideo,
  pickPaidMedia,
  PaidApiError,
  PAID_API,
}
