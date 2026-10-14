/**
 * 小说投流：书籍、素材、推广链接（点众）、导入。
 * 需对应菜单权限 novel:books:list / novel:materials:list / novel:promo:list。
 */
const express = require('express')
const multer = require('multer')
const { requireAuth } = require('./auth')
const { ok, fail } = require('../utils/response')
const db = require('../db')
const novelImport = require('../services/novelImportService')
const dianzhong = require('../services/dianzhongPromoClient')

const router = express.Router()

function handleDianzhongCallback(req, res) {
  const q = { ...(req.query || {}), ...((req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}) }
  const taskId = String(q.taskId || q.taskid || q.task_id || '').trim()
  let xurl = String(q.xurl || q.xUrl || '').trim()
  if (xurl && xurl !== '-1') {
    try {
      xurl = decodeURIComponent(xurl)
    } catch {
      /* 已是明文 */
    }
  }
  try {
    database()
      .prepare(
        `INSERT INTO novel_dianzhong_callbacks (task_id, xurl, query_json) VALUES (?, ?, ?)`,
      )
      .run(taskId, xurl, JSON.stringify(q))
  } catch (e) {
    console.error('[novel] dianzhong callback write', e.message)
  }
  console.log('[novel] dianzhong callback', { taskId, xurl: String(xurl).slice(0, 180) })
  res.status(200).json({ code: 1, msg: 'ok' })
}

router.get('/dianzhong/callback', handleDianzhongCallback)
router.post('/dianzhong/callback', handleDianzhongCallback)

router.use(requireAuth)

const database = () => db.getDb()

const PERM = {
  books: 'novel:books:list',
  materials: 'novel:materials:list',
  promo: 'novel:promo:list',
  sync: 'novel:sync:list',
}

const CONVERT_STATUSES = new Set(['collected', 'hot', 'converting', 'converted', 'dropped'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
}).single('file')

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

function requirePerm(permission, label) {
  return (req, res, next) => {
    if (!userHasPermission(req.userId, permission)) {
      return res.json(fail(403, `无权限访问${label}`))
    }
    next()
  }
}

function requireAnyPerm(permissions, label) {
  return (req, res, next) => {
    if (permissions.some((p) => userHasPermission(req.userId, p))) return next()
    return res.json(fail(403, `无权限访问${label}`))
  }
}

function fmtTime(v) {
  return v ? String(v).replace('T', ' ').slice(0, 19) : ''
}

function isNewBookRow(r) {
  if (!r) return false
  if (String(r.launch_status || 'pending') !== 'pending') return false
  const first = String(r.first_seen_at || r.created_at || '').slice(0, 10)
  return first === novelImport.todayLocal()
}

function isNewMaterialRow(r) {
  if (!r) return false
  const first = String(r.first_seen_at || r.created_at || '')
  if (!first) return false
  const launchedAt = r.book_launched_at || r.launched_at
  if (String(r.book_launch_status || r.launch_status || '') === 'launched' && launchedAt) {
    return first > String(launchedAt)
  }
  return first.slice(0, 10) === novelImport.todayLocal()
}

function rowToBook(r) {
  if (!r) return null
  return {
    id: r.id,
    externalBookId: r.external_book_id || '',
    store: r.store || '',
    name: r.name || '',
    author: r.author || '',
    wordCount: r.word_count || 0,
    category: r.category || '',
    firstSeenAt: fmtTime(r.first_seen_at),
    lastSeenAt: fmtTime(r.last_seen_at),
    launchStatus: r.launch_status || 'pending',
    launchedAt: fmtTime(r.launched_at),
    launchUserId: r.launch_user_id || null,
    materialCount: Number(r.material_count || 0),
    newMaterialCount: Number(r.new_material_count || 0),
    isNew: r.is_new != null ? Number(r.is_new) === 1 : isNewBookRow(r),
    createTime: fmtTime(r.create_time || r.created_at),
    updateTime: fmtTime(r.update_time || r.updated_at),
  }
}

function rowToBookSnapshot(r) {
  if (!r) return null
  return {
    id: r.id,
    bookId: r.book_id,
    statDate: r.stat_date,
    slot: r.slot,
    rechargeUsers: r.recharge_users || 0,
    rechargeOrders: r.recharge_orders || 0,
    avgOrders: r.avg_orders || 0,
    firstRechargeOrders: r.first_recharge_orders || 0,
    rechargeAmount: r.recharge_amount || 0,
    arpu: r.arpu || 0,
    isHot: Number(r.is_hot) === 1,
    batchId: r.batch_id,
    createTime: fmtTime(r.created_at),
    updateTime: fmtTime(r.updated_at),
  }
}

