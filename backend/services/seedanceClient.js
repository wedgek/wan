/**
 * Seedance 视频生成 HTTP 适配层（支持 DMXAPI / 火山方舟双 provider）。
 *
 * DMXAPI（默认）：
 * - POST {base}/responses 创建与查询
 * - 文档：https://doc.dmxapi.cn/doubao-seedance-2-0-text-to-video.html
 *
 * 火山方舟（VIDEO_API_PROVIDER=ark）：
 * - POST/GET {base}/contents/generations/tasks
 * - 文档：https://www.volcengine.com/docs/82379/1520758
 *
 * 环境变量：
 * - VIDEO_API_PROVIDER：dmxapi（默认）| ark
 * - ARK_API_KEY / SEEDANCE_API_KEY / DMXAPI_API_KEY：API Key
 * - ARK_API_BASE：方舟 base，默认 https://ark.cn-beijing.volces.com/api/v3
 * - DMXAPI_API_BASE：DMXAPI base，默认 https://www.dmxapi.cn/v1
 * - DMXAPI_QUERY_MODEL：查询任务模型，默认 seedance-2-0-get
 * - ARK_VIDEO_CONTENT_MODE / ARK_VIDEO_MAX_REF_* / ARK_MULTIMODAL_MODEL_ID：见 buildCreateTaskBody
 */

const PROVIDER = (process.env.VIDEO_API_PROVIDER || 'dmxapi').trim().toLowerCase() === 'ark' ? 'ark' : 'dmxapi'

const API_KEY =
  process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || process.env.DMXAPI_API_KEY || ''

const ARK_BASE = (process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3').replace(
  /\/+$/,
  '',
)
const DMXAPI_BASE = (process.env.DMXAPI_API_BASE || 'https://www.dmxapi.cn/v1')
  .replace(/\/+$/, '')
  .replace(/\/responses$/, '')

const DMXAPI_QUERY_MODEL = (process.env.DMXAPI_QUERY_MODEL || 'seedance-2-0-get').trim()

function apiBase() {
  return PROVIDER === 'ark' ? ARK_BASE : DMXAPI_BASE
}

function providerLabel() {
  return PROVIDER === 'ark' ? '火山方舟' : 'DMXAPI'
}

/** Seedance 2.0「全能参考」宣传上限约 9 图 / 3 视频；旧模型请改小环境变量 */
function maxRefImages() {
  const n = Number(process.env.ARK_VIDEO_MAX_REF_IMAGES ?? 9)
  if (!Number.isFinite(n) || n < 1) return 9
  return Math.min(24, Math.floor(n))
}

function maxRefVideos() {
  const n = Number(process.env.ARK_VIDEO_MAX_REF_VIDEOS ?? 3)
  if (!Number.isFinite(n) || n < 1) return 3
  return Math.min(12, Math.floor(n))
}

/**
 * 默认 reference_only：对话 / 多参考场景按「智能参考」构造 content，不带 first_frame/last_frame。
 * 显式设 ARK_VIDEO_CONTENT_MODE=auto 时：仅「1～2 张图且无参考视频」才使用首尾帧 role。
 */
function videoContentMode() {
  return (process.env.ARK_VIDEO_CONTENT_MODE || 'reference_only').trim().toLowerCase()
}

function transformMediaReferences(prompt, imageCount, videoCount) {
  let text = String(prompt || '')
  for (let i = 1; i <= imageCount; i++) {
    const patterns = [
      new RegExp(`@图片${i}(?![0-9])`, 'g'),
      new RegExp(`@image${i}(?![0-9])`, 'gi'),
      new RegExp(`@img${i}(?![0-9])`, 'gi'),
    ]
    for (const re of patterns) {
      text = text.replace(re, `图片${i}`)
    }
  }
  for (let i = 1; i <= videoCount; i++) {
    const patterns = [
      new RegExp(`@视频${i}(?![0-9])`, 'g'),
      new RegExp(`@video${i}(?![0-9])`, 'gi'),
      new RegExp(`@vid${i}(?![0-9])`, 'gi'),
    ]
    for (const re of patterns) {
      text = text.replace(re, `视频${i}`)
    }
  }
  return text
}

