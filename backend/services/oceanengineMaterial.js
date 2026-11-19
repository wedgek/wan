/**
 * 升级版工作台视频上传。
 * 本地文件按原字节转发：只算 MD5、不转码、不改封装。
 */
const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const path = require('path')
const db = require('../db')
const auth = require('./oceanengineAuth')

const API = 'https://api.oceanengine.com'
const UPLOAD = '/open_api/v3.0/tools/ebp/video/upload/'
const LEVEL = '/open_api/2/ebp/level/get/'
const AUTH_ACCOUNTS = '/open_api/oauth2/advertiser/get/'
const MAX_BYTES = 500 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000
const ALLOWED_EXT = new Set(['.mp4', '.mpeg', '.mpg', '.3gp', '.avi'])

// 巨量没有批量上传。同时开多条连接才能把上行打满。默认 4 路，环境变量最高 6。
const UPLOAD_CONCURRENCY = Math.min(
  6,
  Math.max(1, Number(process.env.OCEANENGINE_UPLOAD_CONCURRENCY) || 4),
)

function createLimiter(limit) {
  let active = 0
  const queue = []
  function acquire() {
    if (active < limit) {
      active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => queue.push(resolve))
  }
  function release() {
    active -= 1
    const next = queue.shift()
    if (next) {
      active += 1
      next()
    }
  }
  return async function run(fn) {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

const withSlot = createLimiter(UPLOAD_CONCURRENCY)

function database() {
  return db.getDb()
}

function parseOceanBody(text) {
  const safe = String(text).replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(safe)
}

function decodeFilename(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  if ([...raw].some((ch) => ch.charCodeAt(0) > 255)) return raw
  const decoded = Buffer.from(raw, 'latin1').toString('utf8')
  if (!decoded || decoded.includes('\uFFFD')) return raw
  return decoded
}

function safeFilename(name) {
  const base = path.basename(decodeFilename(name) || 'video.mp4').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  const text = base || 'video.mp4'
  return text.length > 255 ? text.slice(text.length - 255) : text
}

function videoExt(name) {
  return path.extname(safeFilename(name)).toLowerCase()
}

function acceptVideoName(name) {
  return ALLOWED_EXT.has(videoExt(name))
}

function removeTemp(filePath) {
  if (!filePath) return
  fs.promises.unlink(filePath).catch(() => {})
}

function stoppedError() {
  const error = new Error('已停止')
  error.stopped = true
  return error
}

function md5File(filePath, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(stoppedError())
      return
    }
    const hash = crypto.createHash('md5')
    const input = fs.createReadStream(filePath)
    const onAbort = () => {
      input.destroy()
      reject(stoppedError())
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    input.on('error', (error) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (signal && signal.aborted) reject(stoppedError())
      else reject(error)
    })
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve(hash.digest('hex'))
    })
  })
}

function mimeOf(ext) {
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mpeg' || ext === '.mpg') return 'video/mpeg'
  if (ext === '.3gp') return 'video/3gpp'
  if (ext === '.avi') return 'video/x-msvideo'
  return 'application/octet-stream'
}

function textOf(value) {
  if (value == null) return ''
  return String(value).trim()
}

