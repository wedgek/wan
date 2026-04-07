/**
 * 将方舟 / Seedance 返回的限时成片 URL 拉取后写入火山 TOS，返回可长期访问的直链。
 *
 * 环境变量（可选）：
 * - VIDEO_RESULT_MIRROR_TOS=0：关闭转存（仍使用方舟原始 URL）
 * - VIDEO_TOS_MIRROR_MAX_MB：单文件大小上限，默认 600
 */

const tos = require('./tosClient')

const SKIP =
  String(process.env.VIDEO_RESULT_MIRROR_TOS || '').trim() === '0' ||
  String(process.env.VIDEO_RESULT_MIRROR_TOS || '').toLowerCase() === 'false'

const MAX_BYTES = (() => {
  const mb = Number(process.env.VIDEO_TOS_MIRROR_MAX_MB ?? 600)
  const n = Number.isFinite(mb) && mb > 0 ? mb : 600
  return Math.min(2048, n) * 1024 * 1024
})()

const DOWNLOAD_TIMEOUT_MS = Math.min(
  900000,
  Math.max(60000, Number(process.env.VIDEO_TOS_MIRROR_TIMEOUT_MS ?? 300000) || 300000),
)

/** jobId -> Promise<string>，避免并发轮询重复下载上传 */
const inFlight = new Map()

function normHost(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
}

function isAlreadyOurTosUrl(url) {
  try {
    const u = new URL(String(url).trim())
    const base = tos.getPublicBaseUrl()
    if (!base) return false
    const b = new URL(base.startsWith('http') ? base : `https://${base}`)
    return normHost(u.host) === normHost(b.host)
  } catch (_) {
    return false
  }
}

function extFromContentType(ct) {
  const c = String(ct || '').toLowerCase()
  if (c.includes('mp4')) return 'mp4'
  if (c.includes('webm')) return 'webm'
  if (c.includes('quicktime')) return 'mov'
  if (c.includes('x-msvideo')) return 'avi'
  return 'mp4'
}

function normalizeVideoContentType(raw) {
  const s = String(raw || '')
    .split(';')[0]
    .trim()
  if (s && s !== 'application/octet-stream') return s
  return 'video/mp4'
}

async function fetchVideoBytes(sourceUrl) {
  const ac = new AbortController()
  const tid = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS)
  let res
  try {
    res = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'User-Agent': 'wan-ai-seedance-mirror/1.0' },
    })
  } finally {
    clearTimeout(tid)
  }
  if (!res.ok) {
    const err = new Error(`下载成片失败 HTTP ${res.status}`)
    err.code = 'E_MIRROR_FETCH'
    throw err
  }
  const cl = res.headers.get('content-length')
  if (cl && Number(cl) > MAX_BYTES) {
    const err = new Error(`成片超过镜像大小上限（${MAX_BYTES} 字节）`)
    err.code = 'E_MIRROR_TOO_LARGE'
    throw err
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) {
    const err = new Error(`成片超过镜像大小上限（${MAX_BYTES} 字节）`)
    err.code = 'E_MIRROR_TOO_LARGE'
    throw err
  }
  const ct = normalizeVideoContentType(res.headers.get('content-type'))
  return { buf, contentType: ct }
}

async function mirrorToTosOnce(sourceUrl, jobId) {
  if (!sourceUrl || !String(sourceUrl).trim().startsWith('http')) return sourceUrl
  if (SKIP || !tos.isConfigured()) return sourceUrl
  if (isAlreadyOurTosUrl(sourceUrl)) return sourceUrl

  const { buf, contentType } = await fetchVideoBytes(sourceUrl)
  const ext = extFromContentType(contentType)
  const jid = jobId != null && Number.isFinite(Number(jobId)) ? Number(jobId) : 0
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const objectKey =
    jid > 0 ? `video/generated/job-${jid}_${suffix}.${ext}` : `video/generated/${suffix}.${ext}`

  const { url } = await tos.putBuffer({
    objectKey,
    body: buf,
    contentType,
  })
  return url || sourceUrl
}

/**
 * @param {string} sourceUrl 方舟返回的成片 URL
 * @param {{ jobId?: number|string }} [meta]
 * @returns {Promise<string>} TOS 直链，失败或非 http 时返回原始 URL
 */
async function maybeMirrorSeedanceVideoToTos(sourceUrl, meta = {}) {
  const u = String(sourceUrl || '').trim()
  if (!u.startsWith('http')) return u

  const jobId = meta.jobId
  const lockKey = jobId != null && String(jobId) !== '' ? String(jobId) : `_url_${hashUrl(u)}`

  const existing = inFlight.get(lockKey)
  if (existing) return existing

  const task = (async () => {
    try {
      return await mirrorToTosOnce(u, jobId)
    } catch (e) {
      console.error('[videoResultTosMirror] 转存 TOS 失败，保留方舟原始链接', {
        jobId: jobId ?? null,
        message: e.message,
        code: e.code,
      })
      return u
    } finally {
      const cur = inFlight.get(lockKey)
      if (cur === task) inFlight.delete(lockKey)
    }
  })()

  inFlight.set(lockKey, task)
  return task
}

function hashUrl(s) {
  let h = 0
  const str = String(s).slice(0, 500)
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return `${Math.abs(h).toString(36)}`
}

module.exports = {
  maybeMirrorSeedanceVideoToTos,
  isAlreadyOurTosUrl,
}
