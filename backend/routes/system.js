const express = require('express')
const db = require('../db')
const auth = require('./auth')
const { requireAuth, menuRowsForUser } = auth
const { buildTree } = require('../utils/tree')
const { ok, fail } = require('../utils/response')

const router = express.Router()
router.use(requireAuth)

const database = () => db.getDb()

/** 工作台资源概览（用户数 / 角色 / 菜单 / 部门） */
router.get('/workbench-summary', (req, res) => {
  const d = database()
  const row = d
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS userCount,
         (SELECT COUNT(*) FROM roles) AS roleCount,
         (SELECT COUNT(*) FROM menus) AS menuCount,
         (SELECT COUNT(*) FROM departments) AS deptCount`
    )
    .get()
  res.json(
    ok({
      userCount: Number(row.userCount) || 0,
      roleCount: Number(row.roleCount) || 0,
      menuCount: Number(row.menuCount) || 0,
      deptCount: Number(row.deptCount) || 0,
    })
  )
})

/** 自根菜单拼出前端路由 path（与动态路由注册规则一致） */
function menuFullPath(menuId, dbi) {
  const parts = []
  let id = menuId
  const seen = new Set()
  while (id && !seen.has(id)) {
    seen.add(id)
    const row = dbi.prepare('SELECT parent_id, path FROM menus WHERE id = ?').get(id)
    if (!row) break
    const seg = String(row.path || '').replace(/^\/+|\/+$/g, '')
    if (seg) parts.unshift(seg)
    id = row.parent_id
  }
  const s = `/${parts.join('/')}`
  return s.replace(/\/+/g, '/') || '/'
}

function allowedLeafMenuIdSet(userId) {
  const rows = menuRowsForUser(userId)
  const s = new Set()
  for (const r of rows) {
    if (r.status === 0 && Number(r.type) === 2 && String(r.path || '').trim()) s.add(r.id)
  }
  return s
}

/** 工作台快捷入口（按用户持久化）；双路径避免旧网关/缓存只识别短路径 */
function getQuickEntriesList(req, res) {
  try {
    const d = database()
    const allowed = allowedLeafMenuIdSet(req.userId)
    const rows = d
      .prepare(
        `SELECT uqe.menu_id, uqe.sort_order, m.name, m.path, m.icon, m.type, m.status, m.visible
         FROM user_quick_entries uqe
         INNER JOIN menus m ON m.id = uqe.menu_id
         WHERE uqe.user_id = ?
         ORDER BY uqe.sort_order ASC, uqe.menu_id ASC`
      )
      .all(req.userId)

    const list = rows
      .filter((r) => allowed.has(r.menu_id) && r.status === 0)
      .map((r) => ({
        menuId: r.menu_id,
        name: r.name || '',
        path: menuFullPath(r.menu_id, d),
        icon: r.icon || '',
      }))
    res.json(ok(list))
  } catch (e) {
    console.error('[system] quick-entries list', e.message)
    res.json(ok([]))
  }
}

function putQuickEntries(req, res) {
  const raw = req.body?.menuIds
  if (!Array.isArray(raw)) return res.json(fail(400, 'menuIds 须为数组'))
  const menuIds = [...new Set(raw.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))]
  if (menuIds.length > 24) return res.json(fail(400, '最多添加 24 个快捷入口'))

  try {
    const d = database()
    const allowed = allowedLeafMenuIdSet(req.userId)
    for (const mid of menuIds) {
      if (!allowed.has(mid)) return res.json(fail(400, '存在无权限或不可作为入口的菜单'))
    }

    const tx = d.transaction(() => {
      d.prepare('DELETE FROM user_quick_entries WHERE user_id = ?').run(req.userId)
      const ins = d.prepare(
        'INSERT INTO user_quick_entries (user_id, menu_id, sort_order) VALUES (?, ?, ?)'
      )
      menuIds.forEach((mid, i) => ins.run(req.userId, mid, i))
    })
    tx()
    res.json(ok(true))
  } catch (e) {
    console.error('[system] quick-entries put', e.message)
    res.json(fail(500, '保存快捷入口失败'))
  }
}

router.get('/quick-entries', getQuickEntriesList)
router.put('/quick-entries', putQuickEntries)
router.get('/workbench/quick-entries', getQuickEntriesList)
router.put('/workbench/quick-entries', putQuickEntries)

function n(v, d = 0) {
  if (v === undefined || v === null || v === '') return d
  const x = Number(v)
  return Number.isNaN(x) ? d : x
}

/** 菜单 visible / keepAlive：兼容布尔与 1/0、'true'/'false'，便于后台与接口稳定写入 */
function boolToSqliteInt(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1
  if (v === false || v === 0 || v === '0' || v === 'false') return 0
  return 0
}

function formatTime(v) {
  if (!v) return ''
  return String(v).replace('T', ' ').slice(0, 19)
}

/* ---------- 菜单 ---------- */
router.get('/menu/list', (req, res) => {
  const name = (req.query.name || '').trim()
  const status = req.query.status
  const conds = ['1=1']
  const params = []
  if (name) {
    conds.push('name LIKE ?')
    params.push(`%${name}%`)
  }
  if (status !== undefined && status !== '') {
    conds.push('status = ?')
    params.push(Number(status))
  }
  const where = conds.join(' AND ')
  const rows = database().prepare(`SELECT * FROM menus WHERE ${where} ORDER BY sort ASC, id ASC`).all(...params)
  res.json(ok(rows.map(db.rowToMenu)))
})

router.get('/menu/list-all-simple', (req, res) => {
  const rows = database().prepare('SELECT * FROM menus ORDER BY sort ASC, id ASC').all()
  res.json(ok(rows.map(db.rowToMenu)))
})

router.get('/menu/get', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  const row = database().prepare('SELECT * FROM menus WHERE id = ?').get(id)
  if (!row) return res.json(fail(404, '菜单不存在'))
  res.json(ok(db.rowToMenu(row)))
})

router.post('/menu/create', (req, res) => {
  const b = req.body || {}
  const visible = boolToSqliteInt(b.visible)
  const keepAlive = boolToSqliteInt(b.keepAlive)
  const info = database()
    .prepare(
      `INSERT INTO menus (parent_id, type, name, path, component_name, icon, sort, permission, status, visible, keep_alive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(b.parentId) || 0,
      Number(b.type) || 1,
      b.name || '',
      b.path || '',
      b.componentName || '',
      b.icon || '',
      Number(b.sort) || 0,
      b.permission || '',
      n(b.status, 0),
      visible,
      keepAlive
    )
  res.json(ok({ id: Number(info.lastInsertRowid) }))
})

