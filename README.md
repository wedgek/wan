# 万相中台（wan-ai）

AI 管理类业务中台：**Vue3 + Vite** 前端 + **Node（Express）+ SQLite** 后端。单仓库 **npm workspaces**，在**根目录**一条命令安装前后端依赖、统一启动脚本。

---

## 快速开始

### 1. 一键安装依赖（前后端）

进入**仓库根目录**（与根 `package.json` 同级），执行：

```bash
cd wan-ai
npm install
```

或用别名（效果相同）：

```bash
npm run setup
```

npm 会根据 `workspaces` 把 **`frontend/`**、**`backend/`** 里声明的依赖一次性装齐，依赖包通常**集中在根目录的 `node_modules`**（提升），无需分别进入子目录再 `npm install`。

### 2. 启动项目

**均在仓库根目录执行：**

| 做什么 | 命令 |
|--------|------|
| **前后端一起跑（推荐）** | `npm run dev:all` |
| 只跑前端（Vite） | `npm run dev` |
| 只跑后端（API） | `npm run server:dev` |

| 地址 | 默认 |
|------|------|
| 前端页面 | <http://127.0.0.1:5173> |
| 后端 API | <http://127.0.0.1:3000>（环境变量 `PORT` 可改） |

开发时 Vite 会把 **`/admin-api` 代理到本机 3000**，所以要联调请先开后端或使用 `dev:all`。

**登录联调：** 默认管理员 **`admin` / `admin123`**（生产务必改，见 [DEPLOY.md](./DEPLOY.md)）。

### 3. 生产构建

```bash
npm run build:prod
```

静态资源输出在 **`frontend/dist`**。线上用 PM2、环境变量等见 **[DEPLOY.md](./DEPLOY.md)**。

---

## 技术栈（摘要）

| 位置 | 技术 |
|------|------|
| `frontend/` | Vue 3、Vite、Vue Router、Pinia、Element Plus、Axios、Sass |
| `backend/` | Express、better-sqlite3 |

---

## 目录说明（摘要）

| 路径 | 用途 |
|------|------|
| 根 `package.json` | workspaces、统一脚本、`npm install` 装全仓 |
| `frontend/` | 管理端界面、构建配置、`.env*`、产物 **`frontend/dist`** |
| `backend/` | HTTP API、SQLite，数据目录 **`backend/data`**（勿提交 `*.db`） |
| `ecosystem.config.cjs` | PM2 配置 |

**加依赖（选边装）：**

```bash
npm install 包名 -w frontend
npm install 包名 -w backend
```

---

## 代码约定（摘要）

- 接口定义放在 `frontend/src/api/`，请求统一走 `@/request`，页面里不要直接散落 `axios`。
- 样式、布局、路由、Pinia 等按现有 `src` 分层维护即可。

更细的部署步骤、磁盘与 PM2 注意点见 **[DEPLOY.md](./DEPLOY.md)**。
