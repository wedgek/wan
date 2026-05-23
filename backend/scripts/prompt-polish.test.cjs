/**
 * 提示词润色烟测（不调用真实 API / SQLite）
 * 运行：node scripts/prompt-polish.test.cjs
 */
const assert = require('assert')
const { pickMessageContent } = require('../services/dmxapiChatClient')
const { SYSTEM_PROMPT, MAX_INPUT_LENGTH } = require('../services/promptPolishService')

assert.ok(SYSTEM_PROMPT.includes('@图片'))
assert.ok(SYSTEM_PROMPT.includes('@视频'))
assert.ok(SYSTEM_PROMPT.includes('电商'))

assert.strictEqual(
  pickMessageContent({
    choices: [{ message: { content: '  润色后的提示词  ' } }],
  }),
  '润色后的提示词',
)

assert.strictEqual(
  pickMessageContent({
    choices: [{ message: { content: [{ type: 'text', text: 'hello' }] } }],
  }),
  'hello',
)

assert.strictEqual(pickMessageContent({ choices: [] }), '')

const prev = process.env.PROMPT_POLISH_MODEL
process.env.PROMPT_POLISH_MODEL = 'deepseek-chat'
delete require.cache[require.resolve('../services/textModelService')]
const { resolveDefaultTextModel } = require('../services/textModelService')
const fallback = resolveDefaultTextModel({
  prepare() {
    return {
      get() {
        return undefined
      },
    }
  },
})
assert.strictEqual(fallback.apiModelId, 'deepseek-chat')
assert.strictEqual(fallback.source, 'env')
if (prev == null) delete process.env.PROMPT_POLISH_MODEL
else process.env.PROMPT_POLISH_MODEL = prev

assert.throws(
  () =>
    resolveDefaultTextModel({
      prepare() {
        return { get: () => undefined }
      },
    }),
  /请先在模型商店/,
)

delete require.cache[require.resolve('../services/textModelService')]
const { getPolishTextModelStatus } = require('../services/textModelService')
assert.deepStrictEqual(
  getPolishTextModelStatus({
    prepare() {
      return {
        get() {
          return { id: 1, name: 'DeepSeek', api_model_id: 'deepseek-chat' }
        },
      }
    },
  }),
  { available: true, modelName: 'DeepSeek', apiModelId: 'deepseek-chat', source: 'store' },
)
assert.deepStrictEqual(
  getPolishTextModelStatus({
    prepare() {
      return { get: () => undefined }
    },
  }),
  { available: false },
)

assert.strictEqual(MAX_INPUT_LENGTH, 20000)

console.log('[prompt-polish.test] OK')