router.put('/menu/update', (req, res) => {
  const b = req.body || {}
  const id = Number(b.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  const visible = boolToSqliteInt(b.visible)
  const keepAlive = boolToSqliteInt(b.keepAlive)
  database()
    .prepare(
      `UPDATE menus SET parent_id = ?, type = ?, name = ?, path = ?, component_name = ?, icon = ?, sort = ?, permission = ?, status = ?, visible = ?, keep_alive = ?
       WHERE id = ?`
    )
    .run(
      Number(b.parentId) || 0,
      Number(b.type) || 1,
      b.name || '',
      b.path || '',
      b.componentName || '',
      b.icon || '',
      Number(b.sort) || 0,
      b.permission || '',
      n(b.status, 0),
      visible,
      keepAlive,
      id
    )
  res.json(ok(true))
})

router.delete('/menu/delete', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  const hasChild = database().prepare('SELECT 1 FROM menus WHERE parent_id = ? LIMIT 1').get(id)
  if (hasChild) return res.json(fail(400, '存在子菜单，无法删除'))
  database().prepare('DELETE FROM role_menus WHERE menu_id = ?').run(id)
  database().prepare('DELETE FROM menus WHERE id = ?').run(id)
  res.json(ok(true))
})

/* ---------- 部门 ---------- */
function deptRowsWithLeader(whereSql, params) {
  return database()
    .prepare(
      `SELECT d.*, datetime(d.created_at, 'localtime') as create_time, u.nickname as leader_user_name
       FROM departments d
       LEFT JOIN users u ON d.leader_user_id = u.id
       WHERE ${whereSql}
       ORDER BY d.sort ASC, d.id ASC`
    )
    .all(...params)
}

