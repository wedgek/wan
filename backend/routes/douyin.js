/**
 * 抖音解析：粘贴分享链接/文案 → 调用聚合接口解析原链接素材并落库。
 * 聚合侧（server / browser）入库在 app_settings.douyin.agg_side，仅超级管理员可改，全员生效。
 * 需菜单权限 tools:douyin-parse:list；列表按数据范围过滤（本人 / 部门 / 全部）。
 */
const express = require('express')
const { Readable } = require('stream')
const { requireAuth } = require('./auth')
const { ok, fail } = require('../utils/response')
const db = require('../db')
const dataScope = require('../services/dataScopeService')
const douyinParser = require('../services/douyinParser')

const DOWNLOAD_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const SETTING_AGG_SIDE = 'douyin.agg_side'

/** 环境变量仅作库无记录时的种子兜底 */
const ENV_AGG_SIDE = (() => {
  const v = String(process.env.DOUYIN_AGG_SIDE || 'server').trim().toLowerCase()
  return v === 'browser' || v === 'client' ? 'browser' : 'server'
})()

function parseAggSideStrict(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'browser' || v === 'client') return 'browser'
  if (v === 'server' || v === 'backend') return 'server'
  return null
}

/** 读取全局聚合侧（入库优先） */
function getAggSide() {
  return parseAggSideStrict(db.getAppSetting(SETTING_AGG_SIDE, '')) || ENV_AGG_SIDE
}

const router = express.Router()
router.use(requireAuth)

const database = () => db.getDb()

/** @type {string} 与 menus.permission 一致 */
const PERM_DOUYIN_PARSE = 'tools:douyin-parse:list'

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

function requireDouyinParse(req, res, next) {
  if (!userHasPermission(req.userId, PERM_DOUYIN_PARSE)) {
    return res.json(fail(403, '无权限访问抖音素材提取'))
  }
  next()
}

router.use(requireDouyinParse)

/**
 * 惰性超时兜底：把「解析中」但已超过阈值的行判超时失败。
 * 阈值取较大值（默认 300s），大于单次解析上限（约 2×20s）与常规排队等待，避免误杀在跑/排队的任务。
 * 必须用 updated_at（重新获取会刷新它），不能用 created_at——否则老记录一点「重新获取」
 * 就会被当成「创建超过 300s 仍在解析中」而误杀，页面出现「有 resultUrl 却显示失败」。
 */
const PROCESSING_STALE_SEC = Number(process.env.DOUYIN_PROCESSING_STALE_SEC) || 300
function reconcileStaleProcessing() {
  try {
    database()
      .prepare(
        `UPDATE douyin_parse_logs
         SET status = 'failed', error_message = '解析超时，请重新获取', updated_at = datetime('now')
         WHERE status IN ('processing', 'pending')
           AND (strftime('%s', 'now') - strftime('%s', COALESCE(updated_at, created_at))) > ?`,
      )
      .run(PROCESSING_STALE_SEC)
  } catch (e) {
    console.warn('[douyin] reconcileStaleProcessing skipped:', e && e.message)
  }
}

function parseImages(text) {
  if (!text || !String(text).trim()) return []
  try {
    const o = JSON.parse(text)
    return Array.isArray(o) ? o.filter((u) => u && String(u).startsWith('http')) : []
  } catch (_) {
    return []
  }
}

function rowToLog(r) {
  if (!r) return null
  return {
    id: r.id,
    userId: r.user_id,
    username: r.username != null ? String(r.username) : '',
    nickname: r.nickname != null ? String(r.nickname) : '',
    inputText: r.input_text || '',
    douyinUrl: r.douyin_url || '',
    awemeId: r.aweme_id || '',
    title: r.title || '',
    author: r.author || '',
    cover: r.cover || '',
    mediaType: r.media_type || 'video',
    isVideo: r.is_video === 1,
    resultUrl: r.result_url || '',
    images: parseImages(r.images),
    source: r.source || 'aggregator',
    status: r.status || 'success',
    errorMessage: r.error_message || '',
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
    expiresAt: r.expires_at || '',
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
    updateTime: r.update_time ? String(r.update_time).replace('T', ' ').slice(0, 19) : '',
  }
}

