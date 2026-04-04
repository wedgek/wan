const express = require('express')
const authRouter = require('./auth')
const systemRouter = require('./system')
const videoRouter = require('./video')
const storageRouter = require('./storage')
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
router.use('/video', videoRouter)
router.use('/storage', storageRouter)

/** 占位：企微 SDK */
router.get('/qiwei/app-sdk/page', requireAuth, (req, res) => {
  res.json({ code: 0, data: { list: [], total: 0 } })
})

/** 已废弃：上传请使用 POST /admin-api/storage/upload（火山 TOS 服务端上传） */
router.post('/ali/getStsToken', requireAuth, (req, res) => {
  res.status(410).json({
    code: 410,
    msg: '已废弃：请使用服务端 TOS 上传 POST /admin-api/storage/upload，不再下发阿里云 STS',
  })
})

module.exports = router
