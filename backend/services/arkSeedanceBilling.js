/**
 * 火山方舟 Seedance 2.0 官方计费（与 DMXAPI 按 ratio 计费分离）
 *
 * 官方公示（2026-03）：
 * - 不含视频输入（文/图生视频）：46 元 / 百万 tokens
 * - 含视频输入（参考视频/编辑）：28 元 / 百万 tokens
 *
 * 可通过环境变量覆盖单价（元/百万 tokens）：
 * - ARK_SEEDANCE_PRICE_PURE_PER_M
 * - ARK_SEEDANCE_PRICE_VIDEO_INPUT_PER_M
 */
const { resolveEffectiveProvider, getProfileById } = require('./videoApiProfiles')

function yuanPerMillionPure() {
  const n = Number(process.env.ARK_SEEDANCE_PRICE_PURE_PER_M ?? 46)
  return Number.isFinite(n) && n > 0 ? n : 46
}

function yuanPerMillionWithVideoInput() {
  const n = Number(process.env.ARK_SEEDANCE_PRICE_VIDEO_INPUT_PER_M ?? 28)
  return Number.isFinite(n) && n > 0 ? n : 28
}

function parseJsonField(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch (_) {
    return null
  }
}

function jobHasReferenceVideo(sourceVideoUrlsJson = '', requestPayloadJson = '') {
  const col = parseJsonField(sourceVideoUrlsJson)
  if (Array.isArray(col) && col.some((u) => u && String(u).trim().startsWith('http'))) {
    return true
  }
  const payload = parseJsonField(requestPayloadJson)
  const body = payload?.payload
  if (Array.isArray(body?.content)) {
    if (body.content.some((c) => c?.type === 'video_url' || c?.role === 'reference_video')) {
      return true
    }
  }
  const vids = body?.videoUrls || body?.video_urls
  if (Array.isArray(vids) && vids.some((u) => u && String(u).trim().startsWith('http'))) {
    return true
  }
  return false
}

/** 是否走方舟官方 Seedance 计费（非 DMXAPI ratio 公式） */
function shouldUseArkSeedanceBilling(apiProvider, apiProfile = '') {
  const profile = getProfileById(String(apiProfile || '').trim())
  const effective = resolveEffectiveProvider(profile, apiProvider)
  return effective === 'ark' && profile?.id === 'seedance-multimodal'
}

/**
 * @param {{ input: number, output: number, total?: number }} usage
 * @param {boolean} hasReferenceVideo
 */
function computeArkSeedanceCostYuan(usage, hasReferenceVideo = false) {
  if (!usage || typeof usage !== 'object') return null
  const total =
    Number(usage.total) > 0
      ? Math.floor(Number(usage.total))
      : Math.max(0, Math.floor(Number(usage.input) || 0)) +
        Math.max(0, Math.floor(Number(usage.output) || 0))
  if (total <= 0) return null
  const perM = hasReferenceVideo ? yuanPerMillionWithVideoInput() : yuanPerMillionPure()
  const cost = (total / 1e6) * perM
  return Number.isFinite(cost) ? cost : null
}

function buildArkSeedancePriceDisplay(hasReferenceVideo = false) {
  const pure = yuanPerMillionPure()
  const withVid = yuanPerMillionWithVideoInput()
  const lines = [
    `纯生成（无参考视频）¥${pure} / M tokens`,
    `含参考视频 ¥${withVid} / M tokens`,
  ]
  if (hasReferenceVideo) {
    lines.unshift(`当前任务含参考视频，按 ¥${withVid} / M tokens 估算`)
  }
  return {
    kind: 'token',
    title: '方舟官方按量',
    lines,
    arkOfficial: true,
  }
}

function formatArkSeedancePriceSummary(hasReferenceVideo = false) {
  const pure = yuanPerMillionPure()
  const withVid = yuanPerMillionWithVideoInput()
  if (hasReferenceVideo) {
    return `方舟官方 · 含参考视频 ¥${withVid} / M tokens`
  }
  return `方舟官方 · 纯生成 ¥${pure} / M tokens · 含参考视频 ¥${withVid} / M tokens`
}

module.exports = {
  yuanPerMillionPure,
  yuanPerMillionWithVideoInput,
  jobHasReferenceVideo,
  shouldUseArkSeedanceBilling,
  computeArkSeedanceCostYuan,
  buildArkSeedancePriceDisplay,
  formatArkSeedancePriceSummary,
}