function getLogById(id) {
  return database()
    .prepare(
      `SELECT j.*, datetime(j.created_at, 'localtime') as create_time, datetime(j.updated_at, 'localtime') as update_time,
              u.username, u.nickname
       FROM douyin_parse_logs j
       LEFT JOIN users u ON u.id = j.user_id
       WHERE j.id = ?`,
    )
    .get(Number(id))
}

/** 插入一条「解析中」占位记录，立即返回 id（真正解析走后台） */
function insertPendingLog(userId, inputText) {
  const d = database()
  const info = d
    .prepare(
      `INSERT INTO douyin_parse_logs
        (user_id, input_text, status, created_at, updated_at)
       VALUES (?, ?, 'processing', datetime('now'), datetime('now'))`,
    )
    .run(Number(userId), String(inputText || '').slice(0, 2000))
  return Number(info.lastInsertRowid)
}

function markRowFailed(id, errorMessage, durationMs) {
  database()
    .prepare(
      `UPDATE douyin_parse_logs SET status = 'failed', error_message = ?, duration_ms = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(String(errorMessage || '解析失败，请稍后重试').slice(0, 500), Math.round(Number(durationMs) || 0), id)
}

function markRowSuccess(id, result, durationMs) {
  database()
    .prepare(
      `UPDATE douyin_parse_logs SET
         douyin_url = ?, aweme_id = ?, title = ?, author = ?, cover = ?, media_type = ?, is_video = ?,
         result_url = ?, images = ?, source = ?, status = 'success', error_message = '',
         duration_ms = ?, expires_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(
      result.douyinUrl || '',
      result.awemeId || '',
      result.title || '',
      result.author || '',
      result.cover || '',
      result.mediaType || 'video',
      result.isVideo === false ? 0 : 1,
      result.resultUrl || '',
      JSON.stringify(result.images || []),
      result.source || 'aggregator',
      Math.round(Number(durationMs) || 0),
      result.expiresAt || null,
      id,
    )
}

/**
 * 后台解析并把结果写回指定行（fire-and-forget，内部吞异常，绝不抛出）。
 * duration_ms = 任务端到端挂钟时间（进入解析 → 终态），含内部重试与退避。
 * 对标云厂商「任务耗时」：end_time - start_time，不是把各次请求耗时手工相加。
 */
async function runParseIntoRow(id, text) {
  const started = Date.now()
  try {
    const result = await douyinParser.parse(text)
    markRowSuccess(id, result, Date.now() - started)
  } catch (e) {
    const isKnown = e instanceof douyinParser.DouyinParseError
    const msg = isKnown ? e.message : '解析失败，请稍后重试'
    if (!isKnown) console.error('[douyin] runParse', e && e.message)
    try {
      markRowFailed(id, msg, Date.now() - started)
    } catch (_) {
      /* ignore */
    }
  }
}

/** 配置：全局聚合侧 + 浏览器直连用的公开 API；canEditAggSide 仅超级管理员为 true */
router.get('/config', (req, res) => {
  res.json(
    ok({
      aggSide: getAggSide(),
      aggApi: douyinParser.AGGREGATOR_API,
      canEditAggSide: dataScope.isSuperAdmin(req.userId),
    }),
  )
})

/** 超级管理员修改全局聚合侧，全员立即生效 */
router.put('/config', (req, res) => {
  try {
    if (!dataScope.isSuperAdmin(req.userId)) {
      return res.json(fail(403, '仅超级管理员可修改聚合方式'))
    }
    const side = parseAggSideStrict(req.body && req.body.aggSide)
    if (!side) return res.json(fail(400, 'aggSide 须为 server 或 browser'))
    db.setAppSetting(SETTING_AGG_SIDE, side)
    res.json(ok({ aggSide: side, aggApi: douyinParser.AGGREGATOR_API, canEditAggSide: true }))
  } catch (e) {
    console.error('[douyin] config put', e && e.message)
    res.json(fail(500, '保存失败'))
  }
})

/**
 * 解析作品 ID（短链跳转仍走服务器；仅解析 ID，不调 bugpk）。
 * 浏览器模式下前端先 resolve，再直连聚合接口。
 */
router.post('/resolve', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim()
    if (!text) return res.json(fail(400, '请输入抖音分享链接或文案'))
    const resolved = await douyinParser.resolveAwemeId(text)
    res.json(ok(resolved))
  } catch (e) {
    const isKnown = e instanceof douyinParser.DouyinParseError
    res.json(fail(isKnown ? 400 : 500, isKnown ? e.message : '解析作品 ID 失败'))
  }
})

