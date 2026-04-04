#!/usr/bin/env node
/**
 * 排查 TOS「桶不存在」：列出当前 AK 可见的桶及地域，对照 .env / 环境变量中的 TOS_BUCKET、TOS_REGION。
 * 用法：在 backend 目录执行  npm run tos:check
 * 注意：若你在 PowerShell 里设了 $env:，请在与执行本命令相同的终端里先设置再运行。
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const accessKeyId = process.env.TOS_ACCESS_KEY || process.env.TOS_ACCESS_KEY_ID || ''
const accessKeySecret = process.env.TOS_SECRET_KEY || process.env.TOS_ACCESS_KEY_SECRET || ''
const region = (process.env.TOS_REGION || '').trim()
const endpointRaw = (process.env.TOS_ENDPOINT || '').trim()
const endpoint = String(endpointRaw)
  .replace(/^https?:\/\//i, '')
  .replace(/\/+$/, '')
const secure = !/^http:\/\//i.test(endpointRaw)
const bucket = (process.env.TOS_BUCKET || '').trim()

if (!accessKeyId || !accessKeySecret || !region || !endpoint) {
  console.error(
    '[tos-diagnose] 缺少配置：请在 backend/.env 填写 TOS_ACCESS_KEY、TOS_SECRET_KEY、TOS_REGION、TOS_ENDPOINT，\n' +
      '或在同一终端先执行 $env:TOS_ACCESS_KEY="..." 等再运行本命令。',
  )
  process.exit(1)
}

const { TosClient } = require('@volcengine/tos-sdk')

function normalizeBuckets(res) {
  const d = res && res.data != null ? res.data : res
  if (!d) return []
  const raw = d.Buckets
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const b = raw.Bucket
    if (Array.isArray(b)) return b
    if (b) return [b]
  }
  return []
}

async function main() {
  const client = new TosClient({
    accessKeyId,
    accessKeySecret,
    region,
    endpoint,
    secure,
  })
  console.log(
    '[tos-diagnose] 本进程读取到的配置：bucket=%s region=%s endpoint=%s\n',
    bucket || '(空)',
    region,
    endpoint,
  )

  try {
    const res = await client.listBuckets()
    const list = normalizeBuckets(res)
    if (!list.length) {
      console.log('（_listBuckets 返回空列表：账号下暂无桶，或需到控制台创建）')
    } else {
      console.log('当前访问密钥可见的桶（Name + Location）：')
      for (const b of list) {
        const name = b.Name != null ? b.Name : b.name
        const loc = b.Location != null ? b.Location : b.LocationConstraint || ''
        console.log('  ·', String(name), loc ? `  ${loc}` : '')
      }
    }

    if (!bucket) {
      console.log('\n[提示] 未设置 TOS_BUCKET，请在 .env 中设置要使用的桶名。')
      return
    }

    const nameSet = new Set(
      list.map((b) => String(b.Name != null ? b.Name : b.name || '').trim()).filter(Boolean),
    )
    if (!nameSet.has(bucket)) {
      console.error(
        '\n[不匹配] 环境变量 TOS_BUCKET="%s" 不在上述列表中。\n' +
          '  → 检查桶名是否完全一致（仅小写字母、数字、连字符）。\n' +
          '  → 或当前 AK 是否与创建该桶的火山账号一致。',
        bucket,
      )
      process.exit(2)
    }

    try {
      const locRes = await client.getBucketLocation({ bucket })
      const d = locRes && locRes.data != null ? locRes.data : locRes
      const loc = (d && (d.Location || d['Location'])) || ''
      const locStr = typeof loc === 'string' ? loc.trim() : String(loc || '')
      console.log('\n[getBucketLocation] 桶', bucket, '→ 地域:', locStr || '(无)')

      if (locStr && locStr !== region) {
        console.error(
          '\n[根因极可能在此] .env 里 TOS_REGION="%s"，但该桶实际地域为 "%s"。\n' +
            '请把 TOS_REGION 改为桶所属地域，并把 TOS_ENDPOINT 改为该地域的火山 TOS endpoint（例如 cn-guangzhou → https://tos-cn-guangzhou.volces.com），然后重启后端。',
          region,
          locStr,
        )
        process.exit(3)
      }
    } catch (e) {
      console.warn('[tos-diagnose] getBucketLocation 异常（可忽略）:', e.message || e)
    }

    console.log('\n[结论] 桶名在账号中存在且地域与 TOS_REGION 一致。若上传仍报错，请看后端控制台 [storage] 日志或联系火山工单。')
  } catch (e) {
    console.error('[tos-diagnose] listBuckets 失败:', e.message || e)
    process.exit(2)
  }
}

main()