function rowToMaterial(r) {
  if (!r) return null
  return {
    id: r.id,
    bookId: r.book_id,
    bookName: r.book_name || '',
    externalBookId: r.external_book_id || '',
    store: r.store || '',
    externalId: r.external_id || '',
    title: r.title || '',
    coverUrl: r.cover_url || '',
    playUrl: r.play_url || '',
    heat: r.heat || 0,
    convertStatus: r.convert_status || 'collected',
    convertedUrl: r.converted_url || '',
    convertRemark: r.convert_remark || '',
    convertUserId: r.convert_user_id,
    convertAt: fmtTime(r.convert_at),
    firstSeenAt: fmtTime(r.first_seen_at),
    lastSeenAt: fmtTime(r.last_seen_at),
    isNew: isNewMaterialRow(r),
    createTime: fmtTime(r.created_at),
    updateTime: fmtTime(r.updated_at),
    latest: r.snap_id
      ? {
          id: r.snap_id,
          statDate: r.snap_stat_date,
          slot: r.snap_slot,
          cost: r.snap_cost || 0,
          impressions: r.snap_impressions || 0,
          clicks: r.snap_clicks || 0,
          ctr: r.snap_ctr || 0,
          conversions: r.snap_conversions || 0,
          rechargeAmount: r.snap_recharge_amount || 0,
          heat: r.snap_heat != null ? r.snap_heat : r.heat || 0,
          isHot: Number(r.snap_is_hot) === 1,
        }
      : null,
  }
}

function rowToPromo(r) {
  if (!r) return null
  return {
    id: r.id,
    bookId: r.book_id,
    bookName: r.book_name || '',
    externalBookId: r.external_book_id || '',
    store: r.store || r.book_store || '',
    name: r.name || '',
    url: r.url || '',
    channel: r.channel || '',
    status: r.status || 'active',
    remark: r.remark || '',
    externalId: r.external_id || '',
    source: r.source || 'manual',
    referralId: r.referral_id || '',
    mediaSource: r.media_source || '',
    path: r.path || '',
    monitor1: r.monitor1 || '',
    monitor2: r.monitor2 || '',
    createTime: fmtTime(r.created_at),
    updateTime: fmtTime(r.updated_at),
  }
}

function rowToBatch(r) {
  if (!r) return null
  let fails = []
  if (r.fail_reasons) {
    try {
      fails = JSON.parse(r.fail_reasons)
    } catch {
      fails = []
    }
  }
  return {
    id: r.id,
    type: r.type,
    statDate: r.stat_date,
    slot: r.slot,
    filename: r.filename || '',
    status: r.status,
    totalCount: r.total_count || 0,
    successCount: r.success_count || 0,
    failCount: r.fail_count || 0,
    errorMessage: r.error_message || '',
    fails,
    userId: r.user_id,
    username: r.username || '',
    nickname: r.nickname || '',
    createTime: fmtTime(r.created_at),
    finishedAt: fmtTime(r.finished_at),
  }
}

function pageParams(query) {
  const pageNo = Math.max(1, parseInt(query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20))
  return { pageNo, pageSize, offset: (pageNo - 1) * pageSize }
}

router.get('/books/page', requirePerm(PERM.books, '书籍'), (req, res) => {
  try {
    const { pageSize, offset } = pageParams(req.query)
    const keyword = String(req.query.keyword || '').trim()
    const store = String(req.query.store || '').trim()
    const launchStatus = String(req.query.launchStatus || '').trim()
    const d = database()
    const today = novelImport.todayLocal()

    const conds = ['1=1']
    const params = []
    if (keyword) {
      conds.push('(b.name LIKE ? OR b.external_book_id LIKE ? OR b.author LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (store) {
      conds.push('b.store = ?')
      params.push(store)
    }
    if (launchStatus === 'pending' || launchStatus === 'launched') {
      conds.push("COALESCE(b.launch_status, 'pending') = ?")
      params.push(launchStatus)
    } else if (launchStatus === 'new') {
      conds.push("COALESCE(b.launch_status, 'pending') = 'pending'")
      conds.push("date(COALESCE(b.first_seen_at, b.created_at)) = ?")
      params.push(today)
    }

    const where = conds.join(' AND ')
    const from = `
      FROM novel_books b
      LEFT JOIN (
        SELECT book_id, MAX(id) AS max_id FROM novel_book_snapshots GROUP BY book_id
      ) latest ON latest.book_id = b.id
      LEFT JOIN novel_book_snapshots s ON s.id = latest.max_id
      WHERE ${where}
    `
    const total = d.prepare(`SELECT COUNT(*) AS c ${from}`).get(...params).c
    const rows = d
      .prepare(
        `SELECT b.id, b.external_book_id, b.store, b.name, b.author, b.word_count, b.category,
                b.first_seen_at, b.last_seen_at, b.launch_status, b.launched_at, b.launch_user_id,
                b.created_at, b.updated_at,
                (SELECT COUNT(*) FROM novel_materials m WHERE m.book_id = b.id) AS material_count,
                (SELECT COUNT(*) FROM novel_materials m WHERE m.book_id = b.id AND (
                   CASE
                     WHEN COALESCE(b.launch_status, 'pending') = 'launched' AND b.launched_at IS NOT NULL
                       THEN datetime(COALESCE(m.first_seen_at, m.created_at)) > datetime(b.launched_at)
                     ELSE date(COALESCE(m.first_seen_at, m.created_at)) = date('now', 'localtime')
                   END
                )) AS new_material_count,
                CASE
                  WHEN COALESCE(b.launch_status, 'pending') = 'pending'
                   AND date(COALESCE(b.first_seen_at, b.created_at)) = date('now', 'localtime')
                  THEN 1 ELSE 0
                END AS is_new,
                s.id AS snap_id, s.stat_date, s.slot, s.recharge_users, s.recharge_orders,
                s.avg_orders, s.first_recharge_orders, s.recharge_amount, s.arpu, s.is_hot, s.batch_id
         ${from}
         ORDER BY b.last_seen_at DESC, b.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset)

    res.json(
      ok({
        list: rows.map((r) => ({
          ...rowToBook(r),
          snapshot: r.snap_id
            ? rowToBookSnapshot({
                id: r.snap_id,
                book_id: r.id,
                stat_date: r.stat_date,
                slot: r.slot,
                recharge_users: r.recharge_users,
                recharge_orders: r.recharge_orders,
                avg_orders: r.avg_orders,
                first_recharge_orders: r.first_recharge_orders,
                recharge_amount: r.recharge_amount,
                arpu: r.arpu,
                is_hot: r.is_hot,
                batch_id: r.batch_id,
              })
            : null,
        })),
        total,
      }),
    )
  } catch (e) {
    console.error('[novel] books/page', e.message)
    res.json(fail(500, '读取书籍失败'))
  }
})

router.get(
  '/books/options',
  requireAnyPerm([PERM.books, PERM.materials, PERM.promo], '书籍选项'),
  (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim()
    const d = database()
    const conds = ['1=1']
    const params = []
    if (keyword) {
      conds.push('(name LIKE ? OR external_book_id LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`)
    }
    const rows = d
      .prepare(
        `SELECT id, name, external_book_id, store
         FROM novel_books
         WHERE ${conds.join(' AND ')}
         ORDER BY last_seen_at DESC
         LIMIT 50`,
      )
      .all(...params)
    res.json(
      ok(
        rows.map((r) => ({
          id: r.id,
          name: r.name || '',
          externalBookId: r.external_book_id || '',
          store: r.store || '',
          label: `${r.name || '未命名'}（${r.external_book_id || '-'}）`,
        })),
      ),
    )
  } catch (e) {
    console.error('[novel] books/options', e.message)
    res.json(fail(500, '读取书籍选项失败'))
  }
})