/**
 * 浏览器直连聚合后的结果回写。服务端用 buildFromAggregator 归一化，不盲信前端拼好的字段。
 * body: { durationMs, errorMessage? } 或 { durationMs, awemeId, douyinUrl, aggregatorData }
 */
router.post('/logs/:id/client-complete', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.json(fail(400, '参数错误'))
    const row = getLogById(id)
    if (!row) return res.json(fail(404, '记录不存在'))
    const check = dataScope.assertUserInScope(req.userId, row.user_id)
    if (!check.ok) return res.json(fail(403, check.msg || '无权操作该记录'))

    const body = req.body || {}
    const durationMs = Math.max(0, Math.round(Number(body.durationMs) || 0))
    const errMsg = String(body.errorMessage || '').trim()
    if (errMsg) {
      markRowFailed(id, errMsg, durationMs)
      return res.json(ok(rowToLog(getLogById(id))))
    }

    const awemeId = String(body.awemeId || '').trim()
    const douyinUrl = String(body.douyinUrl || '').trim()
    const aggregatorData = body.aggregatorData
    if (!awemeId || !aggregatorData || typeof aggregatorData !== 'object') {
      return res.json(fail(400, '缺少聚合结果数据'))
    }

    const built = douyinParser.buildFromAggregator(awemeId, douyinUrl || `https://www.douyin.com/video/${awemeId}`, aggregatorData)
    if (!built.resultUrl && !(built.images && built.images.length)) {
      markRowFailed(id, '未解析到可用素材地址，作品可能已被删除或仅本人可见', durationMs)
      return res.json(ok(rowToLog(getLogById(id))))
    }
    built.source = 'aggregator-browser'
    markRowSuccess(id, built, durationMs)
    res.json(ok(rowToLog(getLogById(id))))
  } catch (e) {
    console.error('[douyin] client-complete', e && e.message)
    res.json(fail(500, '回写解析结果失败'))
  }
})

/** 解析：粘贴文案/链接（支持多条批量）→ 立即建「解析中」记录并返回；聚合侧读库，server 后台解析 / browser 由前端回写 */
router.post('/parse', (req, res) => {
  const text = String((req.body && req.body.text) || '').trim()
  if (!text) return res.json(fail(400, '请输入抖音分享链接或文案'))
  const inputs = douyinParser.splitInputs(text)
  if (!inputs.length) return res.json(fail(400, '请输入抖音分享链接或文案'))
  const aggSide = getAggSide()

  const created = []
  for (const input of inputs) {
    const id = insertPendingLog(req.userId, input)
    created.push({ id, input })
  }
  res.json(ok({ list: created.map((c) => rowToLog(getLogById(c.id))), aggSide }))
  if (aggSide === 'server') {
    for (const c of created) {
      Promise.resolve().then(() => runParseIntoRow(c.id, c.input))
    }
  }
})

