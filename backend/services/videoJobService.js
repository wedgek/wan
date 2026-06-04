/**
 * 创建 Seedance 视频任务（供 REST /chat/send 与 POST /video/jobs 复用）
 */
const seedance = require('./seedanceClient')
const transport = require('./videoApiTransport')
const {
  resolveVideoProfile,
  preflightVideoTask,
  mergeConstraints,
  getProfileById,
} = require('./videoApiProfiles')
const { mergeAndPersistJobUsage } = require('./videoJobBilling')

/** 每分钟每用户最大创建任务数 */
const RATE_PER_MINUTE = Math.min(120, Math.max(6, Number(process.env.VIDEO_JOB_RATE_PER_MIN || 24)))
const rateBuckets = new Map()

function allowVideoJobRate(userId) {
  const k = `${userId}:${Math.floor(Date.now() / 60000)}`
  const n = (rateBuckets.get(k) || 0) + 1
  if (n > RATE_PER_MINUTE) return false
  rateBuckets.set(k, n)
  if (rateBuckets.size > 5000) {
    const cutoff = Math.floor(Date.now() / 60000) - 2
    for (const key of rateBuckets.keys()) {
      const minute = Number(key.split(':')[1])
      if (minute < cutoff) rateBuckets.delete(key)
    }
  }
  return true
}

