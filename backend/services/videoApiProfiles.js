/**
 * 视频模型 API Profile 注册表：协议族 → builder / queryModel / 能力约束
 */
const seedance = require('./seedanceClient')

const DMXAPI_QUERY_MODEL = (process.env.DMXAPI_QUERY_MODEL || 'seedance-2-0-get').trim()

const DEFAULT_CONSTRAINTS = {
  supportsReferenceImage: true,
  supportsReferenceVideo: false,
  requiresImageWithVideo: false,
  maxRefImages: 9,
  maxRefVideos: 0,
  maxRefTotal: 12,
  /** 生成成片时长（秒） */
  durationMin: 4,
  durationMax: 15,
  durationChoices: null,
  /** 参考视频输入时长（秒），与成片 durationMin/Max 无关 */
  refVideoDurationMin: 1,
  refVideoDurationMax: 30,
  aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
  resolutions: ['480p', '720p', '1080p'],
}

function isQueryModelId(apiModelId) {
  const id = String(apiModelId || '').toLowerCase()
  if (!id) return true
  return /-get(?:$|-)/.test(id) || id.endsWith('-get-all')
}

/** @type {Array<{ id: string, label: string, transport: string, queryModel: string, responseParser: string, builder: string, constraints: object, infer: (id: string) => boolean }>} */
const PROFILE_REGISTRY = [
  {
    id: 'vidu-ref',
    label: 'Vidu 参考生视频',
    transport: 'dmxapi-responses',
    queryModel: 'vidu-get',
    responseParser: 'vidu',
    builder: 'viduRef',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: false,
      maxRefImages: 9,
      maxRefVideos: 0,
      maxRefTotal: 9,
      durationMin: 1,
      durationMax: 10,
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['540p', '720p', '1080p'],
    },
    infer: (id) => /^viduq2-ctv|^viduq2$/.test(id),
  },
  {
    id: 'vidu-headtail',
    label: 'Vidu 首尾帧',
    transport: 'dmxapi-responses',
    queryModel: 'vidu-get',
    responseParser: 'vidu',
    builder: 'viduHeadtail',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: false,
      maxRefImages: 2,
      maxRefVideos: 0,
      maxRefTotal: 2,
      durationMin: 1,
      durationMax: 8,
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['540p', '720p', '1080p'],
    },
    infer: (id) => /^viduq2-pro|^viduq2-turbo/.test(id),
  },
  {
    id: 'vidu-t2v',
    label: 'Vidu 文生视频',
    transport: 'dmxapi-responses',
    queryModel: 'vidu-get',
    responseParser: 'vidu',
    builder: 'viduT2v',
    constraints: {
      supportsReferenceImage: false,
      supportsReferenceVideo: false,
      maxRefImages: 0,
      maxRefVideos: 0,
      maxRefTotal: 0,
      durationMin: 1,
      durationMax: 10,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['540p', '720p', '1080p'],
    },
    infer: (id) => /^viduq\d|^vidu-/.test(id) && !/^viduq2-ctv|^viduq2-pro|^viduq2-turbo|^vidu-get/.test(id),
  },
  {
    id: 'hailuo-i2v',
    label: '海螺 图生视频',
    transport: 'dmxapi-hailuo',
    queryModel: '',
    responseParser: 'hailuo',
    builder: 'hailuoI2v',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: false,
      maxRefImages: 1,
      maxRefVideos: 0,
      maxRefTotal: 1,
      durationMin: 6,
      durationMax: 10,
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['512P', '768P', '1080P'],
    },
    infer: (id) => /^minimax-hailuo|^hailuo-/.test(id),
  },
  {
    id: 'sora-flat',
    label: 'Sora/Veo 扁平文生',
    transport: 'dmxapi-responses',
    queryModel: 'sora-get',
    responseParser: 'sora',
    builder: 'soraFlat',
    constraints: {
      supportsReferenceImage: false,
      supportsReferenceVideo: false,
      maxRefImages: 0,
      maxRefVideos: 0,
      maxRefTotal: 0,
      durationMin: 4,
      durationMax: 12,
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
    },
    infer: (id) => /^sora-|^veo-/.test(id),
  },
  {
    id: 'happyhorse-r2v',
    label: '快乐马 参考生视频',
    transport: 'dmxapi-responses',
    queryModel: 'happyhorse-get',
    responseParser: 'happyhorse',
    builder: 'happyhorseR2v',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: false,
      maxRefImages: 9,
      maxRefVideos: 0,
      maxRefTotal: 9,
      durationMin: 3,
      durationMax: 15,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['720p', '1080p'],
    },
    infer: (id) => /^happyhorse.*r2v/.test(id),
  },
  {
    id: 'happyhorse-t2v',
    label: '快乐马 文生视频',
    transport: 'dmxapi-responses',
    queryModel: 'happyhorse-get',
    responseParser: 'happyhorse',
    builder: 'happyhorseT2v',
    constraints: {
      supportsReferenceImage: false,
      supportsReferenceVideo: false,
      maxRefImages: 0,
      maxRefVideos: 0,
      maxRefTotal: 0,
      durationMin: 3,
      durationMax: 15,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['720p', '1080p'],
    },
    infer: (id) => /^happyhorse.*t2v/.test(id),
  },
  {
    id: 'wan-r2v',
    label: '万相 参考生视频',
    transport: 'dmxapi-responses',
    queryModel: '',
    responseParser: 'seedance-nested',
    builder: 'wanR2v',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: true,
      maxRefImages: 5,
      maxRefVideos: 3,
      maxRefTotal: 5,
      durationMin: 2,
      durationMax: 10,
      refVideoDurationMin: 1,
      refVideoDurationMax: 30,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['720p', '1080p'],
    },
    infer: (id) => /wan2\.[0-9]+-r2v/.test(id),
  },
  {
    id: 'wan-i2v',
    label: '万相 图生视频',
    transport: 'dmxapi-responses',
    queryModel: '',
    responseParser: 'seedance-nested',
    builder: 'wanI2v',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: false,
      maxRefImages: 1,
      maxRefVideos: 0,
      maxRefTotal: 1,
      durationMin: 2,
      durationMax: 15,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['720p', '1080p'],
    },
    infer: (id) => /wan2\.[0-9]+-i2v/.test(id),
  },
  {
    id: 'wan-t2v',
    label: '万相 文生视频',
    transport: 'dmxapi-responses',
    queryModel: '',
    responseParser: 'seedance-nested',
    builder: 'wanT2v',
    constraints: {
      supportsReferenceImage: false,
      supportsReferenceVideo: false,
      maxRefImages: 0,
      maxRefVideos: 0,
      maxRefTotal: 0,
      durationMin: 2,
      durationMax: 15,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['720p', '1080p'],
    },
    infer: (id) => /wan2\.[0-9]+-t2v/.test(id),
  },
  {
    id: 'kling-v3',
    label: '可灵 V3',
    transport: 'dmxapi-responses',
    queryModel: 'kling-v3-get',
    responseParser: 'kling',
    builder: 'klingV3',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: false,
      requiresImageWithVideo: false,
      maxRefImages: 9,
      maxRefVideos: 0,
      maxRefTotal: 9,
      durationMin: 5,
      durationMax: 10,
      durationChoices: [5, 10],
      refVideoDurationMin: 1,
      refVideoDurationMax: 30,
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
    },
    infer: (id) => {
      if (!/^kling/.test(id) || isQueryModelId(id)) return false
      if (/-image2video(?:$|-)/.test(id)) return false
      if (/^kling-v(?:2-[56]|2\.[56])(?:$|-)/.test(id)) return false
      return /kling-v3|kling-3|kling.*video-generation|kling.*omni/.test(id)
    },
  },
  {
    id: 'kling-v2',
    label: '可灵 V2',
    transport: 'dmxapi-responses',
    queryModel: 'kling-v2-6-get',
    responseParser: 'kling',
    builder: 'klingV2',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: true,
      requiresImageWithVideo: true,
      maxRefImages: 1,
      maxRefVideos: 1,
      maxRefTotal: 2,
      durationMin: 5,
      durationMax: 10,
      durationChoices: [5, 10],
      refVideoDurationMin: 1,
      refVideoDurationMax: 30,
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
    },
    infer: (id) => {
      if (!/^kling/.test(id) || isQueryModelId(id)) return false
      if (/-image2video(?:$|-)/.test(id)) return false
      const klingV3 = PROFILE_REGISTRY.find((p) => p.id === 'kling-v3')
      return klingV3 ? !klingV3.infer(id) : true
    },
  },
  {
    id: 'seedance-multimodal',
    label: 'Seedance 多模态',
    transport: 'dmxapi-responses',
    queryModel: DMXAPI_QUERY_MODEL,
    responseParser: 'seedance-nested',
    builder: 'seedanceMultimodal',
    constraints: {
      supportsReferenceImage: true,
      supportsReferenceVideo: true,
      maxRefImages: 9,
      maxRefVideos: 3,
      maxRefTotal: 12,
      durationMin: 4,
      durationMax: 15,
      refVideoDurationMin: 1,
      refVideoDurationMax: 30,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
      resolutions: ['480p', '720p', '1080p'],
    },
    infer: (id) => /doubao-seedance-2|seedance-2/.test(id) || /^ep-/.test(id),
  },
]

