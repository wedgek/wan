/**
 * 巨量引擎：授权回调（公开）与通用版商品创建（需登录）。
 * 与点众 /admin-api/novel/dianzhong/callback 分开。
 */
const crypto = require('crypto')
const os = require('os')
const path = require('path')
const express = require('express')
const multer = require('multer')
const db = require('../db')
const { requireAuth } = require('./auth')
const { ok, fail } = require('../utils/response')
const oceanengine = require('../services/oceanengineAuth')
const products = require('../services/oceanengineProduct')
const accounts = require('../services/oceanengineAccount')
const events = require('../services/oceanengineEvent')
const sites = require('../services/oceanengineSite')
const materials = require('../services/oceanengineMaterial')
const launch = require('../services/oceanengineLaunch')
const titles = require('../services/oceanengineTitles')
const bids = require('../services/oceanengineBids')

const siteUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
}).single('file')

const videoUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, os.tmpdir())
    },
    filename(_req, _file, cb) {
      cb(null, `ocean-video-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`)
    },
  }),
  limits: { fileSize: materials.MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (materials.acceptVideoName(file.originalname)) {
      cb(null, true)
      return
    }
    cb(new Error('只接收 mp4、mpeg、3gp、avi 原文件'))
  },
}).single('file')

const router = express.Router()

function userHasPermission(userId, permission) {
  const d = db.getDb()
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

function requireOceanProducts(req, res, next) {
  if (!userHasPermission(req.userId, 'novel:ocean-product:list')) {
    return res.json(fail(403, '无权限访问商品库'))
  }
  next()
}

function requireOceanAccounts(req, res, next) {
  if (
    !userHasPermission(req.userId, 'novel:ocean-account:list') &&
    !userHasPermission(req.userId, 'novel:ocean-product:list')
  ) {
    return res.json(fail(403, '无权限访问账户管理'))
  }
  next()
}

router.get('/callback', async (req, res) => {
  try {
    const result = await oceanengine.handleBrowserCallback(req.query)
    if (result && result.redirectTo) {
      res.redirect(302, result.redirectTo)
      return
    }
    res.status(200).type('html').send(oceanengine.renderCallbackPage(result))
  } catch (e) {
    console.error('[oceanengine] callback', e.message)
    res.status(500).type('html').send(
      oceanengine.renderCallbackPage({
        title: '授权处理失败',
        detail: '服务器处理授权回调时出错，请稍后重新打开授权链接。',
      }),
    )
  }
})

router.get('/callback/done', (req, res) => {
  const n = Number(req.query.accounts)
  const accounts = Number.isFinite(n) && n > 0 ? `已授权 ${n} 个广告账户。` : 'Token 已保存。'
  res.status(200).type('html').send(
    oceanengine.renderCallbackPage({
      title: '授权成功',
      detail: `${accounts}之后由服务器自动续期，不用再打开授权页。`,
    }),
  )
})

router.get('/apps', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(oceanengine.listApps()))
  } catch (e) {
    console.error('[oceanengine] apps', e.message)
    res.json(fail(500, '读取应用失败'))
  }
})

router.post('/apps', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = oceanengine.saveApp(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] save app', e.message)
    const msg = /UNIQUE/i.test(e.message) ? '这个 AppID 已经添加过' : '保存应用失败'
    res.json(fail(500, msg))
  }
})

router.post('/apps/:id/authorize', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = oceanengine.createAuthorizeUrl(req.params.id)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] authorize url', e.message)
    res.json(fail(500, '生成授权链接失败'))
  }
})

router.post('/auth/export', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = oceanengine.exportAuthText(req.body && req.body.appPk)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok({ text: result.text }))
  } catch (e) {
    console.error('[oceanengine] export auth', e.message)
    res.json(fail(500, '复制授权失败'))
  }
})

router.post('/auth/import', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = oceanengine.importAuthText(req.body && req.body.text)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] import auth', e.message)
    res.json(fail(500, '导入授权失败'))
  }
})

