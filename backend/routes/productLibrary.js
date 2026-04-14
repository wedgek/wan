/**
 * 产品库：当前用户下的产品条目（多图 URL），需菜单权限 ai:product-library:list
 */
const express = require('express')
const { requireAuth } = require('./auth')
const { ok, fail } = require('../utils/response')
const db = require('../db')

const router = express.Router()
router.use(requireAuth)

const database = () => db.getDb()

const PERM = 'ai:product-library:list'
const MAX_IMAGES = 20

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

function requireProductLibrary(req, res, next) {
  if (!userHasPermission(req.userId, PERM)) {
    return res.json(fail(403, '无权限访问产品库'))
  }
  next()
}

function parseImageUrls(text) {
  if (!text || !String(text).trim()) return []
  try {
    const o = JSON.parse(text)
    if (!Array.isArray(o)) return []
    const out = []
    const seen = new Set()
    for (const u of o) {
      const s = u && String(u).trim()
      if (!s || seen.has(s)) continue
      if (!s.startsWith('http')) continue
      seen.add(s)
      out.push(s)
    }
    return out
  } catch (_) {
    return []
  }
}

function normalizeInputImages(raw) {
  const arr = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  for (const u of arr) {
    const s = u && String(u).trim()
    if (!s || seen.has(s)) continue
    if (!s.startsWith('http')) continue
    seen.add(s)
    out.push(s)
    if (out.length >= MAX_IMAGES) break
  }
  return out
}

function rowToItem(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name != null ? String(r.name) : '',
    remark: r.remark != null ? String(r.remark) : '',
    images: parseImageUrls(r.image_urls),
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
    updateTime: r.update_time ? String(r.update_time).replace('T', ' ').slice(0, 19) : '',
  }
}

router.use(requireProductLibrary)

router.get('/page', (req, res) => {
  try {
    const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
    const offset = (pageNo - 1) * pageSize
    const keyword = String(req.query.keyword || '').trim()
    const createTimeFrom = String(req.query.createTimeFrom || '').trim()
    const createTimeTo = String(req.query.createTimeTo || '').trim()
    const userId = req.userId
    const d = database()

    const conds = ['user_id = ?']
    const params = [userId]
    if (keyword) {
      conds.push('name LIKE ?')
      params.push(`%${keyword}%`)
    }
    if (createTimeFrom) {
      conds.push(`replace(replace(trim(created_at), 'T', ' '), 'Z', '') >= ?`)
      params.push(createTimeFrom)
    }
    if (createTimeTo) {
      conds.push(`replace(replace(trim(created_at), 'T', ' '), 'Z', '') <= ?`)
      params.push(createTimeTo)
    }
    const where = conds.join(' AND ')

    const total = d.prepare(`SELECT COUNT(*) AS c FROM product_library_items WHERE ${where}`).get(...params).c

    const rows = d
      .prepare(
        `SELECT id, name, remark, image_urls,
                datetime(created_at, 'localtime') as create_time, datetime(updated_at, 'localtime') as update_time
         FROM product_library_items
         WHERE ${where}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset)

    res.json(ok({ list: rows.map(rowToItem), total }))
  } catch (e) {
    console.error('[productLibrary] page', e.message)
    res.json(fail(500, '读取产品库失败'))
  }
})

router.post('/', (req, res) => {
  try {
    const name = req.body && req.body.name != null ? String(req.body.name).trim() : ''
    if (!name) return res.json(fail(400, '请填写产品名称'))
    const remark = req.body && req.body.remark != null ? String(req.body.remark).trim() : ''
    const images = normalizeInputImages(req.body && req.body.images)
    const json = JSON.stringify(images)
    const d = database()
    const userId = req.userId
    const r = d
      .prepare(
        `INSERT INTO product_library_items (user_id, name, remark, image_urls, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(userId, name, remark || null, json)
    const row = d
      .prepare(
        `SELECT id, name, remark, image_urls,
                datetime(created_at, 'localtime') as create_time, datetime(updated_at, 'localtime') as update_time
         FROM product_library_items WHERE id = ? AND user_id = ?`,
      )
      .get(r.lastInsertRowid, userId)
    res.json(ok(rowToItem(row)))
  } catch (e) {
    console.error('[productLibrary] create', e.message)
    res.json(fail(500, '新增失败'))
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.json(fail(400, '无效 id'))
    const name = req.body && req.body.name != null ? String(req.body.name).trim() : ''
    if (!name) return res.json(fail(400, '请填写产品名称'))
    const remark = req.body && req.body.remark != null ? String(req.body.remark).trim() : ''
    const images = normalizeInputImages(req.body && req.body.images)
    const json = JSON.stringify(images)
    const userId = req.userId
    const d = database()
    const hit = d.prepare('SELECT 1 FROM product_library_items WHERE id = ? AND user_id = ?').get(id, userId)
    if (!hit) return res.json(fail(404, '记录不存在'))
    d.prepare(
      `UPDATE product_library_items SET name = ?, remark = ?, image_urls = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(name, remark || null, json, id, userId)
    const row = d
      .prepare(
        `SELECT id, name, remark, image_urls,
                datetime(created_at, 'localtime') as create_time, datetime(updated_at, 'localtime') as update_time
         FROM product_library_items WHERE id = ? AND user_id = ?`,
      )
      .get(id, userId)
    res.json(ok(rowToItem(row)))
  } catch (e) {
    console.error('[productLibrary] update', e.message)
    res.json(fail(500, '更新失败'))
  }
})

router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.json(fail(400, '无效 id'))
    const userId = req.userId
    const d = database()
    const r = d.prepare('DELETE FROM product_library_items WHERE id = ? AND user_id = ?').run(id, userId)
    if (r.changes === 0) return res.json(fail(404, '记录不存在'))
    res.json(ok({ ok: true }))
  } catch (e) {
    console.error('[productLibrary] delete', e.message)
    res.json(fail(500, '删除失败'))
  }
})

module.exports = router
