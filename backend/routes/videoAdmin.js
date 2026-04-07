/**
 * 创作日志：跨用户视频任务查询，需菜单权限 ai:video-manage:list
 */
const express = require('express')
const { requireAuth } = require('./auth')
const { ok, fail } = require('../utils/response')
const db = require('../db')

const router = express.Router()
router.use(requireAuth)

const database = () => db.getDb()

/** @type {string} 与 menus.permission 一致 */
const PERM_VIDEO_MANAGE = 'ai:video-manage:list'

function userHasPermission(userId, permission) {
  const d = database()
  const roles = d
    .prepare('SELECT role_id FROM user_roles WHERE user_id = ?')
    .all(userId)
    .map((r) => r.role_id)
  if (roles.includes(1)) return true
  const p = String(permission || '').trim()
  if (!p || !roles.length) return false
  const ph = roles.map(() => '?').join(',')
  const row = d
    .prepare(
      `SELECT 1 FROM role_menus rm
       INNER JOIN menus m ON m.id = rm.menu_id AND m.status = 0 AND m.permission = ?
       WHERE rm.role_id IN (${ph})
       LIMIT 1`,
    )
    .get(p, ...roles)
  return !!row
}

function requireVideoManage(req, res, next) {
  if (!userHasPermission(req.userId, PERM_VIDEO_MANAGE)) {
    return res.json(fail(403, '无权限访问创作日志'))
  }
  next()
}

function parseSourceVideoUrls(text) {
  if (!text || !String(text).trim()) return []
  try {
    const o = JSON.parse(text)
    return Array.isArray(o) ? o.filter((u) => u && String(u).startsWith('http')) : []
  } catch (_) {
    return []
  }
}

function parseChatExtra(requestPayloadText) {
  const out = { aspectRatio: '', duration: null }
  if (!requestPayloadText || !String(requestPayloadText).trim()) return out
  try {
    const root = JSON.parse(requestPayloadText)
    const payload = root && typeof root === 'object' && root.payload ? root.payload : root
    if (!payload || typeof payload !== 'object') return out
    const ar = payload.aspect_ratio ?? payload.aspectRatio
    if (ar != null && ar !== '') out.aspectRatio = String(ar)
    if (payload.duration != null && payload.duration !== '') {
      const n = parseInt(String(payload.duration), 10)
      if (Number.isFinite(n)) out.duration = n
    }
  } catch (_) {
    /* ignore */
  }
  return out
}

function extractMediaUrlsFromPayload(requestPayloadText) {
  const images = []
  const videos = []
  if (!requestPayloadText || !String(requestPayloadText).trim()) return { images, videos }
  try {
    const root = JSON.parse(requestPayloadText)
    const payload = root && typeof root === 'object' && root.payload ? root.payload : root
    const content = payload && typeof payload === 'object' && Array.isArray(payload.content) ? payload.content : []
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      if (item.type === 'image_url' && item.image_url && item.image_url.url) {
        const u = String(item.image_url.url).trim()
        if (u.startsWith('http')) images.push(u)
      }
      if (item.type === 'video_url' && item.video_url && item.video_url.url) {
        const u = String(item.video_url.url).trim()
        if (u.startsWith('http')) videos.push(u)
      }
    }
  } catch (_) {
    /* ignore */
  }
  return { images, videos }
}

