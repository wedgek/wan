# 企业微信管理系统前端（Vue3 + Vite）

> 本项目是一个 **企业级、可长期维护、高性能** 的后台管理系统前端基建。

适用于：企业微信 / 内部管理系统 / 中后台系统。

---

## 一、技术栈说明

* **Vue 3**（Composition API）
* **Vite**（构建工具）
* **Vue Router 4**（路由）
* **Pinia**（状态管理）
* **Element Plus**（UI 组件库）
* **Axios**（HTTP 请求）
* **ECharts**（图表）
* **Sass / SCSS**（样式管理）

---

## 二、项目目录结构说明（非常重要）

```text
├─ build/                    # 构建 & 打包配置（多环境）
│  ├─ vite.base.js           # 公共 Vite 配置
│  ├─ vite.dev.js            # 开发环境配置
│  ├─ vite.test.js           # 测试环境配置
│  └─ vite.prod.js           # 生产环境配置
├─ public/                   # 不参与构建的静态资源
├─ src/
│  ├─ api/                   # 接口统一管理（按业务模块拆分）
│  ├─ assets/                # 静态资源（图片 / icon / font）
│  ├─ components/            # 公共组件（可复用）
│  ├─ hooks/                 # 组合式 hooks（useXXX）
│  ├─ directives/            # 自定义指令（权限 / 防抖等）
│  ├─ layout/               # 页面整体布局
│  │  ├─ admin.vue           # 顶部 + 侧边栏 + 内容
│  │  ├─ main.vue            # 顶部 + 内容（Home）
│  │  ├─ blank.vue           # 空白布局（Login / 404）
│  │  └─ index.js            # 统一导出
│  ├─ plugins/               # 项目插件 & 第三方工具注册
│  │  └─ icons.js            # 常用 Element Plus 图标全局注册
│  ├─ router/                # 路由 & 权限控制
│  ├─ store/                 # Pinia 状态管理（模块化）
│  ├─ styles/                # 全局样式 / 变量 / 主题
│  ├─ request/               # axios 请求封装（统一 request 方法）
│  │  ├─ core.js             # axios 工厂
│  │  ├─ index.js            # 统一 request 方法，支持多域名，自动带 token
│  │  └─ index.js            # 统一导出
│  ├─ utils/                 # 工具函数（非请求类）
│  │  ├─ storage.js          # localStorage / sessionStorage 封装
│  │  ├─ auth.js             # token / 登录态工具
│  │  ├─ date.js             # 日期 / 时间处理工具
│  │  ├─ permission.js       # 权限判断工具
│  │  └─ validate.js         # 表单 / 数据校验工具
│  ├─ views/                 # 页面级组件
│  ├─ App.vue                # 根组件
│  └─ main.js                # 项目入口
├─ .env                      # 公共环境变量
├─ .env.development          # 开发环境变量
├─ .env.test                 # 测试环境变量
├─ .env.production           # 生产环境变量
├─ index.html
├─ package.json
└─ README.md
```

---

## 三、src 内各模块初始化说明

### 1️⃣ api（接口管理）

**职责：**

* 所有接口统一在这里管理
* 按业务模块拆分文件

```text
api/
├─ user.js
├─ auth.js
└─ home.js
```

示例：

```js
import { request } from '@/request'

export function login(data) {
  return request({
    url: '/login',
    method: 'POST',
    data
  })
}
```

---

### 2️⃣ request/request（统一请求封装）

**职责：**

* 所有 axios 请求统一入口
* 自动带 token
* 支持多域名接口
* 页面 / 组件直接调用 `request({ url, method, data, baseURL })`

示例：

```js
import { request } from '@/request'

// 主域名接口
let result = await request({ url: '/user/info', method: 'GET' })

// 不同域名接口
let result2 = await request({ url: '/wx/config', method: 'GET', baseURL: 'https://api.thirdparty.com' })
```

---

### 3️⃣ utils/storage.js

**职责：**

* 提供统一 localStorage / sessionStorage 封装
* 简化 get / set / remove 操作

示例：

```js
import storage from '@/utils/storage'

storage.set('user', { name: '张三' })
const user = storage.get('user')
storage.remove('user')
```

---

### 4️⃣ components（公共组件）

**职责：**

* 多页面复用组件
* 与具体业务无强耦合

---

### 5️⃣ hooks（组合式 Hooks）

**职责：**

* 抽离逻辑
* 复用状态与行为

示例：

```js
export function useLoading() {
  const loading = ref(false)
  return { loading }
}
```

---

### 6️⃣ directives（自定义指令）

**职责：**

* 权限控制
* 防抖 / 节流

---

### 7️⃣ layout（布局）

**职责：**

* 后台整体框架
* Header / Sidebar / Main

---

### 8️⃣ router（路由 & 权限）

**职责：**

* 页面访问控制
* 动态路由

---

### 9️⃣ store（Pinia）

**职责：**

* 一个文件 = 一个 store
* 禁止所有状态写在一个 store 里

---

### 🔟 styles（样式体系初始化）

**职责：**

* 全局样式、变量、可复用快捷类
* Element Plus 覆盖样式

---

### 11 views（页面）

**职责：**

* 页面只处理 UI + 业务，不写通用逻辑
* 一个页面一个文件夹

---

### 12 文件与路径大小写约定  

- 所有 **文件夹和文件路径建议使用小写**，例如 `components/navbar`、`layout/admin.vue`。
- Vue 组件名可以保持大写开头，如 `Navbar.vue`、`Sidebar.vue`，但 import 路径必须与文件系统大小写一致。
- 避免大小写不一致导致 Vite/ESM 模块解析报错，尤其在 Windows 上也会触发 HMR 问题。

---

## 四、环境变量 & 多环境部署

### 启动开发

```bash
npm run dev
```

### 打包测试环境

```bash
npm run build:test
```

### 打包生产环境

```bash
npm run build:prod
```

### Nginx 配置（history 模式）

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

---

## 五、团队协作开发规范

1. 所有接口必须写在 api 目录
2. 页面 / 组件禁止直接写 axios，统一通过 request/request 调用
3. 样式统一放 styles，不允许随意写全局样式
4. 页面逻辑优先使用 hooks
5. 组件必须可复用，禁止写死业务

---


# wan
