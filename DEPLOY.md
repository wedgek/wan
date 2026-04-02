# 万相中台（wan-ai）部署说明

单进程 Express：接口 **`/admin-api`** + 静态 **`frontend/dist`**；数据库 **SQLite**（`backend/data`）。仓库为 **npm workspaces**。

---

## 本地：安装与运行

**在仓库根目录执行。**

```bash
cd wan-ai

# 一键安装前后端依赖（与 npm run setup 相同）
npm install

# 推荐：前后端一起
npm run dev:all
```

- 前端 <http://127.0.0.1:5173>，后端 <http://127.0.0.1:3000>
- 默认账号 `admin` / `admin123`（生产请改 `ADMIN_PASSWORD` 等）

**本地模拟生产（可选）：**

```bash
npm run build:prod
# PowerShell: $env:NODE_ENV="production"; npm run start:prod
# Linux/macOS: export NODE_ENV=production && npm run start:prod
```

浏览器访问 `http://127.0.0.1:3000`（端口以 `PORT` 为准）。

---

## 服务器环境

- **Node.js LTS**（与本地主版本尽量一致，便于 `better-sqlite3`）
- **PM2**：`npm i -g pm2`
- 安装 `better-sqlite3` 可能需要本机构建链（如 `build-essential`）；磁盘紧时先 `df -h`、清日志与 `~/.npm`

## 发布（最简单）

在服务器**需要打 Vite 包**时：

```bash
git clone <仓库> && cd wan-ai
npm ci
npm run build:prod
```

若 **`frontend/dist` 已由 CI 上传**，可视情况 `npm ci --omit=dev`（须确保仍有 `dist` 且后端依赖可用）。

## 生产启动（PM2）

```bash
export NODE_ENV=production
export PORT=3000
export DATA_DIR=/root/wan-ai-data          # 可选，默认 backend/data
export ADMIN_PASSWORD='强密码'

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

- **PM2 实例数保持 1**（SQLite 单写）
- 会话在内存，重启需重新登录

---

更多架构与目录说明见根目录 **[README.md](./README.md)**。
