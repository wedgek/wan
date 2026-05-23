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

/** 项目默认关闭各厂商视频水印（parameters.watermark / 扁平 watermark 字段） */
const DEFAULT_VIDEO_WATERMARK = false

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

/** 万相 wan2.x-r2v：DMXAPI 要求 input 为 { prompt, reference_urls } 对象 */
function isWanR2vModel(model) {
  const id = String(model || '').toLowerCase()
  if (!id || isKlingQueryModel(model)) return false
  if (isHappyHorseR2vModel(model)) return false
  return /wan2\.[0-9]+-r2v/.test(id)
}

/** 快乐马 happyhorse-*-r2v：DMXAPI 要求 input 为 [{ prompt, media }] 数组（仅参考图） */
function isHappyHorseR2vModel(model) {
  const id = String(model || '').toLowerCase()
  if (!id || isKlingQueryModel(model)) return false
  return /^happyhorse.*r2v/.test(id)
}

function resolveDmxapiQueryModel(createModelId) {
  const profiles = require('./videoApiProfiles')
  const profile = profiles.resolveVideoProfile(createModelId)
  if (profile) return profiles.resolveQueryModel(profile, createModelId)
  const id = String(createModelId || '').toLowerCase().trim()
  if (/^happyhorse/.test(id)) return 'happyhorse-get'
  const wanGet = profiles.inferWanGetModel(id)
  if (wanGet) return wanGet
  return DMXAPI_QUERY_MODEL
}

function pickWanR2vSize(extra) {
  const ratio = String(extra.ratio || extra.aspect_ratio || '16:9').trim()
  const res = String(extra.resolution || '720p').toLowerCase()
  const is1080 = res === '1080p'
  const map = {
    '16:9': is1080 ? '1920*1080' : '1280*720',
    '9:16': is1080 ? '1080*1920' : '720*1280',
    '1:1': is1080 ? '1440*1440' : '960*960',
    '4:3': is1080 ? '1632*1248' : '1088*832',
    '3:4': is1080 ? '1248*1632' : '832*1088',
  }
  return map[ratio] || (is1080 ? '1920*1080' : '1280*720')
}

function pickWanR2vDuration(extra) {
  const n = Number(extra.duration)
  if (!Number.isFinite(n)) return 5
  return Math.min(10, Math.max(2, Math.round(n)))
}

/** 万相 r2v 用 character1/2 引用 reference_urls 顺序；先图后视频与 UI 附件顺序一致 */
function transformWanCharacterReferences(prompt, imageCount, videoCount) {
  let text = transformMediaReferences(String(prompt || '').trim(), imageCount, videoCount)
  for (let i = 1; i <= imageCount; i++) {
    text = text.replace(new RegExp(`图片${i}(?![0-9])`, 'g'), `character${i}`)
  }
  for (let i = 1; i <= videoCount; i++) {
    const charIdx = imageCount + i
    text = text.replace(new RegExp(`视频${i}(?![0-9])`, 'g'), `character${charIdx}`)
  }
  return text
}

