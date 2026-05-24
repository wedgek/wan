/**
 * 对话创作：图像生成发送
 */

const { generateImage, DEFAULT_SIZE } = require('./dmxapiImageClient')
const { resolveImageModelById } = require('./imageModelService')
const { attachmentsToJson, estimateMessageTokens } = require('./textChatContextService')
const tos = require('./tosClient')

const MAX_INPUT_LENGTH = 2000
const MAX_REF_IMAGES = 4

const MIRROR_ENABLED =
  String(process.env.IMAGE_GEN_MIRROR_TO_TOS ?? '1').trim() !== '0' &&
  String(process.env.IMAGE_GEN_MIRROR_TO_TOS ?? '1').toLowerCase() !== 'false'

function validateImageInput(text, imageUrls) {
  const prompt = String(text || '').trim()
  if (!prompt) {
    const err = new Error('请输入图像描述')
    err.code = 'E_IMAGE_PROMPT'
    throw err
  }
  if (prompt.length > MAX_INPUT_LENGTH) {
    const err = new Error(`描述过长，最多 ${MAX_INPUT_LENGTH} 字`)
    err.code = 'E_IMAGE_PROMPT'
    throw err
  }
  const refs = Array.isArray(imageUrls)
    ? imageUrls.filter((u) => u && String(u).startsWith('http'))
    : []
  if (refs.length > MAX_REF_IMAGES) {
    const err = new Error(`最多 ${MAX_REF_IMAGES} 张参考图`)
    err.code = 'E_IMAGE_REFS'
    throw err
  }
  return { prompt, refs: refs.slice(0, MAX_REF_IMAGES) }
}

function resultUrlsToJson(urls) {
  const list = Array.isArray(urls) ? urls.filter((u) => u && String(u).startsWith('http')) : []
  return list.length ? JSON.stringify(list) : null
}

function parseResultUrls(json) {
  if (!json || !String(json).trim()) return []
  try {
    const o = JSON.parse(json)
    return Array.isArray(o) ? o.filter((u) => u && String(u).startsWith('http')) : []
  } catch (_) {
    return []
  }
}

async function mirrorImageUrl(sourceUrl, messageId) {
  const u = String(sourceUrl || '').trim()
  if (!u.startsWith('http') || !MIRROR_ENABLED || !tos.isConfigured()) return u

  try {
    const ac = new AbortController()
    const tid = setTimeout(() => ac.abort(), 120000)
    let res
    try {
      res = await fetch(u, {
        redirect: 'follow',
        signal: ac.signal,
        headers: { 'User-Agent': 'wan-ai-image-mirror/1.0' },
      })
    } finally {
      clearTimeout(tid)
    }
    if (!res.ok) return u
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 20 * 1024 * 1024) return u
    const ct = String(res.headers.get('content-type') || 'image/jpeg').split(';')[0]
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
    const mid = messageId != null ? Number(messageId) : 0
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const objectKey =
      mid > 0 ? `image/generated/msg-${mid}_${suffix}.${ext}` : `image/generated/${suffix}.${ext}`
    const { url } = await tos.putBuffer({ objectKey, body: buf, contentType: ct || 'image/jpeg' })
    return url || u
  } catch (e) {
    console.error('[textChatImage] mirror TOS failed', e.message)
    return u
  }
}

async function mirrorResultUrls(urls, messageId) {
  const out = []
  for (const u of urls) {
    out.push(await mirrorImageUrl(u, messageId))
  }
  return out
}

function insertUserMessage(dbi, sessionId, userId, text, refs) {
  const attachmentsJson = attachmentsToJson(refs)
  const tokenEstimate = estimateMessageTokens(text, refs.map((url) => ({ type: 'image', url })))
  const info = dbi
    .prepare(
      `INSERT INTO text_chat_messages
       (session_id, user_id, role, text, attachments_json, token_estimate, generation_mode)
       VALUES (?, ?, 'user', ?, ?, ?, 'image')`,
    )
    .run(sessionId, userId, text, attachmentsJson, tokenEstimate)
  return Number(info.lastInsertRowid)
}

function insertAssistantPlaceholder(dbi, sessionId, userId, modelName) {
  const info = dbi
    .prepare(
      `INSERT INTO text_chat_messages
       (session_id, user_id, role, text, generation_mode, status, model_name)
       VALUES (?, ?, 'assistant', '', 'image', 'processing', ?)`,
    )
    .run(sessionId, userId, modelName || '')
  return Number(info.lastInsertRowid)
}

function updateAssistantResult(dbi, assistantId, { status, resultUrls, errorMessage }) {
  dbi
    .prepare(
      `UPDATE text_chat_messages
       SET status = ?, result_urls_json = ?, error_message = ?, text = ?
       WHERE id = ?`,
    )
    .run(
      status,
      resultUrlsToJson(resultUrls),
      errorMessage || null,
      status === 'success' ? '已生成图片' : errorMessage || '',
      assistantId,
    )
}

function touchSession(dbi, sessionId, imageModelId) {
  dbi
    .prepare(
      `UPDATE text_chat_sessions SET updated_at = datetime('now'), image_model_id = COALESCE(?, image_model_id) WHERE id = ?`,
    )
    .run(imageModelId || null, sessionId)
}

/**
 * @param {import('better-sqlite3').Database} dbi
 * @param {{ session, userId, text, imageUrls, modelId, size?, n?, signal? }} opts
 */
async function sendTextChatImage(dbi, opts) {
  const { session, userId, signal } = opts
  const modelRow = resolveImageModelById(dbi, opts.modelId || session.image_model_id)
  const { prompt, refs } = validateImageInput(opts.text, opts.imageUrls)

  if (refs.length && !modelRow.supportsImageEdit) {
    const err = new Error('当前模型不支持参考图编辑，请更换模型或移除参考图')
    err.code = 'E_IMAGE_EDIT'
    throw err
  }

  const userMessageId = insertUserMessage(dbi, session.id, userId, prompt, refs)
  const assistantId = insertAssistantPlaceholder(dbi, session.id, userId, modelRow.name)
  touchSession(dbi, session.id, modelRow.id)

  try {
    const { urls } = await generateImage({
      model: modelRow.apiModelId,
      prompt,
      size: opts.size || DEFAULT_SIZE,
      n: opts.n != null ? Number(opts.n) : 1,
      image: refs.length === 1 ? refs[0] : refs.length > 1 ? refs : undefined,
      signal,
    })
    const mirrored = await mirrorResultUrls(urls, assistantId)
    updateAssistantResult(dbi, assistantId, { status: 'success', resultUrls: mirrored })
    touchSession(dbi, session.id, modelRow.id)
    return {
      userMessageId,
      assistantMessageId: assistantId,
      resultUrls: mirrored,
      modelId: modelRow.id,
      modelName: modelRow.name,
      generationMode: 'image',
    }
  } catch (e) {
    updateAssistantResult(dbi, assistantId, {
      status: 'failed',
      resultUrls: [],
      errorMessage: e.message || '生成失败',
    })
    throw e
  }
}

module.exports = {
  sendTextChatImage,
  validateImageInput,
  parseResultUrls,
  MAX_INPUT_LENGTH,
  MAX_REF_IMAGES,
}
