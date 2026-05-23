/**
 * 对话创作：提示词润色（调用默认文本模型）
 */
const { resolveDefaultTextModel } = require('./textModelService')
const { chatCompletion, streamChatCompletion } = require('./dmxapiChatClient')

const MAX_INPUT_LENGTH = 20000

const SYSTEM_PROMPT = `你是电商 AI 视频生成提示词优化助手，服务对象主要为商品展示、种草、测评、换品复刻等电商视频场景。

用户会提供一段用于生成/改视频的提示词（常含 @图片N、@视频N 引用）。请在不改变核心意图与业务约束的前提下润色，使其更适合视频生成模型执行。

## 必须遵守
1. 必须原样保留所有媒体引用占位符（如 @图片1、@图片2、@视频1、@image1、@video1），不得删除、改写、合并或重新编号。
2. 不得新增用户未提及的：商品卖点、功效宣称、价格、促销、品牌故事、口播台词、额外场景或人物。
3. 不得臆造包装/标签/Logo 上的文字；用户已写明的品牌名、产品名、标签文案必须原样保留，可写「清晰可读」但不可改写字样。
4. 用户明确要求「与原视频一致/相同镜头/仅替换某元素/其余不变」时，必须在润色结果中明确写出需保持一致的范围（镜头、运镜、时长感、背景、光线、构图、其他道具等）。
5. 用户列出多条修改要求时，不得遗漏任一条；建议按时间或动作顺序组织（如「先…，随后…，最后…」），但不得改变要求含义。
6. 只输出润色后的提示词正文，不要解释、不要标题、不要列表编号、不要用 markdown 代码块包裹。

## 润色目标（电商向）
- 把「修改要求/换品说明」整理成连贯、可执行的镜头描述，突出商品主体、手部动作、使用过程与画面变化。
- 涉及 @视频N 作参考时：写清「与 @视频N 相同的镜头/画面/运镜」及需要替换或保留的元素。
- 涉及 @图片N 作商品/素材时：写清该元素在画面中的位置、形态、颜色、材质，以及与动作的关联（如手持、展示、喷洒、擦拭）。
- 语句通顺、信息完整、避免空泛形容词堆砌；优先使用具体、可拍到的画面描述。

## 禁止
- 不要输出「好的/以下是润色结果」等前缀或任何元说明。
- 不要把占位符改写成「第一张图」「参考视频」等自然语言替代。
- 不要擅自补充未提及的卖点、功效、场景或剧情。`

function stripMarkdownFence(text) {
  let s = String(text || '').trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  return s
}

/**
 * @param {import('better-sqlite3').Database} dbi
 * @param {string} rawText
 */
async function polishPrompt(dbi, rawText) {
  const input = validatePolishInput(rawText)
  const modelRow = resolveDefaultTextModel(dbi)
  const { content } = await chatCompletion({
    model: modelRow.apiModelId,
    messages: buildPolishMessages(input),
    temperature: 0.5,
  })

  const polished = finalizePolishedText(content)
  return {
    text: polished,
    modelId: modelRow.apiModelId,
    modelName: modelRow.name || modelRow.apiModelId,
  }
}

function validatePolishInput(rawText) {
  const input = String(rawText || '').trim()
  if (!input) {
    const err = new Error('请先输入提示词')
    err.code = 'E_PROMPT_EMPTY'
    throw err
  }
  if (input.length > MAX_INPUT_LENGTH) {
    const err = new Error(`提示词过长，最多 ${MAX_INPUT_LENGTH} 字`)
    err.code = 'E_PROMPT_TOO_LONG'
    throw err
  }
  return input
}

function buildPolishMessages(input) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: input },
  ]
}

function finalizePolishedText(full) {
  let polished = stripMarkdownFence(full)
  if (polished.length > MAX_INPUT_LENGTH) {
    polished = polished.slice(0, MAX_INPUT_LENGTH)
  }
  if (!polished) {
    const err = new Error('润色结果为空，请重试')
    err.code = 'E_POLISH_EMPTY'
    throw err
  }
  return polished
}

/**
 * 流式润色：onDelta(delta, full) 在生成过程中回调
 */
async function polishPromptStream(dbi, rawText, onDelta, opts = {}) {
  const input = validatePolishInput(rawText)
  const modelRow = resolveDefaultTextModel(dbi)
  const chatOpts = {
    model: modelRow.apiModelId,
    messages: buildPolishMessages(input),
    temperature: 0.5,
    signal: opts.signal,
  }

  const emitChunks = (fullRaw) => {
    const text = String(fullRaw || '')
    if (!text || typeof onDelta !== 'function') return text
    let acc = ''
    const step = 3
    for (let i = 0; i < text.length; i += step) {
      acc = text.slice(0, Math.min(i + step, text.length))
      onDelta(text.slice(i, Math.min(i + step, text.length)), acc)
    }
    return text
  }

  let content = ''
  try {
    const streamed = await streamChatCompletion(chatOpts, (delta, full) => {
      content = full
      if (typeof onDelta === 'function') onDelta(delta, full)
    })
    content = streamed.content
  } catch (streamErr) {
    const { content: fullContent } = await chatCompletion(chatOpts)
    content = emitChunks(fullContent)
  }

  const polished = finalizePolishedText(content)
  if (typeof onDelta === 'function' && polished !== String(content || '').trim()) {
    onDelta('', polished)
  }

  return {
    text: polished,
    modelId: modelRow.apiModelId,
    modelName: modelRow.name || modelRow.apiModelId,
  }
}

module.exports = {
  polishPrompt,
  polishPromptStream,
  SYSTEM_PROMPT,
  MAX_INPUT_LENGTH,
}
