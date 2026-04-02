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

- `ecosystem.config.cjs` 会把当前 shell 里的 `PORT`、`DATA_DIR`、`ADMIN_PASSWORD`、`ADMIN_USERNAME` 传给进程（请勿把密码写进仓库）。
- **PM2 实例数保持 1**（SQLite 单写）
- 会话在内存，重启需重新登录

### 第 6 步起（在同一终端、已 export 之后执行）

**必须在项目根目录**（与 `ecosystem.config.cjs` 同级），且与第 5 步 **同一个 SSH 会话**，否则环境变量不会带进 PM2：

```bash
cd /path/to/wan-ai   # 换成你服务器上的实际路径

pm2 start ecosystem.config.cjs
pm2 status
pm2 logs wan-ai --lines 50    # 确认无报错；Ctrl+C 仅退出日志，不停服务
```

持久化进程列表并设开机自启：

```bash
pm2 save
pm2 startup
# 按屏幕提示复制执行输出的那一行（通常带 sudo 或 env PATH=...）
```

若之前误启动过旧配置，先删掉再起：

```bash
pm2 delete wan-ai
# 重新 export 第 5 步变量后
pm2 start ecosystem.config.cjs && pm2 save
```

### 第 7 步：本机验证

```bash
curl -sI http://127.0.0.1:3000 | head -5
# 浏览器：http://服务器公网IP:3000
```

### 第 8 步：安全组与防火墙

- 云控制台 **安全组** 放行 **TCP 3000**（或你只开 80/443 时放行对应端口）。
- 系统防火墙示例（firewalld）：`firewall-cmd --permanent --add-port=3000/tcp && firewall-cmd --reload`
- ufw：`ufw allow 3000/tcp && ufw reload`

### 第 9 步（可选）：Nginx 反向代理

域名解析到服务器后，配置 `location / { proxy_pass http://127.0.0.1:3000; ... }`，并设置 `Host`、`X-Forwarded-Proto` 等；证书可用 certbot。

---

更多架构与目录说明见根目录 **[README.md](./README.md)**。
