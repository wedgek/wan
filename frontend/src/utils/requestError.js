import { ElMessage } from "element-plus"

let lastUnreachableAt = 0

/** 网络中断、超时、502/503：后端重启或代理连不上，不是登录失效 */
export function isTransientError(error) {
  if (!error || error.isAuthExpired) return false
  if (error.isTransient) return true
  const status = error.response?.status
  if (error.response) return status >= 500
  const code = error.code
  if (code === "ECONNABORTED" || code === "ERR_NETWORK" || code === "ECONNRESET" || code === "ERR_BAD_RESPONSE") {
    return true
  }
  return typeof error.message === "string" && /Network Error|ECONNREFUSED|timeout|ETIMEDOUT|502|503|504/i.test(error.message)
}

export function markTransient(error, fallbackMessage = "后端暂时不可用，请稍后重试") {
  const err = error instanceof Error ? error : new Error(fallbackMessage)
  err.isTransient = true
  return err
}

export function markAuthExpired(message = "登录已过期，请重新登录") {
  const err = new Error(message)
  err.isAuthExpired = true
  return err
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 只对瞬时失败重试，登录失效立即抛出 */
export async function withTransientRetry(fn, { retries = 2, delayMs = 700 } = {}) {
  let lastError
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isTransientError(error) || i === retries) throw error
      await delay(delayMs)
    }
  }
  throw lastError
}

export function notifyBackendUnreachable() {
  const now = Date.now()
  if (now - lastUnreachableAt < 8000) return
  lastUnreachableAt = now
  ElMessage.warning("暂时没能同步登录信息，已保留当前登录状态")
}
