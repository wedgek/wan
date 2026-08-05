/**
 * 浏览器直连抖音聚合接口（bugpk）。
 * 仅在页面开关为「浏览器」时使用；落库仍走后端 /logs/:id/client-complete。
 */

const DEFAULT_AGG_API = "https://api.bugpk.com/api/douyin"
const REQUEST_TIMEOUT_MS = 12000
const MAX_RETRIES = 2
const RETRY_BASE_MS = 600

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJsonWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      // 不自定义危险头，避免触发额外 CORS 预检；Referer 由浏览器自动带当前页
    })
    const text = await resp.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch (_) {
      throw new Error("聚合接口返回异常")
    }
    if (!resp.ok) {
      throw new Error(`聚合接口 HTTP ${resp.status}`)
    }
    return data
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("解析超时，请稍后重试")
    // 浏览器跨域被拦时，错误信息通常是 Failed to fetch / NetworkError
    const msg = String((e && e.message) || "")
    if (/failed to fetch|networkerror|cors|load failed/i.test(msg)) {
      throw new Error("浏览器无法直连聚合接口（可能被跨域拦截），请切回「服务器」模式或检查网络")
    }
    throw e instanceof Error ? e : new Error(msg || "聚合接口请求失败")
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调用聚合接口，返回 data 节点（与后端 fetchAggregator 对齐）
 * @param {string} awemeId
 * @param {string} [aggApi]
 */
export async function fetchAggregatorData(awemeId, aggApi = DEFAULT_AGG_API) {
  const share = `https://www.douyin.com/video/${awemeId}`
  const base = String(aggApi || DEFAULT_AGG_API).replace(/\?.*$/, "").replace(/\/+$/, "")
  const target = `${base}?url=${encodeURIComponent(share)}`

  let lastErr
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const data = await fetchJsonWithTimeout(target)
      if (!data || Number(data.code) !== 200 || !data.data) {
        throw new Error(`聚合接口返回异常：${(data && data.msg) || "无数据"}`)
      }
      return data.data
    } catch (e) {
      lastErr = e
      if (attempt === MAX_RETRIES) break
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt))
    }
  }
  throw lastErr || new Error("聚合接口请求失败，请稍后重试")
}
