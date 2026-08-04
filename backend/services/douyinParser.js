/**
 * 抖音原链素材解析：从分享文案/链接中提取作品，调用 bugpk 聚合接口拿到无水印原链。
 * 仅在后端调用第三方接口，前端不感知具体 API。
 * 移植自参考项目 douyin原链素材/backend/parser.py 的核心链路（聚合接口）。
 */

const AGGREGATOR_API = process.env.DOUYIN_AGG_API || 'https://api.bugpk.com/api/douyin'
const REQUEST_TIMEOUT_MS = Number(process.env.DOUYIN_TIMEOUT_MS) || 20000
const MAX_CONCURRENT = Number(process.env.DOUYIN_MAX_CONCURRENT) || 6

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

/** 面向用户的可读解析错误 */
class DouyinParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DouyinParseError'
  }
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
    if (e && e.name === 'AbortError') throw new DouyinParseError('解析超时，请稍后重试')
    throw new DouyinParseError('聚合接口请求失败，请稍后重试')
  }
  const text = await resp.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {
    throw new DouyinParseError('聚合接口返回异常')
  }
  if (!data || Number(data.code) !== 200 || !data.data) {
    throw new DouyinParseError(`聚合接口返回异常：${(data && data.msg) || '无数据'}`)
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
    source: 'aggregator',
    expiresAt: extractExpiresAt(bestUrl) || (images.length ? extractExpiresAt(images[0]) : null),
  }
}

/**
 * 解析入口：输入分享文案/链接，返回归一化素材信息。
 * @param {string} text
 * @returns {Promise<object>}
 * @throws {DouyinParseError}
 */
async function parse(text) {
  const { awemeId, douyinUrl } = await resolveAwemeId(text)
  await acquireSlot()
  try {
    const data = await fetchAggregator(awemeId)
    const result = buildFromAggregator(awemeId, douyinUrl, data)
    if (!result.resultUrl && !result.images.length) {
      throw new DouyinParseError('未解析到可用素材地址，作品可能已被删除或仅本人可见')
    }
    return result
  } finally {
    releaseSlot()
  }
}

module.exports = { parse, splitInputs, DouyinParseError, extractExpiresAt }
