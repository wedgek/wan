/**
 * 海螺 MiniMax 视频生成 REST API（非 /v1/responses）
 * 文档：https://doc.dmxapi.cn/hailuo-img2video.html
 */
const API_KEY =
  process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || process.env.DMXAPI_API_KEY || ''

const ORIGIN = (process.env.DMXAPI_API_BASE || 'https://www.dmxapi.cn/v1')
  .replace(/\/+$/, '')
  .replace(/\/v1$/, '')

function authHeaders() {
  const key = String(API_KEY || '').trim()
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}`,
  }
}

async function hailuoFetch(path, { method = 'GET', body } = {}) {
  if (!API_KEY) {
    const err = new Error('未配置 ARK_API_KEY / DMXAPI_API_KEY')
    err.code = 'E_ARK_CONFIG'
    throw err
  }
  const url = `${ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
  const opts = { method, headers: authHeaders() }
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
      (data && (data.message || data.error?.message || data.msg || data.base_resp?.status_msg)) ||
      text ||
      `HTTP ${res.status}`
    const err = new Error(String(msg))
    err.code = 'E_ARK_HTTP'
    err.status = res.status
    err.detail = data
    throw err
  }
  return data
}

async function createVideoGenerationTask(payload) {
  const body = { ...payload }
  delete body.last_frame_image
  return hailuoFetch('/video_generation', { method: 'POST', body })
}

async function queryVideoGenerationTask(taskId) {
  return hailuoFetch(`/query/video_generation?task_id=${encodeURIComponent(String(taskId))}`, {
    method: 'GET',
  })
}

async function retrieveVideoFile(fileId) {
  return hailuoFetch(`/files/retrieve?file_id=${encodeURIComponent(String(fileId))}`, {
    method: 'GET',
  })
}

function pickHailuoTaskId(remote) {
  if (!remote || typeof remote !== 'object') return ''
  return String(remote.task_id || remote.data?.task_id || remote.id || '').trim()
}

function mapHailuoRemoteToJobUpdate(remote, fileUrl = '') {
  const statusRaw = String(
    remote?.status || remote?.data?.status || remote?.task_status || '',
  ).toLowerCase()
  let status = 'pending'
  if (['success', 'succeeded', 'completed', 'done'].includes(statusRaw)) status = 'succeeded'
  else if (['fail', 'failed', 'error'].includes(statusRaw)) status = 'failed'
  else if (['processing', 'running', 'queueing', 'pending'].includes(statusRaw))
    status = statusRaw === 'pending' || statusRaw === 'queueing' ? 'pending' : 'processing'

  const fileId = remote?.file_id || remote?.data?.file_id || ''
  let resultUrl = fileUrl || ''
  if (!resultUrl && remote?.file?.download_url) resultUrl = String(remote.file.download_url)
  if (!resultUrl && remote?.data?.file?.download_url) resultUrl = String(remote.data.file.download_url)

  const errorMessage =
    status === 'failed'
      ? String(remote?.base_resp?.status_msg || remote?.message || remote?.fail_reason || 'failed')
      : ''

  return { status, resultUrl, errorMessage, fileId: String(fileId || '').trim() }
}

module.exports = {
  createVideoGenerationTask,
  queryVideoGenerationTask,
  retrieveVideoFile,
  pickHailuoTaskId,
  mapHailuoRemoteToJobUpdate,
}
