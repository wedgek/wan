/**
 * 视频任务 Token 用量解析与 DMXAPI Token 计费落库
 */
const { fetchDmxapiPricingMap, pickPriceInfoDefault, computeTokenCostYuan } = require('./dmxapiModelMeta')

function parseJsonField(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch (_) {
    return null
  }
}

/**
 * @param {object} remote API 响应
 * @returns {{ input: number, output: number }|null}
 */
function extractUsageFromRemote(remote) {
  if (!remote || typeof remote !== 'object') return null
  const u = remote.usage
  if (!u || typeof u !== 'object') return null

  let input = u.input_tokens
  let output = u.output_tokens
  if (input == null && u.prompt_tokens != null) input = u.prompt_tokens
  if (output == null && u.completion_tokens != null) output = u.completion_tokens

  const inN = Number(input)
  const outN = Number(output)
  if (!Number.isFinite(inN) && !Number.isFinite(outN)) return null

  return {
    input: Number.isFinite(inN) ? Math.max(0, Math.floor(inN)) : 0,
    output: Number.isFinite(outN) ? Math.max(0, Math.floor(outN)) : 0,
  }
}

function pricingFromCatalogRow(row) {
  if (!row) return { entry: null, groupRatio: 1 }
  const raw = parseJsonField(row.raw_meta_json)
  const entry = raw?.pricing || null
  return { entry, groupRatio: 1 }
}

function resolvePriceInfoFromDb(dbi, apiModelId, catalogId) {
  const cid = Number(catalogId)
  if (cid > 0) {
    const row = dbi
      .prepare(`SELECT raw_meta_json FROM model_catalog WHERE id = ? LIMIT 1`)
      .get(cid)
    const { entry, groupRatio } = pricingFromCatalogRow(row)
    if (entry) return { pi: pickPriceInfoDefault(entry), groupRatio, pricingEntry: entry }
  }

  const mid = String(apiModelId || '').trim()
  if (mid) {
    const row = dbi
      .prepare(`SELECT raw_meta_json FROM model_catalog WHERE api_model_id = ? LIMIT 1`)
      .get(mid)
    const { entry, groupRatio } = pricingFromCatalogRow(row)
    if (entry) return { pi: pickPriceInfoDefault(entry), groupRatio, pricingEntry: entry }
  }

  return { pi: null, groupRatio: 1, pricingEntry: null }
}

async function resolvePriceInfo(dbi, apiModelId, catalogId) {
  const fromDb = resolvePriceInfoFromDb(dbi, apiModelId, catalogId)
  if (fromDb.pi) return fromDb

  const mid = String(apiModelId || '').trim()
  if (!mid) return fromDb

  try {
    const { map, groupRatio } = await fetchDmxapiPricingMap()
    const entry = map.get(mid) || null
    if (entry) {
      return {
        pi: pickPriceInfoDefault(entry),
        groupRatio: Number(groupRatio) || 1,
        pricingEntry: entry,
      }
    }
  } catch (e) {
    console.warn('[videoJobBilling] resolvePriceInfo fetch', e.message)
  }

  return fromDb
}

function resolveBillingContext(dbi, jobId, ctx = {}) {
  let apiModelId = String(ctx.apiModelId || '').trim()
  let catalogId = ctx.catalogId

  if ((!apiModelId || catalogId == null) && jobId) {
    const row = dbi
      .prepare(
        `SELECT vm.api_model_id, vm.catalog_id
         FROM video_jobs j
         LEFT JOIN video_models vm ON vm.id = j.video_model_id
         WHERE j.id = ?`,
      )
      .get(jobId)
    if (row) {
      if (!apiModelId) apiModelId = String(row.api_model_id || '').trim()
      if (catalogId == null) catalogId = row.catalog_id
    }
  }

  return { apiModelId, catalogId }
}

/**
 * 从远端响应提取 usage，仅在 token 总量增加时落库并计费
 * @param {import('better-sqlite3').Database} dbi
 */
async function mergeAndPersistJobUsage(dbi, jobId, remote, ctx = {}) {
  const id = Number(jobId)
  if (!id) return

  const usage = extractUsageFromRemote(remote)
  if (!usage) return

  const row = dbi
    .prepare(`SELECT usage_input_tokens, usage_output_tokens, cost_yuan FROM video_jobs WHERE id = ?`)
    .get(id)
  if (!row) return

  const prevIn = Number(row.usage_input_tokens) || 0
  const prevOut = Number(row.usage_output_tokens) || 0
  const prevTotal = prevIn + prevOut
  const newTotal = usage.input + usage.output
  if (newTotal <= prevTotal) return

  const { apiModelId, catalogId } = resolveBillingContext(dbi, id, ctx)
  const { pi, groupRatio } = await resolvePriceInfo(dbi, apiModelId, catalogId)

  let costYuan = row.cost_yuan
  if (pi) {
    const computed = computeTokenCostYuan(pi, usage.input, usage.output, groupRatio, 1)
    if (computed != null) costYuan = computed
  }

  dbi
    .prepare(
      `UPDATE video_jobs SET usage_input_tokens = ?, usage_output_tokens = ?, cost_yuan = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .run(usage.input, usage.output, costYuan, id)
}

module.exports = {
  extractUsageFromRemote,
  resolvePriceInfoFromDb,
  resolvePriceInfo,
  mergeAndPersistJobUsage,
  computeTokenCostYuan,
}