router.get('/books/stores', requireAnyPerm([PERM.books, PERM.promo], '书城'), (req, res) => {
  try {
    const rows = database()
      .prepare(
        `SELECT DISTINCT store FROM novel_books WHERE TRIM(store) != '' ORDER BY store`,
      )
      .all()
    res.json(ok(rows.map((r) => r.store)))
  } catch (e) {
    console.error('[novel] books/stores', e.message)
    res.json(fail(500, '读取书城失败'))
  }
})

router.patch('/books/:id/launch', requirePerm(PERM.books, '书籍'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!id) return res.json(fail(400, '书籍不存在'))
    const launched = req.body && (req.body.launched === true || req.body.launched === 'true' || req.body.launchStatus === 'launched')
    const d = database()
    const book = d.prepare('SELECT * FROM novel_books WHERE id = ?').get(id)
    if (!book) return res.json(fail(404, '书籍不存在'))
    if (launched) {
      d.prepare(
        `UPDATE novel_books
         SET launch_status = 'launched', launched_at = datetime('now'), launch_user_id = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(req.userId, id)
    } else {
      d.prepare(
        `UPDATE novel_books
         SET launch_status = 'pending', launched_at = NULL, launch_user_id = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(id)
    }
    const next = d.prepare('SELECT * FROM novel_books WHERE id = ?').get(id)
    res.json(ok(rowToBook(next)))
  } catch (e) {
    console.error('[novel] books/launch', e.message)
    res.json(fail(500, '更新投放状态失败'))
  }
})

router.get('/books/:id', requirePerm(PERM.books, '书籍'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!id) return res.json(fail(400, '书籍不存在'))
    const d = database()
    const book = d.prepare('SELECT * FROM novel_books WHERE id = ?').get(id)
    if (!book) return res.json(fail(404, '书籍不存在'))
    const snapshots = d
      .prepare(
        `SELECT * FROM novel_book_snapshots WHERE book_id = ? ORDER BY stat_date DESC, id DESC`,
      )
      .all(id)
    const materials = d
      .prepare(
        `SELECT m.*, b.name AS book_name, b.external_book_id, b.store,
                b.launch_status AS book_launch_status, b.launched_at AS book_launched_at,
                s.id AS snap_id, s.stat_date AS snap_stat_date, s.slot AS snap_slot,
                s.cost AS snap_cost, s.impressions AS snap_impressions, s.clicks AS snap_clicks,
                s.ctr AS snap_ctr, s.conversions AS snap_conversions,
                s.recharge_amount AS snap_recharge_amount, s.heat AS snap_heat, s.is_hot AS snap_is_hot
         FROM novel_materials m
         LEFT JOIN novel_books b ON b.id = m.book_id
         LEFT JOIN (
           SELECT material_id, MAX(id) AS max_id FROM novel_material_snapshots GROUP BY material_id
         ) latest ON latest.material_id = m.id
         LEFT JOIN novel_material_snapshots s ON s.id = latest.max_id
         WHERE m.book_id = ?
         ORDER BY COALESCE(s.is_hot, 0) DESC, COALESCE(s.recharge_amount, 0) DESC, m.id DESC`,
      )
      .all(id)
    const promoLinks = d
      .prepare(
        `SELECT p.*, b.name AS book_name, b.external_book_id, b.store AS book_store
         FROM novel_promo_links p
         LEFT JOIN novel_books b ON b.id = p.book_id
         WHERE p.book_id = ?
         ORDER BY p.id DESC`,
      )
      .all(id)
    res.json(
      ok({
        book: rowToBook(book),
        snapshots: snapshots.map(rowToBookSnapshot),
        materials: materials.map(rowToMaterial),
        promoLinks: promoLinks.map(rowToPromo),
      }),
    )
  } catch (e) {
    console.error('[novel] books/:id', e.message)
    res.json(fail(500, '读取书籍详情失败'))
  }
})

