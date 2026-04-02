import OSS from 'ali-oss'
import request from '@/request'

// OSS 目录配置
export const OSS_DIRS = {
  IMAGE: 'image/',
  VIDEO: 'video/',
  APK: 'apk/',
  DOCUMENT: 'document/'
}

// 扩展名 → 目录映射
const EXT_DIR_MAP = {
  jpg: OSS_DIRS.IMAGE, jpeg: OSS_DIRS.IMAGE, png: OSS_DIRS.IMAGE,
  gif: OSS_DIRS.IMAGE, webp: OSS_DIRS.IMAGE, bmp: OSS_DIRS.IMAGE, svg: OSS_DIRS.IMAGE,
  mp4: OSS_DIRS.VIDEO, avi: OSS_DIRS.VIDEO, mov: OSS_DIRS.VIDEO,
  mkv: OSS_DIRS.VIDEO, wmv: OSS_DIRS.VIDEO, flv: OSS_DIRS.VIDEO, webm: OSS_DIRS.VIDEO,
  apk: OSS_DIRS.APK, ipa: OSS_DIRS.APK, exe: OSS_DIRS.APK, dmg: OSS_DIRS.APK, msi: OSS_DIRS.APK,
}

// 需要分片上传的文件类型
const LARGE_FILE_EXTS = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'apk', 'ipa', 'exe', 'dmg', 'msi']

// 获取文件扩展名
export const getFileExt = (file) => (file.name?.split('.').pop() || '').toLowerCase()

// 根据文件类型获取上传目录
export const getUploadDir = (file) => EXT_DIR_MAP[getFileExt(file)] || OSS_DIRS.DOCUMENT

// 判断是否需要分片上传（大文件类型 或 >20MB）
export const needMultipart = (file) => 
  LARGE_FILE_EXTS.includes(getFileExt(file)) || file.size > 20 * 1024 * 1024

// 生成唯一文件名
const buildObjectName = (file, dir) => {
  const ext = file.name?.split('.').pop() || file.type?.split('/').pop() || 'bin'
  const baseName = (file.name?.replace(/\.[^.]+$/, '') || 'file').slice(0, 20)
  const suffix = String(Date.now()).slice(-6)
  return `${dir}${baseName}_${suffix}.${ext}`
}

// ============ STS Token 缓存 ============
let cachedClient = null
let clientExpireTime = 0
let clientPromise = null
const SAFETY_MARGIN = 5 * 60 * 1000 // 5分钟安全边际

// 判断是否为 Token 过期错误
const isTokenExpiredError = (err) => {
  const msg = err?.message || err?.code || ''
  return msg.includes('SecurityTokenExpired') || 
         msg.includes('InvalidAccessKeyId') ||
         msg.includes('AccessDenied') ||
         msg.includes('token')
}

// 强制刷新 client
export function refreshClient() {
  cachedClient = null
  clientExpireTime = 0
  clientPromise = null
}

// 创建 OSS Client
async function createClient() {
  const now = Date.now()
  
  // Token 仍有效则复用
  if (cachedClient && (clientExpireTime - now > SAFETY_MARGIN)) {
    return cachedClient
  }
  
  // 防止并发重复请求
  if (clientPromise) return clientPromise
  
  clientPromise = (async () => {
    try {
      const res = await request({ url: '/admin-api/ali/getStsToken', method: 'POST' })
      if (res.code !== 0) throw new Error(res.msg || '获取 OSS STS 失败')

      const { accessKeyId, accessKeySecret, securityToken, expiration } = res.data?.credentials || {}
      
      cachedClient = new OSS({
        accessKeyId,
        accessKeySecret,
        stsToken: securityToken,
        bucket: import.meta.env.VITE_OSS_BUCKET,
        region: import.meta.env.VITE_OSS_REGION,
      })
      
      // STS Token 通常有效期 1 小时
      clientExpireTime = expiration ? new Date(expiration).getTime() : (now + 55 * 60 * 1000)
      
      return cachedClient
    } finally {
      clientPromise = null
    }
  })()
  
  return clientPromise
}

// 带重试的上传执行器
async function executeWithRetry(uploadFn, maxRetry = 1) {
  try {
    return await uploadFn()
  } catch (err) {
    // Token 过期则刷新后重试一次
    if (maxRetry > 0 && isTokenExpiredError(err)) {
      refreshClient()
      return executeWithRetry(uploadFn, maxRetry - 1)
    }
    throw err
  }
}

// ============ 上传方法 ============

// 基础上传
async function upload(file, { dir, multipart }) {
  return executeWithRetry(async () => {
    const client = await createClient()
    const objectName = buildObjectName(file, dir)

    if (!multipart) {
      const res = await client.put(objectName, file)
      return res.url
    }

    const res = await client.multipartUpload(objectName, file)
    return res.res.requestUrls?.[0]?.split('?')[0]
  })
}

// 带进度的上传
export async function uploadWithProgress(file, options = {}) {
  const { dir, onProgress } = options
  const targetDir = dir || getUploadDir(file)

  return executeWithRetry(async () => {
    const client = await createClient()
    const objectName = buildObjectName(file, targetDir)

    if (!needMultipart(file)) {
      const res = await client.put(objectName, file)
      onProgress?.(100)
      return res.url
    }

    const res = await client.multipartUpload(objectName, file, {
      parallel: 4,
      partSize: 1024 * 1024,
      progress: (p) => onProgress?.(Math.round(p * 100)),
    })

    return res.res.requestUrls?.[0]?.split('?')[0]
  })
}

// 批量上传
export async function uploadBatch(files, options = {}) {
  const { dir, maxConcurrent = 6, onFileProgress, onFileComplete, onFileError } = options
  
  const client = await createClient()
  const targetDir = dir || OSS_DIRS.IMAGE
  
  const results = []
  const queue = [...files]
  const uploading = new Set()
  
  // 单个文件上传（带重试）
  const uploadSingleFile = async (file) => {
    const objectName = buildObjectName(file, targetDir)
    
    try {
      const res = await client.put(objectName, file)
      return res.url
    } catch (err) {
      // Token 过期则刷新 client 并重试
      if (isTokenExpiredError(err)) {
        refreshClient()
        const newClient = await createClient()
        const res = await newClient.put(objectName, file)
        return res.url
      }
      throw err
    }
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
            const url = await uploadSingleFile(file)
            
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

// 上传图片
export const uploadImage = (file) => upload(file, { dir: OSS_DIRS.IMAGE, multipart: false })

// 上传视频
export const uploadVideo = (file) => upload(file, { dir: OSS_DIRS.VIDEO, multipart: true })

// 通用文件上传
export const uploadFile = (file, dir) => upload(file, { 
  dir: dir || getUploadDir(file), 
  multipart: needMultipart(file) 
})
