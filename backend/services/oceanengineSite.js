/**
 * 橙子建站：上传一张图，创建一个只有图片组件的落地页并发布。
 * 图片先入广告主素材库，再调 tools/site/create，最后 update_status 发布。
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const auth = require('./oceanengineAuth')
const db = require('../db')
const { stringifyOcean } = require('./oceanengineEvent')

const API = 'https://api.oceanengine.com'
const AD = 'https://ad.oceanengine.com'
const IMAGE_UPLOAD = '/open_api/2/file/image/ad/'
const SITE_CREATE = '/open_api/2/tools/site/create/'
const SITE_STATUS = '/open_api/2/tools/site/update_status/'
const SITE_LIST = '/open_api/2/tools/site/get/'
const PAGE_WIDTH = 375
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const BATCH_LIMIT = 100
const POSTER_KEY = 'oceanengine.landing.poster'

function database() {
  return db.getDb()
}

function idText(value) {
  const text = String(value == null ? '' : value).trim()
  return /^\d+$/.test(text) ? text : ''
}

function parseOceanBody(text) {
  const safe = String(text).replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(safe)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function landingDir() {
  const dir = path.join(__dirname, '../data/landing')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function posterStore() {
  try {
    const raw = db.getAppSetting(POSTER_KEY, '')
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.filename && !Array.isArray(parsed.items)) {
      const id = crypto.createHash('md5').update(parsed.filename).digest('hex').slice(0, 16)
      const store = {
        activeId: id,
        items: [{
          id,
          filename: parsed.filename,
          mime: parsed.mime || 'image/jpeg',
          originalName: parsed.originalName || parsed.filename,
        }],
      }
      writePosterStore(store)
      return store
    }
    if (!parsed || !Array.isArray(parsed.items)) return { activeId: '', items: [] }
    return { activeId: String(parsed.activeId || ''), items: parsed.items }
  } catch {
    return { activeId: '', items: [] }
  }
}

function writePosterStore(store) {
  db.setAppSetting(POSTER_KEY, JSON.stringify({
    activeId: store.activeId || '',
    items: store.items || [],
  }))
}

function posterFile(item) {
  if (!item || !item.filename) return null
  const filePath = path.join(landingDir(), item.filename)
  if (!fs.existsSync(filePath)) return null
  return {
    buffer: fs.readFileSync(filePath),
    mimetype: item.mime || 'image/jpeg',
    originalname: item.originalName || item.filename,
    filePath,
    mime: item.mime || 'image/jpeg',
  }
}

function savePoster(file) {
  if (!file || !file.buffer || !file.buffer.length) return { error: '请上传落地页图片' }
  if (file.buffer.length > MAX_IMAGE_BYTES) return { error: '图片不能超过 2MB' }
  const ext = path.extname(file.originalname || '').toLowerCase()
  const allowed = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp' }
  const mime = allowed[ext] || ''
  if (!mime && !allowed[Object.keys(allowed).find((key) => allowed[key] === file.mimetype)]) {
    return { error: '请上传 jpg、png、gif 或 bmp' }
  }
  const useExt = ext && allowed[ext] ? (ext === '.jpeg' ? '.jpg' : ext) : '.jpg'
  const id = crypto.randomBytes(8).toString('hex')
  const filename = `${id}${useExt}`
  fs.writeFileSync(path.join(landingDir(), filename), file.buffer)
  const store = posterStore()
  store.items.push({
    id,
    filename,
    mime: allowed[ext] || 'image/jpeg',
    originalName: file.originalname || filename,
  })
  store.activeId = id
  writePosterStore(store)
  return { ready: true, activeId: id, id }
}

function setActivePoster(id) {
  const store = posterStore()
  const item = store.items.find((row) => row.id === String(id || ''))
  if (!item || !posterFile(item)) return { error: '这张图片不存在' }
  store.activeId = item.id
  writePosterStore(store)
  return { ready: true, activeId: item.id }
}

function readPoster(id) {
  const store = posterStore()
  const target = String(id || store.activeId || '')
  const item = store.items.find((row) => row.id === target) || store.items.find((row) => row.id === store.activeId)
  return posterFile(item)
}

function posterInfo() {
  const store = posterStore()
  const items = store.items
    .filter((item) => posterFile(item))
    .map((item) => ({
      id: item.id,
      name: item.originalName || item.filename,
      active: item.id === store.activeId,
    }))
  const active = items.find((item) => item.active) || null
  return { ready: !!active, activeId: active ? active.id : '', items }
}

function accountName(advertiserId) {
  const row = database().prepare('SELECT name FROM oceanengine_advertisers WHERE advertiser_id = ?').get(advertiserId)
  return (row && row.name) || ''
}

function accountLabel(advertiserId) {
  const name = accountName(advertiserId)
  return name ? `${name}（${advertiserId}）` : advertiserId
}

function imageSize(buffer) {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 10 && buffer[0] === 0x47 && buffer[1] === 0x49) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const size = buffer.readUInt16BE(offset + 2)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      if (!size) break
      offset += 2 + size
    }
  }
  return { width: PAGE_WIDTH, height: 667 }
}

function batchStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function autoSiteName(stamp, seq) {
  const tail = String(Math.abs(seq) % 100000).padStart(5, '0')
  return `落地页-${stamp}${tail}`
}

function pageHeight(size) {
  const width = Number(size && size.width) || PAGE_WIDTH
  const height = Number(size && size.height) || 667
  if (width < 1 || height < 1) return 667
  return Math.max(1, Math.min(4000, Math.round((PAGE_WIDTH * height) / width)))
}

const SITE_STATUS_LABELS = {
  ENABLE: '已上线',
  AUDIT_ACCEPTED: '审核通过',
  auditAccepted: '审核通过',
  AUDIT_DOING: '审核中',
  auditDoing: '审核中',
  AUDIT_REJECTED: '审核拒绝',
  auditRejected: '审核拒绝',
  EDIT: '未发布',
  edit: '未发布',
  DISABLE: '已下线',
  DELETE: '已删除',
  DELETED: '已删除',
  FORBIDDEN: '审核拒绝',
}

function siteStatusLabel(status) {
  const key = String(status == null ? '' : status)
  return SITE_STATUS_LABELS[key] || key || '—'
}

function toSite(row) {
  const siteId = idText(row && (row.siteId || row.site_id))
  return {
    siteId,
    name: String((row && row.name) || ''),
    status: String((row && row.status) == null ? '' : row.status),
    statusLabel: siteStatusLabel(row && row.status),
    thumbnail: String((row && row.thumbnail) || ''),
    shareType: String((row && (row.share_type || row.shareType)) || ''),
    pageUrl: siteId ? `https://www.chengzijianzhan.com/tetris/page/${siteId}/` : '',
  }
}

function rateLimited(message) {
  return /限频|40100|请求频率|频率超限|too many|rate limit/i.test(String(message || ''))
}

const MAX_INFLIGHT = 4
let inflight = 0
const slotWaiters = []
let nextStartAt = 0
let gapMs = 200
let cooledUntil = 0

function takeSlot() {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => slotWaiters.push(resolve))
}

function freeSlot() {
  const next = slotWaiters.shift()
  if (next) next()
  else inflight -= 1
}

function reserveStart() {
  const now = Date.now()
  const at = Math.max(now, nextStartAt, cooledUntil)
  nextStartAt = at + gapMs
  return at - now
}

async function paced(task) {
  await takeSlot()
  try {
    let last = { error: '巨量接口请求失败' }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wait = reserveStart()
      if (wait) await sleep(wait)
      try {
        last = await task()
      } catch (e) {
        last = { error: e.message || String(e) }
      }
      if (!last || !last.error || !rateLimited(last.error)) {
        if (last && !last.error && gapMs > 200) gapMs = Math.max(200, gapMs - 20)
        return last
      }
      gapMs = Math.min(800, gapMs + 100)
      cooledUntil = Date.now() + 400 * (attempt + 1)
    }
    return last
  } finally {
    freeSlot()
  }
}

async function oceanGetOnce(token, path, query) {
  const bases = [AD, API]
  let last = { error: '巨量接口请求失败' }
  for (const base of bases) {
    const url = new URL(base + path)
    for (const [key, value] of Object.entries(query || {})) {
      if (value == null || value === '') continue
      url.searchParams.set(key, String(value))
    }
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Access-Token': token },
        signal: AbortSignal.timeout(30000),
      })
      const json = parseOceanBody(await res.text())
      if (!json || json.code !== 0) {
        last = { error: (json && (json.message || json.msg)) || `巨量接口失败（HTTP ${res.status}）` }
        if (res.status >= 500) continue
        return last
      }
      return { data: json.data != null ? json.data : {} }
    } catch (e) {
      last = { error: `巨量接口请求失败：${e.message || e}` }
    }
  }
  return last
}

function oceanGet(token, path, query) {
  return paced(() => oceanGetOnce(token, path, query))
}

async function listAccountSites(advertiserId, { page, pageSize, search } = {}) {
  const id = idText(advertiserId)
  if (!id) return { error: '请选择账户' }
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const current = Math.max(1, parseInt(page, 10) || 1)
  const size = Math.min(100, Math.max(20, parseInt(pageSize, 10) || 20))
  const keyword = String(search || '').trim().slice(0, 50)
  const map = new Map()
  let total = 0
  let lastError = ''
  for (const shareType of ['MY_CREATIONS', 'SHARE']) {
    const result = await oceanGet(tokenResult.token, SITE_LIST, {
      advertiser_id: id,
      page: current,
      page_size: size,
      share_type: shareType,
      ...(keyword ? { search: keyword } : {}),
    })
    if (result.error) {
      lastError = result.error
      continue
    }
    const info = (result.data && result.data.page_info) || {}
    total += Number(info.total_number || info.total_count || info.total) || 0
    const list = Array.isArray(result.data.list) ? result.data.list : []
    for (const row of list.map(toSite)) {
      if (row.siteId) map.set(`${shareType}:${row.siteId}`, { ...row, shareType })
    }
  }
  const list = [...map.values()]
  if (!list.length && lastError) return { error: lastError }
  return { list, total: total || list.length, page: current, pageSize: size }
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length)
  let next = 0
  const size = Math.min(limit, items.length)
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        out[index] = await worker(items[index])
      }
    }),
  )
  return out
}

async function listCreatedSites(token, advertiserId) {
  const result = await oceanGet(token, SITE_LIST, {
    advertiser_id: advertiserId,
    page: 1,
    page_size: 20,
    share_type: 'MY_CREATIONS',
  })
  if (result.error) return result
  const info = (result.data && result.data.page_info) || {}
  const list = (Array.isArray(result.data.list) ? result.data.list : []).map(toSite).filter((row) => row.siteId)
  const total = Number(info.total_number || info.total_count || info.total) || list.length
  return { list, total }
}

async function summarizeAccountSites(advertiserIds) {
  const ids = []
  const seen = new Set()
  for (const raw of Array.isArray(advertiserIds) ? advertiserIds : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (!ids.length) return { error: '请选择账户' }
  if (ids.length > 20) return { error: '一次最多查询 20 个账户的落地页' }
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const list = await mapLimit(ids, 4, async (advertiserId) => {
    const found = await listCreatedSites(tokenResult.token, advertiserId)
    if (found.error) return { advertiserId, total: 0, sites: [], error: found.error }
    return { advertiserId, total: found.total, sites: found.list, error: '' }
  })
  return { list }
}

async function oceanJson(token, method, path, body, bases) {
  let last = { error: '巨量接口请求失败' }
  for (const base of bases) {
    try {
      const res = await fetch(base + path, {
        method,
        headers: {
          'Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: stringifyOcean(body),
        signal: AbortSignal.timeout(30000),
      })
      const json = parseOceanBody(await res.text())
      if (!json || json.code !== 0) {
        last = { error: (json && (json.message || json.msg)) || `巨量接口失败（HTTP ${res.status}）` }
        if (res.status >= 500) continue
        return last
      }
      return { data: json.data != null ? json.data : {} }
    } catch (e) {
      last = { error: `巨量接口请求失败：${e.message || e}` }
    }
  }
  return last
}

async function uploadAdImage(token, advertiserId, file) {
  const form = new FormData()
  form.append('advertiser_id', advertiserId)
  form.append('upload_type', 'UPLOAD_BY_FILE')
  form.append('image_signature', crypto.createHash('md5').update(file.buffer).digest('hex'))
  form.append('filename', file.originalname || 'landing.jpg')
  form.append('image_file', new Blob([file.buffer], { type: file.mimetype || 'image/jpeg' }), file.originalname || 'landing.jpg')
  let res
  try {
    res = await fetch(API + IMAGE_UPLOAD, {
      method: 'POST',
      headers: { 'Access-Token': token },
      body: form,
      signal: AbortSignal.timeout(30000),
    })
  } catch (e) {
    return { error: `上传图片失败：${e.message || e}` }
  }
  let json
  try {
    json = parseOceanBody(await res.text())
  } catch {
    return { error: `上传图片失败（HTTP ${res.status}）` }
  }
  if (!json || json.code !== 0) return { error: (json && (json.message || json.msg)) || '上传图片失败' }
  const data = json.data || {}
  const imageId = idText(data.id || data.image_id)
  const imageUrl = String(data.url || data.image_url || '')
  if (!imageId && !imageUrl) return { error: '图片已上传，但没有拿到图片 ID' }
  return {
    imageId,
    imageUrl,
    width: Number(data.width) || 0,
    height: Number(data.height) || 0,
  }
}

async function createOne(token, advertiserId, file, siteName, fallbackSize) {
  const base = {
    advertiserId,
    accountName: accountLabel(advertiserId),
    assetName: siteName,
    eventName: '落地页',
    status: 'fail',
    message: '',
  }
  const uploaded = await uploadAdImage(token, advertiserId, file)
  if (uploaded.error) return { ...base, message: uploaded.error }
  const height = pageHeight(uploaded.width ? uploaded : fallbackSize)
  const picture = {
    name: 'XrPicture',
    width: PAGE_WIDTH,
    height,
    is_cover: 1,
  }
  if (uploaded.imageUrl) picture.image_url = uploaded.imageUrl
  else picture.ic_id = uploaded.imageId
  const created = await oceanJson(token, 'POST', SITE_CREATE, {
    advertiser_id: advertiserId,
    name: siteName,
    bricks: [picture],
  }, [AD, API])
  if (created.error) return { ...base, message: created.error }
  const siteId = idText(created.data.site_id || created.data.siteId)
  if (!siteId) return { ...base, message: '落地页已提交，但没有拿到站点 ID' }
  const published = await oceanJson(token, 'POST', SITE_STATUS, {
    advertiser_id: advertiserId,
    site_ids: [siteId],
    status: 'published',
  }, [AD, API])
  const pageUrl = `https://www.chengzijianzhan.com/tetris/page/${siteId}/`
  if (published.error) return { ...base, assetName: siteName, message: `已创建，发布失败：${published.error}`, siteId, pageUrl }
  const failed = Array.isArray(published.data.fail) ? published.data.fail : []
  if (failed.length) {
    const reason = failed.map((item) => item.message || item.site_id).filter(Boolean).join('；') || '发布失败'
    return { ...base, message: `已创建，发布失败：${reason}`, siteId, pageUrl }
  }
  console.log('[oceanengine] orange site published', { advertiserId, siteId })
  return { ...base, status: 'added', message: '已发布', siteId, pageUrl }
}

function summarize(results, extra) {
  return {
    results,
    added: results.filter((row) => row.status === 'added').length,
    skipped: results.filter((row) => row.status === 'skip').length,
    failed: results.filter((row) => row.status === 'fail').length,
    ...extra,
  }
}

async function generateSites(advertiserIds) {
  const file = readPoster()
  if (!file) return { error: '请先配置落地页图片' }
  const ids = []
  const seen = new Set()
  for (const raw of Array.isArray(advertiserIds) ? advertiserIds : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (!ids.length) return { error: '请选择账户' }
  if (ids.length > BATCH_LIMIT) return { error: `一次最多 ${BATCH_LIMIT} 个账户` }
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const pending = []
  const results = []
  for (const advertiserId of ids) {
    const found = await listCreatedSites(tokenResult.token, advertiserId)
    if (found.error) {
      results.push({
        advertiserId,
        accountName: accountLabel(advertiserId),
        assetName: '',
        eventName: '落地页',
        status: 'fail',
        message: found.error,
      })
      if (/授权|access_token|无权限|权限不足|白名单/i.test(found.error)) {
        return summarize(results, { stopped: found.error })
      }
      continue
    }
    if (found.total > 0 || (found.list && found.list.length)) {
      const site = found.list[0] || {}
      results.push({
        advertiserId,
        accountName: accountLabel(advertiserId),
        assetName: site.name || '',
        eventName: '落地页',
        status: 'skip',
        message: '已有落地页',
        siteId: site.siteId || '',
        pageUrl: site.pageUrl || '',
      })
      continue
    }
    pending.push(advertiserId)
  }
  if (!pending.length) return summarize(results)
  const created = await createImageSites({ advertiserIds: pending, file })
  if (created.error) return created
  return summarize([...(created.results || []), ...results], { stopped: created.stopped || '' })
}

async function createImageSites({ advertiserIds, names, name, file } = {}) {
  if (!file || !file.buffer || !file.buffer.length) return { error: '请上传落地页图片' }
  if (file.buffer.length > MAX_IMAGE_BYTES) return { error: '图片不能超过 2MB，橙子建站只收 2MB 以内的图' }
  const ids = []
  const seen = new Set()
  for (const raw of Array.isArray(advertiserIds) ? advertiserIds : []) {
    const id = idText(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  if (!ids.length) return { error: '请勾选账户' }
  if (ids.length > BATCH_LIMIT) return { error: `一次最多 ${BATCH_LIMIT} 个账户` }
  const customName = String(name || '').trim().slice(0, 50)
  const given = Array.isArray(names) ? names.map((item) => String(item || '').trim().slice(0, 50)) : []
  const stamp = batchStamp()
  const seqBase = Number(String(Date.now()).slice(-5))
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const size = imageSize(file.buffer)
  const results = []
  let stopped = ''
  for (let index = 0; index < ids.length; index += 1) {
    if (stopped) break
    const advertiserId = ids[index]
    const siteName = given[index] || customName || autoSiteName(stamp, seqBase + index)
    const row = await createOne(tokenResult.token, advertiserId, file, siteName, size)
    results.push(row)
    if (/授权|access_token|无权限|权限不足/i.test(row.message)) stopped = row.message
    else await sleep(200)
  }
  console.log('[oceanengine] orange sites', { accounts: ids.length, stopped: !!stopped })
  return summarize(results, { stopped })
}

module.exports = {
  listAccountSites,
  summarizeAccountSites,
  createImageSites,
  generateSites,
  savePoster,
  setActivePoster,
  readPoster,
  posterInfo,
  imageSize,
  pageHeight,
  autoSiteName,
  batchStamp,
}
