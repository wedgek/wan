/**
 * 等待 backend 写入 .dev-port 且端口可连（与「端口自增」配套，避免 Vite 先于后端就绪）
 */
const fs = require("fs")
const path = require("path")
const net = require("net")

const file = path.join(__dirname, "..", "backend", ".dev-port")
const deadline = Date.now() + 30000
const interval = 200

function tryConnect(port) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection({ port, host: "127.0.0.1" }, () => {
      c.end()
      resolve()
    })
    c.setTimeout(1500, () => {
      c.destroy()
      reject(new Error("timeout"))
    })
    c.on("error", reject)
  })
}

async function main() {
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(file)) {
        const port = Number(String(fs.readFileSync(file, "utf8")).trim())
        if (port > 0) {
          await tryConnect(port)
          console.log(`[wait-backend] 后端就绪 · 127.0.0.1:${port}`)
          return
        }
      }
    } catch (_) {
      /* 未就绪 */
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  console.error(
    "[wait-backend] 超时：未检测到 backend/.dev-port 或端口不可连。请查看 [backend] 终端是否报 EADDRINUSE / 启动失败。",
  )
  process.exit(1)
}

main()
