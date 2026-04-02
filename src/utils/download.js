/**
 * 文件下载工具
 */
const download = {
  /**
   * 通过URL下载文件（本页面下载）
   * @param {string} url - 文件URL
   * @param {string} filename - 文件名（可选，默认从URL提取）
   */
  url(url, filename) {
    if (!url) {
      console.error('下载链接为空')
      return
    }
    const link = document.createElement('a')
    link.href = url
    link.download = filename || url.split('/').pop() || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  },

  /**
   * 下载Excel文件
   * @param {Blob} data - 文件数据
   * @param {string} filename - 文件名
   */
  excel(data, filename = 'export.xls') {
    if (!data) {
      console.error('下载数据为空')
      return
    }

    // 如果是Blob对象，直接下载
    if (data instanceof Blob) {
      const url = window.URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      return
    }

    // 如果是base64字符串
    if (typeof data === 'string' && data.startsWith('data:')) {
      const link = document.createElement('a')
      link.href = data
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    }

    // 其他情况，尝试转换为Blob
    const blob = new Blob([data], {
      type: 'application/vnd.ms-excel',
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  },

  /**
   * 下载文件（通用方法）
   * @param {Blob|string} data - 文件数据
   * @param {string} filename - 文件名
   * @param {string} mimeType - MIME类型
   */
  file(data, filename, mimeType = 'application/octet-stream') {
    if (!data) {
      console.error('下载数据为空')
      return
    }

    let blob
    if (data instanceof Blob) {
      blob = data
    } else if (typeof data === 'string' && data.startsWith('data:')) {
      const link = document.createElement('a')
      link.href = data
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    } else {
      blob = new Blob([data], { type: mimeType })
    }

    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  },
}

export default download

