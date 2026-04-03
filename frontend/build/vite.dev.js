import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mergeConfig } from "vite"
import baseConfig from "./vite.base"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEV_PORT_FILE = path.resolve(__dirname, "../../backend/.dev-port")

function readBackendBaseUrl() {
  try {
    const raw = fs.readFileSync(DEV_PORT_FILE, "utf8").trim()
    if (/^\d+$/.test(raw)) return `http://127.0.0.1:${raw}`
  } catch (_) {
    /* 后端尚未写入 */
  }
  return "http://127.0.0.1:3000"
}

/** 动态读 backend/.dev-port，解决开发环境下 3000 被占用而后端改用 3001+ 时代理仍指向 3000 的问题 */
function wanAiAdminApiProxy() {
  return {
    name: "wan-ai-admin-api-dynamic-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.originalUrl || req.url || ""
        if (!rawUrl.startsWith("/admin-api")) return next()

        const baseStr = readBackendBaseUrl()
        let dest
        try {
          dest = new URL(baseStr)
        } catch {
          return next()
        }

        const headers = { ...req.headers }
        delete headers["accept-encoding"]
        const host = dest.port ? `${dest.hostname}:${dest.port}` : dest.hostname
        headers.host = host

        const opts = {
          protocol: dest.protocol,
          hostname: dest.hostname,
          port: dest.port || undefined,
          path: rawUrl,
          method: req.method,
          headers,
        }

        const proxyReq = http.request(opts, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
          proxyRes.pipe(res)
        })
        proxyReq.on("error", (err) => {
          console.warn("[vite-proxy] /admin-api →", baseStr, err.message)
          if (!res.headersSent) {
            res.statusCode = 502
            res.setHeader("Content-Type", "text/plain; charset=utf-8")
            res.end(
              `[vite] 无法连接后端 ${baseStr}（${err.code || err.message}）。请确认 backend 已启动；若端口被占用，后端会自动写 .dev-port，重启前端 dev 或刷新即可。`,
            )
          }
        })
        req.pipe(proxyReq)
      })
    },
  }
}

export default mergeConfig(baseConfig, {
  mode: "development",
  plugins: [wanAiAdminApiProxy()],
  server: {
    open: false,
    cors: true,
    port: 5173,
  },
  build: {
    sourcemap: "inline",
  },
})