function numberOf(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function listOrgs() {
  return database()
    .prepare(
      `SELECT org_id AS id, MAX(org_name) AS name, COUNT(*) AS accounts
       FROM oceanengine_advertisers
       WHERE org_id != ''
       GROUP BY org_id
       ORDER BY accounts DESC, name`,
    )
    .all()
    .map((row) => ({
      id: String(row.id),
      name: String(row.name || '').trim(),
      accounts: Number(row.accounts) || 0,
    }))
}

async function readOcean(token, url) {
  const res = await fetch(url, {
    headers: { 'Access-Token': token },
    signal: AbortSignal.timeout(20000),
  })
  const json = parseOceanBody(await res.text())
  if (!json || json.code !== 0) return null
  return json.data || {}
}

async function authorizedRoots(token) {
  const data = await readOcean(token, `${API}${AUTH_ACCOUNTS}?access_token=${encodeURIComponent(token)}`)
  const list = (data && data.list) || []
  return list
    .filter((row) => String(row.account_role || '').includes('ENTERPRISE_BP') || Number(row.advertiser_role) === 17)
    .map((row) => ({
      id: textOf(row.account_id || row.advertiser_id),
      name: textOf(row.account_name || row.advertiser_name),
      parentName: '',
    }))
    .filter((row) => row.id)
}

async function childOrgs(token, orgId, parentName, walked) {
  if (!orgId || walked.has(orgId)) return []
  walked.add(orgId)
  const data = await readOcean(token, `${API}${LEVEL}?enterprise_organization_id=${orgId}`)
  const list = (data && data.sub_team) || []
  const out = []
  for (const team of list) {
    const id = textOf(team.team_id)
    const name = textOf(team.team_name)
    if (!id) continue
    out.push({ id, name, parentName })
    out.push(...(await childOrgs(token, id, name || parentName, walked)))
  }
  return out
}

async function targets() {
  const tokenResult = await auth.getAccessToken()
  const local = listOrgs()
  const orgs = []
  const seen = new Set()
  function pushOrg(row) {
    const id = textOf(row && row.id)
    if (!id || seen.has(id)) return
    seen.add(id)
    const known = local.find((item) => item.id === id)
    orgs.push({
      id,
      name: textOf(row.name) || (known && known.name) || '',
      parentName: textOf(row.parentName),
      accounts: (known && known.accounts) || 0,
    })
  }
  if (!tokenResult.error && tokenResult.token) {
    try {
      const roots = await authorizedRoots(tokenResult.token)
      const appOrg = textOf(tokenResult.accountId)
      if (!roots.length && appOrg) roots.push({ id: appOrg, name: '', parentName: '' })
      for (const root of roots) {
        pushOrg(root)
        const children = await childOrgs(tokenResult.token, root.id, root.name, new Set())
        children.forEach(pushOrg)
      }
    } catch (e) {
      console.error('[oceanengine] org names', e.message)
    }
  }
  local.forEach((row) => pushOrg(row))
  const appOrg = textOf(tokenResult.accountId)
  if (appOrg) pushOrg({ id: appOrg, name: '', parentName: '' })
  const orgId = appOrg && orgs.some((row) => row.id === appOrg) ? appOrg : (orgs[0] && orgs[0].id) || ''
  return {
    authorized: !tokenResult.error,
    message: tokenResult.error || '',
    orgs,
    orgId,
    concurrency: UPLOAD_CONCURRENCY,
  }
}

function saveRecord(input) {
  const row = input || {}
  database()
    .prepare(
      `INSERT INTO oceanengine_upload_records (
         user_id, task_key, org_id, org_name, filename, local_size, remote_size, size_matched,
         status, error, video_id, material_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      Number(row.userId) || 0,
      textOf(row.taskKey).slice(0, 64),
      textOf(row.orgId),
      textOf(row.orgName).slice(0, 100),
      textOf(row.filename).slice(0, 255),
      Number(row.localSize) || 0,
      Number(row.remoteSize) || 0,
      row.sizeMatched == null ? null : row.sizeMatched ? 1 : 0,
      textOf(row.status).slice(0, 20),
      textOf(row.error).slice(0, 300),
      textOf(row.videoId),
      textOf(row.materialId),
    )
}

function listRecords(userId, query) {
  const pageSize = Math.min(200, Math.max(1, Number(query && query.pageSize) || 20))
  const page = Math.max(1, Number(query && query.page) || 1)
  const d = database()
  const user = Number(userId) || 0
  const total = d.prepare('SELECT COUNT(*) AS n FROM oceanengine_upload_records WHERE user_id = ?').get(user).n
  const offset = (page - 1) * pageSize
  const list = d
    .prepare(
      `SELECT id, task_key, org_id, org_name, filename, local_size, remote_size, size_matched,
              status, error, video_id, material_id, created_at
       FROM oceanengine_upload_records
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(user, pageSize, offset)
    .map((row) => ({
      id: row.id,
      taskKey: row.task_key || '',
      orgId: row.org_id || '',
      orgName: row.org_name || '',
      filename: row.filename || '',
      localSize: Number(row.local_size) || 0,
      remoteSize: Number(row.remote_size) || 0,
      sizeMatched: row.size_matched == null ? null : row.size_matched === 1,
      status: row.status || '',
      error: row.error || '',
      videoId: row.video_id || '',
      materialId: row.material_id || '',
      createdAt: row.created_at || '',
    }))
  return { list, total, page, pageSize }
}

function formField(boundary, name, value) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
}

function filePartHeader(boundary, filename, mime) {
  const encoded = encodeURIComponent(filename)
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="video_file"; filename="${encoded}"; filename*=UTF-8''${encoded}\r\nContent-Type: ${mime}\r\n\r\n`,
  )
}

function postOceanFile({ token, accountId, filename, mime, filePath, bytes, signature, signal, onProgress }) {
  const boundary = `WanOcean${crypto.randomBytes(8).toString('hex')}`
  const head = Buffer.concat([
    formField(boundary, 'account_id', accountId),
    formField(boundary, 'account_type', 'EBP'),
    formField(boundary, 'upload_type', 'UPLOAD_BY_FILE'),
    formField(boundary, 'video_signature', signature),
    formField(boundary, 'filename', filename),
  ])
  const fileHead = filePartHeader(boundary, filename, mime)
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }
    const req = https.request(
      {
        hostname: 'api.oceanengine.com',
        path: UPLOAD,
        method: 'POST',
        headers: {
          'Access-Token': token,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': head.length + fileHead.length + bytes + tail.length,
        },
        timeout: UPLOAD_TIMEOUT_MS,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => finish(null, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    let input = null
    const fail = (error) => {
      if (input) input.destroy()
      req.destroy()
      finish(error)
    }
    req.on('error', (error) => finish(error && error.stopped ? stoppedError() : error))
    req.on('timeout', () => fail(Object.assign(new Error('传到巨量超时'), { name: 'TimeoutError' })))
    if (signal) {
      const onAbort = () => fail(stoppedError())
      if (signal.aborted) {
        fail(stoppedError())
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      req.on('close', () => signal.removeEventListener('abort', onAbort))
    }
    req.write(head)
    req.write(fileHead)
    input = fs.createReadStream(filePath)
    let sent = 0
    let lastReport = 0
    input.on('data', (chunk) => {
      if (settled) return
      sent += chunk.length
      const now = Date.now()
      if (onProgress && bytes > 0 && (now - lastReport >= 250 || sent >= bytes)) {
        lastReport = now
        onProgress(Math.min(1, sent / bytes))
      }
      if (!req.write(chunk)) input.pause()
    })
    req.on('drain', () => input.resume())
    input.on('error', fail)
    input.on('end', () => {
      if (onProgress) onProgress(1)
      req.end(tail)
    })
  })
}

async function uploadLocalFile({ filePath, filename, size, orgId, signal, onProgress }) {
  const name = safeFilename(filename)
  if (!acceptVideoName(name)) return { error: '只接收 mp4、mpeg、3gp、avi 原文件，不会转成别的格式' }
  let bytes = 0
  try {
    bytes = (await fs.promises.stat(filePath)).size
  } catch {
    bytes = Number(size) || 0
  }
  if (!filePath || bytes < 1) return { error: '文件是空的' }
  if (bytes > MAX_BYTES) return { error: '单个视频不能超过 500MB' }
  const tokenResult = await auth.getAccessToken()
  if (tokenResult.error) return tokenResult
  const accountId = String(orgId || tokenResult.accountId || '').trim()
  if (!/^\d+$/.test(accountId)) return { error: '请选择要上传的组织' }

  let signature
  try {
    signature = await md5File(filePath, signal)
  } catch (e) {
    if (e && e.stopped) return { error: '上传被中断，文件还没进巨量', stopped: true }
    return { error: `计算校验失败：${e.message || e}` }
  }
  if (signal && signal.aborted) return { error: '上传被中断，文件还没进巨量', stopped: true }
  const ext = videoExt(name)
  let posted
  try {
    posted = await postOceanFile({
      token: tokenResult.token,
      accountId,
      filename: name,
      mime: mimeOf(ext),
      filePath,
      bytes,
      signature,
      signal,
      onProgress,
    })
  } catch (e) {
    if ((signal && signal.aborted) || (e && e.stopped)) return { error: '上传被中断，文件还没进巨量', stopped: true }
    const timedOut = e && (e.name === 'TimeoutError' || e.code === 'ETIMEDOUT')
    return { error: timedOut ? '传到巨量超时，请稍后重试' : `传到巨量失败：${e.message || e}` }
  }

  let json
  try {
    json = parseOceanBody(posted.body)
  } catch {
    return { error: `巨量返回不是 JSON（HTTP ${posted.status}）` }
  }
  if (!json || json.code !== 0) {
    return { error: (json && (json.message || json.msg)) || `上传失败（code=${json && json.code}）` }
  }
  const data = json.data || {}
  const remoteSize = numberOf(data.size)
  const videoId = textOf(data.video_id)
  if (!videoId) return { error: '上传成功但未返回视频 ID' }
  console.log('[oceanengine] video upload', {
    orgId: accountId,
    filename: name,
    bytes,
    remoteSize,
    videoId,
    materialId: textOf(data.material_id),
  })
  return {
    filename: name,
    orgId: accountId,
    videoId,
    materialId: textOf(data.material_id),
    localSize: bytes,
    remoteSize,
    sizeMatched: remoteSize > 0 ? remoteSize === bytes : null,
    width: numberOf(data.width),
    height: numberOf(data.height),
    duration: numberOf(data.duration),
    signature: textOf(data.video_signature) || signature,
  }
}

const taskAborts = new Map()
const stoppedTaskIds = new Set()
let taskWorkers = 0

function uploadRoot() {
  const dir = path.join(__dirname, '../data/ocean-uploads')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function taskFolder(taskId) {
  const dir = path.join(uploadRoot(), String(taskId))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function createUploadTask({ userId, orgId, orgName }) {
  const id = textOf(orgId)
  if (!/^\d+$/.test(id)) return { error: '请选择要上传的组织' }
  const info = database()
    .prepare(
      `INSERT INTO oceanengine_upload_tasks (user_id, org_id, org_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'running', datetime('now'), datetime('now'))`,
    )
    .run(Number(userId) || 0, id, textOf(orgName).slice(0, 100))
  return { id: Number(info.lastInsertRowid) }
}

function readTask(taskId, userId) {
  return database()
    .prepare('SELECT * FROM oceanengine_upload_tasks WHERE id = ? AND user_id = ?')
    .get(Number(taskId), Number(userId) || 0)
}

function acceptTaskFile({ taskId, userId, tempPath, filename, size }) {
  const task = readTask(taskId, userId)
  if (!task) return { error: '任务不存在' }
  if (task.status !== 'running') return { error: '这个任务已经结束' }
  const name = safeFilename(filename)
  if (!acceptVideoName(name)) return { error: '只接收 mp4、mpeg、3gp、avi 原文件' }
  const info = database()
    .prepare(
      `INSERT INTO oceanengine_upload_task_items (task_id, filename, local_size, status, created_at, updated_at)
       VALUES (?, ?, ?, 'waiting', datetime('now'), datetime('now'))`,
    )
    .run(task.id, name, Number(size) || 0)
  const itemId = Number(info.lastInsertRowid)
  const dest = path.join(taskFolder(task.id), `${itemId}${path.extname(name)}`)
  try {
    try {
      fs.renameSync(tempPath, dest)
    } catch {
      fs.copyFileSync(tempPath, dest)
      fs.unlinkSync(tempPath)
    }
  } catch (e) {
    database().prepare('DELETE FROM oceanengine_upload_task_items WHERE id = ?').run(itemId)
    return { error: '保存视频失败' }
  }
  database()
    .prepare('UPDATE oceanengine_upload_task_items SET file_path = ? WHERE id = ?')
    .run(dest, itemId)
  pumpTasks()
  return { id: itemId, filename: name }
}

function publicItem(row) {
  return {
    id: row.id,
    filename: row.filename || '',
    localSize: Number(row.local_size) || 0,
    status: row.status || '',
    error: row.error || '',
    videoId: row.video_id || '',
    materialId: row.material_id || '',
    updatedAt: row.updated_at || '',
  }
}

function listActiveTasks(userId) {
  const tasks = database()
    .prepare(
      `SELECT * FROM oceanengine_upload_tasks
       WHERE user_id = ?
         AND (
           dismissed = 0
           AND (
           status = 'running'
           OR (
             status = 'done'
             AND EXISTS (
               SELECT 1 FROM oceanengine_upload_task_items
               WHERE task_id = oceanengine_upload_tasks.id AND status = 'fail'
             )
           )
           )
         )
       ORDER BY id DESC`,
    )
    .all(Number(userId) || 0)
  return tasks.map((task) => {
    const items = database()
      .prepare(
        `SELECT id, filename, local_size, status, error, video_id, material_id, updated_at
         FROM oceanengine_upload_task_items WHERE task_id = ? ORDER BY id`,
      )
      .all(task.id)
      .map(publicItem)
    const done = items.filter((item) => item.status === 'success' || item.status === 'fail' || item.status === 'stopped').length
    return {
      id: task.id,
      orgId: task.org_id || '',
      orgName: task.org_name || '',
      createdAt: task.created_at || '',
      status: task.status,
      total: items.length,
      done,
      items,
    }
  })
}

function finishTaskIfIdle(taskId) {
  const left = database()
    .prepare(
      `SELECT COUNT(*) AS n FROM oceanengine_upload_task_items
       WHERE task_id = ? AND status IN ('waiting', 'uploading')`,
    )
    .get(taskId).n
  if (left) return
  database()
    .prepare(`UPDATE oceanengine_upload_tasks SET status = 'done', updated_at = datetime('now') WHERE id = ? AND status = 'running'`)
    .run(taskId)
}

function settleItem(item, result) {
  const stopped = !!(result && result.stopped) || stoppedTaskIds.has(item.task_id)
  const status = stopped ? 'stopped' : result && result.error ? 'fail' : 'success'
  const error = stopped ? ((result && result.error) || '已停止') : (result && result.error) || ''
  database()
    .prepare(
      `UPDATE oceanengine_upload_task_items
       SET status = ?, error = ?, video_id = ?, material_id = ?, remote_size = ?, size_matched = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(
      status,
      String(error).slice(0, 300),
      textOf(result && result.videoId),
      textOf(result && result.materialId),
      Number(result && result.remoteSize) || 0,
      result && result.sizeMatched == null ? null : result && result.sizeMatched ? 1 : 0,
      item.id,
    )
  const task = database().prepare('SELECT * FROM oceanengine_upload_tasks WHERE id = ?').get(item.task_id)
  saveRecord({
    userId: task ? task.user_id : 0,
    taskKey: String(item.task_id),
    orgId: task ? task.org_id : '',
    orgName: task ? task.org_name : '',
    filename: item.filename,
    localSize: item.local_size,
    remoteSize: result && result.remoteSize,
    sizeMatched: result && result.sizeMatched,
    status,
    error,
    videoId: result && result.videoId,
    materialId: result && result.materialId,
  })
  if (item.file_path && status !== 'fail') fs.promises.unlink(item.file_path).catch(() => {})
  finishTaskIfIdle(item.task_id)
}

function retryUploadItem(taskId, itemId, userId) {
  const task = readTask(taskId, userId)
  if (!task) return { error: '任务不存在' }
  const item = database()
    .prepare('SELECT * FROM oceanengine_upload_task_items WHERE id = ? AND task_id = ?')
    .get(Number(itemId), task.id)
  if (!item) return { error: '文件不存在' }
  if (item.status !== 'fail') return { error: '这个文件没有失败' }
  if (!item.file_path || !fs.existsSync(item.file_path)) return { error: '原文件已经不在了，请重新选择上传' }
  database()
    .prepare(
      `UPDATE oceanengine_upload_task_items
       SET status = 'waiting', error = '', video_id = '', material_id = '', updated_at = datetime('now')
       WHERE id = ? AND status = 'fail'`,
    )
    .run(item.id)
  database()
    .prepare(`UPDATE oceanengine_upload_tasks SET status = 'running', dismissed = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(task.id)
  stoppedTaskIds.delete(task.id)
  pumpTasks()
  return { id: item.id }
}

function claimNextItem() {
  const d = database()
  const row = d
    .prepare(
      `SELECT i.*, t.org_id, t.user_id
       FROM oceanengine_upload_task_items i
       JOIN oceanengine_upload_tasks t ON t.id = i.task_id
       WHERE i.status = 'waiting' AND t.status = 'running'
       ORDER BY i.id
       LIMIT 1`,
    )
    .get()
  if (!row) return null
  const changed = d
    .prepare(`UPDATE oceanengine_upload_task_items SET status = 'uploading', updated_at = datetime('now') WHERE id = ? AND status = 'waiting'`)
    .run(row.id)
  if (!changed.changes) return claimNextItem()
  return row
}

async function processItem(item) {
  if (stoppedTaskIds.has(item.task_id) || !item.file_path || !fs.existsSync(item.file_path)) {
    settleItem(item, { error: item.file_path ? '已停止' : '文件不在了', stopped: !!item.file_path && stoppedTaskIds.has(item.task_id) })
    return
  }
  const ac = new AbortController()
  taskAborts.set(item.id, ac)
  try {
    const result = await uploadLocalFile({
      filePath: item.file_path,
      filename: item.filename,
      size: item.local_size,
      orgId: item.org_id,
      signal: ac.signal,
    })
    settleItem(item, result)
  } catch (e) {
    settleItem(item, { error: e.message || '上传失败' })
  } finally {
    taskAborts.delete(item.id)
  }
}

function pumpTasks() {
  while (taskWorkers < UPLOAD_CONCURRENCY) {
    const item = claimNextItem()
    if (!item) return
    taskWorkers += 1
    processItem(item).finally(() => {
      taskWorkers -= 1
      pumpTasks()
    })
  }
}

function stopUploadItem(taskId, itemId, userId) {
  const task = readTask(taskId, userId)
  if (!task) return { error: '任务不存在' }
  const item = database()
    .prepare('SELECT * FROM oceanengine_upload_task_items WHERE id = ? AND task_id = ?')
    .get(Number(itemId), task.id)
  if (!item) return { error: '文件不存在' }
  if (item.status === 'waiting') {
    const changed = database()
      .prepare(`UPDATE oceanengine_upload_task_items SET status = 'stopped', error = '已取消', updated_at = datetime('now') WHERE id = ? AND status = 'waiting'`)
      .run(item.id)
    if (changed.changes) {
      settleItem({ ...item, status: 'stopped' }, { stopped: true, error: '已取消' })
      return { id: item.id }
    }
  }
  const current = database().prepare('SELECT * FROM oceanengine_upload_task_items WHERE id = ?').get(item.id)
  if (current && current.status === 'uploading') {
    const ac = taskAborts.get(current.id)
    if (ac) ac.abort()
  }
  return { id: item.id }
}

function dismissUploadTask(taskId, userId) {
  const task = readTask(taskId, userId)
  if (!task) return { error: '任务不存在' }
  const left = database()
    .prepare(`SELECT COUNT(*) AS n FROM oceanengine_upload_task_items WHERE task_id = ? AND status IN ('waiting', 'uploading')`)
    .get(task.id).n
  if (left) return { error: '还有文件在上传，先停止再关闭' }
  database().prepare(`UPDATE oceanengine_upload_tasks SET dismissed = 1, updated_at = datetime('now') WHERE id = ?`).run(task.id)
  return { id: task.id }
}

function stopUploadTask(taskId, userId) {
  const task = readTask(taskId, userId)
  if (!task) return { error: '任务不存在' }
  stoppedTaskIds.add(task.id)
  database().prepare(`UPDATE oceanengine_upload_tasks SET status = 'stopped', updated_at = datetime('now') WHERE id = ?`).run(task.id)
  const items = database().prepare('SELECT * FROM oceanengine_upload_task_items WHERE task_id = ?').all(task.id)
  for (const item of items) {
    if (item.status === 'uploading') {
      const ac = taskAborts.get(item.id)
      if (ac) ac.abort()
    } else if (item.status === 'waiting') {
      settleItem(item, { stopped: true, error: '已停止' })
    }
  }
  return { id: task.id }
}

function resumeTasks() {
  try {
    database().prepare(`UPDATE oceanengine_upload_task_items SET status = 'waiting' WHERE status = 'uploading'`).run()
    pumpTasks()
  } catch (e) {
    console.error('[oceanengine] resume upload tasks', e.message)
  }
}

resumeTasks()

module.exports = {
  targets,
  uploadLocalFile,
  removeTemp,
  acceptVideoName,
  saveRecord,
  listRecords,
  withSlot,
  createUploadTask,
  acceptTaskFile,
  listActiveTasks,
  stopUploadTask,
  stopUploadItem,
  retryUploadItem,
  dismissUploadTask,
  MAX_BYTES,
  UPLOAD_CONCURRENCY,
}
