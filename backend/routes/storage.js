const fs = require('fs')
const path = require('path')
const os = require('os')
const express = require('express')
const multer = require('multer')
const auth = require('./auth')
const { requireAuth } = auth
const { ok, fail } = require('../utils/response')
const tos = require('../services/tosClient')

const router = express.Router()
router.use(requireAuth)

const ALLOWED_DIRS = new Set(['image/', 'video/', 'apk/', 'document/'])

const ALLOWED_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'mp4',
  'avi',
  'mov',
  'mkv',
  'wmv',
  'flv',
  'webm',
  'apk',
  'ipa',
  'exe',
  'dmg',
  'msi',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'zip',
  'rar',
  '7z',
  'json',
  'xml',
])

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
}

const MAX_UPLOAD_MB = Math.min(2048, Math.max(1, Number(process.env.MAX_UPLOAD_MB || 512)))
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024

const UPLOAD_RATE_PER_MIN = Math.min(200, Math.max(12, Number(process.env.STORAGE_UPLOAD_RATE_PER_MIN || 60)))
const rateBuckets = new Map()

function allowRate(userId) {
  const k = `${userId}:${Math.floor(Date.now() / 60000)}`
  const n = (rateBuckets.get(k) || 0) + 1
  if (n > UPLOAD_RATE_PER_MIN) return false
  rateBuckets.set(k, n)
  if (rateBuckets.size > 4000) {
    const cutoff = Math.floor(Date.now() / 60000) - 2
    for (const key of rateBuckets.keys()) {
      const minute = Number(key.split(':')[1])
      if (minute < cutoff) rateBuckets.delete(key)
    }
  }
  return true
}

function normalizeDir(d) {
  if (!d || typeof d !== 'string') return ''
  let s = d.trim()
  if (!s.endsWith('/')) s += '/'
  return s
}

function safeBaseName(originalname) {
  const base = path.basename(originalname || 'file')
  const cleaned = base.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, '_').slice(0, 80)
  return cleaned || 'file'
}

function extOf(filename) {
  const e = path.extname(filename || '').replace(/^\./, '').toLowerCase()
  return e
}

function guessContentType(ext, mimetype) {
  if (mimetype && String(mimetype).trim() && mimetype !== 'application/octet-stream') return mimetype
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

const diskStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, os.tmpdir())
  },
  filename(_req, file, cb) {
    const ext = extOf(file.originalname)
    cb(null, `wan-ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext ? `.${ext}` : ''}`)
  },
})

const uploadMiddleware = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = extOf(file.originalname)
    if (!ext || !ALLOWED_EXT.has(ext)) {
      cb(new Error(`不允许的文件类型：.${ext || 'unknown'}`))
      return
    }
    cb(null, true)
  },
}).single('file')

router.post('/upload', (req, res) => {
  if (!tos.isConfigured()) {
    return res.json(fail(503, '未配置火山 TOS：请设置 TOS_ACCESS_KEY、TOS_SECRET_KEY、TOS_REGION、TOS_ENDPOINT、TOS_BUCKET'))
  }
  if (!allowRate(req.userId)) {
    return res.json(fail(429, '上传过于频繁，请稍后再试'))
  }

  uploadMiddleware(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.json(fail(413, `单文件不超过 ${MAX_UPLOAD_MB}MB`))
        }
        return res.json(fail(400, err.message || '上传失败'))
      }
      return res.json(fail(400, err.message || '上传失败'))
    }

    const file = req.file
    if (!file || !file.path) {
      return res.json(fail(400, '请选择文件'))
    }

    const dir = normalizeDir(req.body?.dir || 'document/')
    if (!ALLOWED_DIRS.has(dir)) {
      try {
        fs.unlinkSync(file.path)
      } catch (_) {
        /* ignore */
      }
      return res.json(fail(400, `dir 须为 ${[...ALLOWED_DIRS].join(' ')} 之一`))
    }

    const ext = extOf(file.originalname)
    const base = safeBaseName(file.originalname).replace(/\.[^.]+$/, '') || 'file'
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const objectKey = `${dir}u${req.userId}/${base}_${suffix}.${ext}`
    const contentType = guessContentType(ext, file.mimetype)

    try {
      const { key, url } = await tos.putFileFromPath({
        localPath: file.path,
        objectKey,
        contentType,
      })
      res.json(ok({ key, url, bucket: tos.getConfig().bucket }))
    } catch (e) {
      const c = tos.getConfig()
      console.error('[storage] put TOS', e.message, {
        bucket: c.bucket,
        region: c.region,
        endpoint: c.endpoint,
      })
      let msg = e.message || '写入对象存储失败'
      if (/bucket does not exist/i.test(String(msg))) {
        msg += `（服务端当前 bucket=${c.bucket} region=${c.region}。请与火山控制台该桶名称及「所属地域」一致；开发环境可执行 npm run tos:check 对照。）`
      }
      res.json(fail(502, msg))
    } finally {
      try {
        fs.unlinkSync(file.path)
      } catch (_) {
        /* ignore */
      }
    }
  })
})

module.exports = router
