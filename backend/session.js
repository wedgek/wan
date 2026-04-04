/**
 * 会话存 SQLite，与生产共用同一套逻辑；PM2 / 本地 watch 重启后不丢登录态。
 */
const crypto = require('crypto')
const db = require('./db')

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000

function dbi() {
  return db.getDb()
}

function createSession(userId, ttlMs = DEFAULT_TTL_MS) {
  const accessToken = crypto.randomBytes(32).toString('hex')
  const refreshToken = crypto.randomBytes(24).toString('hex')
  const exp = Date.now() + ttlMs
  const rExp = Date.now() + REFRESH_TTL_MS
  const d = dbi()
  d.prepare('INSERT INTO auth_access_tokens (token, user_id, exp_ms) VALUES (?, ?, ?)').run(accessToken, userId, exp)
  d.prepare('INSERT INTO auth_refresh_tokens (token, user_id, exp_ms) VALUES (?, ?, ?)').run(refreshToken, userId, rExp)
  return { accessToken, refreshToken, expiresTime: exp }
}

function getSession(token) {
  if (!token) return null
  const now = Date.now()
  const row = dbi().prepare('SELECT user_id, exp_ms FROM auth_access_tokens WHERE token = ?').get(token)
  if (!row) return null
  if (row.exp_ms < now) {
    dbi().prepare('DELETE FROM auth_access_tokens WHERE token = ?').run(token)
    return null
  }
  return { userId: row.user_id, exp: row.exp_ms }
}

function consumeRefreshToken(refreshToken) {
  if (!refreshToken) return null
  const now = Date.now()
  const row = dbi().prepare('SELECT user_id, exp_ms FROM auth_refresh_tokens WHERE token = ?').get(refreshToken)
  if (!row) return null
  if (row.exp_ms < now) {
    dbi().prepare('DELETE FROM auth_refresh_tokens WHERE token = ?').run(refreshToken)
    return null
  }
  dbi().prepare('DELETE FROM auth_refresh_tokens WHERE token = ?').run(refreshToken)
  return row.user_id
}

function revokeToken(accessToken) {
  dbi().prepare('DELETE FROM auth_access_tokens WHERE token = ?').run(accessToken)
}

function revokeAllForUser(userId) {
  const d = dbi()
  d.prepare('DELETE FROM auth_access_tokens WHERE user_id = ?').run(userId)
  d.prepare('DELETE FROM auth_refresh_tokens WHERE user_id = ?').run(userId)
}

module.exports = {
  createSession,
  getSession,
  consumeRefreshToken,
  revokeToken,
  revokeAllForUser,
}
