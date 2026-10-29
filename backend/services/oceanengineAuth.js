/**
 * 巨量引擎 Marketing API 授权。
 * 与点众书城无关：点众回调在 /admin-api/novel/dianzhong/callback。
 * 本模块只处理巨量 OAuth：浏览器带回 auth_code 后换 Token，并在过期前用 refresh_token 续期。
 *
 * 回调地址（创建应用时填写，须完全一致）：
 * https://wanx.luoyushipin.com/admin-api/oceanengine/callback
 */
const crypto = require('crypto')
const db = require('../db')

const TOKEN_URL = 'https://api.oceanengine.com/open_api/oauth2/access_token/'
const REFRESH_URL = 'https://api.oceanengine.com/open_api/oauth2/refresh_token/'
const DEFAULT_REDIRECT_URI = 'https://wanx.luoyushipin.com/admin-api/oceanengine/callback'
const ACCESS_REFRESH_AHEAD_MS = 6 * 60 * 60 * 1000
const REFRESH_CHECK_MS = 60 * 60 * 1000

let refreshTimer = null
let refreshing = null

function config() {
  return {
    appId: String(process.env.OCEANENGINE_APP_ID || '').trim(),
    secret: String(process.env.OCEANENGINE_SECRET || '').trim(),
  }
}

function database() {
  return db.getDb()
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function expiresAt(seconds) {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(Date.now() + n * 1000).toISOString()
}

function oauthBody(fields) {
  const parts = []
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'app_id' && /^\d+$/.test(String(value))) {
      parts.push(`"app_id":${String(value)}`)
    } else {
      parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`)
    }
  }
  return `{${parts.join(',')}}`
}

function advertiserIdsFrom(data) {
  const ids = []
  const list = data && data.advertiser_ids
  if (Array.isArray(list)) {
    for (const id of list) {
      const s = String(id == null ? '' : id).trim()
      if (s) ids.push(s)
    }
  }
  const one = data && data.advertiser_id
  if (one != null && String(one).trim() && !ids.includes(String(one).trim())) {
    ids.unshift(String(one).trim())
  }
  return ids
}

async function postOauth(url, fields) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oauthBody(fields),
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    return { error: `巨量接口请求失败：${e.message || e}` }
  }
  let json
  try {
    json = await res.json()
  } catch {
    return { error: `巨量接口返回不是 JSON（HTTP ${res.status}）` }
  }
  const code = json && json.code
  if (code !== 0) {
    return { error: (json && (json.message || json.msg)) || `巨量接口失败（code=${code}）` }
  }
  return { data: (json && json.data) || {} }
}

function saveTokens(appPk, data) {
  const ids = advertiserIdsFrom(data)
  database()
    .prepare(
      `INSERT INTO oceanengine_authorizations (
         app_pk, access_token, refresh_token, advertiser_ids,
         access_expires_at, refresh_expires_at, last_error, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, '', datetime('now'))
       ON CONFLICT(app_pk) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         advertiser_ids = excluded.advertiser_ids,
         access_expires_at = excluded.access_expires_at,
         refresh_expires_at = excluded.refresh_expires_at,
         last_error = '',
         updated_at = datetime('now')`,
    )
    .run(
      appPk,
      String(data.access_token || ''),
      String(data.refresh_token || ''),
      JSON.stringify(ids),
      expiresAt(data.expires_in),
      expiresAt(data.refresh_token_expires_in),
    )
  return ids
}

let seeded = false

function ensureSeed() {
  if (seeded) return
  seeded = true
  const d = database()
  d.prepare(`DELETE FROM oceanengine_oauth_states WHERE created_at < datetime('now', '-1 day')`).run()
  const env = config()
  if (!env.appId) {
    console.error('[oceanengine] 未读到 OCEANENGINE_APP_ID，请检查 backend/.env 后重启')
  } else {
    const accountId = String(process.env.OCEANENGINE_EBP_ACCOUNT_ID || '1863711955555339').trim()
    const platformId = String(process.env.OCEANENGINE_PLATFORM_ID || '2068752917202714').trim()
    const existing = d.prepare('SELECT id, secret FROM oceanengine_apps WHERE app_id = ?').get(env.appId)
    if (!existing) {
      d.prepare(
        `INSERT INTO oceanengine_apps (name, app_id, secret, redirect_uri, account_id, platform_id, enabled)
         VALUES ('创漫基建工具', ?, ?, ?, ?, ?, 1)`,
      ).run(env.appId, env.secret, redirectUri(), accountId, platformId)
      console.log('[oceanengine] 已写入应用', env.appId)
    } else if (env.secret && existing.secret !== env.secret) {
      d.prepare(`UPDATE oceanengine_apps SET secret = ?, updated_at = datetime('now') WHERE id = ?`).run(env.secret, existing.id)
      console.log('[oceanengine] 已更新应用 Secret', env.appId)
    }
  }
  const legacy = d.prepare(`SELECT * FROM oceanengine_tokens WHERE access_token != ''`).all()
  for (const old of legacy) {
    const app = d.prepare('SELECT id FROM oceanengine_apps WHERE app_id = ?').get(old.app_id)
    if (!app) continue
    const exists = d.prepare('SELECT id FROM oceanengine_authorizations WHERE app_pk = ?').get(app.id)
    if (exists) continue
    d.prepare(
      `INSERT INTO oceanengine_authorizations (
         app_pk, access_token, refresh_token, advertiser_ids, access_expires_at, refresh_expires_at, last_error, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      app.id,
      old.access_token,
      old.refresh_token,
      old.advertiser_ids || '[]',
      old.access_expires_at,
      old.refresh_expires_at,
      old.last_error || '',
    )
  }
}

