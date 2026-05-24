const express = require('express')
const { ok, fail } = require('../utils/response')
const db = require('../db')
const { listEnabledTextModels, resolveTextModelById } = require('../services/textModelService')
const { listEnabledImageModels, resolveImageModelById } = require('../services/imageModelService')
const { computeContextUsage, parseAttachments } = require('../services/textChatContextService')
const { parseResultUrls } = require('../services/textChatImageSendService')
const { sendTextChatStream, sendTextChat } = require('../services/textChatSendService')
const { sendTextChatImage } = require('../services/textChatImageSendService')

const router = express.Router()
const database = () => db.getDb()

const DEFAULT_SESSION_TITLES = new Set(['', '新对话'])

function sqliteUtcTextToIso(ts) {
  if (ts == null || ts === '') return ''
  const s = String(ts).replace('T', ' ').trim().slice(0, 19)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return String(ts).replace('T', ' ').slice(0, 19)
  }
  const ms = Date.parse(`${s.replace(' ', 'T')}Z`)
  if (!Number.isFinite(ms)) return s
  return new Date(ms).toISOString()
}

function previewFromUserPrompt(text, max = 32) {
  const raw = String(text || '')
  let firstLine = ''
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (t) {
      firstLine = t
      break
    }
  }
  if (!firstLine) return ''
  const oneLine = firstLine.replace(/\s+/g, ' ')
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max)}…`
}

function rowToSession(r) {
  if (!r) return null
  const stored = String(r.title || '').trim() || '新对话'
  let title = stored
  if (DEFAULT_SESSION_TITLES.has(stored)) {
    const hint = previewFromUserPrompt(r.first_user_text || '')
    if (hint) title = hint
  }
  return {
    id: r.id,
    title,
    modelId: r.model_id || null,
    imageModelId: r.image_model_id || null,
    createTime: sqliteUtcTextToIso(r.create_time),
    updateTime: sqliteUtcTextToIso(r.update_time),
  }
}

function rowToMessage(r) {
  if (!r) return null
  const attachments = parseAttachments(r.attachments_json)
  const resultUrls = parseResultUrls(r.result_urls_json)
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    text: r.text || '',
    attachments: { images: attachments.map((a) => a.url) },
    generationMode: String(r.generation_mode || 'reply').trim() || 'reply',
    status: r.status || '',
    resultUrls,
    errorMessage: r.error_message || '',
    modelName: r.model_name != null ? String(r.model_name).trim() : '',
    includedInSummary: r.included_in_summary === 1,
    createTime: sqliteUtcTextToIso(r.create_time),
  }
}

function getSessionOrFail(dbi, sessionId, userId) {
  const session = dbi
    .prepare(
      `SELECT id, user_id, title, model_id, image_model_id, summary, summary_updated_at, context_budget_tokens,
              created_at, updated_at
       FROM text_chat_sessions WHERE id = ? AND user_id = ?`,
    )
    .get(sessionId, userId)
  if (!session) {
    const err = new Error('会话不存在')
    err.code = 'E_SESSION'
    err.status = 404
    throw err
  }
  return session
}

function normalizeGenerationMode(raw) {
  const m = String(raw || 'reply').trim().toLowerCase()
  return m === 'image' ? 'image' : 'reply'
}

function extractImageUrls(body) {
  if (Array.isArray(body?.imageUrls)) return body.imageUrls
  if (Array.isArray(body?.images)) return body.images
  return []
}

function mapSendError(e) {
  const code = e.code || ''
  if (code === 'E_TEXT_VISION') return { status: 400, msg: e.message }
  if (code === 'E_IMAGE_EDIT' || code === 'E_IMAGE_PROMPT' || code === 'E_IMAGE_REFS') {
    return { status: 400, msg: e.message }
  }
  if (code === 'E_TEXT_EMPTY' || code === 'E_TEXT_TOO_LONG' || code === 'E_TEXT_IMAGES') {
    return { status: 400, msg: e.message }
  }
  if (code === 'E_TEXT_MODEL' || code === 'E_TEXT_MODEL_CONFIG' || code === 'E_IMAGE_MODEL') {
    return { status: 400, msg: e.message }
  }
  if (code === 'E_DMXAPI_CONFIG') return { status: 503, msg: e.message }
  if (code === 'E_CHAT_TIMEOUT' || code === 'E_IMAGE_TIMEOUT') return { status: 504, msg: e.message }
  if (code === 'E_DMXAPI_HTTP') return { status: 502, msg: e.message || '模型服务异常' }
  if (code === 'E_IMAGE_EMPTY') return { status: 502, msg: e.message }
  return { status: 500, msg: e.message || '发送失败' }
}

router.get('/model/list-enabled', (req, res) => {
  try {
    res.json(ok(listEnabledTextModels(database())))
  } catch (e) {
    console.error('[textChat] list-enabled', e.message)
    res.json(fail(500, '读取模型列表失败'))
  }
})

router.get('/image-model/list-enabled', (req, res) => {
  try {
    res.json(ok(listEnabledImageModels(database())))
  } catch (e) {
    console.error('[textChat] image-model/list-enabled', e.message)
    res.json(fail(500, '读取图像模型列表失败'))
  }
})

router.get('/sessions/page', (req, res) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
    const offset = (pageNo - 1) * pageSize
    const d = database()
    const total = d.prepare('SELECT COUNT(*) AS c FROM text_chat_sessions WHERE user_id = ?').get(req.userId).c
    const rows = d
      .prepare(
        `SELECT s.id, s.title, s.model_id, s.image_model_id,
                s.created_at as create_time, s.updated_at as update_time,
                m.text as first_user_text
         FROM text_chat_sessions s
         LEFT JOIN (
           SELECT session_id, MIN(id) AS mid
           FROM text_chat_messages
           WHERE role = 'user' AND user_id = ?
           GROUP BY session_id
         ) t ON t.session_id = s.id
         LEFT JOIN text_chat_messages m ON m.id = t.mid AND m.user_id = ?
         WHERE s.user_id = ?
         ORDER BY datetime(COALESCE(s.updated_at, s.created_at)) DESC, s.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(req.userId, req.userId, req.userId, pageSize, offset)
    res.json(ok({ list: rows.map(rowToSession), total }))
  } catch (e) {
    console.error('[textChat] sessions/page', e.message)
    res.json(fail(500, '读取会话失败'))
  }
})

