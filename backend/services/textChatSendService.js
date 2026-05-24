/**
 * 对话创作：发送消息 + 流式回复
 */

const { streamChatCompletion, chatCompletion } = require('./dmxapiChatClient')
const { resolveTextModelById } = require('./textModelService')
const {
  MAX_IMAGES_PER_MESSAGE,
  estimateMessageTokens,
  attachmentsToJson,
  parseAttachments,
  buildMessagesForApi,
} = require('./textChatContextService')
const { ensureContextWithinBudget } = require('./textChatSummarizeService')

const MAX_INPUT_LENGTH = 20000

function validateSendInput(text, imageUrls) {
  const body = String(text || '').trim()
  if (!body && (!imageUrls || !imageUrls.length)) {
    const err = new Error('请输入消息或上传图片')
    err.code = 'E_TEXT_EMPTY'
    throw err
  }
  if (body.length > MAX_INPUT_LENGTH) {
    const err = new Error(`消息过长，最多 ${MAX_INPUT_LENGTH} 字`)
    err.code = 'E_TEXT_TOO_LONG'
    throw err
  }
  const imgs = Array.isArray(imageUrls) ? imageUrls.filter((u) => u && String(u).startsWith('http')) : []
  if (imgs.length > MAX_IMAGES_PER_MESSAGE) {
    const err = new Error(`最多上传 ${MAX_IMAGES_PER_MESSAGE} 张图片`)
    err.code = 'E_TEXT_IMAGES'
    throw err
  }
  return { text: body, images: imgs.slice(0, MAX_IMAGES_PER_MESSAGE) }
}

function insertUserMessage(dbi, sessionId, userId, text, images) {
  const attachmentsJson = attachmentsToJson(images)
  const tokenEstimate = estimateMessageTokens(text, images.map((url) => ({ type: 'image', url })))
  const info = dbi
    .prepare(
      `INSERT INTO text_chat_messages (session_id, user_id, role, text, attachments_json, token_estimate, generation_mode)
       VALUES (?, ?, 'user', ?, ?, ?, 'reply')`,
    )
    .run(sessionId, userId, text, attachmentsJson, tokenEstimate)
  return {
    id: Number(info.lastInsertRowid),
    session_id: sessionId,
    user_id: userId,
    role: 'user',
    text,
    attachments_json: attachmentsJson,
    token_estimate: tokenEstimate,
  }
}

function insertAssistantMessage(dbi, sessionId, userId, text, modelName) {
  const tokenEstimate = estimateMessageTokens(text, [])
  const info = dbi
    .prepare(
      `INSERT INTO text_chat_messages (session_id, user_id, role, text, token_estimate, model_name, generation_mode, status)
       VALUES (?, ?, 'assistant', ?, ?, ?, 'reply', 'success')`,
    )
    .run(sessionId, userId, text, tokenEstimate, modelName || '')
  return Number(info.lastInsertRowid)
}

function touchSession(dbi, sessionId, modelId) {
  dbi
    .prepare(
      `UPDATE text_chat_sessions SET updated_at = datetime('now'), model_id = COALESCE(?, model_id) WHERE id = ?`,
    )
    .run(modelId || null, sessionId)
}

async function prepareMessages(dbi, session, modelRow, userRow) {
  await ensureContextWithinBudget(dbi, session, modelRow.apiModelId, userRow)
  return buildMessagesForApi(dbi, session, userRow)
}

async function sendTextChatStream(dbi, opts, onDelta) {
  const { session, userId, text, imageUrls, modelId, signal } = opts
  const modelRow = resolveTextModelById(dbi, modelId || session.model_id)
  const { text: body, images } = validateSendInput(text, imageUrls)

  if (images.length && !modelRow.supportsVision) {
    const err = new Error('当前模型不支持图片，请更换支持视觉的模型或移除图片')
    err.code = 'E_TEXT_VISION'
    throw err
  }

  const userRow = insertUserMessage(dbi, session.id, userId, body, images)
  touchSession(dbi, session.id, modelRow.id)

  const apiMessages = await prepareMessages(dbi, session, modelRow, userRow)

  let content = ''
  try {
    const streamed = await streamChatCompletion(
      {
        model: modelRow.apiModelId,
        messages: apiMessages,
        temperature: 0.7,
        signal,
      },
      (delta, full) => {
        content = full
        if (typeof onDelta === 'function') onDelta(delta, full)
      },
    )
    content = streamed.content || content
  } catch (streamErr) {
    const { content: fullContent } = await chatCompletion({
      model: modelRow.apiModelId,
      messages: apiMessages,
      temperature: 0.7,
      signal,
    })
    content = fullContent
    if (typeof onDelta === 'function') onDelta('', content)
  }

  const assistantId = insertAssistantMessage(dbi, session.id, userId, content, modelRow.name)
  touchSession(dbi, session.id, modelRow.id)

  return {
    userMessageId: userRow.id,
    assistantMessageId: assistantId,
    text: content,
    modelId: modelRow.id,
    modelName: modelRow.name,
  }
}

async function sendTextChat(dbi, opts) {
  let finalText = ''
  const result = await sendTextChatStream(dbi, opts, (_d, full) => {
    finalText = full
  })
  return { ...result, text: finalText || result.text }
}

module.exports = {
  validateSendInput,
  sendTextChatStream,
  sendTextChat,
  MAX_INPUT_LENGTH,
}