function redirectUri() {
  return String(process.env.OCEANENGINE_REDIRECT_URI || DEFAULT_REDIRECT_URI).trim()
}

function readApp(id) {
  return database().prepare('SELECT * FROM oceanengine_apps WHERE id = ?').get(id) || null
}

function readAuth(appPk) {
  return database().prepare('SELECT * FROM oceanengine_authorizations WHERE app_pk = ?').get(appPk) || null
}

function markError(appPk, message) {
  if (!appPk) return
  database()
    .prepare(
      `INSERT INTO oceanengine_authorizations (app_pk, last_error, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(app_pk) DO UPDATE SET
         last_error = excluded.last_error,
         updated_at = datetime('now')`,
    )
    .run(appPk, String(message || '').slice(0, 500))
}

function authStatus(row) {
  if (!row || !row.access_token) return 'unauthorized'
  const left = row.refresh_expires_at ? Date.parse(row.refresh_expires_at) - Date.now() : 1
  if (row.refresh_expires_at && left <= 0) return 'expired'
  return 'authorized'
}

function toPublic(app) {
  const row = readAuth(app.id)
  let advertiserIds = []
  try {
    const parsed = JSON.parse((row && row.advertiser_ids) || '[]')
    if (Array.isArray(parsed)) advertiserIds = parsed.map((id) => String(id))
  } catch {
    advertiserIds = []
  }
  return {
    id: app.id,
    name: app.name,
    appId: app.app_id,
    secretSet: !!app.secret,
    redirectUri: app.redirect_uri,
    accountId: app.account_id,
    platformId: app.platform_id,
    enabled: app.enabled !== 0,
    status: authStatus(row),
    lastError: (row && row.last_error) || '',
    advertiserIds,
    accessExpiresAt: (row && row.access_expires_at) || '',
    refreshExpiresAt: (row && row.refresh_expires_at) || '',
    updatedAt: (row && row.updated_at) || '',
  }
}

function listApps() {
  ensureSeed()
  return database()
    .prepare('SELECT * FROM oceanengine_apps ORDER BY id')
    .all()
    .map(toPublic)
}

