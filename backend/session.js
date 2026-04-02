/**
 * 内存会话（单进程 PM2）。重启后需重新登录。
 */
const crypto = require('crypto')

const sessions = new Map()
/** refreshToken -> { userId, exp } */
const refreshSessions = new Map()

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000

function createSession(userId, ttlMs = DEFAULT_TTL_MS) {
  const accessToken = crypto.randomBytes(32).toString('hex')
  const refreshToken = crypto.randomBytes(24).toString('hex')
  const exp = Date.now() + ttlMs
  sessions.set(accessToken, { userId, exp })
  refreshSessions.set(refreshToken, { userId, exp: Date.now() + REFRESH_TTL_MS })
  return { accessToken, refreshToken, expiresTime: exp }
}

function getSession(token) {
  if (!token) return null
  const s = sessions.get(token)
  if (!s || s.exp < Date.now()) {
    if (s) sessions.delete(token)
    return null
  }
  return s
}

function consumeRefreshToken(refreshToken) {
  if (!refreshToken) return null
  const r = refreshSessions.get(refreshToken)
  if (!r || r.exp < Date.now()) {
    if (r) refreshSessions.delete(refreshToken)
    return null
  }
  refreshSessions.delete(refreshToken)
  return r.userId
}

function revokeToken(accessToken) {
  sessions.delete(accessToken)
}

function revokeAllForUser(userId) {
  for (const [t, s] of sessions) {
    if (s.userId === userId) sessions.delete(t)
  }
  for (const [rt, r] of refreshSessions) {
    if (r.userId === userId) refreshSessions.delete(rt)
  }
}

module.exports = {
  sessions,
  refreshSessions,
  createSession,
  getSession,
  consumeRefreshToken,
  revokeToken,
  revokeAllForUser,
}
