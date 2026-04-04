/**
 * 火山方舟「视频生成 / 智能视频」HTTP 适配层。
 *
 * 创建任务路径：POST {ARK_API_BASE}/contents/generations/tasks
 * 即文档「创建视频生成任务 API」，与控制台里 Seedance / 豆包视频（常统称「智能视频」）同源，
 * 并非另一套「首尾帧专用域名」；首尾帧只是 content 里可选的 role 字段。
 *
 * 文档：https://www.volcengine.com/docs/82379/1520758
 *
 * 环境变量：
 * - ARK_API_KEY（或 SEEDANCE_API_KEY）：方舟 API Key，Bearer 鉴权
 * - ARK_API_BASE：默认 https://ark.cn-beijing.volces.com/api/v3
 * - ARK_VIDEO_CONTENT_MODE：见 buildCreateTaskBody
 * - ARK_VIDEO_MAX_REF_IMAGES / ARK_VIDEO_MAX_REF_VIDEOS：参考图、参考视频数量上限（接入点/模型可能更小，以方舟报错为准）
 * - ARK_MULTIMODAL_MODEL_ID：（可选）参考图+参考视频同时存在时，覆盖请求里的 model，指向支持多模态参考的接入点 ID（如 Seedance 2.0）；不设则使用后台所选模型的 api_model_id。
 */

const ARK_BASE = (process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
const ARK_API_KEY = process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || ''

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
 * 默认 reference_only：对话 / 多参考场景按「智能参考」构造 content，不带 first_frame/last_frame，避免与参考视频混用报错。
 * 显式设 ARK_VIDEO_CONTENT_MODE=auto 时：仅「1～2 张图且无参考视频」才使用首尾帧 role。
 */
function videoContentMode() {
  return (process.env.ARK_VIDEO_CONTENT_MODE || 'reference_only').trim().toLowerCase()
}

function assertConfigured() {
  if (!ARK_API_KEY || !String(ARK_API_KEY).trim()) {
    const err = new Error('未配置 ARK_API_KEY 或 SEEDANCE_API_KEY')
    err.code = 'E_ARK_CONFIG'
    throw err
  }
}

/**
 * 构造创建任务请求体。
 *
 * 方舟约束：
 * - first/last frame 与 reference media 不得混用在同一 content（报错原文见其文档）。
 * - 参考媒体模式：video_url 须带 role=reference_video（否则会报 reference media mode requires video role to be reference_video）。
 * - 首尾帧（仅 ARK_VIDEO_CONTENT_MODE=auto）：1～2 张图且无参考视频时可用 first_frame / last_frame。
 * - 图 + 参考视频（reference_only）：顺序「先视频、再图、最后文本」；视频 role=reference_video，图片 role=reference_image（与首尾帧链路区分，避免混用报错）。
 * - 默认 reference_only：纯图多参考、纯参考视频、多模态均不走 first_frame / last_frame。
 * @see https://www.volcengine.com/docs/82379/1520757
 */
function buildCreateTaskBody({ model, prompt, extra, imageUrls, videoUrls }) {
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
  /** 仅纯图 1～2 张且无视频、且非 reference_only 时走首尾帧；否则参考媒体 */
  const useFirstLastRoles =
    mode !== 'reference_only' && !hasVideo && urls.length >= 1 && urls.length <= 2

  let text = String(prompt || '').trim()
  if (!text && urls.length) text = '根据参考图生成视频'
  if (!text && vids.length && !urls.length) text = '根据参考视频生成视频'
  if (!text && (urls.length || vids.length)) text = '根据参考素材生成视频'

  const content = []

  /** 图 + 参考视频：参考媒体模式；视频必须 reference_video。媒体在前、文本在后 */
  const multimodalRef = hasVideo && urls.length > 0

  if (multimodalRef) {
    for (const u of vids) {
      content.push({
        type: 'video_url',
        role: 'reference_video',
        video_url: { url: String(u).trim() },
      })
    }
    for (let i = 0; i < urls.length; i++) {
      const u = String(urls[i]).trim()
      content.push({
        type: 'image_url',
        role: 'reference_image',
        image_url: { url: u },
      })
    }
    content.push({ type: 'text', text })
  } else {
    content.push({ type: 'text', text })
    for (let i = 0; i < urls.length; i++) {
      const u = String(urls[i]).trim()
      const item = { type: 'image_url', image_url: { url: u } }
      if (useFirstLastRoles) {
        if (urls.length === 1) item.role = 'first_frame'
        else item.role = i === 0 ? 'first_frame' : 'last_frame'
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

  // 必须先展开业务扩展字段，最后再强制写入 model / content。
  // default_params / options 里若带有 content（或含 role 的示例片段），会覆盖上面构造的多模态正文，
  // 导致方舟报 first/last frame 与 reference media 混用。
  const { model: _m, content: _c, ...restExtra } = safeExtra
  return {
    ...restExtra,
    model,
    content,
  }
}

async function arkFetch(path, { method = 'GET', body } = {}) {
  assertConfigured()
  const url = `${ARK_BASE}${path.startsWith('/') ? path : `/${path}`}`
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ARK_API_KEY}`,
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
 * 创建内容生成任务，返回方舟原始 JSON（须含 id 或可解析的任务 id）
 */
async function createContentsGenerationTask(payload) {
  return arkFetch('/contents/generations/tasks', { method: 'POST', body: payload })
}

/**
 * 查询任务状态
 */
async function getContentsGenerationTask(taskId) {
  const id = encodeURIComponent(String(taskId).trim())
  return arkFetch(`/contents/generations/tasks/${id}`, { method: 'GET' })
}

function pickTaskId(remote) {
  if (!remote || typeof remote !== 'object') return ''
  return String(remote.id || remote.task_id || remote.data?.id || '').trim()
}

/** 将远端状态归一为 pending | processing | succeeded | failed | cancelled */
function normalizeRemoteStatus(remote) {
  const s = String(
    remote?.status || remote?.task_status || remote?.data?.status || ''
  ).toLowerCase()
  if (['succeeded', 'success', 'completed', 'complete', 'done'].includes(s)) return 'succeeded'
  if (['cancelled', 'canceled'].includes(s)) return 'cancelled'
  if (['failed', 'error'].includes(s)) return 'failed'
  if (['running', 'processing', 'in_progress', 'in-progress', 'executing'].includes(s))
    return 'processing'
  return 'pending'
}

function pickResultUrl(remote) {
  if (!remote || typeof remote !== 'object') return ''
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
  if (content && typeof content === 'object') {
    const u = content.url || content.videoUrl || content.video
    if (typeof u === 'string' && u.startsWith('http')) return u
  }
  return ''
}

function pickErrorMessage(remote) {
  if (!remote || typeof remote !== 'object') return ''
  return String(remote.error?.message || remote.message || remote.fail_reason || remote.error || '')
}

function mapRemoteToJobUpdate(remote) {
  const status = normalizeRemoteStatus(remote)
  const resultUrl = status === 'succeeded' ? pickResultUrl(remote) : ''
  const err =
    status === 'failed' || status === 'cancelled' ? pickErrorMessage(remote) || status : ''
  return { status, resultUrl, errorMessage: err }
}

module.exports = {
  videoContentMode,
  maxRefImages,
  maxRefVideos,
  buildCreateTaskBody,
  createContentsGenerationTask,
  getContentsGenerationTask,
  pickTaskId,
  mapRemoteToJobUpdate,
  isConfigured: () => !!(ARK_API_KEY && String(ARK_API_KEY).trim()),
}