/** 重新获取：把记录置为「解析中」立即返回；聚合侧读库 */
router.post('/logs/:id/reparse', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.json(fail(400, '参数错误'))
    const row = getLogById(id)
    if (!row) return res.json(fail(404, '记录不存在'))
    const check = dataScope.assertUserInScope(req.userId, row.user_id)
    if (!check.ok) return res.json(fail(403, check.msg || '无权操作该记录'))

    const text = String(row.input_text || row.douyin_url || '').trim()
    if (!text) return res.json(fail(400, '该记录缺少原始链接，无法重新获取'))
    const aggSide = getAggSide()

    // 清空旧结果，避免前端/Network 里还带着上次的 resultUrl，误判「已经成功」
    database()
      .prepare(
        `UPDATE douyin_parse_logs SET
           status = 'processing', error_message = '',
           result_url = '', images = '[]', expires_at = NULL, duration_ms = NULL,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(id)
    res.json(ok({ ...rowToLog(getLogById(id)), aggSide }))
    if (aggSide === 'server') {
      Promise.resolve().then(() => runParseIntoRow(id, text))
    }
  } catch (e) {
    console.error('[douyin] reparse', e.message)
    res.json(fail(500, '重新获取失败'))
  }
})

/** 轻量状态轮询：仅返回指定 id（数据范围内）的最新记录，用于前端更新「解析中」行 */
router.get('/logs/status', (req, res) => {
  try {
    reconcileStaleProcessing()
    const ids = String(req.query.ids || '')
      .split(',')
      .map((x) => parseInt(x, 10))
      .filter((x) => x > 0)
      .slice(0, 200)
    if (!ids.length) return res.json(ok({ list: [] }))
    const conds = [`j.id IN (${ids.map(() => '?').join(',')})`]
    const params = [...ids]
    const scopePart = dataScope.douyinLogsScopeClause(req.userId)
    if (scopePart.sql) {
      conds.push(scopePart.sql)
      params.push(...scopePart.params)
    }
    const rows = database()
      .prepare(
        `SELECT j.*, datetime(j.created_at, 'localtime') as create_time, datetime(j.updated_at, 'localtime') as update_time,
                u.username, u.nickname
         FROM douyin_parse_logs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE ${conds.join(' AND ')}`,
      )
      .all(...params)
    res.json(ok({ list: rows.map(rowToLog) }))
  } catch (e) {
    console.error('[douyin] logs/status', e.message)
    res.json(fail(500, '读取状态失败'))
  }
})

/** 删除：仅可删除数据范围内的记录 */
router.delete('/logs/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.json(fail(400, '参数错误'))
    const row = getLogById(id)
    if (!row) return res.json(fail(404, '记录不存在'))
    const check = dataScope.assertUserInScope(req.userId, row.user_id)
    if (!check.ok) return res.json(fail(403, check.msg || '无权删除该记录'))
    database().prepare('DELETE FROM douyin_parse_logs WHERE id = ?').run(id)
    res.json(ok({ id }))
  } catch (e) {
    console.error('[douyin] delete', e.message)
    res.json(fail(500, '删除失败'))
  }
})

/**
 * 代理下载：把抖音 CDN 的短时签名地址服务端拉取后以附件形式回传，强制触发浏览器下载。
 * 不落盘（边拉边转发）；仅可下载数据范围内记录的素材；鉴权走标准 Bearer（前端 fetch 带 token）。
 */
router.get('/logs/:id/download', async (req, res) => {
  let upstreamAbort = null
  try {
    const id = Number(req.params.id)
    if (!id) return res.status(400).json(fail(400, '参数错误'))
    const row = getLogById(id)
    if (!row) return res.status(404).json(fail(404, '记录不存在'))
    const check = dataScope.assertUserInScope(req.userId, row.user_id)
    if (!check.ok) return res.status(403).json(fail(403, check.msg || '无权下载该记录'))

    const isImage = String(row.media_type || '') === 'images'
    const idxRaw = parseInt(req.query.index, 10)
    let url = ''
    if (isImage) {
      const imgs = parseImages(row.images)
      const idx = idxRaw >= 0 && idxRaw < imgs.length ? idxRaw : 0
      url = imgs[idx] || row.result_url || ''
    } else {
      url = row.result_url || ''
    }
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json(fail(400, '无可下载素材，请重新获取'))
    }

    upstreamAbort = new AbortController()
    const timer = setTimeout(() => upstreamAbort.abort(), 120000)
    // 客户端断开时同步中止上游拉取，避免悬挂连接
    res.on('close', () => {
      try {
        upstreamAbort.abort()
      } catch (_) {
        /* ignore */
      }
    })

    let upstream
    try {
      upstream = await fetch(url, {
        redirect: 'follow',
        signal: upstreamAbort.signal,
        headers: { 'User-Agent': DOWNLOAD_UA, Referer: 'https://www.douyin.com/' },
      })
    } catch (e) {
      clearTimeout(timer)
      if (!res.headersSent) res.status(502).json(fail(502, '下载失败，链接可能已过期，请重新获取'))
      return
    }
    if (!upstream.ok || !upstream.body) {
      clearTimeout(timer)
      if (!res.headersSent) res.status(502).json(fail(502, '下载失败，链接可能已过期，请重新获取'))
      return
    }

    const ext = isImage ? 'jpg' : 'mp4'
    const fname = `douyin_${row.aweme_id || id}.${ext}`
    const upType = upstream.headers.get('content-type')
    res.setHeader('Content-Type', upType || (isImage ? 'image/jpeg' : 'video/mp4'))
    const len = upstream.headers.get('content-length')
    if (len) res.setHeader('Content-Length', len)
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
    res.setHeader('Cache-Control', 'no-store')

    const nodeStream = Readable.fromWeb(upstream.body)
    nodeStream.on('error', () => {
      clearTimeout(timer)
      try {
        res.destroy()
      } catch (_) {
        /* ignore */
      }
    })
    res.on('finish', () => clearTimeout(timer))
    nodeStream.pipe(res)
  } catch (e) {
    console.error('[douyin] download', e && e.message)
    try {
      if (upstreamAbort) upstreamAbort.abort()
    } catch (_) {
      /* ignore */
    }
    if (!res.headersSent) res.status(500).json(fail(500, '下载失败'))
  }
})

/** 分页：按数据范围过滤的解析记录 */
router.get('/logs/page', (req, res) => {
  try {
    reconcileStaleProcessing()
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
    const scopePart = dataScope.douyinLogsScopeClause(req.userId)
    if (scopePart.sql) {
      conds.push(scopePart.sql)
      params.push(...scopePart.params)
    }
    if (userIdFilter > 0) {
      const userCheck = dataScope.assertUserInScope(req.userId, userIdFilter)
      if (!userCheck.ok) {
        return res.json(ok({ list: [], total: 0 }))
      }
      conds.push('j.user_id = ?')
      params.push(userIdFilter)
    }
    if (statusRaw === 'success') {
      conds.push(`LOWER(TRIM(j.status)) = 'success'`)
    } else if (statusRaw === 'failed') {
      conds.push(`LOWER(TRIM(j.status)) IN ('failed','error')`)
    } else if (statusRaw) {
      conds.push('LOWER(TRIM(j.status)) = ?')
      params.push(statusRaw)
    }
    if (keyword) {
      conds.push('(j.input_text LIKE ? OR j.title LIKE ? OR j.douyin_url LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (createTimeFrom) {
      conds.push(`datetime(j.created_at, 'localtime') >= ?`)
      params.push(createTimeFrom)
    }
    if (createTimeTo) {
      conds.push(`datetime(j.created_at, 'localtime') <= ?`)
      params.push(createTimeTo)
    }
    const where = conds.join(' AND ')
    const d = database()

    const total = d
      .prepare(
        `SELECT COUNT(*) AS c FROM douyin_parse_logs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE ${where}`,
      )
      .get(...params).c

    const rows = d
      .prepare(
        `SELECT j.*, datetime(j.created_at, 'localtime') as create_time, datetime(j.updated_at, 'localtime') as update_time,
                u.username, u.nickname
         FROM douyin_parse_logs j
         LEFT JOIN users u ON u.id = j.user_id
         WHERE ${where}
         ORDER BY j.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset)

    res.json(ok({ list: rows.map(rowToLog), total }))
  } catch (e) {
    console.error('[douyin] logs/page', e.message)
    res.json(fail(500, '读取解析记录失败'))
  }
})

module.exports = router
