const path = require('path')
const express = require('express')
const db = require('./db')
const apiRouter = require('./routes')

const PORT = Number(process.env.PORT) || 3000
const isProd = process.env.NODE_ENV === 'production'

db.initDb()

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))

app.use('/admin-api', apiRouter)

if (isProd) {
  const distPath = path.join(__dirname, '..', 'frontend', 'dist')
  const fs = require('fs')
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { index: false }))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/admin-api')) return next()
      res.sendFile(path.join(distPath, 'index.html'))
    })
  } else {
    console.warn('[wan-ai] dist 目录不存在，请先执行 npm run build:prod')
  }
}

app.listen(PORT, () => {
  console.log(`[wan-ai] server listening on http://127.0.0.1:${PORT} (${isProd ? 'production' : 'development'})`)
})
