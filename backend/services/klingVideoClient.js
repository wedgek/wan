/**
 * 可灵 DMXAPI
 * - V3 创建/查询：output[].content[].text 内嵌 JSON（task_id UUID、task_status、video_url）
 *   文档：https://doc.dmxapi.cn/kling-v3-video-generation-text-to-video.html
 * - V2 创建：data.task_id（数字）
 */
const seedance = require('./seedanceClient')

function isUuidLike(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || '').trim(),
  )
}

function isLikelyKlingNumericTaskId(v) {
  const s = String(v || '').trim()
  return /^\d{10,}$/.test(s)
}

function pickCandidateId(v, requestId) {
  const s = String(v ?? '').trim()
  if (!s || s === requestId) return ''
  return s
}

/** 解析 output[].content[].text 中的 JSON（V3 官方格式） */
function parseKlingOutputJson(remote) {
  if (!remote || typeof remote !== 'object') return null
  const inner = remote._dmxapiInner
  if (inner && typeof inner === 'object') return inner
  const output = remote.output
  if (!Array.isArray(output)) return null
  for (const block of output) {
    const content = block?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      const text = c?.text
      if (typeof text !== 'string' || !text.trim()) continue
      const t = text.trim()
      if (!t.startsWith('{')) continue
      try {
        const parsed = JSON.parse(t)
        if (parsed && typeof parsed === 'object') return parsed
      } catch (_) {
        /* ignore */
      }
    }
  }
  return null
}

function pickTaskIdFromText(text) {
  const s = String(text || '')
  if (!s) return ''
  const labeled = s.match(/任务\s*ID\s*[:：]\s*([A-Za-z0-9-]+)/i)
  if (labeled?.[1]) return labeled[1].trim()
  const bare = s.match(/\b(\d{12,})\b/)
  return bare?.[1]?.trim() || ''
}

function pickKlingTaskId(remote) {
  if (!remote || typeof remote !== 'object') return ''
  const requestId = String(remote.request_id || '').trim()

  // V3 官方：从 output JSON 取 task_id（UUID）
  const fromOutputJson = parseKlingOutputJson(seedance.unwrapDmxapiQueryPayload(remote))
  if (fromOutputJson) {
    const got = pickCandidateId(fromOutputJson.task_id ?? fromOutputJson.taskId, requestId)
    if (got) return got
  }

  // V2 官方：data.task_id（数字）
  const data = remote.data
  if (data && typeof data === 'object') {
    for (const key of ['task_id', 'taskId']) {
      const got = pickCandidateId(data[key], requestId)
      if (got) return got
    }
  }

  // V2 流式查询文本
  if (Array.isArray(remote.output)) {
    for (const block of remote.output) {
      for (const c of block?.content || []) {
        const fromText = pickTaskIdFromText(c?.text)
        if (fromText) return fromText
      }
    }
  }

  const got = pickCandidateId(remote.task_id, requestId)
  if (got) return got

  return ''
}

function normalizeKlingStatus(raw) {
  const s = String(raw || '').trim().toUpperCase()
  if (!s) return 'processing'
  if (['SUCCEEDED', 'SUCCESS', 'COMPLETED', 'DONE'].includes(s)) return 'succeeded'
  if (['FAILED', 'ERROR', 'FAIL', 'EXPIRED', 'CANCELED', 'CANCELLED', 'UNKNOWN'].includes(s)) {
    return 'failed'
  }
  if (['PENDING', 'SUBMITTED', 'QUEUED'].includes(s)) return 'pending'
  if (['RUNNING', 'PROCESSING', 'IN_PROGRESS'].includes(s)) return 'processing'
  const lower = s.toLowerCase()
  if (['succeeded', 'success', 'completed', 'done'].includes(lower)) return 'succeeded'
  if (['failed', 'error', 'fail', 'expired'].includes(lower)) return 'failed'
  if (['submitted', 'pending', 'queued'].includes(lower)) return 'pending'
  if (['processing', 'running', 'in_progress'].includes(lower)) return 'processing'
  return 'processing'
}

function extractMp4UrlFromText(text) {
  const s = String(text || '')
  if (!s) return ''
  const m = s.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i)
  return m ? m[0] : ''
}