router.get('/dept/list', (req, res) => {
  const name = (req.query.name || '').trim()
  const status = req.query.status
  const conds = ['1=1']
  const params = []
  if (name) {
    conds.push('d.name LIKE ?')
    params.push(`%${name}%`)
  }
  if (status !== undefined && status !== '') {
    conds.push('d.status = ?')
    params.push(Number(status))
  }
  const rows = deptRowsWithLeader(conds.join(' AND '), params)
  res.json(ok(rows.map((r) => db.rowToDept(r))))
})

router.get('/dept/list-all-simple', (req, res) => {
  const rows = deptRowsWithLeader('1=1', [])
  res.json(ok(rows.map((r) => db.rowToDept(r))))
})

router.post('/dept/create', (req, res) => {
  const b = req.body || {}
  const info = database()
    .prepare(
      `INSERT INTO departments (parent_id, name, sort, leader_user_id, phone, email, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(b.parentId) ?? 0,
      b.name || '',
      Number(b.sort) || 0,
      b.leaderUserId ? Number(b.leaderUserId) : null,
      b.phone || '',
      b.email || '',
      n(b.status, 0)
    )
  res.json(ok({ id: Number(info.lastInsertRowid) }))
})

router.put('/dept/update', (req, res) => {
  const b = req.body || {}
  const id = Number(b.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  database()
    .prepare(
      `UPDATE departments SET parent_id = ?, name = ?, sort = ?, leader_user_id = ?, phone = ?, email = ?, status = ?
       WHERE id = ?`
    )
    .run(
      Number(b.parentId) ?? 0,
      b.name || '',
      Number(b.sort) || 0,
      b.leaderUserId ? Number(b.leaderUserId) : null,
      b.phone || '',
      b.email || '',
      n(b.status, 0),
      id
    )
  res.json(ok(true))
})

router.delete('/dept/delete', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  if (id === 1) return res.json(fail(400, '根部门不可删除'))
  const hasChild = database().prepare('SELECT 1 FROM departments WHERE parent_id = ? LIMIT 1').get(id)
  if (hasChild) return res.json(fail(400, '存在子部门，无法删除'))
  const hasUser = database().prepare('SELECT 1 FROM users WHERE dept_id = ? LIMIT 1').get(id)
  if (hasUser) return res.json(fail(400, '部门下仍有成员，无法删除'))
  database().prepare('DELETE FROM departments WHERE id = ?').run(id)
  res.json(ok(true))
})

/* ---------- 角色 ---------- */
router.get('/role/page', (req, res) => {
  const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const name = (req.query.name || '').trim()
  const code = (req.query.code || '').trim()
  const status = req.query.status
  const conds = ['1=1']
  const params = []
  if (name) {
    conds.push('name LIKE ?')
    params.push(`%${name}%`)
  }
  if (code) {
    conds.push('code LIKE ?')
    params.push(`%${code}%`)
  }
  if (status !== undefined && status !== '') {
    conds.push('status = ?')
    params.push(Number(status))
  }
  const where = conds.join(' AND ')
  const total = database().prepare(`SELECT COUNT(*) as c FROM roles WHERE ${where}`).get(...params).c
  const offset = (pageNo - 1) * pageSize
  const rows = database()
    .prepare(
      `SELECT *, datetime(created_at, 'localtime') as create_time FROM roles WHERE ${where} ORDER BY sort ASC, id ASC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)
  const list = rows.map((r) => {
    const base = db.roleRow(r)
    const ds = database().prepare('SELECT dept_id FROM role_data_scope_depts WHERE role_id = ?').all(base.id)
    base.dataScopeDeptIds = ds.map((x) => x.dept_id)
    return base
  })
  res.json(ok({ list, total }))
})

router.get('/role/list-all-simple', (req, res) => {
  const rows = database().prepare('SELECT id, name, code, sort, status, type FROM roles WHERE status = 0 ORDER BY sort ASC').all()
  res.json(ok(rows))
})

