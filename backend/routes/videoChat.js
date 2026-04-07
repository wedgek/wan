const express = require('express')
const { ok, fail } = require('../utils/response')
const db = require('../db')
const seedance = require('../services/seedanceClient')
const { createVideoJob, allowVideoJobRate } = require('../services/videoJobService')

const router = express.Router()
const database = () => db.getDb()

/** 与新建会话默认标题一致时，列表展示首条用户消息第一行文字预览 */
const DEFAULT_SESSION_TITLES = new Set(['', '新对话'])

/** 对话页传入的生成参数；时长范围与火山 Seedance 文档常见区间一致（可用环境变量放宽） */
const CHAT_VIDEO_DURATION_MIN = Math.max(2, Number(process.env.ARK_CHAT_DURATION_MIN || 4))
const CHAT_VIDEO_DURATION_MAX = Math.min(60, Number(process.env.ARK_CHAT_DURATION_MAX || 15))
const CHAT_ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1'])

/** 对话参考附件上限（图+视+音，与前端 Seedance 规则一致） */
const CHAT_REF_ATTACHMENT_MAX = 12
const CHAT_REF_VIDEO_MAX = 3

function clonePlainOptions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  try {
    return JSON.parse(JSON.stringify(raw))
  } catch (_) {
    return { ...raw }
  }
}

/**
 * 合并 options，写入方舟创建任务体顶层（与 model、content 并列），如 aspect_ratio、duration
 */
function normalizeChatVideoOptions(body) {
  const base = clonePlainOptions(body?.options)
  const ar = String(body?.aspectRatio ?? body?.aspect_ratio ?? base.aspect_ratio ?? '').trim()
  if (CHAT_ASPECT_RATIOS.has(ar)) base.aspect_ratio = ar
  const durRaw = body?.duration ?? base.duration
  if (durRaw != null && durRaw !== '') {
    const n = parseInt(String(durRaw), 10)
    if (Number.isFinite(n)) {
      base.duration = Math.min(CHAT_VIDEO_DURATION_MAX, Math.max(CHAT_VIDEO_DURATION_MIN, n))
    }
  }
  return base
}

/**
 * SQLite 存的是 UTC 无时区字符串（datetime('now')）；下发 ISO 带 Z，前端才能按用户本地时区显示。
 */
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

/** 第一行非空文字，折叠空白，截断 max 字符（仅文本） */
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
    createTime: sqliteUtcTextToIso(r.create_time),
    updateTime: sqliteUtcTextToIso(r.update_time),
  }
}