function mapKlingRemoteToJobUpdate(remote) {
  if (!remote || typeof remote !== 'object') {
    return { status: 'pending', resultUrl: '', errorMessage: '' }
  }

  const unwrapped = seedance.unwrapDmxapiQueryPayload(remote)
  const inner = parseKlingOutputJson(unwrapped) || unwrapped?._dmxapiInner
  const data = remote.data && typeof remote.data === 'object' ? remote.data : {}
  const resp = remote.response && typeof remote.response === 'object' ? remote.response : {}

  const status = normalizeKlingStatus(
    inner?.task_status ||
      inner?.status ||
      resp.status ||
      remote.status ||
      data.task_status ||
      data.status ||
      remote.task_status,
  )

  let resultUrl = ''
  if (status === 'succeeded') {
    if (inner?.video_url && String(inner.video_url).startsWith('http')) {
      resultUrl = String(inner.video_url)
    }
    if (!resultUrl && inner?.watermark_video_url && String(inner.watermark_video_url).startsWith('http')) {
      resultUrl = String(inner.watermark_video_url)
    }
    const out = resp.output || remote.output
    if (!resultUrl && Array.isArray(out)) {
      for (const block of out) {
        for (const c of block?.content || []) {
          const fromText = extractMp4UrlFromText(c?.text)
          if (fromText) {
            resultUrl = fromText
            break
          }
          if (typeof c?.text === 'string' && c.text.trim().startsWith('{')) {
            try {
              const j = JSON.parse(c.text)
              const u = j?.video_url || j?.watermark_video_url
              if (u && String(u).startsWith('http')) {
                resultUrl = String(u)
                break
              }
            } catch (_) {
              /* ignore */
            }
          }
        }
        if (resultUrl) break
      }
    }
    const videos = data.task_result?.videos || data.task_result?.video_urls
    if (!resultUrl && Array.isArray(videos) && videos.length) {
      const v0 = videos[0]
      resultUrl = typeof v0 === 'string' ? v0 : String(v0?.url || v0?.video_url || '')
    }
    if (!resultUrl && data.video_url) resultUrl = String(data.video_url)
    if (!resultUrl && resp.video_url) resultUrl = String(resp.video_url)
  }

  const errorMessage =
    status === 'failed'
      ? String(
          inner?.task_status_msg ||
            inner?.message ||
            data.task_status_msg ||
            data.message ||
            resp.message ||
            remote.message ||
            remote.error?.message ||
            inner?.task_status ||
            'failed',
        )
      : ''

  return {
    status,
    resultUrl: resultUrl.startsWith('http') ? resultUrl : '',
    errorMessage,
  }
}

async function queryKlingTask(queryModel, taskId) {
  seedance.assertConfigured()
  const id = String(taskId || '').trim()
  const model = String(queryModel || '').trim()
  if (!id || !model) {
    const err = new Error('可灵查询缺少 taskId 或 queryModel')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }

  const url = `${seedance.apiBase()}/responses`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: seedance.authHeader({ useBearer: false }),
    },
    body: JSON.stringify({ model, input: id }),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {
    data = { raw: text }
  }

  if (res.ok) return data

  // 平台对已失败任务常返回 HTTP 400（使用日志里可能看不到 ¥0 记录，但请求确实发出）
  const errMsg = String(data?.error?.message || data?.message || text || `HTTP ${res.status}`)
  if (/task status:\s*FAILED|任务.*失败|expired|canceled|cancelled|unknown/i.test(errMsg)) {
    return {
      output: [
        {
          content: [
            {
              text: JSON.stringify({
                task_id: id,
                task_status: 'FAILED',
                task_status_msg: errMsg,
              }),
            },
          ],
        },
      ],
    }
  }

  const err = new Error(errMsg)
  err.code = 'E_ARK_HTTP'
  err.status = res.status
  err.detail = data
  throw err
}

module.exports = {
  pickKlingTaskId,
  parseKlingOutputJson,
  isLikelyKlingNumericTaskId,
  isUuidLike,
  mapKlingRemoteToJobUpdate,
  queryKlingTask,
  extractMp4UrlFromText,
  normalizeKlingStatus,
}
