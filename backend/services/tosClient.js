/**
 * 火山引擎 TOS（对象存储）服务端客户端。
 * 环境变量：
 * - TOS_ACCESS_KEY / TOS_SECRET_KEY（或 TOS_ACCESS_KEY_ID / TOS_ACCESS_KEY_SECRET）
 * - TOS_REGION：如 cn-guangzhou
 * - TOS_ENDPOINT：如 https://tos-cn-guangzhou.volces.com
 * - TOS_BUCKET：桶名
 * - TOS_PUBLIC_BASE_URL（可选）：公开访问根，如 https://wanx-ai.tos-cn-guangzhou.volces.com
 *   不填则按 {bucket}.tos-{region}.volces.com 拼接（适用于桶已配置公共读时的直链）
 */

const { TosClient } = require('@volcengine/tos-sdk')

let cachedClient = null
/** 配置变化时重建客户端，避免 watch 热重载后仍用旧 endpoint */
let cachedClientSig = ''

function stripEndpointHost(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^https?:\/\//i, '')
  s = s.replace(/\/+$/, '')
  return s
}

function getConfig() {
  const accessKeyId = process.env.TOS_ACCESS_KEY || process.env.TOS_ACCESS_KEY_ID || ''
  const accessKeySecret = process.env.TOS_SECRET_KEY || process.env.TOS_ACCESS_KEY_SECRET || ''
  const region = (process.env.TOS_REGION || '').trim()
  const endpointRaw = (process.env.TOS_ENDPOINT || '').trim()
  const endpoint = stripEndpointHost(endpointRaw)
  const secure =
    process.env.TOS_SECURE === '0' || String(process.env.TOS_SECURE).toLowerCase() === 'false'
      ? false
      : !/^http:\/\//i.test(endpointRaw)
  const bucket = (process.env.TOS_BUCKET || '').trim()
  const publicBase = (process.env.TOS_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  return { accessKeyId, accessKeySecret, region, endpoint, secure, bucket, publicBase }
}

function isConfigured() {
  const c = getConfig()
  return !!(c.accessKeyId && c.accessKeySecret && c.region && c.endpoint && c.bucket)
}

function getClient() {
  const { accessKeyId, accessKeySecret, region, endpoint, secure } = getConfig()
  if (!accessKeyId || !accessKeySecret || !region || !endpoint) {
    const err = new Error('TOS 未配置完整：需要 TOS_ACCESS_KEY、TOS_SECRET_KEY、TOS_REGION、TOS_ENDPOINT、TOS_BUCKET')
    err.code = 'E_TOS_CONFIG'
    throw err
  }
  const sig = `${accessKeyId}\0${region}\0${endpoint}\0${secure ? 1 : 0}`
  if (cachedClient && sig === cachedClientSig) return cachedClient
  cachedClientSig = sig
  cachedClient = new TosClient({
    accessKeyId,
    accessKeySecret,
    region,
    endpoint,
    secure,
  })
  return cachedClient
}

function defaultPublicBase() {
  const { bucket, region, publicBase } = getConfig()
  if (publicBase) return publicBase
  if (!bucket || !region) return ''
  return `https://${bucket}.tos-${region}.volces.com`
}

function publicUrlForKey(objectKey) {
  const base = defaultPublicBase()
  if (!base) return ''
  const key = String(objectKey || '').replace(/^\/+/, '')
  const encoded = key.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  return `${base}/${encoded}`
}

/**
 * @param {object} opts
 * @param {string} opts.localPath
 * @param {string} opts.objectKey
 * @param {string} [opts.contentType]
 */
async function putFileFromPath(opts) {
  const { bucket } = getConfig()
  if (!bucket) throw new Error('TOS_BUCKET 未配置')
  const client = getClient()
  const input = {
    bucket,
    key: opts.objectKey,
    filePath: opts.localPath,
  }
  if (opts.contentType) input.contentType = opts.contentType
  await client.putObjectFromFile(input)
  return { key: opts.objectKey, url: publicUrlForKey(opts.objectKey) }
}

module.exports = {
  getConfig,
  isConfigured,
  getClient,
  publicUrlForKey,
  putFileFromPath,
}
