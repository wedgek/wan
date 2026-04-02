import axios from "axios"
import router from "@/router"
import { useAuthStore } from "@/stores/auth"

const service = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
})

// 请求拦截器
service.interceptors.request.use(
  (config) => {
    const token = useAuthStore().token
    token && (config.headers.Authorization = `Bearer ${token}`)
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器
service.interceptors.response.use(
  (response) => {
    const res = response.data
    if (res?.code === 401) {
      handleUnauthorized()
      return Promise.reject(new Error('登录已过期，请重新登录'))
    }
    return res
  },
  (error) => {
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
  if (currentPath === '/login') return
  
  isHandlingUnauthorized = true

  // 退出登录
  useAuthStore().logout()

  setTimeout(() => isHandlingUnauthorized = false, 1000)
}

export default service
