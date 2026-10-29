import axios from "axios"
import router from "@/router"
import { useAuthStore } from "@/stores/auth"
import { getStorage } from "@/utils/storage"
import { delay, markAuthExpired, markTransient } from "@/utils/requestError"

/**
 * 规范化 API 根地址。避免出现 http://localhost:8 这类误配置（少写端口/笔误），
 * 导致请求打到错误端口 404，进而影响页面表现。
 */
function resolveApiBaseUrl() {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (raw == null || String(raw).trim() === "") return ""
  const s = String(raw).trim().replace(/\/+$/, "")
  try {
    const baseForParse = /^[a-zA-Z][a-zA-Z+\-.]*:\/\//.test(s) ? s : `http://${s}`
    const u = new URL(baseForParse)
    if (!u.port) return s
    const portNum = Number(u.port)
    if (portNum > 0 && portNum < 10) {
      console.warn(
        `[request] VITE_API_BASE_URL 端口异常 (${u.port})，已改为同源请求。请改为正确端口（开发示例：留空走 Vite 代理，或 http://127.0.0.1:3000）。当前值：`,
        raw,
      )
      return ""
    }
  } catch {
    console.warn("[request] VITE_API_BASE_URL 无法解析，已改为同源请求：", raw)
    return ""
  }
  return s
}

const service = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
})

let refreshPromise = null

function refreshUrl() {
  const base = resolveApiBaseUrl()
  return (base ? String(base).replace(/\/+$/, "") : "") + "/admin-api/system/auth/refresh-token"
}

function classifyRefreshBody(body) {
  if (body?.code === 0 && body.data?.accessToken) {
    useAuthStore().setTokenPair(body.data)
    return { accessToken: body.data.accessToken }
  }
  if (body?.code === 401 || body?.code === 400) return { invalid: true }
  return { transient: true }
}

async function postRefresh(refreshToken) {
  try {
    const axiosRes = await axios.post(
      refreshUrl(),
      { refreshToken },
      { timeout: 10000, headers: { "Content-Type": "application/json" } },
    )
    return classifyRefreshBody(axiosRes.data)
  } catch {
    return { transient: true }
  }
}

/**
 * 使用独立请求，避免进入本 service 的 401 拦截逻辑。
 * 后端重启、超时、502 记为 transient，不把登录态清掉。
 */
function refreshAccessToken() {
  if (refreshPromise) return refreshPromise
  const rt = getStorage("refreshToken")
  if (rt == null || rt === "") return Promise.resolve({ invalid: true })
  refreshPromise = (async () => {
    let result = await postRefresh(rt)
    if (result.transient) {
      await delay(600)
      result = await postRefresh(getStorage("refreshToken") || rt)
    }
    return result
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

async function handleBusiness401(response) {
  const config = response.config
  if (config.__authRetried) {
    handleUnauthorized()
    return Promise.reject(markAuthExpired())
  }
  const result = await refreshAccessToken()
  if (result?.transient) {
    return Promise.reject(markTransient(new Error("后端暂时不可用，请稍后重试")))
  }
  if (!result?.accessToken) {
    handleUnauthorized()
    return Promise.reject(markAuthExpired(response.data?.msg))
  }
  config.__authRetried = true
  config.headers = config.headers || {}
  config.headers.Authorization = `Bearer ${result.accessToken}`
  return service.request(config)
}

// 请求拦截器
service.interceptors.request.use(
  (config) => {
    const token = useAuthStore().token
    token && (config.headers.Authorization = `Bearer ${token}`)
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"]
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器
service.interceptors.response.use(
  (response) => {
    const res = response.data
    if (res?.code === 401) {
      return handleBusiness401(response)
    }
    return res
  },
  (error) => {
    const data = error?.response?.data
    if (data && typeof data === "object" && Number(data.code) === 401 && error.config) {
      return handleBusiness401({ data, config: error.config })
    }
    const status = error?.response?.status
    if (!error?.response || status >= 500 || error.code === "ECONNABORTED" || error.code === "ERR_NETWORK") {
      return Promise.reject(markTransient(error))
    }
    return Promise.reject(error)
  }
)

// 响应拦截器锁
let isHandlingUnauthorized = false

// 处理未授权
function handleUnauthorized() {
  if (isHandlingUnauthorized) return

  // 若当前已经在登录页，退出逻辑
  const currentPath = router.currentRoute.value?.path
  if (currentPath === "/login") return

  isHandlingUnauthorized = true

  // 退出登录
  useAuthStore().logout()

  setTimeout(() => (isHandlingUnauthorized = false), 1000)
}

export default service