router.post('/sessions', (req, res) => {
  try {
    const title = String(req.body?.title || '新对话').trim() || '新对话'
    const modelId = Number(req.body?.modelId) || null
    const imageModelId = Number(req.body?.imageModelId) || null
    if (modelId) resolveTextModelById(database(), modelId)
    if (imageModelId) resolveImageModelById(database(), imageModelId)
    const info = database()
      .prepare(
        'INSERT INTO text_chat_sessions (user_id, title, model_id, image_model_id) VALUES (?, ?, ?, ?)',
      )
      .run(req.userId, title, modelId || null, imageModelId || null)
    const id = Number(info.lastInsertRowid)
    const row = database()
      .prepare(
        `SELECT id, title, model_id, image_model_id, created_at as create_time, updated_at as update_time
         FROM text_chat_sessions WHERE id = ? AND user_id = ?`,
      )
      .get(id, req.userId)
    res.json(ok(rowToSession(row)))
  } catch (e) {
    console.error('[textChat] sessions create', e.message)
    res.json(fail(400, e.message || '创建会话失败'))
  }
})

router.delete('/sessions/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.json(fail(400, '缺少会话 id'))
    const d = database()
    const sess = d.prepare('SELECT id FROM text_chat_sessions WHERE id = ? AND user_id = ?').get(id, req.userId)
    if (!sess) return res.json(fail(404, '会话不存在'))
    d.prepare('DELETE FROM text_chat_messages WHERE session_id = ? AND user_id = ?').run(id, req.userId)
    d.prepare('DELETE FROM text_chat_sessions WHERE id = ? AND user_id = ?').run(id, req.userId)
    res.json(ok({ ok: true }))
  } catch (e) {
    console.error('[textChat] sessions delete', e.message)
    res.json(fail(500, '删除会话失败'))
  }
})

