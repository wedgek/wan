import request from '@/request'

/** 与后端 storage 路由约定的目录前缀 */
export const OSS_DIRS = {
  IMAGE: 'image/',
  VIDEO: 'video/',
  APK: 'apk/',
  DOCUMENT: 'document/'
}

const EXT_DIR_MAP = {
  jpg: OSS_DIRS.IMAGE, jpeg: OSS_DIRS.IMAGE, png: OSS_DIRS.IMAGE,
  gif: OSS_DIRS.IMAGE, webp: OSS_DIRS.IMAGE, bmp: OSS_DIRS.IMAGE, svg: OSS_DIRS.IMAGE,
  mp4: OSS_DIRS.VIDEO, avi: OSS_DIRS.VIDEO, mov: OSS_DIRS.VIDEO,
  mkv: OSS_DIRS.VIDEO, wmv: OSS_DIRS.VIDEO, flv: OSS_DIRS.VIDEO, webm: OSS_DIRS.VIDEO,
  apk: OSS_DIRS.APK, ipa: OSS_DIRS.APK, exe: OSS_DIRS.APK, dmg: OSS_DIRS.APK, msi: OSS_DIRS.APK,
}

const LARGE_FILE_EXTS = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'apk', 'ipa', 'exe', 'dmg', 'msi']

export const getFileExt = (file) => (file.name?.split('.').pop() || '').toLowerCase()

export const getUploadDir = (file) => EXT_DIR_MAP[getFileExt(file)] || OSS_DIRS.DOCUMENT

export const needMultipart = (file) =>
  LARGE_FILE_EXTS.includes(getFileExt(file)) || file.size > 20 * 1024 * 1024

/** 兼容旧代码：已不再使用 STS，无需刷新 */
export function refreshClient() {}

function pickUploadUrl(data) {
  if (data == null) return ''
  if (typeof data === 'string') return data.trim()
  if (Array.isArray(data)) return pickUploadUrl(data[0])
  if (typeof data === 'object') {
    const url = data.url || data.fileUrl || data.file_url || ''
    return typeof url === 'string' ? url.trim() : ''
  }
  return ''
}

/**
 * 服务端火山 TOS 上传（multipart/form-data）
 * @returns {Promise<{ url: string }>}
 */
async function uploadViaBackend(file, { dir, onProgress, timeout }) {
  const form = new FormData()
  form.append('file', file)
  form.append('dir', dir)

  const res = await request({
    url: '/admin-api/storage/upload',
    method: 'POST',
    data: form,
    timeout: timeout ?? (needMultipart(file) ? 600000 : 120000),
    onUploadProgress: onProgress
      ? (evt) => {
          if (evt.total) onProgress(Math.min(100, Math.round((evt.loaded / evt.total) * 100)))
        }
      : undefined,
  })

  if (res.code !== 0) {
    const err = new Error(res.msg || '上传失败')
    err.response = { data: res }
    throw err
  }
  const url = pickUploadUrl(res.data)
  if (!url) throw new Error('上传成功但未返回地址')
  return { url }
}

export async function uploadWithProgress(file, options = {}) {
  const { dir, onProgress } = options
  const targetDir = dir || getUploadDir(file)
  return uploadViaBackend(file, { dir: targetDir, onProgress })
}

export async function uploadBatch(files, options = {}) {
  const { dir, maxConcurrent = 6, onFileProgress, onFileComplete, onFileError } = options
  const targetDir = dir || OSS_DIRS.IMAGE

  const results = []
  const queue = [...files]
  const uploading = new Set()

  const uploadSingleFile = async (file) => {
    return uploadViaBackend(file, { dir: targetDir })
  }

  return new Promise((resolve) => {
    const processNext = async () => {
      if (queue.length === 0 && uploading.size === 0) {
        resolve(results)
        return
      }

      while (uploading.size < maxConcurrent && queue.length > 0) {
        const file = queue.shift()
        const uid = file.uid || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        uploading.add(uid)

        ;(async () => {
          try {
            const { url } = await uploadSingleFile(file)
            onFileProgress?.(uid, 100)
            onFileComplete?.(uid, url, file)
            results.push({ uid, url, file, success: true })
          } catch (err) {
            onFileError?.(uid, err, file)
            results.push({ uid, file, success: false, error: err })
          } finally {
            uploading.delete(uid)
            processNext()
          }
        })()
      }
    }

    processNext()
  })
}

export const uploadImage = (file) => uploadViaBackend(file, { dir: OSS_DIRS.IMAGE })

export const uploadVideo = (file) =>
  uploadViaBackend(file, { dir: OSS_DIRS.VIDEO, timeout: 600000 })

export const uploadFile = (file, dir) =>
  uploadViaBackend(file, { dir: dir || getUploadDir(file), timeout: needMultipart(file) ? 600000 : 120000 })