router.get('/materials/page', requirePerm(PERM.materials, '素材库'), (req, res) => {
  try {
    const { pageSize, offset } = pageParams(req.query)
    const keyword = String(req.query.keyword || '').trim()
    const bookId = parseInt(req.query.bookId, 10) || 0
    const convertStatus = String(req.query.convertStatus || '').trim()
    const isHot = String(req.query.isHot || '').trim()
    const unassigned = String(req.query.unassigned || '').trim()
    const onlyNew = String(req.query.onlyNew || '').trim()
    const d = database()

    const conds = ['1=1']
    const params = []
    if (keyword) {
      conds.push('(m.title LIKE ? OR m.external_id LIKE ? OR m.play_url LIKE ? OR b.name LIKE ? OR b.external_book_id LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (bookId) {
      conds.push('m.book_id = ?')
      params.push(bookId)
    }
    if (CONVERT_STATUSES.has(convertStatus)) {
      conds.push('m.convert_status = ?')
      params.push(convertStatus)
    }
    if (isHot === '1') conds.push('s.is_hot = 1')
    if (isHot === '0') conds.push('(s.is_hot = 0 OR s.is_hot IS NULL)')
    if (unassigned === '1') conds.push('m.book_id IS NULL')
    if (onlyNew === '1') {
      conds.push(`(
        (COALESCE(b.launch_status, 'pending') = 'launched' AND b.launched_at IS NOT NULL
          AND datetime(COALESCE(m.first_seen_at, m.created_at)) > datetime(b.launched_at))
        OR
        (COALESCE(b.launch_status, 'pending') != 'launched'
          AND date(COALESCE(m.first_seen_at, m.created_at)) = date('now', 'localtime'))
      )`)
    }

    const where = conds.join(' AND ')
    const from = `
      FROM novel_materials m
      LEFT JOIN novel_books b ON b.id = m.book_id
      LEFT JOIN (
        SELECT material_id, MAX(id) AS max_id FROM novel_material_snapshots GROUP BY material_id
      ) latest ON latest.material_id = m.id
      LEFT JOIN novel_material_snapshots s ON s.id = latest.max_id
      WHERE ${where}
    `
    const total = d.prepare(`SELECT COUNT(*) AS c ${from}`).get(...params).c
    const rows = d
      .prepare(
        `SELECT m.*, b.name AS book_name, b.external_book_id, b.store,
                b.launch_status AS book_launch_status, b.launched_at AS book_launched_at,
                s.id AS snap_id, s.stat_date AS snap_stat_date, s.slot AS snap_slot,
                s.cost AS snap_cost, s.impressions AS snap_impressions, s.clicks AS snap_clicks,
                s.ctr AS snap_ctr, s.conversions AS snap_conversions,
                s.recharge_amount AS snap_recharge_amount, s.heat AS snap_heat, s.is_hot AS snap_is_hot
         ${from}
         ORDER BY COALESCE(s.is_hot, 0) DESC, COALESCE(s.recharge_amount, m.heat, 0) DESC, m.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset)
    res.json(ok({ list: rows.map(rowToMaterial), total }))
  } catch (e) {
    console.error('[novel] materials/page', e.message)
    res.json(fail(500, '读取素材库失败'))
  }
})

router.patch('/materials/:id/convert', requirePerm(PERM.materials, '素材库'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!id) return res.json(fail(400, '素材不存在'))
    const body = req.body || {}
    const convertStatus = String(body.convertStatus || '').trim()
    if (!CONVERT_STATUSES.has(convertStatus)) return res.json(fail(400, '转化状态无效'))
    const convertedUrl = body.convertedUrl != null ? String(body.convertedUrl).trim() : ''
    const convertRemark = body.convertRemark != null ? String(body.convertRemark).trim() : ''
    const d = database()
    const row = d.prepare('SELECT * FROM novel_materials WHERE id = ?').get(id)
    if (!row) return res.json(fail(404, '素材不存在'))
    if (convertStatus === 'converted' && !convertedUrl && !row.converted_url) {
      return res.json(fail(400, '请填写成片地址'))
    }
    d.prepare(
      `UPDATE novel_materials SET
         convert_status = ?,
         converted_url = CASE WHEN ? != '' THEN ? ELSE converted_url END,
         convert_remark = CASE WHEN ? != '' THEN ? ELSE convert_remark END,
         convert_user_id = ?,
         convert_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(convertStatus, convertedUrl, convertedUrl, convertRemark, convertRemark, req.userId, id)

    if (convertStatus === 'hot') {
      d.prepare(
        `UPDATE novel_material_snapshots SET is_hot = 1
         WHERE id = (SELECT MAX(id) FROM novel_material_snapshots WHERE material_id = ?)`,
      ).run(id)
    }

    const next = d
      .prepare(
        `SELECT m.*, b.name AS book_name, b.external_book_id, b.store,
                b.launch_status AS book_launch_status, b.launched_at AS book_launched_at
         FROM novel_materials m
         LEFT JOIN novel_books b ON b.id = m.book_id
         WHERE m.id = ?`,
      )
      .get(id)
    res.json(ok(rowToMaterial(next)))
  } catch (e) {
    console.error('[novel] materials/convert', e.message)
    res.json(fail(500, '更新转化状态失败'))
  }
})

router.get('/promo-links/page', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const { pageSize, offset } = pageParams(req.query)
    const keyword = String(req.query.keyword || '').trim()
    const bookId = parseInt(req.query.bookId, 10) || 0
    const status = String(req.query.status || '').trim()
    const mediaSource = String(req.query.mediaSource || '').trim()
    const referralId = String(req.query.referralId || '').trim()
    const startTime = String(req.query.startTime || '').trim()
    const endTime = String(req.query.endTime || '').trim()
    const d = database()
    const conds = ['1=1']
    const params = []
    if (keyword) {
      conds.push('(p.name LIKE ? OR p.url LIKE ? OR p.path LIKE ? OR p.channel LIKE ? OR b.name LIKE ? OR b.external_book_id LIKE ? OR p.referral_id LIKE ?)')
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (bookId) {
      conds.push('p.book_id = ?')
      params.push(bookId)
    }
    if (status === 'active' || status === 'inactive') {
      conds.push('p.status = ?')
      params.push(status)
    }
    if (mediaSource) {
      conds.push('p.media_source = ?')
      params.push(mediaSource)
    }
    if (referralId) {
      conds.push('p.referral_id = ?')
      params.push(referralId)
    }
    if (startTime) {
      conds.push("datetime(p.created_at) >= datetime(?)")
      params.push(startTime)
    }
    if (endTime) {
      conds.push("datetime(p.created_at) <= datetime(?)")
      params.push(endTime.includes(' ') ? endTime : `${endTime} 23:59:59`)
    }
    const where = conds.join(' AND ')
    const from = `
      FROM novel_promo_links p
      LEFT JOIN novel_books b ON b.id = p.book_id
      WHERE ${where}
    `
    const total = d.prepare(`SELECT COUNT(*) AS c ${from}`).get(...params).c
    const rows = d
      .prepare(
        `SELECT p.*, b.name AS book_name, b.external_book_id, b.store AS book_store
         ${from}
         ORDER BY p.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset)
    res.json(ok({ list: rows.map(rowToPromo), total }))
  } catch (e) {
    console.error('[novel] promo/page', e.message)
    res.json(fail(500, '读取推广链接失败'))
  }
})

function collectPromoUrls(body) {
  const out = []
  const seen = new Set()
  const add = (v) => {
    const s = String(v || '').trim()
    if (!s || seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  if (Array.isArray(body && body.urls)) {
    for (const u of body.urls) add(u)
  }
  if (body && body.url != null) {
    String(body.url)
      .split(/[\n\r|；;，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach(add)
  }
  return out
}

function normalizePromoBody(body) {
  const bookId = parseInt(body && body.bookId, 10) || 0
  const urls = collectPromoUrls(body)
  const url = urls[0] || ''
  const name = body && body.name != null ? String(body.name).trim() : ''
  const store = body && body.store != null ? String(body.store).trim() : ''
  const channel = body && body.channel != null ? String(body.channel).trim() : ''
  const status = body && body.status === 'inactive' ? 'inactive' : 'active'
  const remark = body && body.remark != null ? String(body.remark).trim() : ''
  const externalId = body && body.externalId != null ? String(body.externalId).trim() : ''
  const source = body && body.source === 'yunfan' ? 'yunfan' : 'manual'
  return { bookId, url, urls, name, store, channel, status, remark, externalId, source }
}

function fetchPromoRow(d, id) {
  return d
    .prepare(
      `SELECT p.*, b.name AS book_name, b.external_book_id, b.store AS book_store
       FROM novel_promo_links p LEFT JOIN novel_books b ON b.id = p.book_id
       WHERE p.id = ?`,
    )
    .get(id)
}

function pickField(obj, keys) {
  if (!obj || typeof obj !== 'object') return ''
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k]
  }
  return ''
}

function pickReferralList(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.list)) return data.list
  if (Array.isArray(data.records)) return data.records
  if (Array.isArray(data.rows)) return data.rows
  if (data.data && Array.isArray(data.data)) return data.data
  if (data.data && Array.isArray(data.data.list)) return data.data.list
  return []
}

function findOrCreateBookByExternal(d, externalBookId, store, name) {
  const ext = String(externalBookId || '').trim()
  if (!ext) return null
  const st = String(store || '').trim()
  if (st) {
    const hit = d.prepare('SELECT id FROM novel_books WHERE store = ? AND external_book_id = ?').get(st, ext)
    if (hit) return hit.id
  }
  const any = d.prepare('SELECT id FROM novel_books WHERE external_book_id = ? ORDER BY id DESC LIMIT 1').get(ext)
  if (any) return any.id
  const r = d
    .prepare(
      `INSERT INTO novel_books (external_book_id, store, name, first_seen_at, last_seen_at, launch_status, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), 'pending', datetime('now'))`,
    )
    .run(ext, st, String(name || '').trim())
  return Number(r.lastInsertRowid)
}

function upsertDianzhongReferral(d, item, fallbackBookId) {
  const referralId = String(pickField(item, ['referralId', 'referral_id', 'id']) || '').trim()
  const path = String(pickField(item, ['path', 'url', 'link', 'miniPath']) || '').trim()
  const monitor1 = String(pickField(item, ['monitor1', 'monitor_1', 'monitorUrl1']) || '').trim()
  const monitor2 = String(pickField(item, ['monitor2', 'monitor_2', 'monitorUrl2']) || '').trim()
  const name = String(pickField(item, ['name', 'channelName', 'title']) || '').trim()
  const mediaSource = dianzhong.normalizeMediaSource(pickField(item, ['mediaSource', 'media_source', 'from']))
  const extBookId = String(pickField(item, ['bookId', 'book_id']) || '').trim()
  const channel = String(pickField(item, ['channelId', 'channel_id', 'channel']) || '').trim()
  const url = path || monitor2 || monitor1 || (referralId ? `dianzhong:${referralId}` : '')
  if (!url) return { error: '缺少 path' }
  const bookId = fallbackBookId || findOrCreateBookByExternal(d, extBookId, '', name)
  if (!bookId) return { error: '找不到对应书籍' }

  const byRef = referralId
    ? d.prepare('SELECT id FROM novel_promo_links WHERE referral_id = ?').get(referralId)
    : null
  const payload = {
    name,
    url,
    channel,
    referralId,
    mediaSource,
    path,
    monitor1,
    monitor2,
  }
  if (byRef) {
    d.prepare(
      `UPDATE novel_promo_links SET
         book_id = ?, name = CASE WHEN ? != '' THEN ? ELSE name END, url = ?,
         channel = CASE WHEN ? != '' THEN ? ELSE channel END,
         external_id = CASE WHEN ? != '' THEN ? ELSE external_id END,
         source = 'dianzhong', media_source = ?, path = ?, monitor1 = ?, monitor2 = ?,
         referral_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      bookId,
      payload.name,
      payload.name,
      payload.url,
      payload.channel,
      payload.channel,
      payload.referralId,
      payload.referralId,
      payload.mediaSource,
      payload.path,
      payload.monitor1,
      payload.monitor2,
      payload.referralId,
      byRef.id,
    )
    return { id: byRef.id, created: false }
  }
  const byUrl = d.prepare('SELECT id FROM novel_promo_links WHERE book_id = ? AND url = ?').get(bookId, url)
  if (byUrl) {
    d.prepare(
      `UPDATE novel_promo_links SET
         name = CASE WHEN ? != '' THEN ? ELSE name END,
         channel = CASE WHEN ? != '' THEN ? ELSE channel END,
         external_id = CASE WHEN ? != '' THEN ? ELSE external_id END,
         source = 'dianzhong', media_source = ?, path = ?, monitor1 = ?, monitor2 = ?,
         referral_id = CASE WHEN ? != '' THEN ? ELSE referral_id END,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      payload.name,
      payload.name,
      payload.channel,
      payload.channel,
      payload.referralId,
      payload.referralId,
      payload.mediaSource,
      payload.path,
      payload.monitor1,
      payload.monitor2,
      payload.referralId,
      payload.referralId,
      byUrl.id,
    )
    return { id: byUrl.id, created: false }
  }
  const r = d
    .prepare(
      `INSERT INTO novel_promo_links
         (book_id, name, url, store, channel, status, remark, external_id, source,
          referral_id, media_source, path, monitor1, monitor2, updated_at)
       VALUES (?, ?, ?, '', ?, 'active', '', ?, 'dianzhong', ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      bookId,
      payload.name,
      payload.url,
      payload.channel,
      payload.referralId,
      payload.referralId,
      payload.mediaSource,
      payload.path,
      payload.monitor1,
      payload.monitor2,
    )
  return { id: Number(r.lastInsertRowid), created: true }
}

async function syncReferralsFromRemote(d, input, fallbackBookId) {
  const remote = await dianzhong.listReferrals(input)
  if (remote.error) return remote
  const items = pickReferralList(remote.data)
  let upserted = 0
  let created = 0
  const rows = []
  for (const item of items) {
    const r = upsertDianzhongReferral(d, item, fallbackBookId)
    if (r.error) continue
    upserted += 1
    if (r.created) created += 1
    rows.push(rowToPromo(fetchPromoRow(d, r.id)))
  }
  return { upserted, created, total: items.length, list: rows, raw: remote.raw }
}

router.post('/promo-links/dianzhong/create', requirePerm(PERM.promo, '推广链接'), async (req, res) => {
  try {
    const body = req.body || {}
    const bookId = parseInt(body.bookId, 10) || 0
    if (!bookId) return res.json(fail(400, '请选择所属书籍'))
    const d = database()
    const book = d.prepare('SELECT * FROM novel_books WHERE id = ?').get(bookId)
    if (!book) return res.json(fail(400, '书籍不存在'))
    if (!book.external_book_id) return res.json(fail(400, '该书缺少书籍ID，无法对接点众'))
    const created = await dianzhong.createReferral({
      bookId: book.external_book_id,
      name: body.name,
      mediaSource: body.mediaSource,
      chapterIdx: body.chapterIdx,
      fromDrId: body.fromDrId,
      batchId: body.batchId,
      callbackConfigId: body.callbackConfigId,
      chapterChargeStart: body.chapterChargeStart,
      chapterKandian: body.chapterKandian,
    })
    if (created.error) return res.json(fail(400, created.error))
    const synced = await syncReferralsFromRemote(d, { bookId: book.external_book_id, size: 100 }, book.id)
    if (synced.error) {
      return res.json(
        ok({
          created: created.data,
          synced: 0,
          warning: synced.error,
          list: [],
        }),
      )
    }
    res.json(
      ok({
        created: created.data,
        synced: synced.upserted,
        list: synced.list,
      }),
    )
  } catch (e) {
    console.error('[novel] promo dianzhong create', e.message)
    res.json(fail(500, '创建推广链接失败'))
  }
})

router.post('/promo-links/dianzhong/refresh', requirePerm(PERM.promo, '推广链接'), async (req, res) => {
  try {
    const body = req.body || {}
    const d = database()
    let fallbackBookId = parseInt(body.bookId, 10) || 0
    let remoteBookId = String(body.externalBookId || '').trim()
    if (fallbackBookId) {
      const book = d.prepare('SELECT * FROM novel_books WHERE id = ?').get(fallbackBookId)
      if (!book) return res.json(fail(400, '书籍不存在'))
      remoteBookId = remoteBookId || book.external_book_id
    } else {
      fallbackBookId = 0
    }
    const synced = await syncReferralsFromRemote(
      d,
      {
        bookId: remoteBookId,
        referralId: body.referralId,
        startTime: body.startTime,
        endTime: body.endTime,
        page: body.page,
        size: body.size,
      },
      fallbackBookId || undefined,
    )
    if (synced.error) return res.json(fail(400, synced.error))
    res.json(ok(synced))
  } catch (e) {
    console.error('[novel] promo dianzhong refresh', e.message)
    res.json(fail(500, '刷新推广链接失败'))
  }
})

router.post('/promo-links', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const p = normalizePromoBody(req.body)
    if (!p.bookId) return res.json(fail(400, '请选择所属书籍'))
    if (!p.name) return res.json(fail(400, '请填写链接名称'))
    if (!p.urls.length) return res.json(fail(400, '请填写推广链接'))
    const d = database()
    const book = d.prepare('SELECT id FROM novel_books WHERE id = ?').get(p.bookId)
    if (!book) return res.json(fail(400, '书籍不存在'))
    const created = []
    const skipped = []
    const insert = d.prepare(
      `INSERT INTO novel_promo_links (book_id, name, url, store, channel, status, remark, external_id, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    const findDup = d.prepare('SELECT id FROM novel_promo_links WHERE book_id = ? AND url = ?')
    const tx = d.transaction(() => {
      for (const url of p.urls) {
        if (findDup.get(p.bookId, url)) {
          skipped.push(url)
          continue
        }
        const r = insert.run(p.bookId, p.name, url, p.store, p.channel, p.status, p.remark, p.externalId, p.source)
        created.push(rowToPromo(fetchPromoRow(d, Number(r.lastInsertRowid))))
      }
    })
    tx()
    if (!created.length) return res.json(fail(400, '该书籍已存在这些推广链接'))
    res.json(
      ok({
        list: created,
        skipped,
        createdCount: created.length,
        ...created[0],
      }),
    )
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return res.json(fail(400, '该书籍已存在此推广链接'))
    console.error('[novel] promo create', e.message)
    res.json(fail(500, '新增推广链接失败'))
  }
})

router.put('/promo-links/:id', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!id) return res.json(fail(400, '链接不存在'))
    const p = normalizePromoBody(req.body)
    if (!p.bookId) return res.json(fail(400, '请选择所属书籍'))
    if (!p.name) return res.json(fail(400, '请填写链接名称'))
    if (!p.url) return res.json(fail(400, '请填写推广链接'))
    const d = database()
    const row = d.prepare('SELECT id FROM novel_promo_links WHERE id = ?').get(id)
    if (!row) return res.json(fail(404, '链接不存在'))
    const dup = d
      .prepare('SELECT id FROM novel_promo_links WHERE book_id = ? AND url = ? AND id != ?')
      .get(p.bookId, p.url, id)
    if (dup) return res.json(fail(400, '该书籍已存在此推广链接'))
    d.prepare(
      `UPDATE novel_promo_links
       SET book_id = ?, name = ?, url = ?, store = ?, channel = ?, status = ?, remark = ?,
           external_id = CASE WHEN ? != '' THEN ? ELSE external_id END,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(p.bookId, p.name, p.url, p.store, p.channel, p.status, p.remark, p.externalId, p.externalId, id)
    const next = d
      .prepare(
        `SELECT p.*, b.name AS book_name, b.external_book_id, b.store AS book_store
         FROM novel_promo_links p LEFT JOIN novel_books b ON b.id = p.book_id
         WHERE p.id = ?`,
      )
      .get(id)
    res.json(ok(rowToPromo(next)))
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return res.json(fail(400, '该书籍已存在此推广链接'))
    console.error('[novel] promo update', e.message)
    res.json(fail(500, '更新推广链接失败'))
  }
})

router.delete('/promo-links/:id', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!id) return res.json(fail(400, '链接不存在'))
    const d = database()
    const info = d.prepare('DELETE FROM novel_promo_links WHERE id = ?').run(id)
    if (!info.changes) return res.json(fail(404, '链接不存在'))
    res.json(ok(true))
  } catch (e) {
    console.error('[novel] promo delete', e.message)
    res.json(fail(500, '删除推广链接失败'))
  }
})

