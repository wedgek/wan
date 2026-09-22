/**
 * 付费解析兜底（muzzz）：仅服务端持有 token（DOUYIN_PAID_TOKEN），前端永不接触。
 * details 扣次；check 只查额度。不复用历史结果，每次 details 都算一次。
 * 每次 details 写入 douyin_paid_calls，供本站对账（对方 used_count 可能含历史重试/其它系统）。
 */

const db = require('../db')

const PAID_API = process.env.DOUYIN_PAID_API || 'https://api-v1-exe.muzzz.cn/detail/users'
const REQUEST_TIMEOUT_MS = Number(process.env.DOUYIN_PAID_TIMEOUT_MS) || 120000
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

function buildPaidBody(body) {
  const type = String((body && body.type) || '').trim()
  const payload = { type, token: paidToken() }
  if (type === 'details') payload.url = String((body && body.url) || '').trim()
  return payload
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
      body: JSON.stringify(buildPaidBody(body)),
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

function recordPaidCall({ logId, userId, url, ok, errorMessage, billedAt }) {
  try {
    const dbi = db.getDb()
    dbi
      .prepare(
        `INSERT INTO douyin_paid_calls (log_id, user_id, url, ok, error_message, billed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        logId ? Number(logId) : null,
        userId ? Number(userId) : null,
        String(url || '').slice(0, 500),
        ok ? 1 : 0,
        String(errorMessage || '').slice(0, 500),
        String(billedAt || '').slice(0, 32) || null,
      )
    if (logId) {
      dbi
        .prepare(
          `UPDATE douyin_parse_logs SET paid_call_count = COALESCE(paid_call_count, 0) + 1, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(Number(logId))
    }
  } catch (e) {
    console.warn('[douyin-paid] recordPaidCall failed', e && e.message)
  }
}

function countLocalPaidCalls() {
  try {
    const row = db.getDb().prepare(`SELECT COUNT(*) AS c FROM douyin_paid_calls`).get()
    return Number(row && row.c) || 0
  } catch (_) {
    return 0
  }
}

function listPaidCalls({ limit = 20, scopeSql = '', scopeParams = [] } = {}) {
  const n = Math.min(50, Math.max(1, Number(limit) || 20))
  const where = scopeSql ? `WHERE ${scopeSql}` : ''
  const rows = db
    .getDb()
    .prepare(
      `SELECT c.id, c.log_id, c.user_id, c.url, c.ok, c.error_message, c.billed_at,
              datetime(c.created_at, 'localtime') AS create_time,
              u.username, u.nickname
       FROM douyin_paid_calls c
       LEFT JOIN douyin_parse_logs j ON j.id = c.log_id
       LEFT JOIN users u ON u.id = COALESCE(c.user_id, j.user_id)
       ${where}
       ORDER BY c.id DESC
       LIMIT ?`,
    )
    .all(...scopeParams, n)
  return rows.map((r) => ({
    id: r.id,
    logId: r.log_id != null ? Number(r.log_id) : null,
    userId: r.user_id != null ? Number(r.user_id) : null,
    username: r.username != null ? String(r.username) : '',
    nickname: r.nickname != null ? String(r.nickname) : '',
    url: r.url || '',
    ok: Number(r.ok) === 1,
    errorMessage: r.error_message || '',
    billedAt: r.billed_at ? String(r.billed_at).replace('T', ' ').slice(0, 19) : '',
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
  }))
}

/**
 * 调用付费 details，返回 data 节点。
 * 不重试：对方按请求扣次，超时/断连时第一次多半已经扣过，再打会连扣两次。
 * @param {string} url 抖音作品链接
 * @param {{ logId?: number, userId?: number }} [meta]
 */
async function fetchPaidDetails(url, meta = {}) {
  const share = String(url || '').trim()
  if (!share) throw new PaidApiError('付费解析缺少作品链接')
  await acquireSlot()
  let ok = false
  let errorMessage = ''
  let billedAt = ''
  try {
    const data = await postPaid({ url: share, type: 'details' })
    billedAt = String((data && data.time) || '').trim()
    throwIfBusinessError(data, 'details')
    if (!data.data || typeof data.data !== 'object') {
      throw new PaidApiError('付费接口未返回数据', { retryable: false })
    }
    ok = true
    return { payload: data.data, billedAt }
  } catch (e) {
    errorMessage = (e && e.message) || '付费接口解析失败'
    throw e
  } finally {
    recordPaidCall({
      logId: meta.logId,
      userId: meta.userId,
      url: share,
      ok,
      errorMessage,
      billedAt,
    })
    console.info(
      `[douyin-paid] details logId=${meta.logId || '-'} ok=${ok ? 1 : 0} billedAt=${billedAt || '-'} ${ok ? 'ok' : errorMessage} url=${share.slice(0, 80)}`,
    )
    releaseSlot()
  }
}

const QUOTA_CACHE_MS = 60000
let quotaCache = { at: 0, data: null }

/** 查询额度：只打 type=check，不重试。返回文档字段 total_count / remainder / used_count / time */
async function checkQuota({ force = false } = {}) {
  if (!force && quotaCache.data && Date.now() - quotaCache.at < QUOTA_CACHE_MS) {
    return quotaCache.data
  }
  const data = await postPaid({ type: 'check' })
  throwIfBusinessError(data, 'check')
  const node = data.data && typeof data.data === 'object' ? data.data : {}
  const parsed = {
    total_count: Number(node.total_count) || 0,
    remainder: Number(node.remainder) || 0,
    used_count: Number(node.used_count) || 0,
    time: String((data && data.time) || '').trim(),
  }
  console.info(
    `[douyin-paid] check used=${parsed.used_count} remainder=${parsed.remainder} total=${parsed.total_count} time=${parsed.time || '-'}`,
  )
  quotaCache = { at: Date.now(), data: parsed }
  return parsed
}

module.exports = {
  isPaidConfigured,
  fetchPaidDetails,
  checkQuota,
  countLocalPaidCalls,
  listPaidCalls,
  pickPaidVideo,
  pickPaidMedia,
  PaidApiError,
  PAID_API,
}
