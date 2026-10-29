/**
 * 巨量引擎：授权回调（公开）与通用版商品创建（需登录）。
 * 与点众 /admin-api/novel/dianzhong/callback 分开。
 */
const express = require('express')
const db = require('../db')
const { requireAuth } = require('./auth')
const { ok, fail } = require('../utils/response')
const oceanengine = require('../services/oceanengineAuth')
const products = require('../services/oceanengineProduct')

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

router.get('/settings', requireAuth, requireOceanProducts, async (req, res) => {
  try {
    const scope = req.query.scope
    res.json(ok(await products.settings(req.query.appPk, { authOnly: scope === 'auth', usageOnly: scope === 'usage' })))
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