router.get('/sync/page', requirePerm(PERM.sync, '同步记录'), (req, res) => {
  try {
    const { pageSize, offset } = pageParams(req.query)
    const type = String(req.query.type || '').trim()
    const statDate = String(req.query.statDate || '').trim()
    const status = String(req.query.status || '').trim()
    const d = database()
    const conds = ['1=1']
    const params = []
    if (['books', 'library', 'materials', 'promo', 'pack'].includes(type)) {
      conds.push('b.type = ?')
      params.push(type)
    }
    if (statDate) {
      conds.push('b.stat_date = ?')
      params.push(statDate)
    }
    if (status) {
      conds.push('b.status = ?')
      params.push(status)
    }
    const where = conds.join(' AND ')
    const total = d.prepare(`SELECT COUNT(*) AS c FROM novel_sync_batches b WHERE ${where}`).get(...params).c
    const rows = d
      .prepare(
        `SELECT b.*, u.username, u.nickname
         FROM novel_sync_batches b
         LEFT JOIN users u ON u.id = b.user_id
         WHERE ${where}
         ORDER BY b.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset)
    res.json(ok({ list: rows.map(rowToBatch), total }))
  } catch (e) {
    console.error('[novel] sync/page', e.message)
    res.json(fail(500, '读取同步记录失败'))
  }
})

router.get('/sync/today', requireAnyPerm([PERM.sync, PERM.books], '导入记录'), (req, res) => {
  try {
    const statDate = String(req.query.statDate || '').trim() || novelImport.todayLocal()
    const d = database()
    const row = d
      .prepare(
        `SELECT COUNT(*) AS c
         FROM novel_sync_batches
         WHERE type IN ('pack', 'books') AND stat_date = ? AND status IN ('success', 'partial')`,
      )
      .get(statDate)
    const latest = d
      .prepare(
        `SELECT *
         FROM novel_sync_batches
         WHERE type IN ('pack', 'books') AND stat_date = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(statDate)
    res.json(
      ok({
        statDate,
        imported: Number(row && row.c) || 0,
        latest: latest ? rowToBatch(latest) : null,
      }),
    )
  } catch (e) {
    console.error('[novel] sync/today', e.message)
    res.json(fail(500, '读取今日导入状态失败'))
  }
})

router.get('/sync/recent', requireAnyPerm([PERM.sync, PERM.books], '导入记录'), (req, res) => {
  try {
    const d = database()
    const rows = d
      .prepare(
        `SELECT b.*, u.username, u.nickname
         FROM novel_sync_batches b
         LEFT JOIN users u ON u.id = b.user_id
         ORDER BY b.id DESC
         LIMIT 8`,
      )
      .all()
    res.json(ok(rows.map(rowToBatch)))
  } catch (e) {
    console.error('[novel] sync/recent', e.message)
    res.json(fail(500, '读取导入记录失败'))
  }
})

function handleImport(forcedType) {
  return (req, res) => {
    upload(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.json(fail(413, '文件不超过 20MB'))
        return res.json(fail(400, err.message || '上传失败'))
      }
      try {
        const type = forcedType || (req.body && req.body.type) || 'pack'
        const statDate = req.body && req.body.statDate
        const slot = req.body && req.body.slot
        const filename = req.file && req.file.originalname ? String(req.file.originalname) : ''
        let text = ''
        let json = null
        let buffer = null
        if (req.file && req.file.buffer) {
          const name = filename.toLowerCase()
          if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
            return res.json(fail(400, '请用云帆「批量导出xlsx表格」，或另存为 CSV / xlsx'))
          }
          buffer = req.file.buffer
        }
        if (req.body && req.body.payload) {
          const payload = String(req.body.payload)
          if (!text) text = payload
          try {
            json = JSON.parse(payload)
          } catch {
            /* 按文本解析 */
          }
        }
        if (!text && json == null && !buffer) return res.json(fail(400, '请上传 xlsx / CSV，或粘贴 JSON'))
        const result = novelImport.runImport({
          db: database(),
          type,
          statDate,
          slot,
          filename,
          userId: req.userId,
          text,
          json,
          buffer,
        })
        if (result.error) return res.json(fail(400, result.error))
        res.json(ok(result))
      } catch (e) {
        console.error('[novel] sync/import', e.message)
        res.json(fail(500, '导入失败'))
      }
    })
  }
}

router.post('/books/import', requirePerm(PERM.books, '书籍'), handleImport('pack'))
router.post('/sync/import', requireAnyPerm([PERM.sync, PERM.books], '导入'), handleImport())
router.post('/promo-links/import', requirePerm(PERM.promo, '推广链接'), handleImport('promo'))

module.exports = router
