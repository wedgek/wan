/**
 * 点众书城推广链接：创建 / 查询 / 更新。
 * 签名：md5(clientId + token + timestamp) 小写。密钥只读环境变量。
 * DIANZHONG_CHANNEL_ID 支持多个投放账号：117110:巨量1,117111:巨量2
 */
const crypto = require('crypto')

const DEFAULT_BASE = 'https://video.wqxsw.com'
const MEDIA_SOURCES = new Set(['dy', 'ks', 'bd', 'adq', 'no_back'])

function parseChannels(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return []
  const seen = new Set()
  const out = []
  for (const part of s.split(',')) {
    const item = String(part || '').trim()
    if (!item) continue
    const colon = item.indexOf(':')
    const id = (colon > 0 ? item.slice(0, colon) : item).trim()
    const label = (colon > 0 ? item.slice(colon + 1) : '').trim() || id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label })
  }
  return out
}

function config() {
  const clientId = String(process.env.DIANZHONG_CLIENT_ID || '').trim()
  const token = String(process.env.DIANZHONG_TOKEN || '').trim()
  const channels = parseChannels(process.env.DIANZHONG_CHANNEL_ID)
  const base = String(process.env.DIANZHONG_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '')
  return { clientId, token, channels, base }
}

function listChannels() {
  return config().channels
}

function findChannel(channelId) {
  const id = String(channelId || '').trim()
  if (!id) return null
  return listChannels().find((c) => c.id === id) || null
}

function assertConfig() {
  const cfg = config()
  if (!cfg.clientId || !cfg.token) {
    return { error: '未配置点众接口，请在 backend/.env 填写 DIANZHONG_CLIENT_ID 与 DIANZHONG_TOKEN' }
  }
  if (!cfg.channels.length) {
    return { error: '未填写点众投放账号，请在 backend/.env 的 DIANZHONG_CHANNEL_ID 填写，格式如 117110:巨量1,117111:巨量2' }
  }
  return { cfg }
}

function signKey(clientId, token, timestamp) {
  return crypto.createHash('md5').update(`${clientId}${token}${timestamp}`).digest('hex')
}

function asInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : v
}

function authBody(channelId) {
  const { clientId, token } = config()
  const timestamp = Math.floor(Date.now() / 1000)
  return {
    clientId: asInt(clientId),
    channelId: asInt(channelId),
    timestamp,
    signKey: signKey(clientId, token, String(timestamp)),
  }
}

async function postJson(path, extra, channelId) {
  const ready = assertConfig()
  if (ready.error) return { error: ready.error }
  const id = String(channelId || '').trim()
  if (!id) return { error: '请选择投放账号' }
  if (!ready.cfg.channels.some((c) => c.id === id)) {
    return { error: '投放账号不在已配置列表中' }
  }
  const url = `${ready.cfg.base}${path}`
  const body = { ...authBody(id), ...extra }
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return { error: `点众接口请求失败：${e.message || e}` }
  }
  let json
  try {
    json = await res.json()
  } catch {
    return { error: `点众接口返回不是 JSON（HTTP ${res.status}）` }
  }
  const code = json && json.code
  if (code !== 1) {
    return { error: (json && (json.msg || json.message)) || `点众接口失败（code=${code}）`, raw: json }
  }
  return { data: json.data != null ? json.data : json, raw: json }
}

function normalizeMediaSource(raw) {
  const s = String(raw || 'dy').trim().toLowerCase()
  return MEDIA_SOURCES.has(s) ? s : 'dy'
}

async function createReferral(input) {
  const bookId = String(input.bookId || '').trim()
  const name = String(input.name || '').trim()
  if (!bookId) return { error: '缺少书籍ID' }
  if (!name) return { error: '请填写链接名称' }
  const chapterIdx = Math.min(20, Math.max(1, parseInt(input.chapterIdx, 10) || 1))
  const extra = {
    bookId: asInt(bookId),
    chapterIdx,
    name: name.slice(0, 60),
    mediaSource: normalizeMediaSource(input.mediaSource),
  }
  const fromDrId = String(input.fromDrId || '').trim()
  if (fromDrId) extra.fromDrId = fromDrId
  if (input.batchId) extra.batchId = String(input.batchId)
  if (input.callbackConfigId) extra.CallbackConfigId = String(input.callbackConfigId)
  if (input.chapterChargeStart != null) extra.chapterChargeStart = Number(input.chapterChargeStart) || 0
  if (input.chapterKandian != null) extra.chapterKandian = Number(input.chapterKandian) || 0
  return postJson('/api/channelapi/referralsave', extra, input.channelId)
}

async function listReferrals(input = {}) {
  const extra = {}
  extra.page = Math.max(1, parseInt(input.page, 10) || 1)
  extra.size = Math.min(200, Math.max(1, parseInt(input.size, 10) || 100))
  if (input.bookId) extra.bookId = asInt(input.bookId)
  if (input.chapterIdx) extra.chapterIdx = asInt(input.chapterIdx)
  if (input.referralId) extra.referralId = asInt(input.referralId)
  if (input.startTime) extra.startTime = asInt(input.startTime)
  if (input.endTime) extra.endTime = asInt(input.endTime)
  return postJson('/api/channelapi/referrallist', extra, input.channelId)
}

async function updateReferral(input) {
  const referralId = String(input.referralId || '').trim()
  if (!referralId) return { error: '缺少推广链接ID' }
  const extra = { referralId }
  if (input.batchId != null) extra.batchId = String(input.batchId)
  if (input.callbackConfigId != null) extra.CallbackConfigId = String(input.callbackConfigId)
  if (input.chapterChargeStart != null) extra.chapterChargeStart = String(input.chapterChargeStart)
  if (input.chapterKandian != null) extra.chapterKandian = String(input.chapterKandian)
  return postJson('/api/channelapi/referralupdate', extra, input.channelId)
}

module.exports = {
  MEDIA_SOURCES,
  parseChannels,
  config,
  listChannels,
  findChannel,
  assertConfig,
  signKey,
  normalizeMediaSource,
  createReferral,
  listReferrals,
  updateReferral,
}
