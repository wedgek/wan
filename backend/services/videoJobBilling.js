/**
 * 视频任务 Token 用量解析与计费落库
 * - DMXAPI 模型：沿用 model_ratio / model_completion_ratio（原有逻辑）
 * - 方舟 Seedance 2.0 官方：按公示单价 × total tokens
 */
const { fetchDmxapiPricingMap, pickPriceInfoDefault, computeTokenCostYuan } = require('./dmxapiModelMeta')
const {
  shouldUseArkSeedanceBilling,
  computeArkSeedanceCostYuan,
  jobHasReferenceVideo,
} = require('./arkSeedanceBilling')
const { resolveEffectiveProvider, getProfileById } = require('./videoApiProfiles')

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
 * @returns {{ input: number, output: number, total?: number }|null}
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
  const totalRaw = Number(u.total_tokens)

  if (!Number.isFinite(inN) && !Number.isFinite(outN) && !Number.isFinite(totalRaw)) return null

  const inputTok = Number.isFinite(inN) ? Math.max(0, Math.floor(inN)) : 0
  const outputTok = Number.isFinite(outN) ? Math.max(0, Math.floor(outN)) : 0
  let total = inputTok + outputTok
  if (Number.isFinite(totalRaw) && totalRaw > 0) {
    total = Math.max(total, Math.floor(totalRaw))
    if (outputTok === 0 && inputTok === 0) {
      return { input: 0, output: Math.floor(totalRaw), total: Math.floor(totalRaw) }
    }
  }

  return { input: inputTok, output: outputTok, total }
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
  let apiProvider = String(ctx.apiProvider || '').trim()
  let apiProfile = String(ctx.apiProfile || '').trim()
  let sourceVideoUrls = ctx.sourceVideoUrls
  let requestPayload = ctx.requestPayload

  if (jobId) {
    const needRow =
      !apiModelId ||
      catalogId == null ||
      !apiProvider ||
      !apiProfile ||
      sourceVideoUrls == null ||
      requestPayload == null
    if (needRow) {
      const row = dbi
        .prepare(
          `SELECT vm.api_model_id, vm.catalog_id, vm.api_provider, j.api_provider AS job_api_provider,
                  j.api_profile, j.source_video_urls, j.request_payload
           FROM video_jobs j
           LEFT JOIN video_models vm ON vm.id = j.video_model_id
           WHERE j.id = ?`,
        )
        .get(jobId)
      if (row) {
        if (!apiModelId) apiModelId = String(row.api_model_id || '').trim()
        if (catalogId == null) catalogId = row.catalog_id
        if (!apiProvider) {
          apiProvider = String(row.job_api_provider || row.api_provider || '').trim()
        }
        if (!apiProfile) apiProfile = String(row.api_profile || '').trim()
        if (sourceVideoUrls == null) sourceVideoUrls = row.source_video_urls
        if (requestPayload == null) requestPayload = row.request_payload
      }
    }
  }

  const profile = getProfileById(apiProfile) || null
  const effectiveProvider = resolveEffectiveProvider(profile, apiProvider)
  const hasReferenceVideo = jobHasReferenceVideo(sourceVideoUrls, requestPayload)

  return {
    apiModelId,
    catalogId,
    apiProvider: effectiveProvider,
    apiProfile,
    hasReferenceVideo,
    useArkSeedanceBilling: shouldUseArkSeedanceBilling(apiProvider, apiProfile),
  }
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
  const newTotal = (usage.total != null ? usage.total : usage.input + usage.output) || 0
  if (newTotal <= prevTotal) return

  const billing = resolveBillingContext(dbi, id, ctx)
  let costYuan = row.cost_yuan

  if (billing.useArkSeedanceBilling) {
    const computed = computeArkSeedanceCostYuan(usage, billing.hasReferenceVideo)
    if (computed != null) costYuan = computed
  } else {
    const { pi, groupRatio } = await resolvePriceInfo(dbi, billing.apiModelId, billing.catalogId)
    if (pi) {
      const computed = computeTokenCostYuan(pi, usage.input, usage.output, groupRatio, 1)
      if (computed != null) costYuan = computed
    }
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
  resolveBillingContext,
  mergeAndPersistJobUsage,
  computeTokenCostYuan,
}
