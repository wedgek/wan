export const getStorage = (key) => {
  try {
    const item = localStorage.getItem(key)
    if (item === null) return null
    
    // 尝试解析 JSON
    try {
      return JSON.parse(item)
    } catch (e) {
      // 如果解析失败，说明可能是纯字符串，直接返回
      return item
    }
  } catch (error) {
    console.error("Storage get error:", error)
    return null
  }
}

export const setStorage = (key, value) => {
  try {
    if (typeof value === 'string') {
      try {
        JSON.parse(value)
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        localStorage.setItem(key, value)
      }
    } else {
      localStorage.setItem(key, JSON.stringify(value))
    }
  } catch (error) {
    console.error("Storage set error:", error)
  }
}

export const removeStorage = (key) => {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.error("Storage remove error:", error)
  }
}

export const clearStorage = () => {
  try {
    localStorage.clear()
  } catch (error) {
    console.error("Storage clear error:", error)
  }
}
