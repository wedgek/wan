const express = require('express')
const auth = require('./auth')
const { requireAuth } = auth
const { ok, fail } = require('../utils/response')
const db = require('../db')
const seedance = require('../services/seedanceClient')
const { pullArkJobStateAndStableResultUrl } = require('../services/videoJobArkSync')
const { createVideoJob, allowVideoJobRate } = require('../services/videoJobService')
const videoChatRouter = require('./videoChat')
const videoAdminRouter = require('./videoAdmin')

const router = express.Router()
router.use(requireAuth)

const database = () => db.getDb()

function parseSourceVideoUrls(text) {
  if (!text || !String(text).trim()) return []
  try {
    const o = JSON.parse(text)
    return Array.isArray(o) ? o.filter((u) => u && String(u).startsWith('http')) : []
  } catch (_) {
    return []
  }
}

function rowToJob(r) {
  if (!r) return null
  return {
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id || null,
    videoModelId: r.video_model_id,
    externalTaskId: r.external_task_id || '',
    status: r.status || 'pending',
    mode: r.mode || 'text',
    sourceImageUrl: r.source_image_url || '',
    sourceVideoUrls: parseSourceVideoUrls(r.source_video_urls),
    prompt: r.prompt || '',
    resultUrl: r.result_url || '',
    errorMessage: r.error_message || '',
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
    updateTime: r.update_time ? String(r.update_time).replace('T', ' ').slice(0, 19) : '',
  }
}

function parseGraphJson(text) {
  if (!text || !String(text).trim()) return { nodes: [], edges: [], viewport: null }
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object') return { nodes: [], edges: [], viewport: null }
    return {
      nodes: Array.isArray(o.nodes) ? o.nodes : [],
      edges: Array.isArray(o.edges) ? o.edges : [],
      viewport: o.viewport && typeof o.viewport === 'object' ? o.viewport : null,
    }
  } catch (_) {
    return { nodes: [], edges: [], viewport: null }
  }
}

function rowToProject(r) {
  if (!r) return null
  const g = parseGraphJson(r.graph_json)
  return {
    id: r.id,
    name: r.name || '未命名项目',
    graphJson: g,
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
    updateTime: r.update_time ? String(r.update_time).replace('T', ' ').slice(0, 19) : '',
  }
}

function rowToProjectBrief(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name || '未命名项目',
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
    updateTime: r.update_time ? String(r.update_time).replace('T', ' ').slice(0, 19) : '',
  }
}

function parseDefaultParams(text) {
  if (!text || !String(text).trim()) return {}
  try {
    const o = JSON.parse(text)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch (_) {
    return {}
  }
}

/** 画布：启用的模型（下拉） */
router.get('/model/list-enabled', (req, res) => {
  try {
    const rows = database()
      .prepare(
        `SELECT id, name, api_model_id, is_default, default_params, supports_reference_video
         FROM video_models WHERE status = 0 ORDER BY sort ASC, id ASC`
      )
      .all()
    res.json(
      ok(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          apiModelId: r.api_model_id,
          isDefault: r.is_default === 1,
          supportsReferenceVideo: r.supports_reference_video === 1,
          defaultParams: parseDefaultParams(r.default_params),
        }))
      )
    )
  } catch (e) {
    console.error('[video] list-enabled.models', e.message)
    res.json(fail(500, '读取模型失败'))
  }
})

/** 创建视频任务（异步，立即返回 job id） */
router.post('/jobs', async (req, res) => {
  if (!allowVideoJobRate(req.userId)) {
    return res.json(fail(429, '请求过于频繁，请稍后再试'))
  }

  const b = req.body || {}
  const modeRaw = String(b.mode || '').toLowerCase()
  const mode =
    modeRaw === 'image' || modeRaw === 'multimodal' || modeRaw === 'text' ? modeRaw : ''

  const sourceImageUrl = String(b.sourceImageUrl || b.source_image_url || '').trim()
  const sourceImageUrls = Array.isArray(b.sourceImageUrls) ? b.sourceImageUrls : []
  const sourceVideoUrls = Array.isArray(b.sourceVideoUrls) ? b.sourceVideoUrls : []

  const result = await createVideoJob(database(), {
    userId: req.userId,
    prompt: b.prompt,
    mode,
    sourceImageUrl,
    sourceImageUrls,
    sourceVideoUrls,
    videoModelId: b.videoModelId,
    projectId: b.projectId ?? b.project_id,
    options: b.options,
  })

  if (!result.ok) {
    return res.json(fail(result.code, result.message))
  }

  res.json(ok({ id: result.id, externalTaskId: result.externalTaskId, status: result.status }))
})

