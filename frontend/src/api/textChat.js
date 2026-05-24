import request from '@/request'
import { useAuthStore } from '@/stores/auth'

function resolveApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (raw == null || String(raw).trim() === '') return ''
  return String(raw).trim().replace(/\/+$/, '')
}

function adminUrl(path) {
  const base = resolveApiBase()
  return base ? `${base}${path}` : path
}

export function listEnabledTextModelsApi() {
  return request({
    url: '/admin-api/text/chat/model/list-enabled',
    method: 'GET',
  })
}

export function listEnabledImageModelsApi() {
  return request({
    url: '/admin-api/text/chat/image-model/list-enabled',
    method: 'GET',
  })
}

export function getTextChatSessionsApi(params) {
  return request({
    url: '/admin-api/text/chat/sessions/page',
    method: 'GET',
    params,
  })
}

export function createTextChatSessionApi(data) {
  return request({
    url: '/admin-api/text/chat/sessions',
    method: 'POST',
    data,
  })
}

export function deleteTextChatSessionApi(id) {
  return request({
    url: `/admin-api/text/chat/sessions/${id}`,
    method: 'DELETE',
  })
}

export function renameTextChatSessionApi(data) {
  return request({
    url: '/admin-api/text/chat/sessions/rename',
    method: 'PUT',
    data,
  })
}

export function getTextChatMessagesApi(params) {
  return request({
    url: '/admin-api/text/chat/messages/page',
    method: 'GET',
    params,
    timeout: 60000,
  })
}

export function getTextChatContextMetaApi(sessionId) {
  return request({
    url: `/admin-api/text/chat/sessions/${sessionId}/context-meta`,
    method: 'GET',
  })
}

export function deleteTextChatMessageApi(id, sessionId) {
  return request({
    url: `/admin-api/text/chat/messages/${id}`,
    method: 'DELETE',
    params: { sessionId },
  })
}

function parseSseBlock(block) {
  let event = 'message'
  const dataLines = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch (_) {
    return null
  }
}

/**
 * SSE 流式发送（对话模式 delta；生图模式 start → done）
 * @param {{ sessionId: number, text: string, imageUrls?: string[], modelId?: number, generationMode?: string, size?: string, n?: number }} payload
 * @param {(text: string) => void} onDelta
 */
export async function sendTextChatStreamApi(payload, onDelta) {
  const authStore = useAuthStore()
  const res = await fetch(adminUrl('/admin-api/text/chat/send/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    let msg = '发送失败'
    try {
      const body = await res.json()
      msg = body.msg || body.message || msg
    } catch (_) {
      /* ignore */
    }
    throw new Error(msg)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('发送失败')

  const decoder = new TextDecoder()
  let buffer = ''
  let finalText = ''
  let donePayload = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const parsed = parseSseBlock(block)
      if (parsed) {
        if (parsed.event === 'delta' && parsed.data?.text != null) {
          finalText = String(parsed.data.text)
          if (typeof onDelta === 'function') onDelta(finalText)
        } else if (parsed.event === 'done') {
          donePayload = parsed.data
          if (parsed.data?.resultUrls?.length) {
            finalText = ''
          } else {
            finalText = String(parsed.data?.text ?? finalText)
            if (typeof onDelta === 'function') onDelta(finalText)
          }
        } else if (parsed.event === 'error') {
          throw new Error(parsed.data?.msg || '发送失败')
        }
      }
      sep = buffer.indexOf('\n\n')
    }
  }

  return { text: finalText, ...(donePayload || {}) }
}
