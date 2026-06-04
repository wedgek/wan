/**
 * videoJobBilling 烟测
 * 运行：node scripts/video-job-billing.test.cjs
 */
const assert = require('assert')
const {
  extractUsageFromRemote,
  computeTokenCostYuan,
} = require('../services/videoJobBilling')
const { pickPriceInfoDefault, computeTokenCostYuan: computeFromMeta } = require('../services/dmxapiModelMeta')

const sampleRemote = {
  id: 'cgt-20260602183016-gs6ll',
  usage: {
    total_tokens: 60850,
    input_tokens: 0,
    output_tokens: 60850,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
}

const usage = extractUsageFromRemote(sampleRemote)
assert.strictEqual(usage.input, 0)
assert.strictEqual(usage.output, 60850)

const pi = pickPriceInfoDefault({
  price_info: { default: { default: { model_ratio: 0.5, model_completion_ratio: 100 } } },
})
assert.ok(pi)

const cost48680 = computeTokenCostYuan(pi, 0, 48680, 1, 1)
assert.strictEqual(cost48680, 4.868)

const costMeta = computeFromMeta(pi, 0, 48680, 1, 1)
assert.strictEqual(costMeta, 4.868)

const cost60850 = computeTokenCostYuan(pi, 0, 60850, 1, 1)
assert.ok(Math.abs(cost60850 - 6.085) < 1e-9)

assert.strictEqual(extractUsageFromRemote(null), null)
assert.strictEqual(extractUsageFromRemote({}), null)

const legacy = extractUsageFromRemote({
  usage: { prompt_tokens: 10, completion_tokens: 20 },
})
assert.strictEqual(legacy.input, 10)
assert.strictEqual(legacy.output, 20)

const fixedPi = pickPriceInfoDefault({
  price_info: { default: { default: { quota_type: 0, model_price: 1 } } },
})
assert.strictEqual(computeTokenCostYuan(fixedPi, 100, 100, 1, 1), null)

console.log('[video-job-billing.test] OK')