router.post('/role/create', (req, res) => {
  const b = req.body || {}
  try {
    const info = database()
      .prepare(
        `INSERT INTO roles (name, code, sort, status, type, remark, data_scope)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        b.name || '',
        b.code || '',
        Number(b.sort) || 0,
        n(b.status, 0),
        2,
        b.remark || '',
        1
      )
    res.json(ok({ id: Number(info.lastInsertRowid) }))
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.json(fail(400, '角色标识已存在'))
    throw e
  }
})

router.put('/role/update', (req, res) => {
  const b = req.body || {}
  const id = Number(b.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  if (id === 1) {
    database()
      .prepare('UPDATE roles SET name = ?, sort = ?, status = ?, remark = ? WHERE id = 1')
      .run(b.name || '超级管理员', Number(b.sort) || 1, n(b.status, 0), b.remark || '')
    return res.json(ok(true))
  }
  try {
    database()
      .prepare('UPDATE roles SET name = ?, code = ?, sort = ?, status = ?, remark = ? WHERE id = ?')
      .run(b.name || '', b.code || '', Number(b.sort) || 0, n(b.status, 0), b.remark || '', id)
    res.json(ok(true))
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.json(fail(400, '角色标识已存在'))
    throw e
  }
})

router.delete('/role/delete', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  if (id === 1) return res.json(fail(400, '内置角色不可删除'))
  database().prepare('DELETE FROM role_menus WHERE role_id = ?').run(id)
  database().prepare('DELETE FROM user_roles WHERE role_id = ?').run(id)
  database().prepare('DELETE FROM role_data_scope_depts WHERE role_id = ?').run(id)
  database().prepare('DELETE FROM roles WHERE id = ?').run(id)
  res.json(ok(true))
})

router.get('/role/export-excel', (req, res) => {
  const rows = database().prepare('SELECT id, name, code, sort, status, type, remark, datetime(created_at, \'localtime\') as create_time FROM roles').all()
  const bom = '\ufeff'
  const head = '编号,名称,标识,排序,状态,类型,备注,创建时间\n'
  const body = rows
    .map(
      (r) =>
        `${r.id},${r.name},${r.code},${r.sort},${r.status === 0 ? '开启' : '关闭'},${r.type === 1 ? '内置' : '自定义'},${r.remark || ''},${formatTime(r.create_time)}`
    )
    .join('\n')
  const buf = Buffer.from(bom + head + body, 'utf8')
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=roles.csv')
  res.send(buf)
})

/* ---------- 用户 ---------- */
router.get('/user/page', (req, res) => {
  const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const username = (req.query.username || '').trim()
  const status = req.query.status
  const deptId = req.query.deptId
  const conds = ['1=1']
  const params = []
  if (username) {
    conds.push('(u.username LIKE ? OR u.email LIKE ? OR u.nickname LIKE ?)')
    const p = `%${username}%`
    params.push(p, p, p)
  }
  if (status !== undefined && status !== '') {
    conds.push('u.status = ?')
    params.push(Number(status))
  }
  if (deptId !== undefined && deptId !== '') {
    conds.push('u.dept_id = ?')
    params.push(Number(deptId))
  }
  const where = conds.join(' AND ')
  const total = database().prepare(`SELECT COUNT(*) as c FROM users u WHERE ${where}`).get(...params).c
  const offset = (pageNo - 1) * pageSize
  const rows = database()
    .prepare(
      `SELECT u.*, d.name as dept_name, datetime(u.created_at, 'localtime') as create_time
       FROM users u
       LEFT JOIN departments d ON u.dept_id = d.id
       WHERE ${where}
       ORDER BY u.id ASC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)
  const list = rows.map((r) => ({
    ...db.rowToUser(r),
    deptName: r.dept_name || '',
  }))
  res.json(ok({ list, total }))
})

router.get('/user/list-all-simple', (req, res) => {
  const nickname = (req.query.nickname || '').trim()
  const conds = ['1=1']
  const params = []
  if (nickname) {
    conds.push('(nickname LIKE ? OR username LIKE ?)')
    const p = `%${nickname}%`
    params.push(p, p)
  }
  const where = conds.join(' AND ')
  const rows = database()
    .prepare(
      `SELECT id, nickname, username, dept_id as deptId FROM users WHERE ${where} ORDER BY id ASC LIMIT 50`
    )
    .all(...params)
  res.json(ok(rows))
})

router.post('/user/create', (req, res) => {
  const b = req.body || {}
  if (!b.username || !b.password) return res.json(fail(400, '缺少账号或密码'))
  const exists = database().prepare('SELECT 1 FROM users WHERE username = ?').get(b.username)
  if (exists) return res.json(fail(400, '用户名已存在'))
  try {
    const info = database()
      .prepare(
        `INSERT INTO users (username, password_hash, nickname, dept_id, status, mobile, email, sex, remark)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(
        b.username,
        db.hashPassword(b.password),
        b.nickname || '',
        Number(b.deptId) || 0,
        b.mobile || '',
        b.email || '',
        b.sex !== undefined && b.sex !== '' ? Number(b.sex) : 0,
        b.remark || ''
      )
    res.json(ok({ id: Number(info.lastInsertRowid) }))
  } catch (e) {
    return res.json(fail(400, '创建失败'))
  }
})

router.put('/user/update', (req, res) => {
  const b = req.body || {}
  const id = Number(b.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  database()
    .prepare(
      `UPDATE users SET nickname = ?, dept_id = ?, mobile = ?, email = ?, sex = ?, remark = ? WHERE id = ?`
    )
    .run(
      b.nickname || '',
      Number(b.deptId) || 0,
      b.mobile || '',
      b.email || '',
      b.sex !== undefined && b.sex !== '' ? Number(b.sex) : 0,
      b.remark || '',
      id
    )
  res.json(ok(true))
})

router.put('/user/update-status', (req, res) => {
  const { id, status } = req.body || {}
  if (id == null) return res.json(fail(400, '缺少 id'))
  if (Number(id) === 1) return res.json(fail(400, '内置管理员状态不可修改'))
  database().prepare('UPDATE users SET status = ? WHERE id = ?').run(Number(status), Number(id))
  res.json(ok(true))
})

router.put('/user/update-password', (req, res) => {
  const { id, password } = req.body || {}
  if (id == null || !password) return res.json(fail(400, '参数不完整'))
  const r = database().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(db.hashPassword(password), Number(id))
  if (!r.changes) return res.json(fail(404, '用户不存在'))
  res.json(ok(true))
})

router.put('/user/updateAvatar', (req, res) => {
  const { id, avatar } = req.body || {}
  if (id == null) return res.json(fail(400, '缺少用户 id'))
  if (String(id) !== String(req.userId)) return res.json(fail(403, '只能修改本人头像'))
  const oku = db.updateUserAvatar(Number(id), avatar || '')
  if (!oku) return res.json(fail(500, '更新失败'))
  res.json(ok(true))
})

router.delete('/user/delete', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  if (id === 1) return res.json(fail(400, '内置管理员不可删除'))
  database().prepare('DELETE FROM user_roles WHERE user_id = ?').run(id)
  database().prepare('DELETE FROM users WHERE id = ?').run(id)
  res.json(ok(true))
})

router.get('/user/qcCode', (req, res) => {
  const username = (req.query.username || '').trim()
  if (!username) return res.json(fail(400, '缺少 username'))
  const onePxPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmWQQAAAABJRU5ErkJggg=='
  res.json(ok(onePxPng))
})

router.get('/user/export', (req, res) => {
  const rows = database()
    .prepare(
      `SELECT u.username, u.nickname, d.name as dept_name, u.status, u.mobile, u.email, datetime(u.created_at, 'localtime') as create_time
       FROM users u LEFT JOIN departments d ON u.dept_id = d.id ORDER BY u.id`
    )
    .all()
  const bom = '\ufeff'
  const head = '用户名,昵称,部门,状态,手机,邮箱,创建时间\n'
  const body = rows
    .map(
      (r) =>
        `${r.username},${r.nickname},${r.dept_name || ''},${r.status === 0 ? '激活' : '锁定'},${r.mobile || ''},${r.email || ''},${formatTime(r.create_time)}`
    )
    .join('\n')
  const buf = Buffer.from(bom + head + body, 'utf8')
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=users.csv')
  res.send(buf)
})

/* ---------- 权限分配 ---------- */
router.get('/permission/list-role-menus', (req, res) => {
  const roleId = Number(req.query.roleId)
  if (!roleId) return res.json(fail(400, '缺少 roleId'))
  const ids = database().prepare('SELECT menu_id FROM role_menus WHERE role_id = ?').all(roleId).map((r) => r.menu_id)
  res.json(ok(ids))
})

router.post('/permission/assign-role-menu', (req, res) => {
  const { roleId, menuIds } = req.body || {}
  if (!roleId) return res.json(fail(400, '缺少 roleId'))
  const dbi = database()
  const tx = dbi.transaction(() => {
    dbi.prepare('DELETE FROM role_menus WHERE role_id = ?').run(Number(roleId))
    const ins = dbi.prepare('INSERT INTO role_menus (role_id, menu_id) VALUES (?, ?)')
    for (const mid of menuIds || []) {
      ins.run(Number(roleId), Number(mid))
    }
  })
  tx()
  res.json(ok(true))
})

router.get('/permission/list-user-roles', (req, res) => {
  const userId = Number(req.query.userId)
  if (!userId) return res.json(fail(400, '缺少 userId'))
  const ids = database().prepare('SELECT role_id FROM user_roles WHERE user_id = ?').all(userId).map((r) => r.role_id)
  res.json(ok(ids))
})

router.post('/permission/assign-user-role', (req, res) => {
  const { userId, roleIds } = req.body || {}
  if (!userId) return res.json(fail(400, '缺少 userId'))
  if (Number(userId) === 1 && (!roleIds || !roleIds.includes(1))) {
    return res.json(fail(400, '内置管理员须保留超级管理员角色'))
  }
  const dbi = database()
  const tx = dbi.transaction(() => {
    dbi.prepare('DELETE FROM user_roles WHERE user_id = ?').run(Number(userId))
    const ins = dbi.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')
    for (const rid of roleIds || []) {
      ins.run(Number(userId), Number(rid))
    }
  })
  tx()
  res.json(ok(true))
})

router.post('/permission/assign-role-data-scope', (req, res) => {
  const { roleId, dataScope, dataScopeDeptIds } = req.body || {}
  if (!roleId) return res.json(fail(400, '缺少 roleId'))
  const dbi = database()
  const tx = dbi.transaction(() => {
    dbi.prepare('UPDATE roles SET data_scope = ? WHERE id = ?').run(Number(dataScope) || 1, Number(roleId))
    dbi.prepare('DELETE FROM role_data_scope_depts WHERE role_id = ?').run(Number(roleId))
    if (Number(dataScope) === 2 && Array.isArray(dataScopeDeptIds)) {
      const ins = dbi.prepare('INSERT INTO role_data_scope_depts (role_id, dept_id) VALUES (?, ?)')
      for (const did of dataScopeDeptIds) {
        ins.run(Number(roleId), Number(did))
      }
    }
  })
  tx()
  res.json(ok(true))
})

function rowToAiPrompt(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name || '',
    scene: r.scene || '',
    content: r.content || '',
    sort: r.sort ?? 0,
    status: r.status ?? 0,
    remark: r.remark || '',
    createTime: r.create_time ? String(r.create_time).replace('T', ' ').slice(0, 19) : '',
    updateTime: r.update_time ? String(r.update_time).replace('T', ' ').slice(0, 19) : '',
  }
}

/* ---------- AI 提示词 ---------- */
router.get('/ai-prompt/page', (req, res) => {
  const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const name = (req.query.name || '').trim()
  const scene = (req.query.scene || '').trim()
  const status = req.query.status
  const keyword = (req.query.keyword || '').trim()
  const conds = ['1=1']
  const params = []
  if (name) {
    conds.push('name LIKE ?')
    params.push(`%${name}%`)
  }
  if (scene) {
    conds.push('scene LIKE ?')
    params.push(`%${scene}%`)
  }
  if (keyword) {
    conds.push('(name LIKE ? OR content LIKE ? OR COALESCE(scene, \'\') LIKE ?)')
    const k = `%${keyword}%`
    params.push(k, k, k)
  }
  if (status !== undefined && status !== '') {
    conds.push('status = ?')
    params.push(Number(status))
  }
  const where = conds.join(' AND ')
  const total = database().prepare(`SELECT COUNT(*) as c FROM ai_prompts WHERE ${where}`).get(...params).c
  const offset = (pageNo - 1) * pageSize
  const rows = database()
    .prepare(
      `SELECT id, name, scene, content, sort, status, remark,
              datetime(created_at, 'localtime') as create_time, datetime(updated_at, 'localtime') as update_time
       FROM ai_prompts WHERE ${where} ORDER BY sort ASC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)
  res.json(ok({ list: rows.map(rowToAiPrompt), total }))
})

router.get('/ai-prompt/get', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  const row = database()
    .prepare(
      `SELECT id, name, scene, content, sort, status, remark,
              datetime(created_at, 'localtime') as create_time, datetime(updated_at, 'localtime') as update_time
       FROM ai_prompts WHERE id = ?`
    )
    .get(id)
  if (!row) return res.json(fail(404, '记录不存在'))
  res.json(ok(rowToAiPrompt(row)))
})

router.post('/ai-prompt/create', (req, res) => {
  const b = req.body || {}
  if (!String(b.name || '').trim()) return res.json(fail(400, '请填写名称'))
  if (!String(b.content || '').trim()) return res.json(fail(400, '请填写提示词内容'))
  const info = database()
    .prepare(
      `INSERT INTO ai_prompts (name, scene, content, sort, status, remark)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(b.name).trim(),
      String(b.scene || '').trim() || null,
      String(b.content).trim(),
      Number(b.sort) || 0,
      n(b.status, 0),
      String(b.remark || '').trim() || null
    )
  res.json(ok({ id: Number(info.lastInsertRowid) }))
})

router.put('/ai-prompt/update', (req, res) => {
  const b = req.body || {}
  const id = Number(b.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  if (!String(b.name || '').trim()) return res.json(fail(400, '请填写名称'))
  if (!String(b.content || '').trim()) return res.json(fail(400, '请填写提示词内容'))
  database()
    .prepare(
      `UPDATE ai_prompts SET name = ?, scene = ?, content = ?, sort = ?, status = ?, remark = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(
      String(b.name).trim(),
      String(b.scene || '').trim() || null,
      String(b.content).trim(),
      Number(b.sort) || 0,
      n(b.status, 0),
      String(b.remark || '').trim() || null,
      id
    )
  res.json(ok(true))
})

router.delete('/ai-prompt/delete', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  database().prepare('DELETE FROM ai_prompts WHERE id = ?').run(id)
  res.json(ok(true))
})

/* ---------- 视频模型（Seedance / 方舟接入点配置） ---------- */
function rowToVideoModel(r) {
  if (!r) return null
  let defaultParams = null
  if (r.default_params && String(r.default_params).trim()) {
    try {
      defaultParams = JSON.parse(r.default_params)
    } catch (_) {
      defaultParams = r.default_params
    }
  }
  return {
    id: r.id,
    name: r.name || '',
    apiModelId: r.api_model_id || '',
    sort: r.sort ?? 0,
    status: r.status ?? 0,
    isDefault: r.is_default === 1,
    remark: r.remark || '',
    supportsReferenceVideo: r.supports_reference_video === 1,
    defaultParams,
    createTime: formatTime(r.create_time),
    updateTime: formatTime(r.update_time),
  }
}

function clearOtherDefaults(dbi, keepId) {
  dbi.prepare('UPDATE video_models SET is_default = 0 WHERE id != ?').run(keepId)
}

router.get('/video-model/page', (req, res) => {
  const pageNo = Math.max(1, parseInt(req.query.pageNo, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const name = (req.query.name || '').trim()
  const status = req.query.status
  const conds = ['1=1']
  const params = []
  if (name) {
    conds.push('(name LIKE ? OR api_model_id LIKE ?)')
    params.push(`%${name}%`, `%${name}%`)
  }
  if (status !== undefined && status !== '') {
    conds.push('status = ?')
    params.push(Number(status))
  }
  const where = conds.join(' AND ')
  const d = database()
  const total = d.prepare(`SELECT COUNT(*) AS c FROM video_models WHERE ${where}`).get(...params).c
  const offset = (pageNo - 1) * pageSize
  const rows = d
    .prepare(
      `SELECT id, name, api_model_id, sort, status, is_default, remark, default_params,
              supports_reference_video,
              datetime(created_at, 'localtime') AS create_time, datetime(updated_at, 'localtime') AS update_time
       FROM video_models WHERE ${where} ORDER BY sort ASC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)
  res.json(ok({ list: rows.map(rowToVideoModel), total }))
})

router.get('/video-model/get', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  const row = database()
    .prepare(
      `SELECT id, name, api_model_id, sort, status, is_default, remark, default_params,
              supports_reference_video,
              datetime(created_at, 'localtime') AS create_time, datetime(updated_at, 'localtime') AS update_time
       FROM video_models WHERE id = ?`
    )
    .get(id)
  if (!row) return res.json(fail(404, '记录不存在'))
  res.json(ok(rowToVideoModel(row)))
})

router.post('/video-model/create', (req, res) => {
  const b = req.body || {}
  if (!String(b.name || '').trim()) return res.json(fail(400, '请填写名称'))
  if (!String(b.apiModelId || '').trim()) return res.json(fail(400, '请填写方舟模型 ID（apiModelId）'))
  let defaultParamsJson = null
  if (b.defaultParams != null && b.defaultParams !== '') {
    try {
      defaultParamsJson =
        typeof b.defaultParams === 'string' ? b.defaultParams : JSON.stringify(b.defaultParams)
      JSON.parse(defaultParamsJson)
    } catch (_) {
      return res.json(fail(400, 'defaultParams 须为合法 JSON'))
    }
  }
  const isDef = b.isDefault === true || b.isDefault === 1 ? 1 : 0
  const refVid = b.supportsReferenceVideo === true || b.supportsReferenceVideo === 1 ? 1 : 0
  const d = database()
  const newId = d.transaction(() => {
    const info = d
      .prepare(
        `INSERT INTO video_models (name, api_model_id, sort, status, is_default, remark, default_params, supports_reference_video)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(b.name).trim(),
        String(b.apiModelId).trim(),
        Number(b.sort) || 0,
        n(b.status, 0),
        isDef,
        String(b.remark || '').trim() || null,
        defaultParamsJson,
        refVid
      )
    const id = Number(info.lastInsertRowid)
    if (isDef) {
      clearOtherDefaults(d, id)
      d.prepare('UPDATE video_models SET is_default = 1 WHERE id = ?').run(id)
    }
    return id
  })()
  res.json(ok({ id: newId }))
})

router.put('/video-model/update', (req, res) => {
  const b = req.body || {}
  const id = Number(b.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  if (!String(b.name || '').trim()) return res.json(fail(400, '请填写名称'))
  if (!String(b.apiModelId || '').trim()) return res.json(fail(400, '请填写方舟模型 ID（apiModelId）'))
  let defaultParamsJson = null
  if (b.defaultParams != null && b.defaultParams !== '') {
    try {
      defaultParamsJson =
        typeof b.defaultParams === 'string' ? b.defaultParams : JSON.stringify(b.defaultParams)
      JSON.parse(defaultParamsJson)
    } catch (_) {
      return res.json(fail(400, 'defaultParams 须为合法 JSON'))
    }
  }
  const isDef = b.isDefault === true || b.isDefault === 1 ? 1 : 0
  const refVid = b.supportsReferenceVideo === true || b.supportsReferenceVideo === 1 ? 1 : 0
  const d = database()
  d.transaction(() => {
    d.prepare(
      `UPDATE video_models SET name = ?, api_model_id = ?, sort = ?, status = ?, is_default = ?, remark = ?,
       default_params = ?, supports_reference_video = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      String(b.name).trim(),
      String(b.apiModelId).trim(),
      Number(b.sort) || 0,
      n(b.status, 0),
      isDef,
      String(b.remark || '').trim() || null,
      defaultParamsJson,
      refVid,
      id
    )
    if (isDef) {
      clearOtherDefaults(d, id)
      d.prepare('UPDATE video_models SET is_default = 1 WHERE id = ?').run(id)
    }
  })()
  res.json(ok(true))
})

router.delete('/video-model/delete', (req, res) => {
  const id = Number(req.query.id)
  if (!id) return res.json(fail(400, '缺少 id'))
  database().prepare('DELETE FROM video_models WHERE id = ?').run(id)
  res.json(ok(true))
})

module.exports = router
