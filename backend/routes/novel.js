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
    promoCount: Number(r.promo_count || 0),
    latestMonitor: r.latest_monitor || '',
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

function blankZero(v) {
  const s = String(v == null ? '' : v).trim()
  return !s || s === '0' ? '' : s
}

function splitLaunchPath(path) {
  const s = String(path || '').trim()
  const i = s.indexOf('?')
  if (i < 0) return { launchPage: s, launchQuery: '' }
  return { launchPage: s.slice(0, i), launchQuery: s.slice(i + 1) }
}

function goodsTypeLabel(goods) {
  const n = Number(goods)
  if (n === 0) return '自定义模板'
  if (n === 1) return '系统模板'
  return blankZero(goods) || '自定义模板'
}

function rechargeNameOf(r) {
  const named = String(r.recharge_name || '').trim()
  if (named) return named
  const m = String(r.name || '').match(/(\d+(?:\.\d+)?)\s*$/)
  return m ? m[1] : ''
}

function displayBookName(name) {
  const n = String(name || '').trim()
  return dianzhong.isRealBookName(n) ? n : ''
}

function bookHasRealName(d, bookId) {
  if (!bookId) return false
  const row = d.prepare('SELECT name FROM novel_books WHERE id = ?').get(bookId)
  return dianzhong.isRealBookName(row && row.name)
}

function applyRemoteBookTitle(d, bookId, rawTitle) {
  const title = displayBookName(rawTitle)
  if (!bookId || !title) return false
  d.prepare(
    `UPDATE novel_books SET name = CASE
         WHEN name = '' OR name LIKE '点众-%' THEN ?
         ELSE name END,
       last_seen_at = datetime('now') WHERE id = ?`,
  ).run(title, bookId)
  return true
}

