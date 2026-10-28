export const SLOT_OPTIONS = [
  { value: "morning", label: "上午" },
  { value: "afternoon", label: "下午" },
]

export const BATCH_TYPE_OPTIONS = [
  { value: "pack", label: "投放素材" },
  { value: "books", label: "书籍分日" },
  { value: "library", label: "云素材" },
  { value: "materials", label: "素材报表" },
  { value: "promo", label: "推广链接" },
]

export const LAUNCH_STATUS_OPTIONS = [
  { value: "pending", label: "未投放" },
  { value: "launched", label: "已投放" },
  { value: "new", label: "新书" },
]

export const MEDIA_SOURCE_OPTIONS = [
  { value: "dy", label: "抖音" },
  { value: "ks", label: "快手" },
  { value: "bd", label: "百度" },
  { value: "adq", label: "ADQ" },
  { value: "no_back", label: "不回传" },
]

export const PROMO_COUNT_OPTIONS = [1, 2, 3, 5]

export const CONVERT_STATUS_OPTIONS = [
  { value: "collected", label: "已收集" },
  { value: "hot", label: "爆款" },
  { value: "converting", label: "转化中" },
  { value: "converted", label: "已转化" },
  { value: "dropped", label: "已放弃" },
]

export const CONVERT_STATUS_MAP = Object.fromEntries(CONVERT_STATUS_OPTIONS.map((x) => [x.value, x.label]))

export function todayDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function inferSlot() {
  return new Date().getHours() < 14 ? "morning" : "afternoon"
}

export function slotLabel(slot) {
  if (slot === "morning") return "上午"
  if (slot === "afternoon") return "下午"
  return slot || "—"
}

export function typeLabel(type) {
  const hit = BATCH_TYPE_OPTIONS.find((x) => x.value === type)
  return hit ? hit.label : type || "—"
}

export function splitPromoUrls(raw) {
  if (raw == null || raw === "") return []
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || "").trim()).filter(Boolean)
  }
  return String(raw)
    .split(/[\n\r|；;，]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "-" && s !== "—")
}

export function convertLabel(status) {
  return CONVERT_STATUS_MAP[status] || status || "—"
}

export function convertTagType(status) {
  if (status === "hot") return "danger"
  if (status === "converting") return "warning"
  if (status === "converted") return "success"
  if (status === "dropped") return "info"
  return ""
}

export function fmtNum(n, digits = 2) {
  if (n == null || n === "") return "—"
  const x = Number(n)
  if (!Number.isFinite(x)) return "—"
  return x.toLocaleString("zh-CN", { maximumFractionDigits: digits })
}

export function fmtPct(ratio, digits = 1) {
  if (ratio == null || ratio === "") return "—"
  const x = Number(ratio)
  if (!Number.isFinite(x)) return "—"
  return `${(x * 100).toLocaleString("zh-CN", { maximumFractionDigits: digits })}%`
}

export function bookTitle(row) {
  if (!row) return "—"
  const name = row.name || row.bookName || "未命名"
  const id = row.externalBookId || ""
  return id ? `${name}（${id}）` : name
}

export function launchLabel(status) {
  if (status === "launched") return "已投放"
  return "未投放"
}

export function mediaSourceLabel(value) {
  const hit = MEDIA_SOURCE_OPTIONS.find((x) => x.value === value)
  return hit ? hit.label : value || "—"
}

export const PROMO_NAME_PREFIX = "点众-倾心书馆-公共配置"

export function publicConfigPromoName(templateName) {
  const n = String(templateName || "").trim()
  return (n ? `${PROMO_NAME_PREFIX}-${n}` : PROMO_NAME_PREFIX).slice(0, 60)
}

export function defaultPromoName({ bookName, channelLabel, mediaSource, rechargeName }) {
  if (rechargeName) return publicConfigPromoName(rechargeName)
  const media = MEDIA_SOURCE_OPTIONS.find((x) => x.value === mediaSource)
  const parts = [String(bookName || "").trim(), String(channelLabel || "").trim(), media ? media.label : ""]
  return parts.filter(Boolean).join("-").slice(0, 60)
}

export function sourceLabel(source) {
  if (source === "dianzhong") return "点众"
  if (source === "yunfan") return "云帆"
  return "手工"
}

export function channelLabel(id, channels) {
  const s = String(id || "").trim()
  if (!s) return "—"
  const hit = (channels || []).find((c) => String(c.id) === s)
  return hit ? hit.label : s
}

export async function copyText(text) {
  const s = String(text || "").trim()
  if (!s) return false
  try {
    await navigator.clipboard.writeText(s)
    ElMessage.success("已复制")
    return true
  } catch {
    ElMessage.error("复制失败")
    return false
  }
}