const PROFILE_BY_ID = new Map(PROFILE_REGISTRY.map((p) => [p.id, p]))

function inferApiProfile(apiModelId) {
  const id = String(apiModelId || '').toLowerCase().trim()
  if (!id || isQueryModelId(id)) return ''
  for (const p of PROFILE_REGISTRY) {
    if (p.infer(id)) return p.id
  }
  return ''
}

function getProfileById(profileId) {
  return PROFILE_BY_ID.get(String(profileId || '').trim()) || null
}

function resolveVideoProfile(apiModelId, profileOverride = '') {
  const override = String(profileOverride || '').trim()
  if (override && PROFILE_BY_ID.has(override)) {
    return { ...PROFILE_BY_ID.get(override), apiModelId: String(apiModelId || '').trim() }
  }
  const inferred = inferApiProfile(apiModelId)
  if (inferred && PROFILE_BY_ID.has(inferred)) {
    return { ...PROFILE_BY_ID.get(inferred), apiModelId: String(apiModelId || '').trim() }
  }
  if (seedance.PROVIDER === 'ark') {
    return {
      ...PROFILE_BY_ID.get('seedance-multimodal'),
      apiModelId: String(apiModelId || '').trim(),
    }
  }
  return null
}

function mergeConstraints(profile, overrides = null) {
  const base = profile?.constraints || DEFAULT_CONSTRAINTS
  const caps = overrides && typeof overrides === 'object' ? overrides : {}
  const merged = {
    ...DEFAULT_CONSTRAINTS,
    ...base,
    ...caps,
    apiProfile: profile?.id || caps.apiProfile || '',
    queryModel: caps.queryModel || profile?.queryModel || DMXAPI_QUERY_MODEL,
  }
  merged.supportsReferenceVideo = !!merged.supportsReferenceVideo
  merged.supportsReferenceImage = merged.supportsReferenceImage !== false
  merged.requiresImageWithVideo = !!merged.requiresImageWithVideo
  return merged
}