function parseDefaultParams(text) {
  if (!text || !String(text).trim()) return {}
  try {
    const o = JSON.parse(text)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch (_) {
    return {}
  }
}

/** 合并 default_params / options 时禁止带上这些键，否则会与 buildCreateTaskBody 拼好的 multimodal 冲突 */
const ARK_EXTRA_FORBIDDEN = new Set(['content', 'contents', 'input', 'model', 'messages'])

function sanitizeArkExtra(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = { ...raw }
  for (const k of ARK_EXTRA_FORBIDDEN) delete out[k]
  return out
}

function normalizeHttpUrls(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const u of list) {
    const s = u && String(u).trim()
    if (s && s.startsWith('http') && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

function resolveModelRow(dbi, videoModelId) {
  const videoOnly = "status = 0 AND modality = 'video'"
  let modelRow = null
  const mid = Number(videoModelId)
  if (mid > 0) {
    modelRow = dbi.prepare(`SELECT * FROM video_models WHERE id = ? AND ${videoOnly}`).get(mid)
  }
  if (!modelRow) {
    modelRow = dbi
      .prepare(
        `SELECT * FROM video_models WHERE ${videoOnly} AND is_default = 1 ORDER BY sort ASC LIMIT 1`,
      )
      .get()
  }
  if (!modelRow) {
    modelRow = dbi
      .prepare(`SELECT * FROM video_models WHERE ${videoOnly} ORDER BY sort ASC, id ASC LIMIT 1`)
      .get()
  }
  return modelRow
}

function resolveModelProfile(modelRow) {
  const apiProfile = String(modelRow?.api_profile || '').trim()
  const arkModelId = String(modelRow?.api_model_id || '').trim()
  return resolveVideoProfile(arkModelId, apiProfile)
}

/**
 * @param {import('better-sqlite3').Database} dbi
 * @param {object} opts
 */
async function createVideoJob(dbi, opts) {
  const userId = opts.userId
  const rawPrompt = String(opts.prompt || '').trim()
  const options =
    opts.options && typeof opts.options === 'object' && !Array.isArray(opts.options) ? opts.options : {}

  const imgList = normalizeHttpUrls(opts.sourceImageUrls || [])
  const singleImg = opts.sourceImageUrl && String(opts.sourceImageUrl).trim().startsWith('http')
    ? String(opts.sourceImageUrl).trim()
    : ''
  if (singleImg && !imgList.includes(singleImg)) imgList.unshift(singleImg)

  const vidList = normalizeHttpUrls(opts.sourceVideoUrls || [])

  let modeRaw = String(opts.mode || '').toLowerCase()
  if (modeRaw !== 'text' && modeRaw !== 'image' && modeRaw !== 'multimodal') {
    modeRaw = ''
  }

  const hasImg = imgList.length > 0
  const hasVid = vidList.length > 0

  let storeMode = modeRaw
  if (!storeMode) {
    if (hasImg && hasVid) storeMode = 'multimodal'
    else if (hasImg) storeMode = 'image'
    else if (hasVid) storeMode = 'multimodal'
    else storeMode = 'text'
  } else {
    if (hasVid && (storeMode === 'text' || storeMode === 'image')) storeMode = 'multimodal'
    if (hasImg && storeMode === 'text' && !hasVid) storeMode = 'image'
  }

  const modelRow = resolveModelRow(dbi, opts.videoModelId)
  if (!modelRow) {
    return { ok: false, code: 400, message: '没有可用的视频模型，请先在「模型管理」中添加并启用' }
  }

  const profile = resolveModelProfile(modelRow)
  if (!profile) {
    return {
      ok: false,
      code: 400,
      message: `无法识别视频模型「${modelRow.api_model_id}」的 API Profile，请在模型目录配置后重新发布`,
    }
  }

  if (!seedance.isConfigured()) {
    return {
      ok: false,
      code: 503,
      message: '服务端未配置视频 API Key（ARK_API_KEY / DMXAPI_API_KEY），无法调用视频 API',
    }
  }

  let projectId = null
  const pid = Number(opts.projectId ?? opts.project_id)
  if (Number.isFinite(pid) && pid > 0) projectId = pid
  if (projectId) {
    const p = dbi.prepare('SELECT id FROM video_projects WHERE id = ? AND user_id = ?').get(projectId, userId)
    if (!p) return { ok: false, code: 400, message: '项目不存在' }
  }

  const extra = sanitizeArkExtra({ ...parseDefaultParams(modelRow.default_params), ...options })
  extra.watermark = false

  let arkModelId = String(modelRow.api_model_id || '').trim()
  if (hasImg && hasVid && profile.id === 'seedance-multimodal') {
    const multimodalOverride = String(process.env.ARK_MULTIMODAL_MODEL_ID || '').trim()
    if (multimodalOverride) arkModelId = multimodalOverride
  }

  const capsOverride = mergeConstraints(profile)
  const preflight = preflightVideoTask(profile, {
    prompt: rawPrompt,
    imageUrls: hasImg ? imgList : [],
    videoUrls: hasVid ? vidList : [],
    extra,
    constraintsOverride: capsOverride,
  })
  if (!preflight.ok) {
    return { ok: false, code: 400, message: preflight.message }
  }

  let prompt = rawPrompt
  if (!prompt && hasImg && !hasVid) prompt = '根据参考图生成视频'
  if (!prompt && hasVid && !hasImg) prompt = '根据参考视频生成视频'
  if (!prompt && (hasImg || hasVid)) prompt = '根据参考素材生成视频'

  let payload
  try {
    payload = seedance.buildCreateTaskBody({
      model: arkModelId,
      prompt,
      extra,
      imageUrls: hasImg ? imgList : [],
      videoUrls: hasVid ? vidList : [],
      profile: profile.id,
    })
  } catch (e) {
    if (e.code === 'E_ARK_PAYLOAD') {
      return { ok: false, code: 400, message: e.message || '请求参数无效' }
    }
    throw e
  }

  let remote
  try {
    remote = await seedance.createContentsGenerationTask(payload, profile.id)
  } catch (e) {
    console.error(`[videoJobService] create task arkModelId=${arkModelId} video_models.id=${modelRow.id}`, e.message)
    const code = e.code === 'E_ARK_CONFIG' ? 503 : 502
    let msg = e.message || `创建${seedance.providerLabel()}视频任务失败`
    const raw = String(msg)
    const multimodalRejected =
      /first[/\\]last frame.*reference media/i.test(raw) ||
      /参考图.*参考视频|参考视频.*参考图/.test(raw) ||
      /首尾帧.*参考媒体|参考媒体.*首尾帧/.test(raw) ||
      /不能.*混用|不支持.*同时/.test(raw)
    if (code === 502 && hasImg && hasVid && multimodalRejected) {
      msg =
        `视频 API 拒绝了「参考图 + 参考视频」同任务（本次请求 model=${arkModelId}，对应后台视频模型 id=${modelRow.id}）。\n` +
        `说明：并未传错后台条目的 api_model_id；部分模型仍可能对多模态参有限制，请以 DMXAPI/方舟文档为准。\n` +
        `可选：换支持多模态参考的模型（如 doubao-seedance-2-0-260128）、或单任务只传图或只传视频、或在 .env 设置 ARK_MULTIMODAL_MODEL_ID 覆盖模型。\n` +
        `—— 接口原文：${raw}`
    }
    return { ok: false, code, message: msg }
  }

  const wrapped = transport.unwrapCreateResponse(profile, remote)
  let tid = seedance.pickTaskId(wrapped, profile.id)
  if (profile.responseParser === 'kling') {
    const kling = require('./klingVideoClient')
    tid = kling.pickKlingTaskId(remote) || tid
    const requestId = String(remote?.request_id || '').trim()
    if (!tid || tid === requestId) {
      console.error('[videoJobService] kling create missing poll id', JSON.stringify(remote).slice(0, 800))
      return {
        ok: false,
        code: 502,
        message:
          '可灵创建成功但未从 output JSON 解析到 task_id。请确认 DMXAPI 返回含 output[0].content[0].text 的 task_id（见 kling-v3 官方文档）。',
      }
    }
  }
  if (!tid) {
    console.error('[videoJobService] unexpected create response', JSON.stringify(remote).slice(0, 500))
    return { ok: false, code: 502, message: '视频 API 返回中缺少任务 id，请核对接口版本与 VIDEO_API_PROVIDER' }
  }

  const sourceImageCol = hasImg ? imgList[0] : null
  const sourceVideosJson = hasVid ? JSON.stringify(vidList) : null

  const ins = dbi.prepare(
    `INSERT INTO video_jobs (user_id, project_id, video_model_id, external_task_id, status, mode, source_image_url, source_video_urls, prompt, request_payload, api_profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const info = ins.run(
    userId,
    projectId,
    modelRow.id,
    tid,
    'processing',
    storeMode,
    sourceImageCol,
    sourceVideosJson,
    prompt,
    JSON.stringify({
      payload,
      remotePreview: { id: tid },
      createRemote: remote,
      apiProfile: profile.id,
    }),
    profile.id,
  )

  const jobId = Number(info.lastInsertRowid)
  try {
    await mergeAndPersistJobUsage(dbi, jobId, remote, {
      apiModelId: arkModelId,
      catalogId: modelRow.catalog_id,
    })
  } catch (e) {
    console.warn('[videoJobService] persist usage', jobId, e.message)
  }

  return {
    ok: true,
    id: jobId,
    externalTaskId: tid,
    status: 'processing',
    mode: storeMode,
    prompt,
    apiProfile: profile.id,
  }
}

module.exports = {
  createVideoJob,
  parseDefaultParams,
  resolveModelRow,
  resolveModelProfile,
  allowVideoJobRate,
  mergeConstraints,
  getProfileById,
}
