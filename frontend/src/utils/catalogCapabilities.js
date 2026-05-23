/**
 * 模型目录能力推断（与 backend modelCatalogService 规则保持一致）
 */
export function inferSupportsReferenceVideo(apiModelId, hint = "") {
  const id = String(apiModelId || "").toLowerCase()
  if (!id || /-get(?:$|-)/.test(id) || id.endsWith("-get-all")) return false
  const s = `${id} ${String(hint || "").toLowerCase()}`

  if (/seedance-2[.-]0|doubao-seedance-2[.-]0/.test(s)) return true
  if (/(?:^|[-_/])(?:r2v|reference-video|video-generation)(?:$|[-_/])/.test(id)) return true
  if (/happyhorse.*r2v|wan2\.6-r2v/.test(id)) return true

  if (/kling/.test(id)) {
    if (/-image2video(?:$|-)/.test(id)) return false
    if (/^kling-v(?:2-[56]|3)(?:$|-)/.test(id)) return true
    if (/kling.*omni|kling.*video-generation/.test(id)) return true
  }

  if (/参考视频|reference[\s_-]?video|动作控制|video_list|reference_urls|\br2v\b/.test(s)) return true

  return false
}
