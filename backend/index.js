const path = require("path")
const fs = require("fs")

/** 本地可从 backend/.env 加载；已有环境变量不会被覆盖（dotenv 默认行为） */
require("dotenv").config({ path: path.join(__dirname, ".env") })
const http = require("http")
const express = require("express")
const db = require("./db")
const apiRouter = require("./routes")

const HOST = process.env.HOST || "0.0.0.0"
const isProd = process.env.NODE_ENV === "production"
const DEV_PORT_FILE = path.join(__dirname, ".dev-port")

/** 是否显式指定端口（此时占用则直接失败，不自增） */
const rawPort = process.env.PORT
const hasExplicitPort = rawPort !== undefined && rawPort !== "" && !Number.isNaN(Number(rawPort))

db.initDb()

const app = express()
app.disable("x-powered-by")
// 置于 Nginx 后时启用：export TRUST_PROXY=1，以便 req.ip / 限流等识别真实客户端
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1)
}
app.use(express.json({ limit: "2mb" }))

app.use("/admin-api", apiRouter)

if (isProd) {
  const distPath = path.join(__dirname, "..", "frontend", "dist")
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { index: false }))
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/admin-api")) return next()
      res.sendFile(path.join(distPath, "index.html"))
    })
  } else {
    console.warn("[wan-ai] dist 目录不存在，请先执行 npm run build:prod")
  }
}

function writeDevPort(port) {
  if (isProd) return
  try {
    fs.writeFileSync(DEV_PORT_FILE, String(port), "utf8")
  } catch (e) {
    console.warn("[wan-ai] 无法写入 .dev-port，Vite 代理可能仍指向默认端口：", e.message)
  }
}

function removeDevPortFile() {
  if (isProd) return
  try {
    fs.unlinkSync(DEV_PORT_FILE)
  } catch (_) {
    /* 无文件 */
  }
}

const server = http.createServer(app)

server.on("listening", () => {
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : null
  if (port != null) {
    writeDevPort(port)
    console.log(
      `[wan-ai] server listening on http://${HOST}:${port} (${isProd ? "production" : "development"})`,
    )
    if (!isProd) {
      if (!hasExplicitPort && port !== 3000) {
        console.warn(
          `[wan-ai] 提示：3000 已被占用，已改用 ${port}。Vite dev 会读取 backend/.dev-port 代理到该端口。`,
        )
      }
      console.log(
        "[wan-ai] API · 快捷入口: GET/PUT /admin-api/system/quick-entries（与 /admin-api/system/workbench/quick-entries）",
      )
      try {
        const tos = require("./services/tosClient")
        if (tos.isConfigured()) {
          const c = tos.getConfig()
          console.log(
            `[wan-ai] TOS 生效参数: bucket=${c.bucket || "(空)"} region=${c.region || "(空)"} endpoint=${c.endpoint || "(空)"}`,
          )
          console.log("[wan-ai] 若上传报 bucket 不存在，请在 backend 目录执行: npm run tos:check")
        } else {
          console.warn("[wan-ai] TOS 未配置完整，上传接口将返回 503")
        }
      } catch (e) {
        console.warn("[wan-ai] TOS 配置检查:", e.message)
      }
    }
  }
})

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const p = server.__wanTryPort
    if (!isProd && !hasExplicitPort && typeof p === "number" && p < 3009) {
      const next = p + 1
      console.warn(`[wan-ai] 端口 ${p} 已被占用，尝试 ${next} …`)
      server.__wanTryPort = next
      server.listen(next, HOST)
      return
    }
    console.error(`[wan-ai] 端口 ${p ?? "?"} 已被占用（EADDRINUSE）。`)
    if (!hasExplicitPort && !isProd) {
      console.error("[wan-ai] 已尝试 3000–3009 仍不可用，请手动结束占用进程。")
    }
    console.error("[wan-ai] Windows 排查: netstat -ano | findstr :3000  再 taskkill /PID <pid> /F")
    console.error("[wan-ai] 或指定端口: cross-env PORT=3010 npm run server:dev（并配置前端直连该端口）")
    removeDevPortFile()
    process.exit(1)
    return
  }
  console.error("[wan-ai] 服务启动失败:", err)
  removeDevPortFile()
  process.exit(1)
})

if (hasExplicitPort) {
  const p = Number(rawPort)
  server.__wanTryPort = p
  server.listen(p, HOST)
} else if (isProd) {
  const p = Number(process.env.PORT) || 3000
  server.__wanTryPort = p
  server.listen(p, HOST)
} else {
  server.__wanTryPort = 3000
  server.listen(3000, HOST)
}

function shutdown() {
  removeDevPortFile()
  server.close(() => process.exit(0))
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