router.get('/settings', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const scope = req.query.scope
    const data = await products.settings(req.query.appPk, { authOnly: scope === 'auth', usageOnly: scope === 'usage' })
    data.allowImport = oceanengine.allowTokenImport()
    res.json(ok(data))
  } catch (e) {
    console.error('[oceanengine] settings', e.message)
    res.json(fail(500, '读取巨量配置失败'))
  }
})

router.post('/libraries/launch', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const body = req.body || {}
    const result = products.setLibraryLaunch(body.platformId, body.launch)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] library launch', e.message)
    res.json(fail(500, '更新批量基建开关失败'))
  }
})

router.post('/libraries/enabled', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const body = req.body || {}
    const result = products.setLibraryEnabled(body.platformId, body.enabled)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] library enabled', e.message)
    res.json(fail(500, '更新商品库开关失败'))
  }
})

router.post('/templates', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = products.saveNovelTemplate(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] save template', e.message)
    res.json(fail(500, '保存模板失败'))
  }
})

router.post('/templates/:id/enabled', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(products.setNovelTemplateEnabled(req.params.id, req.body && req.body.enabled)))
  } catch (e) {
    console.error('[oceanengine] template enabled', e.message)
    res.json(fail(500, '更新模板开关失败'))
  }
})

router.delete('/templates/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    products.deleteNovelTemplate(req.params.id)
    res.json(ok(true))
  } catch (e) {
    console.error('[oceanengine] delete template', e.message)
    res.json(fail(500, '删除模板失败'))
  }
})

router.get('/products/meta', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    res.json(ok(await products.meta(req.query.appPk)))
  } catch (e) {
    console.error('[oceanengine] products meta', e.message)
    res.json(fail(500, '读取商品库失败'))
  }
})

router.get('/products/page', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(products.listLocal(req.query)))
  } catch (e) {
    console.error('[oceanengine] products page', e.message)
    res.json(fail(500, '读取商品失败'))
  }
})

router.post('/products/sync', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const body = req.body || {}
    const result = await products.syncFromOcean(body.platformId, body.appPk)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] products sync', e.message)
    res.json(fail(500, '同步商品库失败'))
  }
})

router.post('/products/refresh', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const body = req.body || {}
    const result = await products.refreshCreated(body.platformId, body.productIds, body.appPk)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] products refresh', e.message)
    res.json(fail(500, '回读新建商品失败'))
  }
})

router.post('/products/batch', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await products.batchCreate(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] batch create', e.message)
    res.json(fail(500, '搭建商品失败'))
  }
})

router.get('/covers', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const list = db
      .getDb()
      .prepare('SELECT id, url, name, created_at AS createdAt FROM oceanengine_cover_images ORDER BY id DESC')
      .all()
    res.json(ok(list))
  } catch (e) {
    console.error('[oceanengine] covers', e.message)
    res.json(fail(500, '读取产品图失败'))
  }
})

router.post('/covers', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const url = String((req.body && req.body.url) || '').trim()
    const name = String((req.body && req.body.name) || '').trim().slice(0, 80)
    if (!url) return res.json(fail(400, '缺少图片地址'))
    const info = db
      .getDb()
      .prepare('INSERT INTO oceanengine_cover_images (url, name) VALUES (?, ?)')
      .run(url, name)
    res.json(ok({ id: Number(info.lastInsertRowid), url, name }))
  } catch (e) {
    console.error('[oceanengine] cover add', e.message)
    res.json(fail(500, '保存产品图失败'))
  }
})

router.delete('/covers/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    db.getDb().prepare('DELETE FROM oceanengine_cover_images WHERE id = ?').run(req.params.id)
    res.json(ok(true))
  } catch (e) {
    console.error('[oceanengine] cover delete', e.message)
    res.json(fail(500, '删除产品图失败'))
  }
})

router.get('/accounts/page', requireAuth, requireOceanAccounts, async (req, res) => {
  try {
    res.json(ok(await accounts.listPage(req.query)))
  } catch (e) {
    console.error('[oceanengine] accounts page', e.message)
    res.json(fail(500, '读取账户失败'))
  }
})

router.get('/accounts/ocean-search', requireAuth, requireOceanAccounts, async (req, res) => {
  try {
    const result = await accounts.searchOceanAccounts(req.query)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] ocean search', e.message)
    res.json(fail(500, '从巨量搜索账户失败'))
  }
})

