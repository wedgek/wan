/**
 * DMXAPI 模型元数据：/api/pricing 标签、说明、价格格式化与本地推断补全
 */

const API_KEY =
  process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || process.env.DMXAPI_API_KEY || ''
const USER_ID = (process.env.DMXAPI_USER_ID || '').trim()
const ORIGIN = (process.env.DMXAPI_API_BASE || 'https://www.dmxapi.cn/v1')
  .replace(/\/+$/, '')
  .replace(/\/v1$/, '')

/** 官方页面有说明但 pricing 接口未返回时的兜底（按 model id） */
const KNOWN_DESCRIPTIONS = {
  'kling-v3-video-generation':
    '可灵 V3 视频生成，支持文生视频、图生视频（首尾帧）及续写。',
  'kling-v1-video-generation':
    '可灵视频生成（DMXAPI），支持文生视频与图生视频（首尾帧）。',
  'kling-v3-get': 'kling-v3-get 获取生成的视频。',
  'wan2.6-r2v': '万相 2.6 参考视频（r2v）生成。',
  'happyhorse-1.0-r2v': '万相 2.6 参考视频（r2v）生成。',
  'doubao-seedance-2-0-260128': 'Seedance 2.0 多模态视频，支持参考图与参考视频。',
  'doubao-seedance-2-0-fast-260128': 'Seedance 2.0 Fast 多模态视频。',
}

function authHeaders() {
  const key = String(API_KEY || '').trim()
  const headers = {
    Accept: 'application/json',
    Authorization: key.startsWith('Bearer ') ? key : key,
  }
  if (USER_ID) headers['Rix-Api-User'] = USER_ID
  return headers
}

function formatPriceNum(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0'
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x))
  return x.toFixed(x >= 1 ? 2 : 4).replace(/\.?0+$/, '')
}

/**
 * 将 /api/pricing 的 price_info 格式化为列表展示文案（含税价由平台倍率体现，此处与官网字段对齐）
 */
function formatDmxapiPriceText(entry, groupRatio = 1) {
  const display = buildDmxapiPriceDisplay(entry, groupRatio)
  return formatDmxapiPriceSummary(display)
}

function formatDmxapiPriceSummary(display) {
  if (!display || display.kind === 'empty') return ''
  if (display.kind === 'free') return display.badge || display.prefix || '免费'
  if (display.kind === 'fixed') return display.prefix || ''
  if (display.kind === 'table') {
    const first = display.rows?.[0]
    if (!first) return display.title || '阶梯价格'
    const cells = Array.isArray(first) ? first : first.cells
    return cells ? `${display.title || '阶梯价格'} · ${cells.join(' / ')}` : display.title || ''
  }
  if (display.kind === 'token') {
    return [display.title, ...(display.lines || [])].filter(Boolean).join(' · ')
  }
  return ''
}

function parsePriceInfoTable(priceInfo) {
  if (!priceInfo) return null
  if (Array.isArray(priceInfo)) {
    const rows = priceInfo
      .map((row) => {
        if (Array.isArray(row)) return row.map((c) => String(c ?? ''))
        if (row && typeof row === 'object') {
          return [
            row.type || row.videoType || row.name || row.label || '',
            row.resolution || row.res || '',
            row.price != null ? String(row.price) : row.unitPrice != null ? String(row.unitPrice) : '',
          ].filter((c) => c !== '')
        }
        return null
      })
      .filter(Boolean)
    if (!rows.length) return null
    return {
      kind: 'table',
      title: '价格',
      columns: ['类型', '分辨率', '元/秒'],
      rows,
    }
  }
  if (priceInfo && typeof priceInfo === 'object') {
    const rows = priceInfo.rows || priceInfo.items || priceInfo.list
    if (Array.isArray(rows)) return parsePriceInfoTable(rows)
    const columns = priceInfo.columns || priceInfo.headers
    if (Array.isArray(rows) && Array.isArray(columns)) {
      return { kind: 'table', title: '价格', columns, rows }
    }
  }
  return null
}

function buildDmxapiPriceDisplay(entry, groupRatio = 1, apiModelId = '') {
  const pi = entry?.price_info?.default?.default

  const fromInfo = parsePriceInfoTable(pi?.priceInfo)
  if (fromInfo) return fromInfo

  if (!pi) return { kind: 'empty' }

  if (pi.quota_type === 0) {
    const p = Number(pi.model_price)
    if (!p || p <= 0) {
      return { kind: 'free', prefix: '固定价格：¥0 / 次', badge: '免费' }
    }
    return { kind: 'fixed', prefix: `固定价格：¥${formatPriceNum(p)} / 次` }
  }

  const ratio = Number(pi.model_ratio) || 0
  const completion = Number(pi.model_completion_ratio) || 0
  const gr = Number(groupRatio) || 1
  if (ratio <= 0 && completion <= 0) {
    return { kind: 'free', prefix: '固定价格：¥0 / 次', badge: '免费' }
  }

  const inputPerM = ratio * 2 * gr
  const outputPerM = ratio * completion * 2 * gr
  const lines = []
  if (completion > 10) {
    lines.push(`输出约 ¥${formatPriceNum(outputPerM)} / M tokens`)
  } else if (ratio > 0 && completion > 0) {
    lines.push(`输入 ¥${formatPriceNum(inputPerM)} / M tokens`)
    lines.push(`输出 ¥${formatPriceNum(outputPerM)} / M tokens`)
  } else {
    lines.push(`ratio ${formatPriceNum(ratio)}`)
  }

  return {
    kind: 'token',
    title: '按量计费',
    lines,
  }
}