function buildWanR2vCreateTaskBody({ model, prompt, extra, imageUrls, videoUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  const vids = Array.isArray(videoUrls)
    ? videoUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []

  if (urls.length > 5) {
    const err = new Error('万相参考生视频最多 5 张参考图，请删除多余图片后重试。')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  if (vids.length > 3) {
    const err = new Error('万相参考生视频最多 3 段参考视频，请删除多余视频后重试。')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  if (urls.length + vids.length > 5) {
    const err = new Error('万相参考生视频参考图与参考视频合计最多 5 个，请减少附件后重试。')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  const referenceUrls = [...urls.map((u) => String(u).trim()), ...vids.map((u) => String(u).trim())]

  let text = transformWanCharacterReferences(prompt, urls.length, vids.length)
  if (!text && referenceUrls.length) text = '根据参考素材生成视频'

  const {
    model: _m,
    content: _c,
    input: _i,
    parameters: _p,
    ratio: _ratio,
    aspect_ratio: _ar,
    duration: _dur,
    resolution: _res,
    negative_prompt: _np,
    shot_type: _st,
    watermark: _wm,
    seed: _seed,
    ...restExtra
  } = safeExtra

  const input = {
    prompt: text,
    reference_urls: referenceUrls,
    negative_prompt: String(safeExtra.negative_prompt || '').trim(),
  }

  const parameters = {
    size: pickWanR2vSize(safeExtra),
    duration: pickWanR2vDuration(safeExtra),
    shot_type: safeExtra.shot_type || 'single',
    watermark: DEFAULT_VIDEO_WATERMARK,
    ...restExtra,
  }
  if (safeExtra.seed != null && safeExtra.seed !== '') {
    parameters.seed = Number(safeExtra.seed)
  }

  return {
    model,
    input,
    parameters,
  }
}

function pickWanI2vResolution(extra) {
  const res = String(extra.resolution || '720p').toLowerCase()
  return res === '1080p' ? '1080P' : '720P'
}

function pickWanI2vDuration(extra) {
  const n = Number(extra.duration)
  if (!Number.isFinite(n)) return 5
  return Math.min(15, Math.max(2, Math.round(n)))
}

/** 万相 wan2.x-i2v：首帧图 + prompt 对象 input */
function buildWanI2vCreateTaskBody({ model, prompt, extra, imageUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  if (urls.length < 1) {
    const err = new Error('万相图生视频需要 1 张首帧参考图，请上传图片后重试。')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  if (urls.length > 1) {
    const err = new Error('万相图生视频仅支持 1 张首帧图，请只保留一张图片后重试。')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  let text = transformMediaReferences(String(prompt || '').trim(), 1, 0)
  if (!text) text = '根据首帧图生成视频'

  const {
    model: _m,
    content: _c,
    input: _i,
    parameters: _p,
    ratio: _ratio,
    aspect_ratio: _ar,
    duration: _dur,
    resolution: _res,
    negative_prompt: _np,
    shot_type: _st,
    watermark: _wm,
    seed: _seed,
    ...restExtra
  } = safeExtra

  const input = {
    prompt: text,
    img_url: String(urls[0]).trim(),
    negative_prompt: String(safeExtra.negative_prompt || '').trim(),
  }

  const parameters = {
    resolution: pickWanI2vResolution(safeExtra),
    duration: pickWanI2vDuration(safeExtra),
    shot_type: safeExtra.shot_type || 'single',
    prompt_extend: safeExtra.prompt_extend !== false,
    watermark: DEFAULT_VIDEO_WATERMARK,
    ...restExtra,
  }
  if (safeExtra.seed != null && safeExtra.seed !== '') {
    parameters.seed = Number(safeExtra.seed)
  }

  return { model, input, parameters }
}

function pickWanT2vDuration(extra) {
  const n = Number(extra.duration)
  if (!Number.isFinite(n)) return 5
  return Math.min(15, Math.max(2, Math.round(n)))
}

/** 万相 wan2.x-t2v：纯文本 prompt 对象 input */
function buildWanT2vCreateTaskBody({ model, prompt, extra }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const text = String(prompt || '').trim()
  if (!text) {
    const err = new Error('万相文生视频需要填写提示词。')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  const {
    model: _m,
    content: _c,
    input: _i,
    parameters: _p,
    ratio: _ratio,
    aspect_ratio: _ar,
    duration: _dur,
    resolution: _res,
    negative_prompt: _np,
    shot_type: _st,
    watermark: _wm,
    seed: _seed,
    ...restExtra
  } = safeExtra

  const input = {
    prompt: text,
    negative_prompt: String(safeExtra.negative_prompt || '').trim(),
  }

  const parameters = {
    size: pickWanR2vSize(safeExtra),
    duration: pickWanT2vDuration(safeExtra),
    shot_type: safeExtra.shot_type || 'single',
    prompt_extend: safeExtra.prompt_extend !== false,
    watermark: DEFAULT_VIDEO_WATERMARK,
    ...restExtra,
  }
  if (safeExtra.seed != null && safeExtra.seed !== '') {
    parameters.seed = Number(safeExtra.seed)
  }

  return { model, input, parameters }
}

function transformHappyHorseImageReferences(prompt, imageCount) {
  let text = transformMediaReferences(String(prompt || '').trim(), imageCount, 0)
  for (let i = 1; i <= imageCount; i++) {
    text = text.replace(new RegExp(`图片${i}(?![0-9])`, 'g'), `[Image ${i}]`)
    text = text.replace(new RegExp(`@图片${i}(?![0-9])`, 'g'), `[Image ${i}]`)
    text = text.replace(new RegExp(`\\[Image ${i}\\]`, 'gi'), `[Image ${i}]`)
  }
  return text
}

function pickHappyHorseResolution(extra) {
  const res = String(extra.resolution || '720p').toLowerCase()
  return res === '1080p' ? '1080P' : '720P'
}

function pickHappyHorseDuration(extra) {
  const n = Number(extra.duration)
  if (!Number.isFinite(n)) return 5
  return Math.min(15, Math.max(3, Math.round(n)))
}

function buildHappyHorseR2vCreateTaskBody({ model, prompt, extra, imageUrls, videoUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  const vids = Array.isArray(videoUrls)
    ? videoUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []

  if (vids.length > 0) {
    const err = new Error(
      '快乐马参考生视频仅支持 1～9 张参考图，不支持参考视频；请移除参考视频或改用 Seedance / 万相 r2v 模型。',
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  if (urls.length < 1) {
    const err = new Error('快乐马参考生视频至少需要 1 张参考图，请上传图片后重试。')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  if (urls.length > 9) {
    const err = new Error('快乐马参考生视频最多 9 张参考图，请删除多余图片后重试。')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  let text = transformHappyHorseImageReferences(prompt, urls.length)
  if (!text) text = '[Image 1] 根据参考图生成视频'
  if (!/\[Image\s+\d+\]/i.test(text)) {
    text = `[Image 1] ${text}`
  }

  const media = urls.map((u) => ({ type: 'reference_image', url: String(u).trim() }))

  const {
    model: _m,
    content: _c,
    input: _i,
    parameters: _p,
    ratio: _ratio,
    aspect_ratio: _ar,
    duration: _dur,
    resolution: _res,
    watermark: _wm,
    seed: _seed,
    ...restExtra
  } = safeExtra

  const ratio = String(safeExtra.ratio || safeExtra.aspect_ratio || '16:9').trim()
  const parameters = {
    resolution: pickHappyHorseResolution(safeExtra),
    ratio,
    duration: pickHappyHorseDuration(safeExtra),
    watermark: DEFAULT_VIDEO_WATERMARK,
    ...restExtra,
  }
  if (safeExtra.seed != null && safeExtra.seed !== '') {
    parameters.seed = Number(safeExtra.seed)
  }

  return {
    model,
    input: [{ prompt: text, media }],
    parameters,
  }
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

  if (vids.length > 0) {
    const err = new Error(
      '可灵 V3（kling-v3-video-generation）不支持参考视频。请移除参考视频，或改用 Seedance 2.0 / 可灵 V2 动作控制模型。',
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  const limImg = maxRefImages()
  if (urls.length > limImg) {
    const err = new Error(
      `视频接口当前最多支持 ${limImg} 张参考图（可由 ARK_VIDEO_MAX_REF_IMAGES 配置）。请删除多余图片后重试。`,
    )
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  let text = transformMediaReferences(String(prompt || '').trim(), urls.length, 0)
  if (!text && urls.length) text = '根据参考图生成视频'
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
  }

  const {
    model: _m,
    content: _c,
    input: _i,
    media: _media,
    multi_prompt: _mp,
    parameters: _params,
    aspect_ratio: _ar,
    duration: _dur,
    mode: _mode,
    ratio: _ratio,
    resolution: _res,
    audio: _audio,
    watermark: _wm,
    ...restExtra
  } = safeExtra

  const parameters = {
    mode: mode === 'std' ? 'std' : 'pro',
    aspect_ratio: aspectRatio,
    duration,
  }
  if (safeExtra.audio != null) parameters.audio = !!safeExtra.audio
  parameters.watermark = DEFAULT_VIDEO_WATERMARK

  let input
  if (media.length) {
    input = {
      ...restExtra,
      media,
      multi_prompt: [{ prompt: text, duration }],
    }
  } else {
    input = {
      ...restExtra,
      prompt: text,
      multi_shot: false,
    }
  }

  return {
    model,
    input,
    parameters,
  }
}

function buildHappyHorseT2vCreateTaskBody({ model, prompt, extra }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  let text = String(prompt || '').trim()
  if (!text) text = '生成视频'

  const {
    model: _m,
    content: _c,
    input: _i,
    parameters: _p,
    ratio: _ratio,
    aspect_ratio: _ar,
    duration: _dur,
    resolution: _res,
    watermark: _wm,
    seed: _seed,
    ...restExtra
  } = safeExtra

  const ratio = String(safeExtra.ratio || safeExtra.aspect_ratio || '16:9').trim()
  const parameters = {
    resolution: pickHappyHorseResolution(safeExtra),
    ratio,
    duration: pickHappyHorseDuration(safeExtra),
    watermark: DEFAULT_VIDEO_WATERMARK,
    ...restExtra,
  }
  if (safeExtra.seed != null && safeExtra.seed !== '') {
    parameters.seed = Number(safeExtra.seed)
  }

  return {
    model,
    input: [{ prompt: text }],
    parameters,
  }
}

function pickViduResolution(extra) {
  const res = String(extra.resolution || '720p').toLowerCase()
  if (res === '540p' || res === '1080p') return res
  return '720p'
}

function pickViduDuration(extra, min = 1, max = 10) {
  const n = Number(extra.duration)
  if (!Number.isFinite(n)) return 5
  return Math.min(max, Math.max(min, Math.round(n)))
}

function buildViduT2vCreateTaskBody({ model, prompt, extra }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const text = String(prompt || '').trim() || '生成视频'
  const {
    model: _m,
    input: _i,
    content: _c,
    duration: _d,
    aspect_ratio: _ar,
    ratio: _ratio,
    resolution: _res,
    ...restExtra
  } = safeExtra
  return {
    ...restExtra,
    model,
    input: text,
    duration: pickViduDuration(safeExtra, 1, 10),
    aspect_ratio: safeExtra.aspect_ratio || safeExtra.ratio || '16:9',
    resolution: pickViduResolution(safeExtra),
    seed: safeExtra.seed != null ? Number(safeExtra.seed) : 0,
    watermark: DEFAULT_VIDEO_WATERMARK,
  }
}

function buildViduHeadtailCreateTaskBody({ model, prompt, extra, imageUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  if (urls.length < 1) {
    const err = new Error('Vidu 首尾帧模型至少需要 1 张参考图（2 张为首尾帧）')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  if (urls.length > 2) {
    const err = new Error('Vidu 首尾帧模型最多 2 张参考图')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  const text = String(prompt || '').trim() || '根据首尾帧生成视频'
  const {
    model: _m,
    input: _i,
    images: _img,
    duration: _d,
    resolution: _res,
    ...restExtra
  } = safeExtra
  return {
    ...restExtra,
    model,
    input: text,
    images: urls.map((u) => String(u).trim()),
    duration: pickViduDuration(safeExtra, 1, 8),
    resolution: pickViduResolution(safeExtra),
    seed: safeExtra.seed != null ? Number(safeExtra.seed) : 0,
    watermark: DEFAULT_VIDEO_WATERMARK,
  }
}

function buildViduRefCreateTaskBody({ model, prompt, extra, imageUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  if (urls.length < 1) {
    const err = new Error('Vidu 参考生视频至少需要 1 张参考图')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  if (urls.length > 9) {
    const err = new Error('Vidu 参考生视频最多 9 张参考图')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  let text = transformMediaReferences(String(prompt || '').trim(), urls.length, 0)
  if (!text) text = '@1 根据参考图生成视频'
  for (let i = 1; i <= urls.length; i++) {
    text = text.replace(new RegExp(`图片${i}(?![0-9])`, 'g'), `@${i}`)
  }
  const subjects = [{ id: '1', images: urls.map((u) => String(u).trim()), voice_id: '' }]
  const {
    model: _m,
    input: _i,
    subjects: _s,
    duration: _d,
    ...restExtra
  } = safeExtra
  return {
    ...restExtra,
    model,
    input: text,
    subjects,
    duration: pickViduDuration(safeExtra, 1, 10),
    aspect_ratio: safeExtra.aspect_ratio || safeExtra.ratio || '16:9',
    resolution: pickViduResolution(safeExtra),
    seed: safeExtra.seed != null ? Number(safeExtra.seed) : 0,
    watermark: DEFAULT_VIDEO_WATERMARK,
  }
}

function buildSoraFlatCreateTaskBody({ model, prompt, extra, imageUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const text = String(prompt || '').trim() || '生成视频'
  const ratio = String(safeExtra.ratio || safeExtra.aspect_ratio || '16:9').trim()
  const isPortrait = ratio === '9:16'
  const size =
    safeExtra.size ||
    (String(safeExtra.resolution || '').includes('1080')
      ? isPortrait
        ? '1080x1920'
        : '1920x1080'
      : isPortrait
        ? '720x1280'
        : '1280x720')
  const dur = Number(safeExtra.duration)
  const seconds = dur === 12 ? '12' : dur === 8 ? '8' : dur === 6 ? '6' : '4'
  const body = {
    model,
    input: text,
    seconds,
    size,
  }
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  if (urls.length > 0) body.image = String(urls[0]).trim()
  return body
}

/** 海螺图生视频 body（由 hailuoVideoClient 发送，非 /responses） */
function buildHailuoI2vCreateTaskBody({ model, prompt, extra, imageUrls }) {
  const safeExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {}
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).trim().startsWith('http'))
    : []
  if (urls.length < 1) {
    const err = new Error('海螺图生视频需要至少 1 张参考图')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  const text = String(prompt || '').trim() || '根据参考图生成视频'
  const dur = Number(safeExtra.duration)
  return {
    model,
    prompt: text,
    image: String(urls[0]).trim(),
    duration: Number.isFinite(dur) ? dur : 6,
    resolution: safeExtra.resolution || '768P',
  }
}

/**
 * Seedance / Ark 默认多模态 content[] 构造
 */
function buildSeedanceMultimodalBody({ model, prompt, extra, imageUrls, videoUrls }) {
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

  const { model: _m, content: _c, input: _i, watermark: _wm, ...restExtra } = safeExtra
  return {
    ...restExtra,
    model,
    content,
    watermark: DEFAULT_VIDEO_WATERMARK,
  }
}

/**
 * 构造创建任务请求体（Profile 驱动；兼容旧调用）
 */
function buildCreateTaskBody({ model, prompt, extra, imageUrls, videoUrls, profile: profileOverride }) {
  const profiles = require('./videoApiProfiles')
  const profile = profiles.resolveVideoProfile(model, profileOverride)
  if (profile) {
    return profiles.buildVideoTaskPayload(profile, {
      model,
      prompt,
      extra,
      imageUrls,
      videoUrls,
    })
  }
  return buildSeedanceMultimodalBody({ model, prompt, extra, imageUrls, videoUrls })
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
async function createContentsGenerationTask(payload, profileOverride = '') {
  const modelId = payload?.model || ''
  const profiles = require('./videoApiProfiles')
  const profile =
    profiles.resolveVideoProfile(modelId, profileOverride) ||
    profiles.getProfileById('seedance-multimodal')
  const transport = require('./videoApiTransport')
  return transport.createVideoTask(profile, payload)
}

/**
 * 查询任务状态
 */
async function getContentsGenerationTask(taskId, createModelId = '', profileOverride = '') {
  const transport = require('./videoApiTransport')
  const profiles = require('./videoApiProfiles')
  const profile =
    profiles.resolveVideoProfile(createModelId, profileOverride) ||
    profiles.getProfileById('seedance-multimodal')
  return transport.getVideoTaskStatus(profile, taskId, createModelId)
}

function pickTaskId(remote, profileOverride = '') {
  const transport = require('./videoApiTransport')
  const profiles = require('./videoApiProfiles')
  const profile = profileOverride ? profiles.getProfileById(profileOverride) : null
  if (profile) return transport.pickTaskIdForProfile(profile, remote)
  if (!remote || typeof remote !== 'object') return ''
  const inner = unwrapDmxapiQueryPayload(remote)?._dmxapiInner
  if (inner?.task_id) return String(inner.task_id).trim()
  const data = remote.data
  if (data && typeof data === 'object') {
    const tid = data.task_id ?? data.taskId ?? data.id
    if (tid != null && String(tid).trim()) return String(tid).trim()
  }
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
  if (inner && typeof inner === 'object') return inner
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
  if (inner?.video_url && String(inner.video_url).startsWith('http')) {
    return String(inner.video_url)
  }
  if (inner?.output?.video_url && String(inner.output.video_url).startsWith('http')) {
    return String(inner.output.video_url)
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

function mapRemoteToJobUpdate(remote, profileOverride = '') {
  const transport = require('./videoApiTransport')
  const profiles = require('./videoApiProfiles')
  const profile = profileOverride ? profiles.getProfileById(profileOverride) : null
  if (profile) return transport.mapRemoteToJobUpdateForProfile(profile, remote)
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
  buildSeedanceMultimodalBody,
  buildKlingV3CreateTaskBody,
  buildKlingCreateTaskBody,
  buildWanR2vCreateTaskBody,
  buildWanI2vCreateTaskBody,
  buildWanT2vCreateTaskBody,
  buildHappyHorseR2vCreateTaskBody,
  buildHappyHorseT2vCreateTaskBody,
  buildViduT2vCreateTaskBody,
  buildViduHeadtailCreateTaskBody,
  buildViduRefCreateTaskBody,
  buildSoraFlatCreateTaskBody,
  buildHailuoI2vCreateTaskBody,
  isKlingV3GenerationModel,
  isWanR2vModel,
  isHappyHorseR2vModel,
  resolveDmxapiQueryModel,
  payloadForProvider,
  apiFetch,
  createContentsGenerationTask,
  getContentsGenerationTask,
  pickTaskId,
  mapRemoteToJobUpdate,
  unwrapDmxapiQueryPayload,
  normalizeRemoteStatus,
  pickResultUrl,
  pickErrorMessage,
  isConfigured: () => !!(API_KEY && String(API_KEY).trim()),
  assertConfigured,
  authHeader,
  apiBase,
}