function assertConfigured() {
  if (!API_KEY || !String(API_KEY).trim()) {
    const err = new Error('未配置 ARK_API_KEY / SEEDANCE_API_KEY / DMXAPI_API_KEY')
    err.code = 'E_ARK_CONFIG'
    throw err
  }
}

function authHeader({ useBearer = true } = {}) {
  const key = String(API_KEY).trim()
  if (PROVIDER === 'dmxapi' && !useBearer) {
    return key
  }
  return key.startsWith('Bearer ') ? key : `Bearer ${key}`
}

function isKlingModel(model) {
  return /^kling/i.test(String(model || ''))
}

function isKlingQueryModel(model) {
  const id = String(model || '').toLowerCase()
  return !id || /-get(?:$|-)/.test(id) || id.endsWith('-get-all')
}

/** 可灵 V3 生成类（/responses 要求 input 为 { media, multi_prompt } 对象，非 V2 扁平字符串） */
function isKlingV3GenerationModel(model) {
  const id = String(model || '').toLowerCase()
  if (!/^kling/.test(id) || isKlingQueryModel(model)) return false
  if (/-image2video(?:$|-)/.test(id)) return false
  if (/^kling-v(?:2-[56]|2\.[56])(?:$|-)/.test(id)) return false
  return /kling-v3|kling-3|kling.*video-generation|kling.*omni/.test(id)
}

/** 可灵图生视频专用端点：kling-v2-6 → kling-v2-6-image2video（V3 不走此路由） */
function resolveKlingImage2VideoModel(model) {
  const id = String(model || '').trim()
  const lower = id.toLowerCase()
  if (/-image2video(?:$|-)/.test(lower)) return id
  if (/^kling-v(?:2-[56]|2\.[56])(?:$|-)/.test(lower)) return `${id}-image2video`
  return id
}

function pickKlingAspectRatio(extra) {
  return extra.aspect_ratio || extra.ratio || '16:9'
}

function pickKlingDuration(extra) {
  const n = Number(extra.duration)
  return n === 10 ? 10 : 5
}

/**
 * 可灵 DMXAPI：/v1/responses 扁平字段（input + image / video_url + action_control）
 * 参考视频走「动作控制」，需同时提供参考图与参考视频。
 */