function rowToMessage(r) {
  if (!r) return null
  let attachments = { images: [], videos: [] }
  if (r.attachments_json && String(r.attachments_json).trim()) {
    try {
      const o = JSON.parse(r.attachments_json)
      if (o && typeof o === 'object') {
        attachments = {
          images: Array.isArray(o.images) ? o.images : [],
          videos: Array.isArray(o.videos) ? o.videos : [],
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    text: r.text || '',
    attachments,
    videoJobId: r.video_job_id || null,
    status: r.status || '',
    resultUrl: r.result_url || '',
    errorMessage: r.error_message || '',
    videoModelName: r.video_model_name != null ? String(r.video_model_name).trim() : '',
    createTime: sqliteUtcTextToIso(r.create_time),
    /** 关联任务的最近更新时间（生成成功/失败时同步），用于展示「生成完成」时间 */
    completedTime: sqliteUtcTextToIso(r.job_update_time),
  }
}

function syncAssistantMessagesFromJobs(dbi, userId, sessionId) {
  const msgs = dbi
    .prepare(
      `SELECT id, video_job_id FROM video_chat_messages
       WHERE session_id = ? AND user_id = ? AND role = 'assistant' AND video_job_id IS NOT NULL`
    )
    .all(sessionId, userId)
  for (const m of msgs) {
    const job = dbi
      .prepare(
        `SELECT status, result_url, error_message FROM video_jobs WHERE id = ? AND user_id = ?`
      )
      .get(m.video_job_id, userId)
    if (!job) continue
    dbi
      .prepare(
        `UPDATE video_chat_messages SET status = ?, result_url = ?, error_message = ? WHERE id = ?`
      )
      .run(job.status, job.result_url || '', job.error_message || '', m.id)
  }
}

/** 拉取远端任务状态写回 video_jobs，再同步到助手消息 */
async function syncJobsForSession(dbi, userId, sessionIds) {
  if (!sessionIds?.length || !seedance.isConfigured()) return
  const placeholders = sessionIds.map(() => '?').join(',')
  const jobs = dbi
    .prepare(
      `SELECT DISTINCT j.id, j.external_task_id, j.status
       FROM video_jobs j
       INNER JOIN video_chat_messages m ON m.video_job_id = j.id
       WHERE j.user_id = ?
         AND m.session_id IN (${placeholders})
         AND j.external_task_id IS NOT NULL
         AND j.status IN ('pending','processing')`
    )
    .all(userId, ...sessionIds)
  for (const j of jobs) {
    try {
      const remote = await seedance.getContentsGenerationTask(j.external_task_id)
      const { status, resultUrl, errorMessage } = seedance.mapRemoteToJobUpdate(remote)
      if (status !== j.status || resultUrl || errorMessage) {
        dbi
          .prepare(
            `UPDATE video_jobs SET status = ?, result_url = COALESCE(?, result_url), error_message = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .run(status, resultUrl || null, errorMessage || null, j.id)
      }
    } catch (e) {
      console.error('[videoChat] sync job', j.id, e.message)
    }
  }
}

router.get('/sessions/page', async (req, res) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
    const offset = (pageNo - 1) * pageSize
    const d = database()
    const total = d.prepare('SELECT COUNT(*) AS c FROM video_chat_sessions WHERE user_id = ?').get(req.userId).c
    const rows = d
      .prepare(
        `SELECT s.id, s.title,
                datetime(s.created_at) as create_time, datetime(s.updated_at) as update_time,
                m.text as first_user_text
         FROM video_chat_sessions s
         LEFT JOIN (
           SELECT session_id, MIN(id) AS mid
           FROM video_chat_messages
           WHERE role = 'user' AND user_id = ?
           GROUP BY session_id
         ) t ON t.session_id = s.id
         LEFT JOIN video_chat_messages m ON m.id = t.mid AND m.user_id = ?
         WHERE s.user_id = ?
         ORDER BY datetime(COALESCE(s.updated_at, s.created_at)) DESC, s.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(req.userId, req.userId, req.userId, pageSize, offset)
    res.json(ok({ list: rows.map(rowToSession), total }))
  } catch (e) {
    console.error('[videoChat] sessions/page', e.message)
    res.json(fail(500, '读取会话失败'))
  }
})

router.post('/sessions', (req, res) => {
  try {
    const title = String(req.body?.title || '新对话').trim() || '新对话'
    const info = database()
      .prepare('INSERT INTO video_chat_sessions (user_id, title) VALUES (?, ?)')
      .run(req.userId, title)
    const id = Number(info.lastInsertRowid)
    const row = database()
      .prepare(
        `SELECT id, title, datetime(created_at) as create_time, datetime(updated_at) as update_time
         FROM video_chat_sessions WHERE id = ? AND user_id = ?`
      )
      .get(id, req.userId)
    res.json(ok(rowToSession(row)))
  } catch (e) {
    console.error('[videoChat] sessions create', e.message)
    res.json(fail(500, '创建会话失败'))
  }
})

router.delete('/sessions/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.json(fail(400, '缺少会话 id'))
    const d = database()
    const sess = d.prepare('SELECT id FROM video_chat_sessions WHERE id = ? AND user_id = ?').get(id, req.userId)
    if (!sess) return res.json(fail(404, '会话不存在'))

    const jobRows = d
      .prepare(
        `SELECT DISTINCT video_job_id FROM video_chat_messages
         WHERE session_id = ? AND user_id = ? AND video_job_id IS NOT NULL`
      )
      .all(id, req.userId)
    for (const r of jobRows) {
      if (r.video_job_id) {
        d.prepare('DELETE FROM video_jobs WHERE id = ? AND user_id = ?').run(r.video_job_id, req.userId)
      }
    }
    d.prepare('DELETE FROM video_chat_messages WHERE session_id = ? AND user_id = ?').run(id, req.userId)
    d.prepare('DELETE FROM video_chat_sessions WHERE id = ? AND user_id = ?').run(id, req.userId)
    res.json(ok({ ok: true }))
  } catch (e) {
    console.error('[videoChat] sessions delete', e.message)
    res.json(fail(500, '删除会话失败'))
  }
})

router.put('/sessions/rename', (req, res) => {
  try {
    const id = Number(req.body?.id)
    const title = String(req.body?.title || '').trim()
    if (!id || !title) return res.json(fail(400, '缺少 id 或标题'))
    const r = database()
      .prepare('UPDATE video_chat_sessions SET title = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?')
      .run(title, id, req.userId)
    if (r.changes === 0) return res.json(fail(404, '会话不存在'))
    const row = database()
      .prepare(
        `SELECT id, title, datetime(created_at) as create_time, datetime(updated_at) as update_time
         FROM video_chat_sessions WHERE id = ? AND user_id = ?`
      )
      .get(id, req.userId)
    res.json(ok(rowToSession(row)))
  } catch (e) {
    console.error('[videoChat] sessions rename', e.message)
    res.json(fail(500, '重命名失败'))
  }
})

router.get('/messages/page', async (req, res) => {
  try {
    const sessionId = Number(req.query.sessionId)
    if (!sessionId) return res.json(fail(400, '缺少 sessionId'))
    const sess = database()
      .prepare('SELECT id FROM video_chat_sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, req.userId)
    if (!sess) return res.json(fail(404, '会话不存在'))

    await syncJobsForSession(database(), req.userId, [sessionId])
    syncAssistantMessagesFromJobs(database(), req.userId, sessionId)

    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 100))
    const offset = (pageNo - 1) * pageSize
    const d = database()
    const total = d.prepare('SELECT COUNT(*) AS c FROM video_chat_messages WHERE session_id = ?').get(sessionId).c
    // 须取「最新」一页：ASC + LIMIT 只会拿到最旧 N 条，超过 pageSize 的会话会丢最新一轮（表现为提示词/生成中卡片突然没了，刷新或下一页又出现）
    const rows = d
      .prepare(
        `SELECT m.id, m.session_id, m.user_id, m.role, m.text, m.attachments_json, m.video_job_id, m.status, m.result_url, m.error_message,
                datetime(m.created_at) as create_time,
                datetime(COALESCE(NULLIF(j.updated_at, ''), j.created_at)) as job_update_time,
                TRIM(COALESCE(NULLIF(TRIM(m.video_model_name), ''), vm.name, '')) as video_model_name
         FROM video_chat_messages m
         LEFT JOIN video_jobs j ON j.id = m.video_job_id
         LEFT JOIN video_models vm ON vm.id = j.video_model_id
         WHERE m.session_id = ? ORDER BY m.id DESC LIMIT ? OFFSET ?`
      )
      .all(sessionId, pageSize, offset)
    const chronological = rows.slice().reverse()
    res.json(ok({ list: chronological.map(rowToMessage), total }))
  } catch (e) {
    console.error('[videoChat] messages/page', e.message)
    res.json(fail(500, '读取消息失败'))
  }
})

router.post('/send', async (req, res) => {
  if (!allowVideoJobRate(req.userId)) {
    return res.json(fail(429, '请求过于频繁，请稍后再试'))
  }

  const sessionId = Number(req.body?.sessionId)
  if (!sessionId) return res.json(fail(400, '缺少 sessionId'))

  const sess = database()
    .prepare('SELECT id FROM video_chat_sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, req.userId)
  if (!sess) return res.json(fail(404, '会话不存在'))

  const text = String(req.body?.text || '').trim()
  const imageUrls = Array.isArray(req.body?.imageUrls) ? req.body.imageUrls : []
  const videoUrls = Array.isArray(req.body?.videoUrls) ? req.body.videoUrls : []
  const audioUrls = Array.isArray(req.body?.audioUrls) ? req.body.audioUrls : []

  if (!text && imageUrls.length === 0 && videoUrls.length === 0) {
    return res.json(fail(400, '请填写内容或上传参考图/视频'))
  }

  const attachments = {
    images: imageUrls.filter((u) => u && String(u).startsWith('http')).map((u) => String(u).trim()),
    videos: videoUrls.filter((u) => u && String(u).startsWith('http')).map((u) => String(u).trim()),
  }
  const audioClean = audioUrls.filter((u) => u && String(u).startsWith('http')).map((u) => String(u).trim())
  if (attachments.videos.length > CHAT_REF_VIDEO_MAX) {
    return res.json(fail(400, `参考视频最多 ${CHAT_REF_VIDEO_MAX} 个`))
  }
  if (attachments.images.length + attachments.videos.length + audioClean.length > CHAT_REF_ATTACHMENT_MAX) {
    return res.json(
      fail(400, `参考文件（图+视+音）最多 ${CHAT_REF_ATTACHMENT_MAX} 个`),
    )
  }
  const attachmentsJson = JSON.stringify(attachments)

  const d = database()
  const userIns = d
    .prepare(
      `INSERT INTO video_chat_messages (session_id, user_id, role, text, attachments_json)
       VALUES (?, ?, 'user', ?, ?)`
    )
    .run(sessionId, req.userId, text, attachmentsJson)
  const userMsgId = Number(userIns.lastInsertRowid)

  const modeIn = String(req.body?.mode || '').toLowerCase()
  const result = await createVideoJob(d, {
    userId: req.userId,
    prompt: text,
    mode: modeIn === 'image' || modeIn === 'text' || modeIn === 'multimodal' ? modeIn : '',
    sourceImageUrls: attachments.images,
    sourceVideoUrls: attachments.videos,
    videoModelId: req.body?.videoModelId,
    projectId: req.body?.projectId,
    options: normalizeChatVideoOptions(req.body),
  })

  if (!result.ok) {
    return res.json(fail(result.code, result.message))
  }

  const jobMeta = d.prepare('SELECT video_model_id FROM video_jobs WHERE id = ? AND user_id = ?').get(result.id, req.userId)
  const vmRow = jobMeta
    ? d.prepare('SELECT name FROM video_models WHERE id = ?').get(jobMeta.video_model_id)
    : null
  const videoModelName = vmRow && vmRow.name ? String(vmRow.name).trim() : ''

  const assistIns = d
    .prepare(
      `INSERT INTO video_chat_messages (session_id, user_id, role, text, video_job_id, status, video_model_name)
       VALUES (?, ?, 'assistant', '', ?, 'processing', ?)`
    )
    .run(sessionId, req.userId, result.id, videoModelName || null)
  const assistantMsgId = Number(assistIns.lastInsertRowid)

  d.prepare(`UPDATE video_chat_sessions SET updated_at = datetime('now') WHERE id = ?`).run(sessionId)

  res.json(
    ok({
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId,
      jobId: result.id,
      externalTaskId: result.externalTaskId,
      status: result.status,
    })
  )
})

router.delete('/messages/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const sessionIdQ = Number(req.query.sessionId)
    if (!id) return res.json(fail(400, '缺少消息 id'))

    const row = database()
      .prepare('SELECT id, session_id FROM video_chat_messages WHERE id = ? AND user_id = ?')
      .get(id, req.userId)
    if (!row) return res.json(fail(404, '消息不存在'))
    if (sessionIdQ && Number(row.session_id) !== sessionIdQ) {
      return res.json(fail(400, '会话不匹配'))
    }

    database().prepare('DELETE FROM video_chat_messages WHERE id = ? AND user_id = ?').run(id, req.userId)
    res.json(ok({ ok: true }))
  } catch (e) {
    console.error('[videoChat] messages delete', e.message)
    res.json(fail(500, '删除失败'))
  }
})

module.exports = router