function asNullableNumber(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function rowToPromo(r) {
  if (!r) return null
  const path = r.path || r.url || ''
  const launch = splitLaunchPath(path)
  const callbackConfigId = blankZero(r.callback_config_id)
  const rechargeAmount = asNullableNumber(r.snap_recharge_amount)
  const rechargeUsers = asNullableNumber(r.snap_recharge_users)
  const costRaw = asNullableNumber(r.mat_cost)
  const cost = costRaw != null && costRaw > 0 ? costRaw : null
  const recovery = cost != null && rechargeAmount != null ? rechargeAmount / cost : null
  return {
    id: r.id,
    bookId: r.book_id,
    bookName: displayBookName(r.book_name),
    externalBookId: r.external_book_id || '',
    store: r.store || r.book_store || '',
    name: r.name || '',
    url: r.url || '',
    channel: r.channel || '',
    status: r.status || 'active',
    linkStatus: r.status === 'inactive' ? '下架' : '上架',
    entryType: '小说',
    remark: r.remark || '',
    externalId: r.external_id || '',
    source: r.source || 'manual',
    referralId: r.referral_id || '',
    mediaSource: r.media_source || '',
    path,
    launchPage: launch.launchPage,
    launchQuery: launch.launchQuery,
    monitor1: r.monitor1 || '',
    monitor2: r.monitor2 || '',
    chapterIdx: r.chapter_idx != null && r.chapter_idx !== '' ? Number(r.chapter_idx) : null,
    chapterChargeStart: r.chapter_charge_start != null && r.chapter_charge_start !== '' ? Number(r.chapter_charge_start) : null,
    chapterKandian: r.chapter_kandian != null && r.chapter_kandian !== '' ? Number(r.chapter_kandian) : null,
    goods: r.goods || '',
    goodsType: goodsTypeLabel(r.goods),
    goodsBatchId: r.goods_batch_id || '',
    rechargeName: rechargeNameOf(r),
    callbackSwitch: callbackConfigId ? '指定配置' : '按公共配置回传',
    callbackConfigId,
    rechargeAmount,
    rechargeUsers,
    cost,
    recovery,
    snapDate: r.snap_stat_date || '',
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
                (SELECT COUNT(*) FROM novel_promo_links p WHERE p.book_id = b.id) AS promo_count,
                (SELECT COALESCE(NULLIF(p.monitor1, ''), NULLIF(p.monitor2, ''), NULLIF(p.path, ''), p.url)
                 FROM novel_promo_links p WHERE p.book_id = b.id ORDER BY p.id DESC LIMIT 1) AS latest_monitor,
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
        `SELECT p.*, b.name AS book_name, b.external_book_id, b.store AS book_store, rt.name AS recharge_name
         FROM novel_promo_links p
         LEFT JOIN novel_books b ON b.id = p.book_id
         LEFT JOIN novel_recharge_templates rt ON rt.batch_id != '' AND rt.batch_id = p.goods_batch_id
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
      conds.push('(p.name LIKE ? OR p.url LIKE ? OR p.path LIKE ? OR p.channel LIKE ? OR b.name LIKE ? OR b.external_book_id LIKE ? OR p.referral_id LIKE ? OR p.goods LIKE ? OR p.goods_batch_id LIKE ?)')
      const like = `%${keyword}%`
      params.push(like, like, like, like, like, like, like, like, like)
    }
    if (bookId) {
      conds.push('p.book_id = ?')
      params.push(bookId)
    }
    if (status === 'active' || status === 'inactive') {
      conds.push('p.status = ?')
      params.push(status)
    }
    const channel = String(req.query.channel || '').trim()
    if (mediaSource) {
      conds.push('p.media_source = ?')
      params.push(mediaSource)
    }
    if (channel) {
      conds.push('p.channel = ?')
      params.push(channel)
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
      LEFT JOIN novel_recharge_templates rt ON rt.batch_id != '' AND rt.batch_id = p.goods_batch_id
      LEFT JOIN (
        SELECT book_id, MAX(id) AS max_id FROM novel_book_snapshots GROUP BY book_id
      ) snap_idx ON snap_idx.book_id = p.book_id
      LEFT JOIN novel_book_snapshots bs ON bs.id = snap_idx.max_id
      LEFT JOIN (
        SELECT m.book_id AS book_id, SUM(ms.cost) AS cost
        FROM novel_materials m
        INNER JOIN (
          SELECT material_id, MAX(id) AS max_id FROM novel_material_snapshots GROUP BY material_id
        ) lm ON lm.material_id = m.id
        INNER JOIN novel_material_snapshots ms ON ms.id = lm.max_id
        GROUP BY m.book_id
      ) mc ON mc.book_id = p.book_id
      WHERE ${where}
    `
    const total = d.prepare(`SELECT COUNT(*) AS c ${from}`).get(...params).c
    const rows = d
      .prepare(
        `SELECT p.*, b.name AS book_name, b.external_book_id, b.store AS book_store, rt.name AS recharge_name,
                bs.recharge_amount AS snap_recharge_amount, bs.recharge_users AS snap_recharge_users,
                bs.stat_date AS snap_stat_date, mc.cost AS mat_cost
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
      `SELECT p.*, b.name AS book_name, b.external_book_id, b.store AS book_store, rt.name AS recharge_name
       FROM novel_promo_links p
       LEFT JOIN novel_books b ON b.id = p.book_id
       LEFT JOIN novel_recharge_templates rt ON rt.batch_id != '' AND rt.batch_id = p.goods_batch_id
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

function asOptInt(v) {
  if (v == null || v === '') return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

function stringifyGoods(raw) {
  if (raw == null || raw === '') return ''
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw)) return raw.map((x) => stringifyGoods(x)).filter(Boolean).join(' / ')
  if (typeof raw === 'object') {
    const n = raw.name || raw.title || raw.goodsName || raw.goods_name || raw.desc
    if (n) return String(n).trim()
    return ''
  }
  return String(raw)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function asReferralItem(data, extra = {}) {
  if (data == null) return extra
  if (typeof data === 'number' || typeof data === 'string') {
    return { ...extra, referralId: data }
  }
  if (typeof data === 'object') return { ...extra, ...data }
  return extra
}

function upsertDianzhongReferral(d, item, fallbackBookId, fallbackChannel) {
  const referralId = String(pickField(item, ['referralId', 'referral_id', 'id']) || '').trim()
  const path = String(pickField(item, ['path', 'url', 'link', 'miniPath']) || '').trim()
  const monitor1 = String(pickField(item, ['monitor1', 'monitor_1', 'monitorUrl1']) || '').trim()
  const monitor2 = String(pickField(item, ['monitor2', 'monitor_2', 'monitorUrl2']) || '').trim()
  const name = String(pickField(item, ['name', 'channelName', 'title']) || '').trim()
  const bookTitle = String(pickField(item, ['bookName', 'book_name', 'bookTitle', 'book_title']) || '').trim()
  const mediaSource = dianzhong.normalizeMediaSource(pickField(item, ['mediaSource', 'media_source', 'from']))
  const extBookId = String(pickField(item, ['bookId', 'book_id']) || '').trim()
  const channel = String(
    pickField(item, ['channelId', 'channel_id', 'channel']) || fallbackChannel || '',
  ).trim()
  const url = path || (referralId ? `dianzhong:${referralId}` : '') || monitor2 || monitor1
  if (!url) return { error: '缺少 path' }
  const bookId = fallbackBookId || findOrCreateBookByExternal(d, extBookId, '', bookTitle)
  if (!bookId) return { error: '找不到对应书籍' }
  if (!applyRemoteBookTitle(d, bookId, bookTitle)) {
    d.prepare(`UPDATE novel_books SET last_seen_at = datetime('now') WHERE id = ?`).run(bookId)
  }

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
    chapterIdx: asOptInt(pickField(item, ['chapterIdx', 'chapter_idx'])),
    chapterChargeStart: asOptInt(pickField(item, ['chapterChargeStart', 'chapter_charge_start'])),
    chapterKandian: asOptInt(pickField(item, ['chapterKandian', 'chapter_kandian'])),
    goods: stringifyGoods(item && (item.goods != null ? item.goods : pickField(item, ['goodsName', 'goods_name']))),
    goodsBatchId: String(
      pickField(item, ['referral_goods_batch_id', 'goodsBatchId', 'goods_batch_id']) || '',
    ).trim(),
    callbackConfigId: String(
      pickField(item, ['callback_config_id', 'callbackConfigId', 'CallbackConfigId']) || '',
    ).trim(),
  }
  if (byRef) {
    d.prepare(
      `UPDATE novel_promo_links SET
         book_id = ?, name = CASE WHEN ? != '' THEN ? ELSE name END, url = ?,
         channel = CASE WHEN ? != '' THEN ? ELSE channel END,
         external_id = CASE WHEN ? != '' THEN ? ELSE external_id END,
         source = 'dianzhong', media_source = ?, path = ?, monitor1 = ?, monitor2 = ?,
         referral_id = ?, chapter_idx = ?, chapter_charge_start = ?, chapter_kandian = ?,
         goods = CASE WHEN ? != '' THEN ? ELSE goods END,
         goods_batch_id = CASE WHEN ? != '' THEN ? ELSE goods_batch_id END,
         callback_config_id = CASE WHEN ? != '' THEN ? ELSE callback_config_id END,
         updated_at = datetime('now')
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
      payload.chapterIdx,
      payload.chapterChargeStart,
      payload.chapterKandian,
      payload.goods,
      payload.goods,
      payload.goodsBatchId,
      payload.goodsBatchId,
      payload.callbackConfigId,
      payload.callbackConfigId,
      byRef.id,
    )
    return { id: byRef.id, created: false }
  }
  const byUrl = referralId
    ? null
    : d.prepare('SELECT id FROM novel_promo_links WHERE book_id = ? AND url = ?').get(bookId, url)
  if (byUrl) {
    d.prepare(
      `UPDATE novel_promo_links SET
         name = CASE WHEN ? != '' THEN ? ELSE name END,
         channel = CASE WHEN ? != '' THEN ? ELSE channel END,
         external_id = CASE WHEN ? != '' THEN ? ELSE external_id END,
         source = 'dianzhong', media_source = ?, path = ?, monitor1 = ?, monitor2 = ?,
         referral_id = CASE WHEN ? != '' THEN ? ELSE referral_id END,
         chapter_idx = ?, chapter_charge_start = ?, chapter_kandian = ?,
         goods = CASE WHEN ? != '' THEN ? ELSE goods END,
         goods_batch_id = CASE WHEN ? != '' THEN ? ELSE goods_batch_id END,
         callback_config_id = CASE WHEN ? != '' THEN ? ELSE callback_config_id END,
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
      payload.chapterIdx,
      payload.chapterChargeStart,
      payload.chapterKandian,
      payload.goods,
      payload.goods,
      payload.goodsBatchId,
      payload.goodsBatchId,
      payload.callbackConfigId,
      payload.callbackConfigId,
      byUrl.id,
    )
    return { id: byUrl.id, created: false }
  }
  const r = d
    .prepare(
      `INSERT INTO novel_promo_links
         (book_id, name, url, store, channel, status, remark, external_id, source,
          referral_id, media_source, path, monitor1, monitor2,
          chapter_idx, chapter_charge_start, chapter_kandian, goods, goods_batch_id, callback_config_id, updated_at)
       VALUES (?, ?, ?, '', ?, 'active', '', ?, 'dianzhong', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
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
      payload.chapterIdx,
      payload.chapterChargeStart,
      payload.chapterKandian,
      payload.goods,
      payload.goodsBatchId,
      payload.callbackConfigId,
    )
  return { id: Number(r.lastInsertRowid), created: true }
}

async function syncReferralsFromRemote(d, input, fallbackBookId) {
  const channelId = String(input.channelId || '').trim()
  if (!channelId) return { error: '请选择投放账号' }
  const size = Math.min(200, Math.max(1, parseInt(input.size, 10) || 100))
  let page = Math.max(1, parseInt(input.page, 10) || 1)
  let upserted = 0
  let created = 0
  let total = 0
  const rows = []
  const maxPages = 50
  while (page <= maxPages) {
    const remote = await dianzhong.listReferrals({ ...input, channelId, page, size })
    if (remote.error) return remote
    const items = pickReferralList(remote.data)
    const remoteTotal = Number(remote.data && remote.data.total)
    if (page === 1) total = Number.isFinite(remoteTotal) && remoteTotal > 0 ? remoteTotal : items.length
    for (const item of items) {
      const r = upsertDianzhongReferral(d, item, fallbackBookId, channelId)
      if (r.error) continue
      upserted += 1
      if (r.created) created += 1
      rows.push(rowToPromo(fetchPromoRow(d, r.id)))
    }
    if (items.length < size) break
    if (Number.isFinite(remoteTotal) && remoteTotal > 0 && page * size >= remoteTotal) break
    page += 1
  }
  return { upserted, created, total, list: rows, channelId }
}

async function syncBookReferralsWithRetry(d, extBookId, channelId, localBookId, minCount) {
  let synced
  const need = Math.max(1, Number(minCount) || 1)
  for (let i = 0; i < 5; i += 1) {
    synced = await syncReferralsFromRemote(
      d,
      { bookId: extBookId, size: 100, channelId },
      localBookId,
    )
    if (synced.error) return synced
    const localCount = d
      .prepare('SELECT COUNT(*) AS c FROM novel_promo_links WHERE book_id = ?')
      .get(localBookId).c
    if (localCount >= need && bookHasRealName(d, localBookId)) return synced
    await sleep(i === 0 ? 500 : 800)
  }
  return synced
}

function promoTemplateSelectSql() {
  return `
    SELECT t.*, r.name AS recharge_name, r.batch_id AS recharge_batch_id
    FROM novel_promo_templates t
    LEFT JOIN novel_recharge_templates r ON r.id = t.recharge_template_id
  `
}

function fetchPromoTemplateRow(d, id) {
  return d.prepare(`${promoTemplateSelectSql()} WHERE t.id = ?`).get(id)
}

function rowToPromoTemplate(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name || '',
    channelId: r.channel_id || '',
    mediaSource: dianzhong.normalizeMediaSource(r.media_source),
    chapterIdx: Math.min(20, Math.max(1, parseInt(r.chapter_idx, 10) || 1)),
    count: [1, 2, 3, 5].includes(Number(r.count)) ? Number(r.count) : 1,
    rechargeTemplateId: r.recharge_template_id || null,
    rechargeName: r.recharge_name || '',
    batchId: r.recharge_batch_id || '',
    createTime: fmtTime(r.created_at),
    updateTime: fmtTime(r.updated_at),
  }
}

function normalizePromoTemplateBody(body) {
  const name = String((body && body.name) || '').trim()
  const channelId = String((body && body.channelId) || '').trim()
  const mediaSource = dianzhong.normalizeMediaSource(body && body.mediaSource)
  const chapterIdx = Math.min(20, Math.max(1, parseInt(body && body.chapterIdx, 10) || 1))
  const countRaw = parseInt(body && body.count, 10) || 1
  const count = [1, 2, 3, 5].includes(countRaw) ? countRaw : 1
  const rid = parseInt(body && body.rechargeTemplateId, 10) || 0
  return { name, channelId, mediaSource, chapterIdx, count, rechargeTemplateId: rid || null }
}

function assertRechargeTemplate(d, id) {
  if (!id) return { ok: true }
  const row = d.prepare('SELECT id FROM novel_recharge_templates WHERE id = ?').get(id)
  if (!row) return { error: '充值模板不存在' }
  return { ok: true }
}

function rechargeSelectSql() {
  return `
    SELECT r.*,
      (SELECT COUNT(*) FROM novel_promo_templates t WHERE t.recharge_template_id = r.id) AS promo_tpl_count,
      (SELECT COUNT(*) FROM novel_promo_links l
        WHERE r.batch_id != '' AND l.goods_batch_id = r.batch_id) AS link_count
    FROM novel_recharge_templates r
  `
}

function unixToLocal(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n * 1000)
  if (Number.isNaN(d.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function rechargeLockFlags(name) {
  const locked = dianzhong.isLockedRechargeName(name) ? 1 : 0
  const enabled = locked ? 1 : dianzhong.isDisabledRechargeName(name) ? 0 : 1
  return { locked, enabled }
}

function rowToRechargeTemplate(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name || '',
    batchId: r.batch_id || '',
    remark: r.remark || '',
    channelId: r.channel_id || '',
    enabled: Number(r.enabled) === 1,
    locked: Number(r.locked) === 1,
    creator: r.creator || '',
    promoTplCount: Number(r.promo_tpl_count) || 0,
    linkCount: Number(r.link_count) || 0,
    remoteCreateTime: fmtTime(r.remote_created_at),
    createTime: fmtTime(r.remote_created_at || r.created_at),
    updateTime: fmtTime(r.remote_updated_at || r.updated_at),
  }
}

function normalizeRechargeTemplateBody(body) {
  const name = String((body && body.name) || '').trim()
  const batchId = String((body && body.batchId) || '').trim()
  const remark = String((body && body.remark) || '').trim()
  const channelId = String((body && body.channelId) || '').trim()
  const creator = String((body && body.creator) || '').trim()
  return { name, batchId, remark, channelId, creator }
}

function findDupRechargeBatch(d, batchId, excludeId) {
  if (!batchId) return null
  if (excludeId) {
    return d
      .prepare('SELECT id FROM novel_recharge_templates WHERE batch_id = ? AND id != ?')
      .get(batchId, excludeId)
  }
  return d.prepare('SELECT id FROM novel_recharge_templates WHERE batch_id = ?').get(batchId)
}

function upsertRemoteRechargeTemplate(d, item, channelId) {
  const batchId = String(pickField(item, ['id', 'batchId', 'batch_id']) || '').trim()
  const name = String(pickField(item, ['name', 'title', 'goodsName']) || '').trim()
  if (!batchId || !name) return { skipped: true }
  const creator = String(pickField(item, ['creator', 'createUser', 'username', 'userName']) || '').trim()
  const remoteCreated = unixToLocal(pickField(item, ['createtime', 'createTime', 'created_at']))
  const remoteUpdated = unixToLocal(pickField(item, ['updatetime', 'updateTime', 'updated_at'])) || remoteCreated
  const exist = d.prepare('SELECT * FROM novel_recharge_templates WHERE batch_id = ?').get(batchId)
  if (exist) {
    d.prepare(
      `UPDATE novel_recharge_templates
       SET name = ?, creator = CASE WHEN ? != '' THEN ? ELSE creator END,
           channel_id = CASE WHEN channel_id = '' THEN ? ELSE channel_id END,
           remote_created_at = CASE WHEN ? != '' THEN ? ELSE remote_created_at END,
           remote_updated_at = CASE WHEN ? != '' THEN ? ELSE remote_updated_at END,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      name,
      creator,
      creator,
      channelId,
      remoteCreated,
      remoteCreated,
      remoteUpdated,
      remoteUpdated,
      exist.id,
    )
    if (dianzhong.isLockedRechargeName(name) && Number(exist.locked) !== 1) {
      d.prepare(
        `UPDATE novel_recharge_templates SET locked = 1, enabled = 1, updated_at = datetime('now') WHERE id = ?`,
      ).run(exist.id)
    }
    return { id: exist.id, created: false }
  }
  const flags = rechargeLockFlags(name)
  const removed = d.prepare('SELECT 1 AS x FROM novel_recharge_removed WHERE batch_id = ?').get(batchId)
  if (removed && Number(flags.locked) !== 1) flags.enabled = 0
  const r = d
    .prepare(
      `INSERT INTO novel_recharge_templates
         (name, batch_id, remark, channel_id, enabled, locked, creator, remote_created_at, remote_updated_at, updated_at)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(name, batchId, channelId, flags.enabled, flags.locked, creator, remoteCreated, remoteUpdated)
  if (removed) d.prepare('DELETE FROM novel_recharge_removed WHERE batch_id = ?').run(batchId)
  return { id: Number(r.lastInsertRowid), created: true }
}

router.get('/promo-links/dianzhong/channels', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  const ready = dianzhong.assertConfig()
  if (ready.error) return res.json(fail(400, ready.error))
  res.json(ok(dianzhong.listChannels()))
})

router.get('/promo-links/templates', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const rows = database()
      .prepare(`${promoTemplateSelectSql()} ORDER BY t.id DESC`)
      .all()
    res.json(ok(rows.map(rowToPromoTemplate)))
  } catch (e) {
    console.error('[novel] promo templates list', e.message)
    res.json(fail(500, '读取推广模板失败'))
  }
})

router.get('/promo-links/templates/page', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const { pageSize, offset } = pageParams(req.query)
    const keyword = String(req.query.keyword || '').trim()
    const channel = String(req.query.channel || req.query.channelId || '').trim()
    const mediaSource = String(req.query.mediaSource || '').trim()
    const where = []
    const args = []
    if (keyword) {
      where.push(`(t.name LIKE ? OR IFNULL(r.name, '') LIKE ? OR IFNULL(r.batch_id, '') LIKE ?)`)
      const like = `%${keyword}%`
      args.push(like, like, like)
    }
    if (channel) {
      where.push('t.channel_id = ?')
      args.push(channel)
    }
    if (mediaSource) {
      where.push('t.media_source = ?')
      args.push(mediaSource)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const d = database()
    const total = d.prepare(`SELECT COUNT(*) AS c FROM (${promoTemplateSelectSql()} ${clause})`).get(...args).c
    const rows = d
      .prepare(`${promoTemplateSelectSql()} ${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, offset)
    res.json(ok({ list: rows.map(rowToPromoTemplate), total }))
  } catch (e) {
    console.error('[novel] promo templates page', e.message)
    res.json(fail(500, '读取推广模板失败'))
  }
})

router.post('/promo-links/templates', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const p = normalizePromoTemplateBody(req.body)
    if (!p.name) return res.json(fail(400, '请填写模板名称'))
    if (!p.channelId) return res.json(fail(400, '请选择投放账号'))
    if (!dianzhong.findChannel(p.channelId)) return res.json(fail(400, '投放账号不在已配置列表中'))
    const d = database()
    const recharge = assertRechargeTemplate(d, p.rechargeTemplateId)
    if (recharge.error) return res.json(fail(400, recharge.error))
    const r = d
      .prepare(
        `INSERT INTO novel_promo_templates
           (name, channel_id, media_source, chapter_idx, count, recharge_template_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(p.name, p.channelId, p.mediaSource, p.chapterIdx, p.count, p.rechargeTemplateId)
    res.json(ok(rowToPromoTemplate(fetchPromoTemplateRow(d, Number(r.lastInsertRowid)))))
  } catch (e) {
    console.error('[novel] promo templates create', e.message)
    res.json(fail(500, '保存模板失败'))
  }
})

router.put('/promo-links/templates/:id', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0
    const d = database()
    const exist = d.prepare('SELECT id FROM novel_promo_templates WHERE id = ?').get(id)
    if (!exist) return res.json(fail(400, '模板不存在'))
    const p = normalizePromoTemplateBody(req.body)
    if (!p.name) return res.json(fail(400, '请填写模板名称'))
    if (!p.channelId) return res.json(fail(400, '请选择投放账号'))
    if (!dianzhong.findChannel(p.channelId)) return res.json(fail(400, '投放账号不在已配置列表中'))
    const recharge = assertRechargeTemplate(d, p.rechargeTemplateId)
    if (recharge.error) return res.json(fail(400, recharge.error))
    d.prepare(
      `UPDATE novel_promo_templates
       SET name = ?, channel_id = ?, media_source = ?, chapter_idx = ?, count = ?,
           recharge_template_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(p.name, p.channelId, p.mediaSource, p.chapterIdx, p.count, p.rechargeTemplateId, id)
    res.json(ok(rowToPromoTemplate(fetchPromoTemplateRow(d, id))))
  } catch (e) {
    console.error('[novel] promo templates update', e.message)
    res.json(fail(500, '保存模板失败'))
  }
})

