#!/usr/bin/env node
/**
 * 对当前 DATA_DIR 下的 SQLite 执行与进程启动时相同的结构/菜单补丁（幂等）。
 * 用于生产环境在「未重启 node」或需单独校准库时执行；不会 DROP 表、不会清空业务数据。
 *
 * 用法（在 backend 目录）：
 *   node scripts/db-apply-patches.cjs
 * 或：
 *   npm run db:patch
 *
 * 须与线上服务使用相同的 .env（尤其 DATA_DIR），否则会对错误路径的库文件操作。
 */
const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "..", ".env") })

const { getDb } = require("../db")

try {
  getDb()
  const dir = process.env.DATA_DIR || path.join(__dirname, "..", "data")
  console.log("[db-apply-patches] 完成：已应用补丁（表结构、缺失菜单、超管 role_menus 等）。库目录:", dir)
} catch (e) {
  console.error("[db-apply-patches] 失败:", e.message)
  process.exit(1)
}
process.exit(0)