router.post('/accounts/ocean-import', requireAuth, requireOceanAccounts, async (req, res) => {
  try {
    const body = req.body || {}
    const result = body.keyword
      ? await accounts.importOceanSearch(body.keyword)
      : await accounts.importSelectedAccounts(body.accounts)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] ocean import', e)
    res.json(fail(500, '导入账户失败'))
  }
})

router.post('/accounts/using', requireAuth, requireOceanAccounts, (req, res) => {
  try {
    const body = req.body || {}
    const result = body.keyword
      ? accounts.importByKeyword(body.keyword)
      : accounts.setUsing(body.advertiserIds, body.using !== false && body.using !== 0)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] accounts using', e.message)
    res.json(fail(500, '更新使用中的账户失败'))
  }
})

router.post('/accounts/sync', requireAuth, requireOceanAccounts, async (req, res) => {
  try {
    const body = req.body || {}
    const result = await accounts.syncOnline(body.advertiserIds)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] accounts sync', e)
    res.json(fail(500, '同步账户失败'))
  }
})

router.post('/accounts/copyright', requireAuth, requireOceanAccounts, (req, res) => {
  try {
    const body = req.body || {}
    const result = accounts.setCopyright(body.advertiserIds, body.copyrightOwner)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] accounts copyright', e)
    res.json(fail(500, '设置版权方失败'))
  }
})

router.post('/accounts/rename', requireAuth, requireOceanAccounts, async (req, res) => {
  try {
    const result = await accounts.renameAccounts(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] accounts rename', e.message)
    res.json(fail(500, '批量改名失败'))
  }
})

router.post('/accounts/avatar', requireAuth, requireOceanAccounts, async (req, res) => {
  try {
    const result = await accounts.updateAvatars(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] accounts avatar', e.message)
    res.json(fail(500, '批量换头像失败'))
  }
})

router.get('/events/accounts', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(events.listAccountOptions(req.query.keyword)))
  } catch (e) {
    console.error('[oceanengine] event accounts', e.message)
    res.json(fail(500, '读取投放账户失败'))
  }
})

router.get('/events/assets', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await events.listMiniProgramAssets(req.query.advertiserId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] event assets', e.message)
    res.json(fail(500, '读取事件资产失败'))
  }
})

router.get('/events/configs', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await events.listCreatedEvents(req.query.advertiserId, req.query.assetId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] event configs', e.message)
    res.json(fail(500, '读取已创建事件失败'))
  }
})

router.get('/events/available', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await events.listAvailableEvents(req.query.advertiserId, req.query.assetId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] available events', e.message)
    res.json(fail(500, '读取可添加事件失败'))
  }
})

router.post('/events/status', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await events.summarizeAccountEvents((req.body || {}).advertiserIds)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] event status', e.message)
    res.json(fail(500, '读取事件状态失败'))
  }
})

router.post('/events/batch', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const body = req.body || {}
    const result = await events.batchAddEvents({
      text: body.text,
      eventNames: body.eventNames,
      advertiserIds: body.advertiserIds,
    })
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] batch events', e.message)
    res.json(fail(500, '批量添加事件失败'))
  }
})

router.get('/sites/poster', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(sites.posterInfo()))
  } catch (e) {
    console.error('[oceanengine] landing poster', e.message)
    res.json(fail(500, '读取落地页图片失败'))
  }
})

router.post('/sites/poster/active', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = sites.setActivePoster((req.body || {}).id)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] active landing poster', e.message)
    res.json(fail(500, '切换落地页图片失败'))
  }
})

router.get('/sites/poster/file', requireAuth, requireOceanProducts, (req, res) => {
  const file = sites.readPoster(req.query.id)
  if (!file) return res.status(404).end()
  res.setHeader('Content-Type', file.mime || 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=60')
  res.send(file.buffer)
})

router.post('/sites/poster', requireAuth, requireOceanProducts, (req, res) => {
  siteUpload(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 2MB' : '图片上传失败'
      return res.json(fail(400, message))
    }
    try {
      const result = sites.savePoster(req.file)
      if (result.error) return res.json(fail(400, result.error))
      res.json(ok(result))
    } catch (e) {
      console.error('[oceanengine] save landing poster', e.message)
      res.json(fail(500, '保存落地页图片失败'))
    }
  })
})