function isQueryModelId(apiModelId) {
  const id = String(apiModelId || '').toLowerCase()
  if (!id) return true
  return /-get(?:$|-)/.test(id) || id.endsWith('-get-all')
}

function inferDmxapiTags(apiModelId, modality = '') {
  const id = String(apiModelId || '').toLowerCase()
  if (isQueryModelId(id)) {
    if (/image2video|i2v|img2video/.test(id)) return '获取生成视频'
    if (/text2video|t2v/.test(id)) return '获取文生视频'
    if (/video-get|video_generation-get/.test(id)) return '获取生成视频'
    return '获取任务'
  }
  if (modality === 'video' || inferModalityHint(id)) {
    if (/video-generation|video_generation/.test(id)) return '视频生成'
    if (/image2video|i2v|img2video/.test(id)) return '图生视频'
    if (/text2video|t2v/.test(id)) return '文生视频'
    if (/-r2v|reference-video/.test(id)) return '参考视频'
    if (/seedance/.test(id)) return '视频生成'
    if (/kling/.test(id)) return '视频生成'
    if (/wan2\.|happyhorse/.test(id)) return '视频生成'
    return '视频'
  }
  if (modality === 'image' || /image|seedream|flux|midjourney|gpt-image/.test(id)) return '图片'
  if (modality === 'text') return '文本'
  return ''
}

function inferModalityHint(id) {
  return /seedance|kling|vidu|wan2\.|video|hailuo|pixverse|happyhorse|sora/.test(id)
}

function buildSyncRemark(apiModelId, pricingEntry, modality) {
  const fromApi = String(pricingEntry?.description || '').trim()
  if (fromApi) return fromApi.slice(0, 500)
  const known = KNOWN_DESCRIPTIONS[String(apiModelId || '').trim()]
  if (known) return known
  const id = String(apiModelId || '').toLowerCase()
  if (isQueryModelId(id)) {
    return `${apiModelId} 查询/获取任务结果`
  }
  if (modality === 'video') {
    if (/r2v|reference/.test(id)) return `${apiModelId} 参考视频生成`
    if (/image2video|i2v/.test(id)) return `${apiModelId} 图生视频`
    if (/text2video|t2v/.test(id)) return `${apiModelId} 文生视频`
  }
  return ''
}

function mergeRemoteMeta(apiModelId, modality, pricingEntry, groupRatio = 1) {
  const tagsFromApi = String(pricingEntry?.tags || '').trim()
  const tags = tagsFromApi || inferDmxapiTags(apiModelId, modality)
  const remark = buildSyncRemark(apiModelId, pricingEntry, modality)
  const dmxapiPrice = buildDmxapiPriceDisplay(pricingEntry, groupRatio, apiModelId)
  const dmxapiPriceText = formatDmxapiPriceSummary(dmxapiPrice)
  const hint = [remark, tags, pricingEntry?.description || ''].filter(Boolean).join(' ')
  return { tags, remark, dmxapiPriceText, dmxapiPrice, hint }
}

async function fetchDmxapiPricingMap() {
  if (!API_KEY) return { map: new Map(), groupRatio: 1 }
  const res = await fetch(`${ORIGIN}/api/pricing`, { method: 'GET', headers: authHeaders() })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {
    data = null
  }
  if (!res.ok) {
    console.warn('[dmxapiModelMeta] pricing fetch failed', res.status, text.slice(0, 200))
    return { map: new Map(), groupRatio: 1 }
  }
  const groupRatio = Number(data?.data?.group_info?.default?.GroupRatio) || 1
  const map = new Map()
  for (const item of data?.data?.model_info || []) {
    const name = String(item?.model_name || '').trim()
    if (name) map.set(name, item)
  }
  return { map, groupRatio }
}

module.exports = {
  fetchDmxapiPricingMap,
  formatDmxapiPriceText,
  formatDmxapiPriceSummary,
  buildDmxapiPriceDisplay,
  inferDmxapiTags,
  buildSyncRemark,
  mergeRemoteMeta,
  KNOWN_DESCRIPTIONS,
}
