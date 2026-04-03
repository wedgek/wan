const express = require('express')
const db = require('../db')
const session = require('../session')
const { buildTree } = require('../utils/tree')
const { rowToUser, rowToMenu } = require('../db')

const router = express.Router()

function requireAuth(req, res, next) {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) {
    return res.json({ code: 401, msg: '未登录' })
  }
  const token = h.slice(7).trim()
  const sess = session.getSession(token)
  if (!sess) {
    return res.json({ code: 401, msg: '登录已过期，请重新登录' })
  }
  req.userId = sess.userId
  req.accessToken = token
  next()
}

function menuRowsForUser(userId) {
  const database = db.getDb()
  const roleIds = database.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').all(userId).map((r) => r.role_id)
  if (roleIds.includes(1)) {
    return database.prepare('SELECT * FROM menus WHERE status = 0 ORDER BY sort ASC, id ASC').all()
  }
  if (!roleIds.length) return []
  const ph = roleIds.map(() => '?').join(',')
  return database
    .prepare(
      `SELECT DISTINCT m.* FROM menus m
       INNER JOIN role_menus rm ON rm.menu_id = m.id
       WHERE rm.role_id IN (${ph}) AND m.status = 0
       ORDER BY m.sort ASC, m.id ASC`
    )
    .all(...roleIds)
}

function buildMenuTree(rows) {
  const flat = rows.map((r) => rowToMenu(r))
  return buildTree(flat, { idKey: 'id', parentKey: 'parentId', childrenKey: 'children' })
}

function collectPermissions(rows) {
  const set = new Set()
  for (const r of rows) {
    if (r.permission && String(r.permission).trim()) set.add(r.permission)
  }
  return [...set]
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {}

  if (!username || !password) {
    return res.json({ code: 400, msg: '请输入用户名和密码' })
  }

  const user = db.findUserByUsername(username)
  if (!user || user.password_hash !== db.hashPassword(password)) {
    return res.json({ code: 400, msg: '用户名或密码错误' })
  }

  const tokens = session.createSession(user.id)
  return res.json({
    code: 0,
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresTime: tokens.expiresTime,
    },
  })
})

router.post('/logout', requireAuth, (req, res) => {
  session.revokeAllForUser(req.userId)
  res.json({ code: 0, data: true })
})

router.get('/get-permission-info', requireAuth, (req, res) => {
  const user = db.findUserById(req.userId)
  if (!user) {
    return res.json({ code: 401, msg: '用户不存在' })
  }

  const database = db.getDb()
  const roleIds = database.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').all(req.userId).map((r) => r.role_id)
  const roleNames = database
    .prepare(
      `SELECT r.name FROM roles r
       INNER JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?`
    )
    .all(req.userId)
    .map((r) => r.name)

  const menuRows = menuRowsForUser(req.userId)
  const menus = buildMenuTree(menuRows)
  const permissions = collectPermissions(menuRows)

  res.json({
    code: 0,
    data: {
      user: rowToUser(user),
      permissions,
      roles: roleIds,
      roleNames,
      menus,
    },
  })
})

router.post('/refresh-token', (req, res) => {
  const { refreshToken } = req.body || {}
  if (!refreshToken) {
    return res.json({ code: 400, msg: '缺少 refreshToken' })
  }
  const userId = session.consumeRefreshToken(refreshToken)
  if (!userId) {
    return res.json({ code: 401, msg: 'refreshToken 无效或已过期' })
  }
  const tokens = session.createSession(userId)
  res.json({
    code: 0,
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresTime: tokens.expiresTime,
    },
  })
})

Object.assign(router, { requireAuth, menuRowsForUser })
module.exports = router