router.delete('/promo-links/templates/:id', requirePerm(PERM.promo, '推广链接'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0
    const d = database()
    const exist = d.prepare('SELECT id FROM novel_promo_templates WHERE id = ?').get(id)
    if (!exist) return res.json(fail(400, '模板不存在'))
    d.prepare('DELETE FROM novel_promo_templates WHERE id = ?').run(id)
    res.json(ok(true))
  } catch (e) {
    console.error('[novel] promo templates delete', e.message)
    res.json(fail(500, '删除模板失败'))
  }
})

function rechargeWhere(query) {
  const keyword = String((query && query.keyword) || '').trim()
  const channel = String((query && (query.channel || query.channelId)) || '').trim()
  const enabledRaw = String((query && query.enabled) || '').trim()
  const where = []
  const args = []
  if (keyword) {
    where.push(`(r.name LIKE ? OR r.batch_id LIKE ? OR r.remark LIKE ? OR r.creator LIKE ?)`)
    const like = `%${keyword}%`
    args.push(like, like, like, like)
  }
  if (channel) {
    where.push('r.channel_id = ?')
    args.push(channel)
  }
  if (enabledRaw === '1' || enabledRaw === '0') {
    where.push('r.enabled = ?')
    args.push(Number(enabledRaw))
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', args }
}

router.get('/recharge-templates', requirePerm(PERM.promo, '充值模板'), (req, res) => {
  try {
    const { clause, args } = rechargeWhere(req.query)
    const rows = database()
      .prepare(`${rechargeSelectSql()} ${clause} ORDER BY r.enabled DESC, r.id DESC`)
      .all(...args)
    res.json(ok(rows.map(rowToRechargeTemplate)))
  } catch (e) {
    console.error('[novel] recharge templates list', e.message)
    res.json(fail(500, '读取充值模板失败'))
  }
})

router.get('/recharge-templates/page', requirePerm(PERM.promo, '充值模板'), (req, res) => {
  try {
    const { pageSize, offset } = pageParams(req.query)
    const { clause, args } = rechargeWhere(req.query)
    const d = database()
    const total = d.prepare(`SELECT COUNT(*) AS c FROM novel_recharge_templates r ${clause}`).get(...args).c
    const rows = d
      .prepare(`${rechargeSelectSql()} ${clause} ORDER BY r.enabled DESC, r.id DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, offset)
    res.json(ok({ list: rows.map(rowToRechargeTemplate), total }))
  } catch (e) {
    console.error('[novel] recharge templates page', e.message)
    res.json(fail(500, '读取充值模板失败'))
  }
})

router.post('/recharge-templates', requirePerm(PERM.promo, '充值模板'), (req, res) => {
  try {
    const p = normalizeRechargeTemplateBody(req.body)
    if (!p.name) return res.json(fail(400, '请填写模板名称'))
    if (!p.batchId) return res.json(fail(400, '请填写档位ID'))
    const d = database()
    if (findDupRechargeBatch(d, p.batchId)) return res.json(fail(400, '该档位ID已存在'))
    if (p.channelId && !dianzhong.findChannel(p.channelId)) return res.json(fail(400, '投放账号不在已配置列表中'))
    const flags = rechargeLockFlags(p.name)
    const r = d
      .prepare(
        `INSERT INTO novel_recharge_templates
           (name, batch_id, remark, channel_id, enabled, locked, creator, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(p.name, p.batchId, p.remark, p.channelId, flags.enabled, flags.locked, p.creator)
    const row = d.prepare(`${rechargeSelectSql()} WHERE r.id = ?`).get(Number(r.lastInsertRowid))
    res.json(ok(rowToRechargeTemplate(row)))
  } catch (e) {
    console.error('[novel] recharge templates create', e.message)
    res.json(fail(500, '保存充值模板失败'))
  }
})

router.put('/recharge-templates/:id', requirePerm(PERM.promo, '充值模板'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0
    const d = database()
    const exist = d.prepare('SELECT * FROM novel_recharge_templates WHERE id = ?').get(id)
    if (!exist) return res.json(fail(400, '充值模板不存在'))
    const p = normalizeRechargeTemplateBody(req.body)
    if (!p.name) return res.json(fail(400, '请填写模板名称'))
    if (!p.batchId) return res.json(fail(400, '请填写档位ID'))
    if (findDupRechargeBatch(d, p.batchId, id)) return res.json(fail(400, '该档位ID已存在'))
    if (p.channelId && !dianzhong.findChannel(p.channelId)) return res.json(fail(400, '投放账号不在已配置列表中'))
    d.prepare(
      `UPDATE novel_recharge_templates
       SET name = ?, batch_id = ?, remark = ?, channel_id = ?,
           creator = CASE WHEN ? != '' THEN ? ELSE creator END, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(p.name, p.batchId, p.remark, p.channelId, p.creator, p.creator, id)
    res.json(ok(rowToRechargeTemplate(d.prepare(`${rechargeSelectSql()} WHERE r.id = ?`).get(id))))
  } catch (e) {
    console.error('[novel] recharge templates update', e.message)
    res.json(fail(500, '保存充值模板失败'))
  }
})

router.patch('/recharge-templates/:id/enabled', requirePerm(PERM.promo, '充值模板'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0
    const d = database()
    const exist = d.prepare('SELECT id FROM novel_recharge_templates WHERE id = ?').get(id)
    if (!exist) return res.json(fail(400, '充值模板不存在'))
    const enabled = req.body && (req.body.enabled === false || req.body.enabled === 0 || req.body.enabled === '0') ? 0 : 1
    d.prepare(`UPDATE novel_recharge_templates SET enabled = ?, updated_at = datetime('now') WHERE id = ?`).run(
      enabled,
      id,
    )
    res.json(ok(rowToRechargeTemplate(d.prepare(`${rechargeSelectSql()} WHERE r.id = ?`).get(id))))
  } catch (e) {
    console.error('[novel] recharge templates enabled', e.message)
    res.json(fail(500, '更新投入使用状态失败'))
  }
})

router.delete('/recharge-templates/:id', requirePerm(PERM.promo, '充值模板'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0
    const d = database()
    const exist = d.prepare('SELECT * FROM novel_recharge_templates WHERE id = ?').get(id)
    if (!exist) return res.json(fail(400, '充值模板不存在'))
    if (Number(exist.locked) === 1) return res.json(fail(400, '该模板已锁定，不能删除'))
    d.prepare('UPDATE novel_promo_templates SET recharge_template_id = NULL WHERE recharge_template_id = ?').run(id)
    if (exist.batch_id) {
      d.prepare('INSERT OR IGNORE INTO novel_recharge_removed (batch_id) VALUES (?)').run(exist.batch_id)
    }
    d.prepare('DELETE FROM novel_recharge_templates WHERE id = ?').run(id)
    res.json(ok(true))
  } catch (e) {
    console.error('[novel] recharge templates delete', e.message)
    res.json(fail(500, '删除充值模板失败'))
  }
})

router.post('/recharge-templates/dianzhong/refresh', requirePerm(PERM.promo, '充值模板'), async (req, res) => {
  try {
    const ready = dianzhong.assertConfig()
    if (ready.error) return res.json(fail(400, ready.error))
    const one = String((req.body && req.body.channelId) || '').trim()
    const targets = one ? ready.cfg.channels.filter((c) => c.id === one) : ready.cfg.channels
    if (!targets.length) return res.json(fail(400, '投放账号不在已配置列表中'))
    const d = database()
    let upserted = 0
    let created = 0
    let disabled = 0
    const warnings = []
    for (const ch of targets) {
      const remote = await dianzhong.listBatches({ channelId: ch.id })
      if (remote.error) {
        warnings.push(`${ch.label}：${remote.error}`)
        continue
      }
      const items = remote.data || []
      if (!items.length) continue
      const seen = new Set()
      for (const item of items) {
        const r = upsertRemoteRechargeTemplate(d, item, ch.id)
        if (r.skipped) continue
        const batchId = String(pickField(item, ['id', 'batchId', 'batch_id']) || '').trim()
        if (batchId) seen.add(batchId)
        upserted += 1
        if (r.created) created += 1
      }
      const locals = d
        .prepare(
          `SELECT id, batch_id, locked, enabled FROM novel_recharge_templates
           WHERE channel_id = ? AND batch_id != ''`,
        )
        .all(ch.id)
      for (const row of locals) {
        if (seen.has(String(row.batch_id)) || Number(row.locked) === 1 || Number(row.enabled) !== 1) continue
        d.prepare(
          `UPDATE novel_recharge_templates SET enabled = 0, updated_at = datetime('now') WHERE id = ?`,
        ).run(row.id)
        disabled += 1
      }
    }
    if (warnings.length && !upserted) return res.json(fail(400, warnings.join('；')))
    res.json(ok({ upserted, created, disabled, warnings }))
  } catch (e) {
    console.error('[novel] recharge templates refresh', e.message)
    res.json(fail(500, '从点众拉取充值模板失败'))
  }
})

router.post('/recharge-templates/import-from-links', requirePerm(PERM.promo, '充值模板'), (req, res) => {
  try {
    const d = database()
    const rows = d
      .prepare(
        `SELECT DISTINCT TRIM(goods) AS name, TRIM(IFNULL(goods_batch_id, '')) AS batch_id
         FROM novel_promo_links
         WHERE TRIM(IFNULL(goods, '')) != '' OR TRIM(IFNULL(goods_batch_id, '')) != ''`,
      )
      .all()
    let created = 0
    let skipped = 0
    const ins = d.prepare(
      `INSERT INTO novel_recharge_templates (name, batch_id, remark, enabled, locked, updated_at)
       VALUES (?, ?, '', ?, ?, datetime('now'))`,
    )
    for (const row of rows) {
      const batchId = String(row.batch_id || '').trim()
      const name = String(row.name || '').trim() || (batchId ? `档位 ${batchId}` : '')
      if (!name) {
        skipped += 1
        continue
      }
      if (batchId) {
        const hit = d.prepare('SELECT id FROM novel_recharge_templates WHERE batch_id = ?').get(batchId)
        if (hit) {
          skipped += 1
          continue
        }
      } else {
        const hit = d
          .prepare(`SELECT id FROM novel_recharge_templates WHERE name = ? AND batch_id = ''`)
          .get(name)
        if (hit) {
          skipped += 1
          continue
        }
      }
      const flags = rechargeLockFlags(name)
      ins.run(name, batchId, flags.enabled, flags.locked)
      created += 1
    }
    res.json(ok({ created, skipped, scanned: rows.length }))
  } catch (e) {
    console.error('[novel] recharge templates import', e.message)
    res.json(fail(500, '从链接带入失败'))
  }
})

router.post('/promo-links/dianzhong/create', requirePerm(PERM.promo, '推广链接'), async (req, res) => {
  try {
    const body = req.body || {}
    const bookId = parseInt(body.bookId, 10) || 0
    if (!bookId) return res.json(fail(400, '请选择所属书籍'))
    const channelId = String(body.channelId || '').trim()
    if (!channelId) return res.json(fail(400, '请选择投放账号'))
    if (!dianzhong.findChannel(channelId)) return res.json(fail(400, '投放账号不在已配置列表中'))
    const d = database()
    const book = d.prepare('SELECT * FROM novel_books WHERE id = ?').get(bookId)
    if (!book) return res.json(fail(400, '书籍不存在'))
    if (!book.external_book_id) return res.json(fail(400, '该书缺少书籍ID，无法对接点众'))
    const count = Math.min(5, Math.max(1, parseInt(body.count, 10) || 1))
    const baseName = String(body.name || '').trim()
    if (!baseName) return res.json(fail(400, '请填写链接名称'))
    let batchId = String(body.batchId || '').trim()
    const rechargeTemplateId = parseInt(body.rechargeTemplateId, 10) || 0
    if (rechargeTemplateId) {
      const rt = d.prepare('SELECT batch_id FROM novel_recharge_templates WHERE id = ?').get(rechargeTemplateId)
      if (!rt) return res.json(fail(400, '充值模板不存在'))
      if (rt.batch_id) batchId = String(rt.batch_id).trim()
    }
    const createdItems = []
    const warnings = []
    for (let i = 0; i < count; i += 1) {
      const name = count === 1 ? baseName : `${baseName}-${i + 1}`.slice(0, 60)
      const created = await dianzhong.createReferral({
        bookId: book.external_book_id,
        name,
        mediaSource: body.mediaSource,
        chapterIdx: body.chapterIdx,
        channelId,
        fromDrId: body.fromDrId,
        batchId,
        callbackConfigId: body.callbackConfigId,
        chapterChargeStart: body.chapterChargeStart,
        chapterKandian: body.chapterKandian,
      })
      if (created.error) {
        warnings.push(`${name}：${created.error}`)
        continue
      }
      createdItems.push(created.data)
    }
    if (!createdItems.length) return res.json(fail(400, warnings.join('；') || '创建失败'))
    const synced = await syncBookReferralsWithRetry(
      d,
      book.external_book_id,
      channelId,
      book.id,
      createdItems.length,
    )
    if (synced.error) {
      warnings.push(synced.error)
      return res.json(
        ok({
          created: createdItems,
          createdCount: createdItems.length,
          synced: 0,
          warning: warnings.join('；'),
          list: [],
        }),
      )
    }
    res.json(
      ok({
        created: createdItems,
        createdCount: createdItems.length,
        synced: synced.upserted,
        warning: warnings.length ? warnings.join('；') : '',
        list: synced.list,
      }),
    )
  } catch (e) {
    console.error('[novel] promo dianzhong create', e.message)
    res.json(fail(500, '创建推广链接失败'))
  }
})

router.post('/promo-links/dianzhong/batch-create', requirePerm(PERM.promo, '推广链接'), async (req, res) => {
  try {
    const body = req.body || {}
    const channelId = String(body.channelId || '').trim()
    if (!channelId) return res.json(fail(400, '请选择投放账号'))
    if (!dianzhong.findChannel(channelId)) return res.json(fail(400, '投放账号不在已配置列表中'))
    const bookIds = dianzhong.parseBookIds(body.bookIds != null ? body.bookIds : body.bookId)
    if (!bookIds.length) return res.json(fail(400, '请填写书籍ID'))
    const d = database()
    const templates = d
      .prepare(
        `SELECT * FROM novel_recharge_templates
         WHERE enabled = 1 AND batch_id != '' AND (channel_id = ? OR channel_id = '')
         ORDER BY id ASC`,
      )
      .all(channelId)
    if (!templates.length) return res.json(fail(400, '该账号没有投入使用的充值模板，请先到充值模板页从点众拉取并打开开关'))
    const createdItems = []
    const warnings = []
    const syncedBooks = new Set()
    for (const extBookId of bookIds) {
      const localBookId = findOrCreateBookByExternal(d, extBookId, '', '')
      let createdForBook = 0
      for (const tpl of templates) {
        const name = dianzhong.publicConfigPromoName(tpl.name)
        const created = await dianzhong.createReferral({
          bookId: extBookId,
          name,
          mediaSource: 'dy',
          chapterIdx: 1,
          channelId,
          batchId: tpl.batch_id,
        })
        if (created.error) {
          warnings.push(`${extBookId} / ${tpl.name}：${created.error}`)
          continue
        }
        createdItems.push(created.data)
        createdForBook += 1
        upsertDianzhongReferral(
          d,
          asReferralItem(created.data, {
            bookId: extBookId,
            name,
            mediaSource: 'dy',
            chapterIdx: 1,
            goods: 0,
            referral_goods_batch_id: tpl.batch_id,
          }),
          localBookId,
          channelId,
        )
      }
      if (!createdForBook) continue
      const synced = await syncBookReferralsWithRetry(
        d,
        extBookId,
        channelId,
        localBookId,
        createdForBook,
      )
      if (synced && synced.error) warnings.push(`${extBookId} 回写：${synced.error}`)
      else syncedBooks.add(extBookId)
    }
    if (!createdItems.length) return res.json(fail(400, warnings.join('；') || '创建失败'))
    res.json(
      ok({
        createdCount: createdItems.length,
        planned: bookIds.length * templates.length,
        bookCount: bookIds.length,
        templateCount: templates.length,
        syncedBooks: syncedBooks.size,
        warning: warnings.length ? warnings.join('；') : '',
      }),
    )
  } catch (e) {
    console.error('[novel] promo dianzhong batch-create', e.message)
    res.json(fail(500, '批量创建推广链接失败'))
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
    const ready = dianzhong.assertConfig()
    if (ready.error) return res.json(fail(400, ready.error))
    const one = String(body.channelId || '').trim()
    const targets = one ? ready.cfg.channels.filter((c) => c.id === one) : ready.cfg.channels
    if (!targets.length) return res.json(fail(400, '投放账号不在已配置列表中'))
    let upserted = 0
    let created = 0
    let total = 0
    const warnings = []
    for (const ch of targets) {
      const synced = await syncReferralsFromRemote(
        d,
        {
          bookId: remoteBookId,
          referralId: body.referralId,
          startTime: body.startTime,
          endTime: body.endTime,
          size: body.size,
          channelId: ch.id,
        },
        fallbackBookId || undefined,
      )
      if (synced.error) {
        warnings.push(`${ch.label}：${synced.error}`)
        continue
      }
      upserted += synced.upserted
      created += synced.created
      total += synced.total
    }
    if (warnings.length && !upserted) return res.json(fail(400, warnings.join('；')))
    res.json(ok({ upserted, created, total, warnings }))
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