router.post('/sites/generate', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await sites.generateSites((req.body || {}).advertiserIds)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] generate sites', e.message)
    res.json(fail(500, '生成落地页失败'))
  }
})

router.post('/sites/summary', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await sites.summarizeAccountSites((req.body || {}).advertiserIds)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] orange site summary', e.message)
    res.json(fail(500, '读取落地页失败'))
  }
})

router.get('/sites', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await sites.listAccountSites(req.query.advertiserId, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      search: req.query.search,
    })
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] orange site list', e.message)
    res.json(fail(500, '读取落地页失败'))
  }
})

router.post('/sites/batch', requireAuth, requireOceanProducts, (req, res) => {
  siteUpload(req, res, async (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 2MB' : '图片上传失败'
      return res.json(fail(400, message))
    }
    try {
      let advertiserIds = []
      try {
        advertiserIds = JSON.parse((req.body && req.body.advertiserIds) || '[]')
      } catch {
        advertiserIds = []
      }
      let names = []
      try {
        names = JSON.parse((req.body && req.body.names) || '[]')
      } catch {
        names = []
      }
      const result = await sites.createImageSites({
        advertiserIds,
        names,
        name: req.body && req.body.name,
        file: req.file,
      })
      if (result.error) return res.json(fail(400, result.error))
      res.json(ok(result))
    } catch (e) {
      console.error('[oceanengine] orange sites', e.message)
      res.json(fail(500, '创建落地页失败'))
    }
  })
})

router.post('/events', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await events.createEvent(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] create event', e.message)
    res.json(fail(500, '添加事件失败'))
  }
})

router.get('/materials/targets', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    res.json(ok(await materials.targets()))
  } catch (e) {
    console.error('[oceanengine] material targets', e.message)
    res.json(fail(500, '读取组织失败'))
  }
})

router.get('/materials/records', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(materials.listRecords(req.userId, req.query)))
  } catch (e) {
    console.error('[oceanengine] upload records', e.message)
    res.json(fail(500, '读取上传记录失败'))
  }
})

router.post('/materials/tasks', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const body = req.body || {}
    const result = materials.createUploadTask({
      userId: req.userId,
      orgId: body.orgId,
      orgName: body.orgName,
    })
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] create upload task', e.message)
    res.json(fail(500, '创建上传任务失败'))
  }
})

router.post('/materials/tasks/:id/files', requireAuth, requireOceanProducts, (req, res) => {
  req.setTimeout(600000)
  res.setTimeout(600000)
  videoUpload(req, res, (err) => {
    const filePath = req.file && req.file.path
    try {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? '单个视频不能超过 500MB' : err.message || '上传失败'
        return res.json(fail(400, message))
      }
      if (!req.file) return res.json(fail(400, '请选择视频文件'))
      const result = materials.acceptTaskFile({
        taskId: req.params.id,
        userId: req.userId,
        tempPath: filePath,
        filename: (req.body && req.body.filename) || req.file.originalname,
        size: req.file.size,
      })
      if (result.error) return res.json(fail(400, result.error))
      res.json(ok(result))
    } catch (e) {
      console.error('[oceanengine] accept upload file', e.message)
      res.json(fail(500, '保存视频失败'))
    } finally {
      materials.removeTemp(filePath)
    }
  })
})

router.get('/materials/tasks/active', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(materials.listActiveTasks(req.userId)))
  } catch (e) {
    console.error('[oceanengine] active upload tasks', e.message)
    res.json(fail(500, '读取上传任务失败'))
  }
})

router.post('/materials/tasks/:id/items/:itemId/retry', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = materials.retryUploadItem(req.params.id, req.params.itemId, req.userId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] retry upload item', e.message)
    res.json(fail(500, '重试失败'))
  }
})

router.post('/materials/tasks/:id/items/:itemId/stop', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = materials.stopUploadItem(req.params.id, req.params.itemId, req.userId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] stop upload item', e.message)
    res.json(fail(500, '停止文件失败'))
  }
})

