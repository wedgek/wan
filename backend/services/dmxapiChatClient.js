/**
 * DMXAPI OpenAI 兼容 Chat Completions
 * POST {base}/chat/completions
 */

const API_KEY =
  process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || process.env.DMXAPI_API_KEY || ''
const USER_ID = (process.env.DMXAPI_USER_ID || '').trim()
const BASE = (process.env.DMXAPI_API_BASE || 'https://www.dmxapi.cn/v1').replace(/\/+$/, '')

const DEFAULT_TIMEOUT_MS = Math.min(
  120000,
  Math.max(10000, Number(process.env.PROMPT_POLISH_TIMEOUT_MS || 60000)),
)

function authHeaders() {
  const key = String(API_KEY || '').trim()
  if (!key) {
    const err = new Error('未配置 ARK_API_KEY / DMXAPI_API_KEY，无法调用文本模型')
    err.code = 'E_DMXAPI_CONFIG'
    throw err
  }
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: key.startsWith('Bearer ') ? key : key,
  }
  if (USER_ID) headers['Rix-Api-User'] = USER_ID
  return headers
}

function pickMessageContent(data) {
  const choice = data?.choices?.[0]
  const content = choice?.message?.content ?? choice?.text
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') return String(part.text || part.content || '')
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

/**
 * @param {{ model: string, messages: Array, temperature?: number, maxTokens?: number }} opts
 */
async function chatCompletion(opts) {
  const model = String(opts?.model || '').trim()
  if (!model) {
    const err = new Error('缺少文本模型 ID')
    err.code = 'E_CHAT_MODEL'
    throw err
  }
  const messages = Array.isArray(opts?.messages) ? opts.messages : []
  if (!messages.length) {
    const err = new Error('缺少 messages')
    err.code = 'E_CHAT_MESSAGES'
    throw err
  }

  const body = {
    model,
    messages,
    temperature: opts.temperature != null ? Number(opts.temperature) : 0.7,
  }
  if (opts.maxTokens != null) body.max_tokens = Number(opts.maxTokens)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  let res
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('文本模型请求超时，请稍后重试')
      err.code = 'E_CHAT_TIMEOUT'
      throw err
    }
    throw e
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {
    data = { raw: text }
  }

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error?.message || data.msg)) || text || `HTTP ${res.status}`
    const err = new Error(String(msg))
    err.code = 'E_DMXAPI_HTTP'
    err.status = res.status
    throw err
  }

  const content = pickMessageContent(data)
  if (!content) {
    const err = new Error('文本模型未返回有效内容')
    err.code = 'E_CHAT_EMPTY'
    throw err
  }

  return { content, raw: data }
}

function parseSseDataLines(buffer) {
  const normalized = String(buffer || '').replace(/\r\n/g, '\n')
  const events = []
  const blocks = normalized.split(/\n\n/)
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    if (!block.trim()) continue
    let event = 'message'
    const dataLines = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (!dataLines.length) continue
    const payload = dataLines.join('\n')
    if (payload === '[DONE]') {
      events.push({ event, data: null, done: true })
      continue
    }
    try {
      events.push({ event, data: JSON.parse(payload), done: false })
    } catch (_) {
      /* ignore malformed chunk */
    }
  }
  return { events, rest }
}

function pickStreamDelta(parsed) {
  const choice = parsed?.choices?.[0]
  const delta = choice?.delta?.content ?? choice?.message?.content
  if (typeof delta === 'string') return delta
  if (Array.isArray(delta)) {
    return delta
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') return String(part.text || part.content || '')
        return ''
      })
      .join('')
  }
  return ''
}

/**
 * 流式 Chat Completions（OpenAI SSE）
 * @param {{ model: string, messages: Array, temperature?: number, maxTokens?: number, signal?: AbortSignal }} opts
 * @param {(delta: string, full: string) => void} onDelta
 */
async function streamChatCompletion(opts, onDelta) {
  const model = String(opts?.model || '').trim()
  if (!model) {
    const err = new Error('缺少文本模型 ID')
    err.code = 'E_CHAT_MODEL'
    throw err
  }
  const messages = Array.isArray(opts?.messages) ? opts.messages : []
  if (!messages.length) {
    const err = new Error('缺少 messages')
    err.code = 'E_CHAT_MESSAGES'
    throw err
  }

  const body = {
    model,
    messages,
    stream: true,
    temperature: opts.temperature != null ? Number(opts.temperature) : 0.7,
  }
  if (opts.maxTokens != null) body.max_tokens = Number(opts.maxTokens)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const outerSignal = opts.signal
  const onOuterAbort = () => controller.abort()
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort()
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true })
  }

  let res
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('文本模型请求超时，请稍后重试')
      err.code = 'E_CHAT_TIMEOUT'
      throw err
    }
    throw e
  } finally {
    clearTimeout(timer)
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort)
  }

  if (!res.ok) {
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch (_) {
      data = { raw: text }
    }
    const msg =
      (data && (data.message || data.error?.message || data.msg)) || text || `HTTP ${res.status}`
    const err = new Error(String(msg))
    err.code = 'E_DMXAPI_HTTP'
    err.status = res.status
    throw err
  }

  const contentType = String(res.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch (_) {
      data = { raw: text }
    }
    const content = pickMessageContent(data)
    if (!content) {
      const err = new Error('文本模型未返回有效内容')
      err.code = 'E_CHAT_EMPTY'
      throw err
    }
    onDelta(content, content)
    return { content }
  }

  if (!res.body) {
    const err = new Error('文本模型未返回流式内容')
    err.code = 'E_CHAT_EMPTY'
    throw err
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseDataLines(buffer)
    buffer = parsed.rest
    for (const item of parsed.events) {
      if (item.done) continue
      const delta = pickStreamDelta(item.data)
      if (!delta) continue
      full += delta
      onDelta(delta, full)
    }
  }

  if (!full.trim()) {
    const err = new Error('文本模型未返回有效内容')
    err.code = 'E_CHAT_EMPTY'
    throw err
  }

  return { content: full }
}

module.exports = {
  chatCompletion,
  streamChatCompletion,
  pickMessageContent,
}