function buildKlingCreateTaskBody({ model, prompt, extra, imageUrls, videoUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  const vids = Array.isArray(videoUrls)
    ? videoUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []

  const limImg = maxRefImages()
  if (urls.length > limImg) {
    const err = new Error(
      `视频接口当前最多支持 ${limImg} 张参考图（可由 ARK_VIDEO_MAX_REF_IMAGES 配置）。请删除多余图片后重试。`,
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  const limVid = maxRefVideos()
  if (vids.length > limVid) {
    const err = new Error(
      `视频接口当前最多支持 ${limVid} 段参考视频（可由 ARK_VIDEO_MAX_REF_VIDEOS 配置）。请删除多余视频后重试。`,
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  const {
    model: _m,
    content: _c,
    input: _i,
    image: _img,
    video_url: _vu,
    action_control: _ac,
    ratio: _ratio,
    ...restExtra
  } = safeExtra

  let text = transformMediaReferences(String(prompt || '').trim(), urls.length, vids.length)
  if (!text && urls.length) text = '根据参考图生成视频'
  if (!text && vids.length && !urls.length) text = '根据参考视频生成视频'
  if (!text && (urls.length || vids.length)) text = '根据参考素材生成视频'

  const aspectRatio = pickKlingAspectRatio(safeExtra)
  const duration = pickKlingDuration(safeExtra)
  const mode = safeExtra.mode || 'pro'

  if (vids.length > 0) {
    if (!urls.length) {
      const err = new Error(
        '可灵「参考视频 / 动作控制」需要同时上传参考图与参考视频，请补充参考图后重试。',
      )
      err.code = 'E_ARK_PAYLOAD'
      throw err
    }
    return {
      ...restExtra,
      model,
      input: text,
      image: String(urls[0]).trim(),
      video_url: String(vids[0]).trim(),
      action_control: true,
      character_orientation: safeExtra.character_orientation || 'video',
      mode,
      aspect_ratio: aspectRatio,
      duration,
    }
  }

  if (urls.length > 0) {
    const i2vModel = resolveKlingImage2VideoModel(model)
    return {
      ...restExtra,
      model: i2vModel,
      input: text,
      image: String(urls[0]).trim(),
      image_tail: safeExtra.image_tail || '',
      negative_prompt: safeExtra.negative_prompt || '',
      mode,
      sound: safeExtra.sound || 'on',
      aspect_ratio: aspectRatio,
      duration,
    }
  }

  return {
    ...restExtra,
    model,
    input: text,
    mode,
    aspect_ratio: aspectRatio,
    duration,
  }
}

/**
 * 可灵 V3（kling-v3-video-generation 等）：DMXAPI 要求 input 为对象
 * { media: [{ type, url }], multi_prompt: [{ prompt, duration }], ... }
 */
function buildKlingV3CreateTaskBody({ model, prompt, extra, imageUrls, videoUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  const vids = Array.isArray(videoUrls)
    ? videoUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []

  const limImg = maxRefImages()
  if (urls.length > limImg) {
    const err = new Error(
      `视频接口当前最多支持 ${limImg} 张参考图（可由 ARK_VIDEO_MAX_REF_IMAGES 配置）。请删除多余图片后重试。`,
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  const limVid = maxRefVideos()
  if (vids.length > limVid) {
    const err = new Error(
      `视频接口当前最多支持 ${limVid} 段参考视频（可由 ARK_VIDEO_MAX_REF_VIDEOS 配置）。请删除多余视频后重试。`,
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  let text = transformMediaReferences(String(prompt || '').trim(), urls.length, vids.length)
  if (!text && urls.length) text = '根据参考图生成视频'
  if (!text && vids.length && !urls.length) text = '根据参考视频生成视频'
  if (!text && (urls.length || vids.length)) text = '根据参考素材生成视频'
  if (!text) text = '生成视频'

  const aspectRatio = pickKlingAspectRatio(safeExtra)
  const duration = pickKlingDuration(safeExtra)
  const mode = safeExtra.mode || 'pro'

  const media = []
  if (urls.length >= 1) {
    media.push({ type: 'first_frame', url: String(urls[0]).trim() })
    if (urls.length >= 2) {
      media.push({ type: 'last_frame', url: String(urls[1]).trim() })
    }
  } else if (urls.length === 0 && vids.length > 0) {
    for (const u of vids) {
      media.push({ type: 'reference_video', url: String(u).trim() })
    }
  }
  if (urls.length >= 1 && vids.length > 0) {
    for (const u of vids) {
      media.push({ type: 'reference_video', url: String(u).trim() })
    }
  }

  const {
    model: _m,
    content: _c,
    input: _i,
    media: _media,
    multi_prompt: _mp,
    aspect_ratio: _ar,
    duration: _dur,
    mode: _mode,
    ...restExtra
  } = safeExtra

  const input = {
    ...restExtra,
    aspect_ratio: aspectRatio,
    mode,
    multi_prompt: [{ prompt: text, duration }],
  }
  if (media.length) input.media = media

  return {
    model,
    input,
  }
}

/**
 * 构造创建任务请求体（内部统一使用 content 字段，发送前按 provider 转换）。
 */
function buildCreateTaskBody({ model, prompt, extra, imageUrls, videoUrls }) {
  if (PROVIDER === 'dmxapi' && isKlingModel(model) && !isKlingQueryModel(model)) {
    if (isKlingV3GenerationModel(model)) {
      return buildKlingV3CreateTaskBody({ model, prompt, extra, imageUrls, videoUrls })
    }
    return buildKlingCreateTaskBody({ model, prompt, extra, imageUrls, videoUrls })
  }

  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  const vids = Array.isArray(videoUrls)
    ? videoUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []

  const limImg = maxRefImages()
  if (urls.length > limImg) {
    const err = new Error(
      `视频接口当前最多支持 ${limImg} 张参考图（可由 ARK_VIDEO_MAX_REF_IMAGES 配置，且不得超过模型能力）。请删除多余图片后重试。`,
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  const limVid = maxRefVideos()
  if (vids.length > limVid) {
    const err = new Error(
      `视频接口当前最多支持 ${limVid} 段参考视频（可由 ARK_VIDEO_MAX_REF_VIDEOS 配置）。请删除多余视频后重试。`,
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  const hasVideo = vids.length > 0
  const mode = videoContentMode()
  const useFirstLastRoles =
    mode !== 'reference_only' && !hasVideo && urls.length >= 1 && urls.length <= 2

  let text = transformMediaReferences(String(prompt || '').trim(), urls.length, vids.length)
  if (!text && urls.length) text = '根据参考图生成视频'
  if (!text && vids.length && !urls.length) text = '根据参考视频生成视频'
  if (!text && (urls.length || vids.length)) text = '根据参考素材生成视频'

  const content = []
  const multimodalRef = hasVideo && urls.length > 0

  if (multimodalRef) {
    content.push({ type: 'text', text })
    for (let i = 0; i < urls.length; i++) {
      const u = String(urls[i]).trim()
      content.push({
        type: 'image_url',
        role: 'reference_image',
        image_url: { url: u },
      })
    }
    for (const u of vids) {
      content.push({
        type: 'video_url',
        role: 'reference_video',
        video_url: { url: String(u).trim() },
      })
    }
  } else {
    content.push({ type: 'text', text })
    for (let i = 0; i < urls.length; i++) {
      const u = String(urls[i]).trim()
      const item = { type: 'image_url', image_url: { url: u } }
      if (useFirstLastRoles) {
        if (urls.length === 1) item.role = 'first_frame'
        else item.role = i === 0 ? 'first_frame' : 'last_frame'
      } else {
        item.role = 'reference_image'
      }
      content.push(item)
    }
    for (const u of vids) {
      content.push({
        type: 'video_url',
        role: 'reference_video',
        video_url: { url: String(u).trim() },
      })
    }
  }

  const { model: _m, content: _c, input: _i, ...restExtra } = safeExtra
  return {
    ...restExtra,
    model,
    content,
  }
}

function payloadForProvider(body) {
  if (PROVIDER !== 'dmxapi') return body
  if (!Array.isArray(body.content)) return body
  const { content, ...rest } = body
  return {
    ...rest,
    input: content,
  }
}

async function apiFetch(path, { method = 'GET', body, authBearer = true } = {}) {
  assertConfigured()
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader({ useBearer: authBearer }),
    },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(url, opts)
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {
    data = { raw: text }
  }
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error?.message || data.msg)) || text || `HTTP ${res.status}`
    const err = new Error(String(msg))
    err.code = 'E_ARK_HTTP'
    err.status = res.status
    err.detail = data
    throw err
  }
  return data
}

/**
 * 创建内容生成任务，返回远端原始 JSON（须含 id 或可解析的任务 id）
 */
async function createContentsGenerationTask(payload) {
  if (PROVIDER === 'dmxapi') {
    return apiFetch('/responses', {
      method: 'POST',
      body: payloadForProvider(payload),
      authBearer: false,
    })
  }
  return apiFetch('/contents/generations/tasks', { method: 'POST', body: payload })
}

/**
 * 查询任务状态
 */
async function getContentsGenerationTask(taskId) {
  const id = String(taskId).trim()
  if (PROVIDER === 'dmxapi') {
    return apiFetch('/responses', {
      method: 'POST',
      body: {
        model: DMXAPI_QUERY_MODEL,
        input: id,
      },
      authBearer: true,
    })
  }
  return apiFetch(`/contents/generations/tasks/${encodeURIComponent(id)}`, { method: 'GET' })
}

function pickTaskId(remote) {
  if (!remote || typeof remote !== 'object') return ''
  return String(remote.id || remote.task_id || remote.data?.id || remote.request_id || '').trim()
}

/** 解析 DMXAPI 查询响应中嵌套的 JSON 字符串 */
function unwrapDmxapiQueryPayload(remote) {
  if (!remote || typeof remote !== 'object') return remote
  const text = remote?.output?.[0]?.content?.[0]?.text
  if (typeof text === 'string' && text.trim()) {
    try {
      const inner = JSON.parse(text)
      if (inner && typeof inner === 'object') {
        return { ...remote, _dmxapiInner: inner }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return remote
}

function remoteStatusSource(remote) {
  const inner = remote?._dmxapiInner
  if (inner && inner.status) return inner
  return remote
}

/** 将远端状态归一为 pending | processing | succeeded | failed | cancelled */
function normalizeRemoteStatus(remote) {
  const src = remoteStatusSource(remote)
  const s = String(src?.status || src?.task_status || src?.data?.status || '').toLowerCase()
  if (['succeeded', 'success', 'completed', 'complete', 'done'].includes(s)) return 'succeeded'
  if (['cancelled', 'canceled'].includes(s)) return 'cancelled'
  if (['failed', 'error', 'expired'].includes(s)) return 'failed'
  if (['running', 'processing', 'in_progress', 'in-progress', 'executing'].includes(s))
    return 'processing'
  if (['queued', 'pending', 'submitted', 'queueing'].includes(s)) return 'pending'
  return 'pending'
}

function pickResultUrl(remote) {
  if (!remote || typeof remote !== 'object') return ''
  const inner = remote._dmxapiInner
  if (inner?.content?.video_url && String(inner.content.video_url).startsWith('http')) {
    return String(inner.content.video_url)
  }
  const tryPaths = [
    remote.video_url,
    remote.output?.video_url,
    remote.content?.video_url,
    remote.result?.video_url,
    remote.data?.video_url,
    remote.content?.[0]?.video_url,
  ]
  for (const p of tryPaths) {
    if (p && typeof p === 'string' && p.startsWith('http')) return p
  }
  const content = remote.content || remote.output || remote.result
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const u = content.url || content.videoUrl || content.video
    if (typeof u === 'string' && u.startsWith('http')) return u
  }
  return ''
}

function pickErrorMessage(remote) {
  if (!remote || typeof remote !== 'object') return ''
  const inner = remote._dmxapiInner
  const fromInner = inner?.error?.message || inner?.message || inner?.fail_reason
  if (fromInner) return String(fromInner)
  return String(remote.error?.message || remote.message || remote.fail_reason || remote.error || '')
}

function mapRemoteToJobUpdate(remote) {
  const normalized = PROVIDER === 'dmxapi' ? unwrapDmxapiQueryPayload(remote) : remote
  const status = normalizeRemoteStatus(normalized)
  const resultUrl = status === 'succeeded' ? pickResultUrl(normalized) : ''
  const err =
    status === 'failed' || status === 'cancelled'
      ? pickErrorMessage(normalized) || status
      : ''
  return { status, resultUrl, errorMessage: err }
}

module.exports = {
  PROVIDER,
  providerLabel,
  videoContentMode,
  maxRefImages,
  maxRefVideos,
  buildCreateTaskBody,
  buildKlingV3CreateTaskBody,
  isKlingV3GenerationModel,
  payloadForProvider,
  createContentsGenerationTask,
  getContentsGenerationTask,
  pickTaskId,
  mapRemoteToJobUpdate,
  unwrapDmxapiQueryPayload,
  isConfigured: () => !!(API_KEY && String(API_KEY).trim()),
}