router.put('/sessions/rename', (req, res) => {
  try {
    const id = Number(req.body?.id)
    const title = String(req.body?.title || '').trim()
    if (!id || !title) return res.json(fail(400, '缺少 id 或标题'))
    const r = database()
      .prepare(
        `UPDATE text_chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      )
      .run(title, id, req.userId)
    if (r.changes === 0) return res.json(fail(404, '会话不存在'))
    const row = database()
      .prepare(
        `SELECT id, title, model_id, image_model_id, created_at as create_time, updated_at as update_time
         FROM text_chat_sessions WHERE id = ? AND user_id = ?`,
      )
      .get(id, req.userId)
    res.json(ok(rowToSession(row)))
  } catch (e) {
    console.error('[textChat] sessions rename', e.message)
    res.json(fail(500, '重命名失败'))
  }
})

router.get('/sessions/:id/context-meta', (req, res) => {
  try {
    const sessionId = Number(req.params.id)
    if (!sessionId) return res.json(fail(400, '缺少 sessionId'))
    const session = getSessionOrFail(database(), sessionId, req.userId)
    const meta = computeContextUsage(database(), session)
    res.json(ok(meta))
  } catch (e) {
    if (e.code === 'E_SESSION') return res.json(fail(404, e.message))
    console.error('[textChat] context-meta', e.message)
    res.json(fail(500, '读取上下文信息失败'))
  }
})

router.get('/messages/page', (req, res) => {
  try {
    const sessionId = Number(req.query.sessionId)
    if (!sessionId) return res.json(fail(400, '缺少 sessionId'))
    getSessionOrFail(database(), sessionId, req.userId)

    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 100))
    const offset = (pageNo - 1) * pageSize
    const d = database()
    const total = d.prepare('SELECT COUNT(*) AS c FROM text_chat_messages WHERE session_id = ?').get(sessionId).c
    const rows = d
      .prepare(
        `SELECT id, session_id, role, text, attachments_json, model_name, included_in_summary,
                generation_mode, status, result_urls_json, error_message, created_at
         FROM text_chat_messages
         WHERE session_id = ?
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(sessionId, pageSize, offset)
    const session = getSessionOrFail(d, sessionId, req.userId)
    const contextMeta = computeContextUsage(d, session)
    res.json(ok({ list: rows.slice().reverse().map(rowToMessage), total, contextMeta }))
  } catch (e) {
    if (e.code === 'E_SESSION') return res.json(fail(404, e.message))
    console.error('[textChat] messages/page', e.message)
    res.json(fail(500, '读取消息失败'))
  }
})

router.post('/send', async (req, res) => {
  try {
    const sessionId = Number(req.body?.sessionId)
    if (!sessionId) return res.json(fail(400, '缺少 sessionId'))
    const session = getSessionOrFail(database(), sessionId, req.userId)
    const mode = normalizeGenerationMode(req.body?.generationMode)
    const imageUrls = extractImageUrls(req.body)

    let result
    if (mode === 'image') {
      result = await sendTextChatImage(database(), {
        session,
        userId: req.userId,
        text: req.body?.text,
        imageUrls,
        modelId: req.body?.modelId || session.image_model_id,
        size: req.body?.size,
        n: req.body?.n,
      })
    } else {
      result = await sendTextChat(database(), {
        session,
        userId: req.userId,
        text: req.body?.text,
        imageUrls,
        modelId: req.body?.modelId || session.model_id,
      })
    }
    res.json(ok(result))
  } catch (e) {
    const mapped = mapSendError(e)
    console.error('[textChat] send', e.message)
    res.json(fail(mapped.status, mapped.msg))
  }
})

router.post('/send/stream', async (req, res) => {
  const sessionId = Number(req.body?.sessionId)
  if (!sessionId) return res.status(400).json(fail(400, '缺少 sessionId'))

  let session
  try {
    session = getSessionOrFail(database(), sessionId, req.userId)
  } catch (e) {
    return res.status(404).json(fail(404, e.message))
  }

  const mode = normalizeGenerationMode(req.body?.generationMode)
  const imageUrls = extractImageUrls(req.body)

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    if (typeof res.flush === 'function') res.flush()
  }

  sendEvent('start', { ok: true })

  const abortController = new AbortController()
  const onClientDisconnect = () => {
    if (!res.writableEnded) abortController.abort()
  }
  req.on('aborted', onClientDisconnect)
  res.on('close', onClientDisconnect)

  try {
    if (mode === 'image') {
      const result = await sendTextChatImage(database(), {
        session,
        userId: req.userId,
        text: req.body?.text,
        imageUrls,
        modelId: req.body?.modelId || session.image_model_id,
        size: req.body?.size,
        n: req.body?.n,
        signal: abortController.signal,
      })
      sendEvent('done', result)
      res.end()
    } else {
      const result = await sendTextChatStream(
        database(),
        {
          session,
          userId: req.userId,
          text: req.body?.text,
          imageUrls,
          modelId: req.body?.modelId || session.model_id,
          signal: abortController.signal,
        },
        (_delta, full) => {
          sendEvent('delta', { text: full })
        },
      )
      const contextMeta = computeContextUsage(
        database(),
        getSessionOrFail(database(), sessionId, req.userId),
      )
      sendEvent('done', { ...result, contextMeta })
      res.end()
    }
  } catch (e) {
    if (abortController.signal.aborted) {
      res.end()
    } else {
      const mapped = mapSendError(e)
      console.error('[textChat] send/stream', e.message)
      sendEvent('error', { msg: mapped.msg, code: mapped.status })
      res.end()
    }
  } finally {
    req.off('aborted', onClientDisconnect)
    res.off('close', onClientDisconnect)
  }
})

router.delete('/messages/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const sessionIdQ = Number(req.query.sessionId)
    if (!id) return res.json(fail(400, '缺少消息 id'))

    const row = database()
      .prepare('SELECT id, session_id FROM text_chat_messages WHERE id = ? AND user_id = ?')
      .get(id, req.userId)
    if (!row) return res.json(fail(404, '消息不存在'))
    if (sessionIdQ && Number(row.session_id) !== sessionIdQ) {
      return res.json(fail(400, '会话不匹配'))
    }

    database().prepare('DELETE FROM text_chat_messages WHERE id = ? AND user_id = ?').run(id, req.userId)
    database()
      .prepare(`UPDATE text_chat_sessions SET updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(row.session_id, req.userId)
    res.json(ok({ ok: true }))
  } catch (e) {
    console.error('[textChat] messages delete', e.message)
    res.json(fail(500, '删除消息失败'))
  }
})

module.exports = router