/** 同步远端状态并返回任务 */
router.get('/jobs/get', async (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))

  const row = database()
    .prepare(
      `SELECT id, user_id, project_id, video_model_id, mode, source_image_url, source_video_urls, external_task_id, status, prompt, result_url, error_message,
              datetime(created_at) as create_time, datetime(updated_at) as update_time
       FROM video_jobs WHERE id = ? AND user_id = ?`
    )
    .get(id, req.userId)
  if (!row) return res.json(fail(404, '任务不存在'))

  const syncable = row.external_task_id && ['pending', 'processing'].includes(row.status)
  if (syncable && seedance.isConfigured()) {
    try {
      const { status, resultUrl, errorMessage } = await pullArkJobStateAndStableResultUrl(
        row.external_task_id,
        row.id,
      )
      if (status !== row.status || resultUrl || errorMessage) {
        database()
          .prepare(
            `UPDATE video_jobs SET status = ?, result_url = COALESCE(?, result_url), error_message = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .run(status, resultUrl || null, errorMessage || null, id)
        row.status = status
        if (resultUrl) row.result_url = resultUrl
        if (errorMessage) row.error_message = errorMessage
      }
    } catch (e) {
      console.error('[video] sync job', e.message)
    }
  }

  res.json(ok(rowToJob(row)))
})

router.get('/jobs/page', (req, res) => {
  const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const offset = (pageNo - 1) * pageSize
  const d = database()
  const total = d.prepare('SELECT COUNT(*) AS c FROM video_jobs WHERE user_id = ?').get(req.userId).c
  const rows = d
    .prepare(
      `SELECT id, user_id, project_id, video_model_id, mode, source_image_url, source_video_urls, external_task_id, status, prompt, result_url, error_message,
              datetime(created_at) as create_time, datetime(updated_at) as update_time
       FROM video_jobs WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(req.userId, pageSize, offset)
  res.json(ok({ list: rows.map(rowToJob), total }))
})

/** 视频创作项目列表 */
router.get('/projects/page', (req, res) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
    const offset = (pageNo - 1) * pageSize
    const d = database()
    const total = d.prepare('SELECT COUNT(*) AS c FROM video_projects WHERE user_id = ?').get(req.userId)
      .c
    const rows = d
      .prepare(
        `SELECT id, name, datetime(created_at) as create_time, datetime(updated_at) as update_time
         FROM video_projects WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(req.userId, pageSize, offset)
    res.json(ok({ list: rows.map(rowToProjectBrief), total }))
  } catch (e) {
    console.error('[video] projects/page', e.message)
    res.json(fail(500, '读取项目列表失败'))
  }
})

/** 新建项目 */
router.post('/projects', (req, res) => {
  try {
    const name = String(req.body?.name || '未命名项目').trim() || '未命名项目'
    const info = database()
      .prepare(
        `INSERT INTO video_projects (user_id, name, graph_json) VALUES (?, ?, ?)`
      )
      .run(req.userId, name, JSON.stringify({ nodes: [], edges: [], viewport: null }))
    const id = Number(info.lastInsertRowid)
    const row = database()
      .prepare(
        `SELECT id, name, graph_json, datetime(created_at) as create_time, datetime(updated_at) as update_time
         FROM video_projects WHERE id = ? AND user_id = ?`
      )
      .get(id, req.userId)
    res.json(ok(rowToProject(row)))
  } catch (e) {
    console.error('[video] projects create', e.message)
    res.json(fail(500, '创建项目失败'))
  }
})

/** 单个项目（含画布 JSON） */
router.get('/projects/get', (req, res) => {
  try {
    const id = Number(req.query.id)
    if (!id) return res.json(fail(400, '缺少 id'))
    const row = database()
      .prepare(
        `SELECT id, name, graph_json, datetime(created_at) as create_time, datetime(updated_at) as update_time
         FROM video_projects WHERE id = ? AND user_id = ?`
      )
      .get(id, req.userId)
    if (!row) return res.json(fail(404, '项目不存在'))
    res.json(ok(rowToProject(row)))
  } catch (e) {
    console.error('[video] projects/get', e.message)
    res.json(fail(500, '读取项目失败'))
  }
})

/** 保存项目（名称与/或画布） */
router.put('/projects/save', (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!id) return res.json(fail(400, '缺少 id'))
    const row = database()
      .prepare('SELECT id FROM video_projects WHERE id = ? AND user_id = ?')
      .get(id, req.userId)
    if (!row) return res.json(fail(404, '项目不存在'))

    const nameIn = req.body?.name
    const graphIn = req.body?.graphJson ?? req.body?.graph_json

    let graphStr = null
    if (graphIn !== undefined && graphIn !== null) {
      const g =
        typeof graphIn === 'string'
          ? parseGraphJson(graphIn)
          : graphIn && typeof graphIn === 'object'
            ? {
                nodes: Array.isArray(graphIn.nodes) ? graphIn.nodes : [],
                edges: Array.isArray(graphIn.edges) ? graphIn.edges : [],
                viewport:
                  graphIn.viewport && typeof graphIn.viewport === 'object' ? graphIn.viewport : null,
              }
            : { nodes: [], edges: [], viewport: null }
      graphStr = JSON.stringify(g)
    }

    const name =
      nameIn !== undefined && nameIn !== null ? String(nameIn).trim() || '未命名项目' : null

    if (name != null && graphStr != null) {
      database()
        .prepare(
          `UPDATE video_projects SET name = ?, graph_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
        )
        .run(name, graphStr, id, req.userId)
    } else if (graphStr != null) {
      database()
        .prepare(
          `UPDATE video_projects SET graph_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
        )
        .run(graphStr, id, req.userId)
    } else if (name != null) {
      database()
        .prepare(`UPDATE video_projects SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
        .run(name, id, req.userId)
    }

    const out = database()
      .prepare(
        `SELECT id, name, graph_json, datetime(created_at) as create_time, datetime(updated_at) as update_time
         FROM video_projects WHERE id = ? AND user_id = ?`
      )
      .get(id, req.userId)
    res.json(ok(rowToProject(out)))
  } catch (e) {
    console.error('[video] projects/save', e.message)
    res.json(fail(500, '保存项目失败'))
  }
})

router.use('/chat', videoChatRouter)
router.use('/admin', videoAdminRouter)

module.exports = router