router.post('/materials/tasks/:id/dismiss', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = materials.dismissUploadTask(req.params.id, req.userId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] dismiss upload task', e.message)
    res.json(fail(500, '关闭任务失败'))
  }
})

router.post('/materials/tasks/:id/stop', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = materials.stopUploadTask(req.params.id, req.userId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] stop upload task', e.message)
    res.json(fail(500, '停止任务失败'))
  }
})

router.post('/materials/upload', requireAuth, requireOceanProducts, (req, res) => {
  req.setTimeout(600000)
  res.setTimeout(600000)
  const ac = new AbortController()
  req.on('close', () => {
    if (req.aborted && !res.writableEnded) ac.abort()
  })
  videoUpload(req, res, async (err) => {
    const filePath = req.file && req.file.path
    const body = req.body || {}
    try {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? '单个视频不能超过 500MB' : err.message || '上传失败'
        return res.json(fail(400, message))
      }
      if (!req.file) return res.json(fail(400, '请选择视频文件'))
      const result = await materials.withSlot(() => {
        if (ac.signal.aborted) return { error: '上传被中断，文件还没进巨量', stopped: true }
        return materials.uploadLocalFile({
          filePath,
          filename: body.filename || req.file.originalname,
          size: req.file.size,
          orgId: body.orgId,
          signal: ac.signal,
        })
      })
      const status = result.stopped ? 'stopped' : result.error ? 'fail' : 'success'
      try {
        materials.saveRecord({
          userId: req.userId,
          taskKey: body.taskKey,
          orgId: body.orgId || result.orgId,
          orgName: body.orgName,
          filename: body.filename || req.file.originalname,
          localSize: result.localSize || req.file.size,
          remoteSize: result.remoteSize || 0,
          sizeMatched: result.sizeMatched,
          status,
          error: result.error || '',
          videoId: result.videoId || '',
          materialId: result.materialId || '',
        })
      } catch (saveError) {
        console.error('[oceanengine] save upload record', saveError.message)
      }
      if (result.error) return res.json(fail(400, result.error))
      res.json(ok(result))
    } catch (e) {
      console.error('[oceanengine] video upload', e.message)
      if (!res.headersSent) res.json(fail(500, '上传到巨量失败'))
    } finally {
      materials.removeTemp(filePath)
    }
  })
})

router.get('/launch/books', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(launch.searchBooks(req.query.keyword, req.query.copyright)))
  } catch (e) {
    console.error('[oceanengine] launch books', e.message)
    res.json(fail(500, '读取书名失败'))
  }
})

router.get('/launch/promos', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(launch.searchPromos(req.query.keyword)))
  } catch (e) {
    console.error('[oceanengine] launch promos', e.message)
    res.json(fail(500, '读取推广链接失败'))
  }
})

router.get('/launch/videos', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(launch.searchVideos(req.query.keyword)))
  } catch (e) {
    console.error('[oceanengine] launch videos', e.message)
    res.json(fail(500, '读取素材失败'))
  }
})

router.get('/launch/tasks', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(launch.listTasks(req.query)))
  } catch (e) {
    console.error('[oceanengine] launch tasks', e.message)
    res.json(fail(500, '读取任务失败'))
  }
})

router.get('/launch/options', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    res.json(ok(await launch.options()))
  } catch (e) {
    console.error('[oceanengine] launch options', e.message)
    res.json(fail(500, '读取批量基建失败'))
  }
})

router.get('/launch/mini-apps', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    res.json(ok(await launch.listMiniApps()))
  } catch (e) {
    console.error('[oceanengine] launch mini apps', e.message)
    res.json(fail(500, '读取小程序失败'))
  }
})

router.get('/launch/awemes', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    res.json(ok(await launch.listAwemes()))
  } catch (e) {
    console.error('[oceanengine] launch awemes', e.message)
    res.json(fail(500, '读取抖音号失败'))
  }
})

router.post('/launch/template', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = launch.saveTemplate(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] launch template', e.message)
    res.json(fail(500, '保存投放模板失败'))
  }
})