function saveApp(input) {
  ensureSeed()
  const name = String((input && input.name) || '').trim()
  const appId = String((input && input.appId) || '').trim()
  const secret = String((input && input.secret) || '').trim()
  const redirect = String((input && input.redirectUri) || redirectUri()).trim()
  const account = String((input && input.accountId) || '').trim()
  const platform = String((input && input.platformId) || '').trim()
  const id = Number(input && input.id) || 0
  if (!name) return { error: '请填写应用名称' }
  if (!/^\d+$/.test(appId)) return { error: 'AppID 必须是数字' }
  if (!redirect) return { error: '请填写回调地址' }
  const d = database()
  if (id) {
    const current = readApp(id)
    if (!current) return { error: '应用不存在' }
    if (!secret && !current.secret) return { error: '请填写 Secret' }
    d.prepare(
      `UPDATE oceanengine_apps
       SET name = ?, app_id = ?, secret = ?, redirect_uri = ?, account_id = ?, platform_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(name, appId, secret || current.secret, redirect, account, platform, id)
    return { id }
  }
  if (!secret) return { error: '请填写 Secret' }
  const info = d
    .prepare(
      `INSERT INTO oceanengine_apps (name, app_id, secret, redirect_uri, account_id, platform_id, enabled)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(name, appId, secret, redirect, account, platform)
  return { id: Number(info.lastInsertRowid) }
}

function createAuthorizeUrl(appPk) {
  ensureSeed()
  const app = readApp(Number(appPk))
  if (!app || app.enabled === 0) return { error: '应用不存在' }
  if (!app.secret) return { error: '请先填写 Secret' }
  const state = crypto.randomBytes(16).toString('hex')
  database().prepare('INSERT INTO oceanengine_oauth_states (state, app_pk) VALUES (?, ?)').run(state, app.id)
  const params = new URLSearchParams({
    app_id: app.app_id,
    state,
    redirect_uri: app.redirect_uri || redirectUri(),
    material_auth: '1',
  })
  return { url: `https://open.oceanengine.com/audit/oauth.html?${params.toString()}` }
}

function resolveApp(appPk) {
  ensureSeed()
  if (appPk) return readApp(Number(appPk))
  return (
    database()
      .prepare(
        `SELECT a.* FROM oceanengine_apps a
         LEFT JOIN oceanengine_authorizations z ON z.app_pk = a.id
         WHERE a.enabled = 1
         ORDER BY CASE WHEN IFNULL(z.access_token, '') != '' THEN 0 ELSE 1 END, a.id
         LIMIT 1`,
      )
      .get() || null
  )
}

function renderCallbackPage(result) {
  const title = esc(result.title || '巨量授权')
  const detail = esc(result.detail || '')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "PingFang SC", sans-serif; background: #f5f7fb; color: #1f2329; }
    main { max-width: 520px; margin: 12vh auto; padding: 28px 32px; background: #fff; border-radius: 12px; box-shadow: 0 8px 28px rgba(31,35,41,.08); }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 0; line-height: 1.7; color: #4e5969; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${detail}</p>
  </main>
</body>
</html>`
}

function frontPath(ok, message) {
  if (ok) return '/novel/ocean-settings?ocean=ok'
  return `/novel/ocean-settings?ocean=fail&msg=${encodeURIComponent(message || '授权失败')}`
}

function findAppByState(state) {
  ensureSeed()
  if (state) {
    const saved = database().prepare('SELECT * FROM oceanengine_oauth_states WHERE state = ?').get(state)
    if (saved) {
      const app = readApp(saved.app_pk)
      if (app) return app
    }
  }
  const apps = database().prepare(`SELECT * FROM oceanengine_apps WHERE enabled = 1 AND secret != ''`).all()
  return apps.length === 1 ? apps[0] : null
}

async function handleBrowserCallback(query) {
  const q = query || {}
  const authCode = String(q.auth_code || q.authCode || q.code || '').trim()
  const state = String(q.state || '').trim()
  if (!authCode) {
    const denied = String(q.error || q.error_description || '').trim()
    if (denied) {
      return { redirectTo: frontPath(false, '未完成授权，请重新点一次「去授权」') }
    }
    return {
      title: '巨量授权回调已就绪',
      detail: '从商品库页面点「去授权」，同意后会自动回到系统，不用复制授权码。',
    }
  }
  const app = findAppByState(state)
  if (!app || !app.secret) {
    return { redirectTo: frontPath(false, '找不到对应应用，请从商品库页面点「去授权」') }
  }
  const exchanged = await postOauth(TOKEN_URL, {
    app_id: app.app_id,
    secret: app.secret,
    auth_code: authCode,
  })
  if (state) database().prepare('DELETE FROM oceanengine_oauth_states WHERE state = ?').run(state)
  if (exchanged.error) {
    markError(app.id, exchanged.error)
    return { redirectTo: frontPath(false, exchanged.error) }
  }
  const ids = saveTokens(app.id, exchanged.data)
  console.log('[oceanengine] token exchanged', { appId: app.app_id, advertisers: ids.length })
  return { redirectTo: frontPath(true) }
}

async function refreshOne(app, row) {
  if (!row || !row.refresh_token || !app.secret) return
  const accessLeft = row.access_expires_at ? Date.parse(row.access_expires_at) - Date.now() : 0
  if (row.access_token && accessLeft > ACCESS_REFRESH_AHEAD_MS) return
  const refreshLeft = row.refresh_expires_at ? Date.parse(row.refresh_expires_at) - Date.now() : 1
  if (refreshLeft <= 0) {
    markError(app.id, '授权已过期，请再点一次「去授权」')
    return
  }
  const refreshed = await postOauth(REFRESH_URL, {
    app_id: app.app_id,
    secret: app.secret,
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
  })
  if (refreshed.error) {
    markError(app.id, refreshed.error)
    console.error('[oceanengine] refresh failed', app.app_id, refreshed.error)
    return
  }
  const ids = saveTokens(app.id, refreshed.data)
  console.log('[oceanengine] token refreshed', { appId: app.app_id, advertisers: ids.length })
}

async function refreshStoredToken() {
  if (refreshing) return refreshing
  refreshing = doRefresh().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function doRefresh() {
  ensureSeed()
  const apps = database().prepare('SELECT * FROM oceanengine_apps WHERE enabled = 1').all()
  for (const app of apps) {
    const row = readAuth(app.id)
    try {
      await refreshOne(app, row)
    } catch (e) {
      console.error('[oceanengine] refresh', app.app_id, e.message)
    }
  }
}

async function getAccessToken(appPk) {
  ensureSeed()
  await refreshStoredToken()
  const app = resolveApp(appPk)
  if (!app) return { error: '请先添加巨量应用', needAuth: true }
  if (!app.secret) return { error: `应用「${app.name}」还没有 Secret`, needAuth: true, appPk: app.id }
  const row = readAuth(app.id)
  if (!row || !row.access_token) {
    return { error: `应用「${app.name}」还没授权，点一次「去授权」即可`, needAuth: true, appPk: app.id, accountId: app.account_id, platformId: app.platform_id }
  }
  const left = row.access_expires_at ? Date.parse(row.access_expires_at) - Date.now() : 1
  if (row.access_expires_at && left <= 60 * 1000) {
    return { error: row.last_error || '授权已过期，请再点一次「去授权」', needAuth: true, appPk: app.id, accountId: app.account_id, platformId: app.platform_id }
  }
  return {
    token: row.access_token,
    appId: app.app_id,
    appPk: app.id,
    accountId: app.account_id,
    platformId: app.platform_id,
  }
}

function startTokenRefresh() {
  if (refreshTimer) return
  const tick = () => {
    refreshStoredToken().catch((e) => console.error('[oceanengine] refresh', e.message))
  }
  setTimeout(tick, 15000)
  refreshTimer = setInterval(tick, REFRESH_CHECK_MS)
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref()
}

module.exports = {
  handleBrowserCallback,
  renderCallbackPage,
  startTokenRefresh,
  getAccessToken,
  listApps,
  saveApp,
  createAuthorizeUrl,
  config,
}
