/**
 * 模型目录能力推断（与 backend modelCatalogService / videoApiProfiles 规则保持一致）
 */

const PROFILE_INFER_RULES = [
  { id: "vidu-ref", test: (id) => /^viduq2-ctv|^viduq2$/.test(id) },
  { id: "vidu-headtail", test: (id) => /^viduq2-pro|^viduq2-turbo/.test(id) },
  {
    id: "vidu-t2v",
    test: (id) => /^viduq\d|^vidu-/.test(id) && !/^viduq2-ctv|^viduq2-pro|^viduq2-turbo|^vidu-get/.test(id),
  },
  { id: "hailuo-i2v", test: (id) => /^minimax-hailuo|^hailuo-/.test(id) },
  { id: "sora-flat", test: (id) => /^sora-|^veo-/.test(id) },
  { id: "happyhorse-r2v", test: (id) => /^happyhorse.*r2v/.test(id) },
  { id: "happyhorse-t2v", test: (id) => /^happyhorse.*t2v/.test(id) },
  { id: "wan-r2v", test: (id) => /wan2\.[0-9]+-r2v/.test(id) },
  { id: "wan-i2v", test: (id) => /wan2\.[0-9]+-i2v/.test(id) },
  { id: "wan-t2v", test: (id) => /wan2\.[0-9]+-t2v/.test(id) },
  {
    id: "kling-v3",
    test: (id) =>
      /^kling/.test(id) &&
      !/-get(?:$|-)/.test(id) &&
      !/-image2video(?:$|-)/.test(id) &&
      !/^kling-v(?:2-[56]|2\.[56])(?:$|-)/.test(id) &&
      /kling-v3|kling-3|kling.*video-generation|kling.*omni/.test(id),
  },
  {
    id: "kling-v2",
    test: (id) => {
      if (!/^kling/.test(id) || /-get(?:$|-)/.test(id)) return false
      const klingV3 = PROFILE_INFER_RULES.find((r) => r.id === "kling-v3")
      return klingV3 ? !klingV3.test(id) : true
    },
  },
  { id: "seedance-multimodal", test: (id) => /doubao-seedance-2|seedance-2/.test(id) || /^ep-/.test(id) },
]

/** 与 backend videoApiProfiles.constraints.supportsReferenceVideo 对齐 */
const REF_VIDEO_PROFILES = new Set(["wan-r2v", "seedance-multimodal", "kling-v2"])

export function inferApiProfile(apiModelId) {
  const id = String(apiModelId || "").toLowerCase()
  if (!id || /-get(?:$|-)/.test(id) || id.endsWith("-get-all")) return ""
  for (const rule of PROFILE_INFER_RULES) {
    if (rule.test(id)) return rule.id
  }
  return ""
}

export function inferSupportsReferenceVideo(apiModelId, _hint = "") {
  const profile = inferApiProfile(apiModelId)
  if (profile) return REF_VIDEO_PROFILES.has(profile)

  const id = String(apiModelId || "").toLowerCase()
  if (!id || /-get(?:$|-)/.test(id) || id.endsWith("-get-all")) return false

  if (/seedance-2[.-]0|doubao-seedance-2[.-]0/.test(id)) return true
  if (/wan2\.[0-9]+-r2v/.test(id)) return true
  if (/^kling-v(?:2-[56]|2\.[56])(?:$|-)/.test(id) && !/-image2video(?:$|-)/.test(id)) return true

  return false
}
