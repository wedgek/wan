/**
 * 巨量引擎：授权回调（公开）与通用版商品创建（需登录）。
 * 与点众 /admin-api/novel/dianzhong/callback 分开。
 */
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

const siteUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
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
