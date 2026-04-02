const express = require('express')
const authRouter = require('./auth')
const systemRouter = require('./system')
const { requireAuth } = require('./auth')

const router = express.Router()

router.get('/health', (req, res) => {
  try {
    const db = require('../db')
    db.getDb().prepare('SELECT 1').get()
    res.json({ code: 0, data: { ok: true, db: true } })
  } catch (e) {
    res.status(500).json({ code: 500, msg: 'health check failed', data: { db: false } })
  }
})

router.use('/system/auth', authRouter)
router.use('/system', systemRouter)

/** 占位：企微 SDK / 阿里云 OSS，接入真实能力前返回空或明确错误 */
router.get('/qiwei/app-sdk/page', requireAuth, (req, res) => {
  res.json({ code: 0, data: { list: [], total: 0 } })
})

router.post('/ali/getStsToken', requireAuth, (req, res) => {
  res.json({ code: 503, msg: '未配置阿里云 STS：请在服务端实现 getStsToken 或关闭 OSS 上传' })
})

module.exports = router