/** 万相 wan2.x-* 创建模型 → wan2.x-get 查询模型（须与创建版本一致） */
function inferWanGetModel(apiModelId) {
  const id = String(apiModelId || '').toLowerCase().trim()
  const m = id.match(/^wan2\.(\d+(?:\.\d+)?)-/)
  if (m) return `wan2.${m[1]}-get`
  return ''
}

function resolveQueryModel(profile, apiModelId = '') {
  if (!profile) return DMXAPI_QUERY_MODEL
  const id = String(apiModelId || profile.apiModelId || '').toLowerCase()
  if (profile.id === 'wan-r2v' || profile.id === 'wan-i2v' || profile.id === 'wan-t2v') {
    const wanGet = inferWanGetModel(id)
    if (wanGet) return wanGet
  }
  if (profile.id === 'kling-v2' && /^kling-v2-6/.test(id)) return 'kling-v2-6-get'
  if (profile.id === 'kling-v2' && /^kling-v2-5/.test(id)) return 'kling-v2-5-get'
  return profile.queryModel || DMXAPI_QUERY_MODEL
}

function buildVideoTaskPayload(profile, ctx) {
  if (!profile) {
    const err = new Error('无法识别视频模型 API Profile，请在模型目录中配置 apiProfile 后重新发布')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  const fn = BUILDERS[profile.builder]
  if (!fn) {
    const err = new Error(`未实现的 Profile builder: ${profile.builder}`)
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  return fn(ctx)
}

function preflightVideoTask(profile, ctx) {
  const c = mergeConstraints(profile, ctx.constraintsOverride)
  const urls = Array.isArray(ctx.imageUrls) ? ctx.imageUrls : []
  const vids = Array.isArray(ctx.videoUrls) ? ctx.videoUrls : []
  const prompt = String(ctx.prompt || '').trim()

  if (!prompt && urls.length === 0 && vids.length === 0) {
    return { ok: false, message: '请填写提示词或上传参考图/视频' }
  }
  if (!c.supportsReferenceImage && urls.length > 0) {
    return { ok: false, message: '当前模型不支持参考图，请移除图片或更换模型' }
  }
  if (!c.supportsReferenceVideo && vids.length > 0) {
    return { ok: false, message: '当前模型不支持参考视频，请移除参考视频或更换模型' }
  }
  if (c.requiresImageWithVideo && vids.length > 0 && urls.length === 0) {
    return { ok: false, message: '当前模型使用参考视频时需同时上传参考图（动作控制）' }
  }
  if (urls.length > c.maxRefImages) {
    return { ok: false, message: `当前模型最多 ${c.maxRefImages} 张参考图，请删除多余图片` }
  }
  if (vids.length > c.maxRefVideos) {
    return { ok: false, message: `当前模型最多 ${c.maxRefVideos} 段参考视频，请删除多余视频` }
  }
  if (urls.length + vids.length > c.maxRefTotal) {
    return { ok: false, message: `当前模型参考附件合计最多 ${c.maxRefTotal} 个，请减少附件` }
  }
  const dur = Number(ctx.extra?.duration)
  if (Number.isFinite(dur)) {
    const choices = Array.isArray(c.durationChoices) ? c.durationChoices : null
    if (choices?.length) {
      if (!choices.includes(dur)) {
        return {
          ok: false,
          message: `当前模型成片时长仅支持 ${choices.join('、')} 秒`,
        }
      }
    } else if (dur < c.durationMin || dur > c.durationMax) {
      return {
        ok: false,
        message: `当前模型成片时长须在 ${c.durationMin}～${c.durationMax} 秒之间`,
      }
    }
  }
  return { ok: true, constraints: c }
}

const BUILDERS = {
  seedanceMultimodal: (ctx) =>
    seedance.buildSeedanceMultimodalBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
      videoUrls: ctx.videoUrls,
    }),
  wanR2v: (ctx) =>
    seedance.buildWanR2vCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
      videoUrls: ctx.videoUrls,
    }),
  wanI2v: (ctx) =>
    seedance.buildWanI2vCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
    }),
  wanT2v: (ctx) =>
    seedance.buildWanT2vCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
    }),
  happyhorseR2v: (ctx) =>
    seedance.buildHappyHorseR2vCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
      videoUrls: ctx.videoUrls,
    }),
  happyhorseT2v: (ctx) =>
    seedance.buildHappyHorseT2vCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
    }),
  klingV2: (ctx) =>
    seedance.buildKlingCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
      videoUrls: ctx.videoUrls,
    }),
  klingV3: (ctx) =>
    seedance.buildKlingV3CreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
      videoUrls: ctx.videoUrls,
    }),
  viduT2v: (ctx) =>
    seedance.buildViduT2vCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
    }),
  viduHeadtail: (ctx) =>
    seedance.buildViduHeadtailCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
    }),
  viduRef: (ctx) =>
    seedance.buildViduRefCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
    }),
  soraFlat: (ctx) =>
    seedance.buildSoraFlatCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
    }),
  hailuoI2v: (ctx) =>
    seedance.buildHailuoI2vCreateTaskBody({
      model: ctx.model,
      prompt: ctx.prompt,
      extra: ctx.extra,
      imageUrls: ctx.imageUrls,
    }),
}