router.get('/launch/strategies', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(launch.listStrategies()))
  } catch (e) {
    console.error('[oceanengine] launch strategies', e.message)
    res.json(fail(500, '读取策略失败'))
  }
})

router.post('/launch/strategies', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = launch.createStrategy(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] launch strategy create', e.message)
    res.json(fail(500, '新建策略失败'))
  }
})

router.put('/launch/strategies/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = launch.updateStrategy(req.params.id, req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] launch strategy update', e.message)
    res.json(fail(500, '保存策略失败'))
  }
})

router.delete('/launch/strategies/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = launch.removeStrategy(req.params.id)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] launch strategy delete', e.message)
    res.json(fail(500, '删除策略失败'))
  }
})

router.get('/bid-strategies', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(bids.list()))
  } catch (e) {
    console.error('[oceanengine] bid strategies', e.message)
    res.json(fail(500, '读取出价策略失败'))
  }
})

router.post('/bid-strategies', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = bids.create(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] bid strategy create', e.message)
    res.json(fail(500, '新建出价策略失败'))
  }
})

router.put('/bid-strategies/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = bids.update(req.params.id, req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] bid strategy update', e.message)
    res.json(fail(500, '保存出价策略失败'))
  }
})

router.delete('/bid-strategies/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = bids.remove(req.params.id)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] bid strategy delete', e.message)
    res.json(fail(500, '删除出价策略失败'))
  }
})

router.get('/title-libraries', requireAuth, requireOceanProducts, (req, res) => {
  try {
    res.json(ok(titles.listLibraries()))
  } catch (e) {
    console.error('[oceanengine] title libraries', e.message)
    res.json(fail(500, '读取标题包失败'))
  }
})

router.get('/title-libraries/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = titles.getLibrary(req.params.id)
    if (!result) return res.json(fail(400, '没有这个标题包'))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] title library get', e.message)
    res.json(fail(500, '读取标题包失败'))
  }
})

router.post('/title-libraries', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = titles.createLibrary(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] title library create', e.message)
    res.json(fail(500, '创建标题包失败'))
  }
})

router.put('/title-libraries/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = titles.updateLibrary(req.params.id, req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] title library update', e.message)
    res.json(fail(500, '保存标题包失败'))
  }
})

router.delete('/title-libraries/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = titles.removeLibrary(req.params.id)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] title library delete', e.message)
    res.json(fail(500, '删除标题包失败'))
  }
})

router.post('/launch/preview', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await launch.preview(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] launch preview', e.message)
    res.json(fail(500, '生成对照失败'))
  }
})

router.post('/launch/submit', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await launch.submit(req.body || {}, req.userId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] launch submit', e.message)
    res.json(fail(500, '创建投放失败'))
  }
})

router.post('/launch/retry', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await launch.retry(req.body || {}, req.userId)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] launch retry', e.message)
    res.json(fail(500, '重试失败'))
  }
})

router.post('/launch/tasks/:id/stop', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const result = launch.stopTask(req.params.id)
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] launch stop', e.message)
    res.json(fail(500, '停止失败'))
  }
})

router.get('/launch/tasks/:id/draft', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const draft = launch.taskDraft(req.params.id)
    if (!draft) return res.json(fail(404, '没有这批投放'))
    res.json(ok(draft))
  } catch (e) {
    console.error('[oceanengine] launch draft', e.message)
    res.json(fail(500, '读取搭建信息失败'))
  }
})

router.get('/launch/tasks/:id', requireAuth, requireOceanProducts, (req, res) => {
  try {
    const task = launch.taskById(req.params.id)
    if (!task) return res.json(fail(404, '没有这批投放'))
    res.json(ok(task))
  } catch (e) {
    console.error('[oceanengine] launch task', e.message)
    res.json(fail(500, '读取投放结果失败'))
  }
})

router.post('/products', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const result = await products.createByBookName(req.body || {})
    if (result.error) return res.json(fail(400, result.error))
    res.json(ok(result))
  } catch (e) {
    console.error('[oceanengine] product create', e.message)
    res.json(fail(500, '创建商品失败'))
  }
})

module.exports = router
