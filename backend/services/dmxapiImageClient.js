/**
 * DMXAPI OpenAI 兼容 Images Generations
 * POST {base}/images/generations
 */

const tos = require('./tosClient')

const API_KEY =
  process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || process.env.DMXAPI_API_KEY || ''
const USER_ID = (process.env.DMXAPI_USER_ID || '').trim()
const BASE = (process.env.DMXAPI_API_BASE || 'https://www.dmxapi.cn/v1').replace(/\/+$/, '')

const DEFAULT_TIMEOUT_MS = Math.min(
  300000,
  Math.max(30000, Number(process.env.IMAGE_GEN_TIMEOUT_MS || 120000)),
)

const DEFAULT_SIZE = String(process.env.IMAGE_GEN_DEFAULT_SIZE || '1024x1024').trim()

function authHeaders() {
  const key = String(API_KEY || '').trim()
  if (!key) {
    const err = new Error('未配置 ARK_API_KEY / DMXAPI_API_KEY，无法调用图像模型')
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

function normalizeUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\\u0026/g, '&')
}

/** @returns {'gpt-image' | 'gemini-image' | 'openai-compat'} */
function inferImageApiProfile(model) {
  const id = String(model || '').toLowerCase()
  if (/gpt-image/.test(id)) return 'gpt-image'
  if (/gemini.*image|flash-image-preview|imagen-/.test(id)) return 'gemini-image'
  return 'openai-compat'
}

function isHttpUrl(value) {
  return String(value || '')
    .trim()
    .startsWith('http')
}

function isBase64ImageData(value) {
  const s = String(value || '').trim()
  if (!s || isHttpUrl(s)) return false
  return (
    /^\/9j\//.test(s) ||
    /^iVBORw0KGgo/.test(s) ||
    /^R0lGOD/.test(s) ||
    /^UklGR/.test(s) ||
    /^[A-Za-z0-9+/=]{256,}$/.test(s)
  )
}

function inferMimeFromBase64(value) {
  const s = String(value || '').trim()
  if (s.startsWith('/9j/')) return 'image/jpeg'
  if (s.startsWith('iVBORw0KGgo')) return 'image/png'
  if (s.startsWith('R0lGOD')) return 'image/gif'
  if (s.startsWith('UklGR')) return 'image/webp'
  return 'image/png'
}

function buildRequestBody(model, opts) {
  const profile = inferImageApiProfile(model)
  const body = {
    model,
    prompt: opts.prompt,
    n: Math.min(4, Math.max(1, Number(opts.n) || 1)),
    size: String(opts.size || DEFAULT_SIZE).trim() || DEFAULT_SIZE,
  }

  if (profile === 'openai-compat') {
    body.response_format = 'url'
    body.watermark = false
  } else if (profile === 'gemini-image') {
    body.response_format = 'url'
  }

  const ref = opts.image
  if (ref) {
    if (Array.isArray(ref)) {
      const urls = ref.filter((u) => u && String(u).startsWith('http'))
      if (urls.length === 1) body.image = urls[0]
      else if (urls.length > 1) body.image = urls
    } else if (String(ref).startsWith('http')) {
      body.image = String(ref).trim()
    }
  }

  return body
}

function extractImagePayloads(data) {
  const payloads = []
  const list = data?.data

  if (Array.isArray(list)) {
    for (const item of list) {
      let handled = false
      if (item?.url) {
        const u = normalizeUrl(item.url)
        if (isHttpUrl(u)) {
          payloads.push({ kind: 'url', value: u })
          handled = true
        } else if (isBase64ImageData(u)) {
          payloads.push({ kind: 'b64', value: u, mime: inferMimeFromBase64(u) })
          handled = true
        }
      }
      if (!handled && item?.b64_json) {
        const b64 = String(item.b64_json).trim()
        if (b64) {
          payloads.push({ kind: 'b64', value: b64, mime: inferMimeFromBase64(b64) })
        }
      }
    }
  }

  if (!payloads.length && data?.url) {
    const u = normalizeUrl(data.url)
    if (isHttpUrl(u)) payloads.push({ kind: 'url', value: u })
    else if (isBase64ImageData(u)) {
      payloads.push({ kind: 'b64', value: u, mime: inferMimeFromBase64(u) })
    }
  }

  return payloads
}

async function materializePayloads(payloads) {
  const urls = []
  for (const payload of payloads) {
    if (payload.kind === 'url') {
      urls.push(payload.value)
      continue
    }

    const mime = payload.mime || 'image/png'
    const buf = Buffer.from(payload.value, 'base64')
    if (!buf.length) continue

    if (tos.isConfigured()) {
      const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const { url } = await tos.putBuffer({
        objectKey: `image/generated/${suffix}.${ext}`,
        body: buf,
        contentType: mime,
      })
      urls.push(url || `data:${mime};base64,${payload.value}`)
    } else {
      urls.push(`data:${mime};base64,${payload.value}`)
    }
  }
  return urls.filter((u) => u && (u.startsWith('http') || u.startsWith('data:')))
}

/**
 * @param {{ model: string, prompt: string, size?: string, n?: number, image?: string|string[], signal?: AbortSignal }} opts
 */
async function generateImage(opts) {
  const model = String(opts?.model || '').trim()
  if (!model) {
    const err = new Error('缺少图像模型 ID')
    err.code = 'E_IMAGE_MODEL'
    throw err
  }
  const prompt = String(opts?.prompt || '').trim()
  if (!prompt) {
    const err = new Error('请输入图像描述')
    err.code = 'E_IMAGE_PROMPT'
    throw err
  }

  const body = buildRequestBody(model, { ...opts, prompt })

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
    res = await fetch(`${BASE}/images/generations`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('图像生成请求超时，请稍后重试')
      err.code = 'E_IMAGE_TIMEOUT'
      throw err
    }
    throw e
  } finally {
    clearTimeout(timer)
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort)
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

  const payloads = extractImagePayloads(data)
  const urls = await materializePayloads(payloads)
  if (!urls.length) {
    const err = new Error('图像模型未返回有效图片 URL')
    err.code = 'E_IMAGE_EMPTY'
    throw err
  }

  return { urls, raw: data }
}

module.exports = {
  generateImage,
  DEFAULT_SIZE,
  inferImageApiProfile,
}