function mergeUniqueHttpUrls(...groups) {
  const seen = new Set()
  const out = []
  for (const g of groups) {
    const arr = Array.isArray(g) ? g : []
    for (const u of arr) {
      const s = u && String(u).trim()
      if (!s || !s.startsWith('http') || seen.has(s)) continue
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

function rowToAdminJob(r) {
  if (!r) return null
  const extra = parseChatExtra(r.request_payload)
  const fromPayload = extractMediaUrlsFromPayload(r.request_payload)
  const colVideos = parseSourceVideoUrls(r.source_video_urls)
  const colImg = r.source_image_url && String(r.source_image_url).trim().startsWith('http')
    ? [String(r.source_image_url).trim()]
    : []
  const sourceImageUrls = mergeUniqueHttpUrls(colImg, fromPayload.images)
  const sourceVideoUrls = mergeUniqueHttpUrls(colVideos, fromPayload.videos)
  return {
    id: r.id,
    userId: r.user_id,
    username: r.username != null ? String(r.username) : '',
    nickname: r.nickname != null ? String(r.nickname) : '',
    projectId: r.project_id || null,
    videoModelId: r.video_model_id,
    modelName: r.model_name != null ? String(r.model_name).trim() : '',
    externalTaskId: r.external_task_id || '',
    status: r.status || 'pending',
    mode: r.mode || 'text',
    sourceImageUrl: sourceImageUrls[0] || '',
    sourceImageUrls,
    sourceVideoUrls,
    prompt: r.prompt || '',
    resultUrl: r.result_url || '',
    errorMessage: r.error_message || '',
    fromChat: r.from_chat === 1,
    aspectRatio: extra.aspectRatio || '',
    durationSec: extra.duration,
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
    updateTime: r.update_time ? String(r.update_time).replace('T', ' ').slice(0, 19) : '',
  }
}

router.use(requireVideoManage)

/** 分页：跨用户视频任务 */
router.get('/jobs/page', (req, res) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
    const offset = (pageNo - 1) * pageSize
    const userIdFilter = req.query.userId != null && req.query.userId !== '' ? Number(req.query.userId) : 0
    const statusRaw = String(req.query.status || '').trim().toLowerCase()
    const keyword = String(req.query.keyword || '').trim()
    const createTimeFrom = String(req.query.createTimeFrom || '').trim()
    const createTimeTo = String(req.query.createTimeTo || '').trim()

    const conds = ['1=1']
    const params = []
    if (userIdFilter > 0) {
      conds.push('j.user_id = ?')
      params.push(userIdFilter)
    }
    if (statusRaw === 'success') {
      conds.push(`(LOWER(TRIM(j.status)) IN ('succeeded','success','completed','complete','done'))`)
    } else if (statusRaw === 'failed') {
      conds.push(`(LOWER(TRIM(j.status)) IN ('failed','error'))`)
    } else if (statusRaw) {
      conds.push('LOWER(TRIM(j.status)) = ?')
      params.push(statusRaw)
    }
    if (keyword) {
      conds.push('j.prompt LIKE ?')
      params.push(`%${keyword}%`)
    }
    if (createTimeFrom) {
      conds.push(`replace(replace(trim(j.created_at), 'T', ' '), 'Z', '') >= ?`)
      params.push(createTimeFrom)
    }
    if (createTimeTo) {
      conds.push(`replace(replace(trim(j.created_at), 'T', ' '), 'Z', '') <= ?`)
      params.push(createTimeTo)
    }
    const where = conds.join(' AND ')
    const d = database()

    const total = d
      .prepare(
        `SELECT COUNT(*) AS c FROM video_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE ${where}`,
      )
      .get(...params).c

    const rows = d
      .prepare(
        `SELECT j.id, j.user_id, j.project_id, j.video_model_id, j.mode, j.source_image_url, j.source_video_urls,
                j.external_task_id, j.status, j.prompt, j.result_url, j.error_message, j.request_payload,
                datetime(j.created_at) as create_time, datetime(j.updated_at) as update_time,
                u.username, u.nickname,
                TRIM(COALESCE(vm.name, '')) as model_name,
                CASE WHEN EXISTS (SELECT 1 FROM video_chat_messages m WHERE m.video_job_id = j.id LIMIT 1) THEN 1 ELSE 0 END as from_chat
         FROM video_jobs j
         LEFT JOIN users u ON u.id = j.user_id
         LEFT JOIN video_models vm ON vm.id = j.video_model_id
         WHERE ${where}
         ORDER BY j.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset)

    res.json(ok({ list: rows.map(rowToAdminJob), total }))
  } catch (e) {
    console.error('[videoAdmin] jobs/page', e.message)
    res.json(fail(500, '读取创作日志失败'))
  }
})

module.exports = router
