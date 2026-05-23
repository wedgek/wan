/**
 * 对话创作：当前选中模型的上传/生成约束（优先用 list-enabled 返回的 constraints）
 */

export const DEFAULT_VIDEO_CONSTRAINTS = {
  supportsReferenceImage: true,
  supportsReferenceVideo: false,
  requiresImageWithVideo: false,
  maxRefImages: 9,
  maxRefVideos: 3,
  maxRefTotal: 12,
  durationMin: 4,
  durationMax: 15,
  durationChoices: null,
  refVideoDurationMin: 1,
  refVideoDurationMax: 30,
  aspectRatios: ["16:9", "9:16", "1:1"],
  resolutions: ["720p", "1080p"],
}

export function modelConstraints(model) {
  if (!model) return { ...DEFAULT_VIDEO_CONSTRAINTS }
  if (model.constraints && typeof model.constraints === "object") {
    return { ...DEFAULT_VIDEO_CONSTRAINTS, ...model.constraints }
  }
  return {
    ...DEFAULT_VIDEO_CONSTRAINTS,
    supportsReferenceVideo: !!model.supportsReferenceVideo,
    maxRefVideos: model.supportsReferenceVideo ? 3 : 0,
  }
}

/** 生成成片可选时长（秒） */
export function outputDurationChoices(constraints) {
  const c = constraints && typeof constraints === "object" ? constraints : DEFAULT_VIDEO_CONSTRAINTS
  if (Array.isArray(c.durationChoices) && c.durationChoices.length) {
    return c.durationChoices.map(Number).filter((n) => Number.isFinite(n))
  }
  const min = Number(c.durationMin)
  const max = Number(c.durationMax)
  const lo = Number.isFinite(min) ? min : DEFAULT_VIDEO_CONSTRAINTS.durationMin
  const hi = Number.isFinite(max) ? max : DEFAULT_VIDEO_CONSTRAINTS.durationMax
  const list = []
  for (let s = lo; s <= hi; s++) list.push(s)
  return list.length ? list : [5]
}

/** 将成片时长钳制到当前模型允许范围 */
export function clampOutputDuration(constraints, sec) {
  const choices = outputDurationChoices(constraints)
  const n = Number(sec)
  if (!Number.isFinite(n)) return choices[0]
  if (choices.includes(n)) return n
  return choices.reduce((best, cur) => (Math.abs(cur - n) < Math.abs(best - n) ? cur : best), choices[0])
}

export function refVideoDurationMin(constraints) {
  const c = constraints && typeof constraints === "object" ? constraints : DEFAULT_VIDEO_CONSTRAINTS
  const n = Number(c.refVideoDurationMin)
  if (Number.isFinite(n) && n > 0) return n
  return DEFAULT_VIDEO_CONSTRAINTS.refVideoDurationMin
}

export function refVideoDurationMax(constraints) {
  const c = constraints && typeof constraints === "object" ? constraints : DEFAULT_VIDEO_CONSTRAINTS
  const n = Number(c.refVideoDurationMax)
  if (Number.isFinite(n) && n > 0) return n
  return DEFAULT_VIDEO_CONSTRAINTS.refVideoDurationMax
}

export function modelAllowsReferenceVideo(model) {
  return !!modelConstraints(model).supportsReferenceVideo
}

export function modelAllowsReferenceImage(model) {
  return modelConstraints(model).supportsReferenceImage !== false
}

export function modelCapabilityTags(model) {
  const c = modelConstraints(model)
  const tags = []
  if (c.supportsReferenceImage) tags.push("参考图")
  if (c.supportsReferenceVideo) tags.push("参考视频")
  if (c.requiresImageWithVideo) tags.push("需图+视频")
  return tags
}

export function pruneAttachmentsForModel(model, images, videos, videosMeta) {
  const c = modelConstraints(model)
  let nextImages = [...(images || [])]
  let nextVideos = [...(videos || [])]
  let nextMeta = [...(videosMeta || [])]
  const notes = []

  if (!c.supportsReferenceImage && nextImages.length) {
    nextImages = []
    notes.push("当前模型不支持参考图，已移除图片")
  }
  if (!c.supportsReferenceVideo && nextVideos.length) {
    nextVideos = []
    nextMeta = []
    notes.push("当前模型不支持参考视频，已移除视频")
  }
  if (nextImages.length > c.maxRefImages) {
    nextImages = nextImages.slice(0, c.maxRefImages)
    notes.push(`参考图最多 ${c.maxRefImages} 张，已自动裁剪`)
  }
  if (nextVideos.length > c.maxRefVideos) {
    nextVideos = nextVideos.slice(0, c.maxRefVideos)
    nextMeta = nextMeta.slice(0, c.maxRefVideos)
    notes.push(`参考视频最多 ${c.maxRefVideos} 段，已自动裁剪`)
  }
  const total = nextImages.length + nextVideos.length
  if (total > c.maxRefTotal) {
    while (nextImages.length + nextVideos.length > c.maxRefTotal && nextVideos.length) {
      nextVideos.pop()
      nextMeta.pop()
    }
    while (nextImages.length + nextVideos.length > c.maxRefTotal && nextImages.length) {
      nextImages.pop()
    }
    notes.push(`参考附件合计最多 ${c.maxRefTotal} 个，已自动裁剪`)
  }
  return { images: nextImages, videos: nextVideos, videosMeta: nextMeta, notes }
}
