/**
 * 视频 API 传输层：按 Profile 创建/查询/解析响应
 */
const hailuo = require('./hailuoVideoClient')
const kling = require('./klingVideoClient')
const { resolveQueryModel } = require('./videoApiProfiles')

function seedanceClient() {
  return require('./seedanceClient')
}

function payloadForProvider(body) {
  return seedanceClient().payloadForProvider(body)
}

async function createVideoTask(profile, payload) {
  if (!profile) {
    const err = new Error('缺少 video API profile')
    err.code = 'E_ARK_PAYLOAD'
    throw err
  }
  if (profile.transport === 'dmxapi-hailuo') {
    return hailuo.createVideoGenerationTask(payload)
  }
  const client = seedanceClient()
  if (client.PROVIDER === 'dmxapi') {
    return client.apiFetch('/responses', {
      method: 'POST',
      body: payloadForProvider(payload),
      authBearer: false,
    })
  }
  return client.apiFetch('/contents/generations/tasks', { method: 'POST', body: payload })
}

async function getVideoTaskStatus(profile, taskId, apiModelId = '') {
  const id = String(taskId).trim()
  if (!profile) {
    return seedanceClient().getContentsGenerationTask(id, apiModelId)
  }
  if (profile.transport === 'dmxapi-hailuo') {
    const remote = await hailuo.queryVideoGenerationTask(id)
    const mapped = hailuo.mapHailuoRemoteToJobUpdate(remote)
    if (mapped.status === 'succeeded' && mapped.fileId && !mapped.resultUrl) {
      try {
        const file = await hailuo.retrieveVideoFile(mapped.fileId)
        const url = file?.file?.download_url || file?.download_url || ''
        if (url) mapped.resultUrl = String(url)
      } catch (e) {
        console.error('[videoApiTransport] hailuo retrieve', e.message)
      }
    }
    return { ...remote, _transportMapped: mapped }
  }
  const client = seedanceClient()
  if (client.PROVIDER === 'dmxapi') {
    if (profile?.responseParser === 'kling') {
      return kling.queryKlingTask(resolveQueryModel(profile, apiModelId), id)
    }
    return client.apiFetch('/responses', {
      method: 'POST',
      body: {
        model: resolveQueryModel(profile, apiModelId),
        input: id,
      },
      authBearer: false,
    })
  }
  return client.apiFetch(`/contents/generations/tasks/${encodeURIComponent(id)}`, { method: 'GET' })
}

function unwrapCreateResponse(profile, remote) {
  if (profile?.transport === 'dmxapi-hailuo') {
    return { ...remote, _hailuoTaskId: hailuo.pickHailuoTaskId(remote) }
  }
  if (profile?.responseParser === 'vidu') {
    return remote
  }
  if (profile?.responseParser === 'happyhorse') {
    const client = seedanceClient()
    const unwrapped = client.unwrapDmxapiQueryPayload(remote)
    const inner = unwrapped?._dmxapiInner
    if (inner?.task_id) return { ...remote, id: inner.task_id, task_id: inner.task_id }
  }
  if (profile?.responseParser === 'kling') {
    const tid = kling.pickKlingTaskId(remote)
    if (tid) return { ...remote, id: tid, task_id: tid }
  }
  return remote
}

function pickTaskIdForProfile(profile, remote) {
  if (!remote || typeof remote !== 'object') return ''
  if (profile?.transport === 'dmxapi-hailuo') {
    return hailuo.pickHailuoTaskId(remote)
  }
  if (profile?.responseParser === 'vidu') {
    return String(remote.task_id || remote.id || '').trim()
  }
  if (profile?.responseParser === 'happyhorse') {
    const client = seedanceClient()
    const inner = client.unwrapDmxapiQueryPayload(remote)?._dmxapiInner
    if (inner?.task_id) return String(inner.task_id).trim()
    return ''
  }
  if (profile?.responseParser === 'kling') {
    return kling.pickKlingTaskId(remote)
  }
  if (profile?.responseParser === 'sora') {
    return String(remote.id || remote.task_id || '').trim()
  }
  const client = seedanceClient()
  const inner = client.unwrapDmxapiQueryPayload(remote)?._dmxapiInner
  if (inner?.task_id) return String(inner.task_id).trim()
  return String(remote.id || remote.task_id || remote.data?.id || remote.request_id || '').trim()
}

function mapRemoteToJobUpdateForProfile(profile, remote) {
  if (profile?.transport === 'dmxapi-hailuo') {
    if (remote?._transportMapped) {
      const m = remote._transportMapped
      return { status: m.status, resultUrl: m.resultUrl || '', errorMessage: m.errorMessage || '' }
    }
    return hailuo.mapHailuoRemoteToJobUpdate(remote)
  }
  const client = seedanceClient()
  let normalized = remote
  if (client.PROVIDER === 'dmxapi') {
    normalized = client.unwrapDmxapiQueryPayload(remote)
  }
  if (profile?.responseParser === 'vidu') {
    const statusRaw = String(normalized?.state || normalized?.status || '').toLowerCase()
    let status = 'processing'
    if (['success', 'succeeded', 'completed'].includes(statusRaw)) status = 'succeeded'
    else if (['fail', 'failed', 'error'].includes(statusRaw)) status = 'failed'
    else if (['created', 'pending', 'queued'].includes(statusRaw)) status = 'pending'
    const resultUrl =
      status === 'succeeded'
        ? String(
            normalized?.video_url ||
              normalized?.url ||
              normalized?.creations?.[0]?.video_url ||
              '',
          ).trim()
        : ''
    return {
      status,
      resultUrl: resultUrl.startsWith('http') ? resultUrl : '',
      errorMessage: status === 'failed' ? String(normalized?.message || 'failed') : '',
    }
  }
  if (profile?.responseParser === 'happyhorse') {
    const inner = normalized?._dmxapiInner || normalized
    const taskStatus = String(inner?.task_status || inner?.status || '').toUpperCase()
    let status = 'processing'
    if (taskStatus === 'SUCCEEDED' || taskStatus === 'SUCCESS') status = 'succeeded'
    else if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(taskStatus)) status = 'failed'
    else if (taskStatus === 'PENDING') status = 'pending'
    const resultUrl =
      status === 'succeeded' && inner?.video_url ? String(inner.video_url).trim() : ''
    return {
      status,
      resultUrl: resultUrl.startsWith('http') ? resultUrl : '',
      errorMessage: status === 'failed' ? String(inner?.message || taskStatus) : '',
    }
  }
  if (profile?.responseParser === 'kling') {
    return kling.mapKlingRemoteToJobUpdate(remote)
  }
  if (profile?.responseParser === 'sora') {
    const s = String(normalized?.status || '').toLowerCase()
    let status = 'processing'
    if (['succeeded', 'completed', 'success'].includes(s)) status = 'succeeded'
    else if (['failed', 'error', 'expired'].includes(s)) status = 'failed'
    else if (['queued', 'pending', 'submitted'].includes(s)) status = 'pending'
    const resultUrl = client.pickResultUrl(normalized)
    return {
      status,
      resultUrl,
      errorMessage: status === 'failed' ? client.pickErrorMessage(normalized) : '',
    }
  }
  return client.mapRemoteToJobUpdate(normalized)
}

module.exports = {
  createVideoTask,
  getVideoTaskStatus,
  unwrapCreateResponse,
  pickTaskIdForProfile,
  mapRemoteToJobUpdateForProfile,
}