function listProfileOptions() {
  return PROFILE_REGISTRY.map((p) => ({ id: p.id, label: p.label }))
}

function buildCatalogCapabilitiesFromProfile(apiModelId, profileId, modality, hint = '', overrides = null) {
  const profile = getProfileById(profileId) || getProfileById(inferApiProfile(apiModelId))
  const caps = overrides && typeof overrides === 'object' ? { ...overrides } : {}
  if (modality !== 'video' || !profile) {
    if (caps.supportsReferenceVideo !== undefined) delete caps.supportsReferenceVideo
    return caps
  }
  const merged = mergeConstraints(profile, caps)
  return {
    apiProfile: profile.id,
    queryModel: resolveQueryModel(profile, apiModelId) || merged.queryModel,
    supportsReferenceVideo: merged.supportsReferenceVideo,
    supportsReferenceImage: merged.supportsReferenceImage,
    requiresImageWithVideo: merged.requiresImageWithVideo,
    maxRefImages: merged.maxRefImages,
    maxRefVideos: merged.maxRefVideos,
    maxRefTotal: merged.maxRefTotal,
    durationMin: merged.durationMin,
    durationMax: merged.durationMax,
    durationChoices: merged.durationChoices,
    refVideoDurationMin: merged.refVideoDurationMin,
    refVideoDurationMax: merged.refVideoDurationMax,
    aspectRatios: merged.aspectRatios,
    resolutions: merged.resolutions,
  }
}

module.exports = {
  PROFILE_REGISTRY,
  DEFAULT_CONSTRAINTS,
  inferApiProfile,
  getProfileById,
  resolveVideoProfile,
  mergeConstraints,
  inferWanGetModel,
  resolveQueryModel,
  buildVideoTaskPayload,
  preflightVideoTask,
  listProfileOptions,
  buildCatalogCapabilitiesFromProfile,
  isQueryModelId,
}
