/**
 * 对话创作：渐进式摘要压缩（Progressive Summarization）
 */

const { chatCompletion } = require('./dmxapiChatClient')
const { resolveDefaultTextModel } = require('./textModelService')
const { formatMessagesForSummary, estimateTextTokens } = require('./textChatContextService')

const SUMMARY_SYSTEM = `你是会话摘要助手。将对话历史压缩为简洁的中文摘要，供后续对话理解上下文。

必须保留：用户明确的要求与约束、关键决策、重要事实、待办事项、用户偏好。
可以省略：寒暄、重复内容、已过时且被后续信息覆盖的内容。
若对话含图片，说明用户曾上传图片及讨论主题，但不要编造图片细节。
只输出摘要正文，不要标题或解释。`

async function summarizeBlock(dbi, apiModelId, oldSummary, blockRows) {
  const transcript = formatMessagesForSummary(blockRows)
  const prev = String(oldSummary || '').trim()
  const userContent = prev
    ? `已有摘要：\n${prev}\n\n请将以下新对话片段合并进摘要（输出完整新摘要，不要只写增量）：\n${transcript}`
    : `请摘要以下对话：\n${transcript}`

  let modelId = String(apiModelId || '').trim()
  if (!modelId) {
    modelId = resolveDefaultTextModel(dbi).apiModelId
  }

  const { content } = await chatCompletion({
    model: modelId,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
    maxTokens: 1500,
  })

  return String(content || '').trim()
}

/**
 * 压缩最旧消息块并写入 session.summary
 * @returns {boolean} 是否执行了压缩
 */
async function compressOldestBlock(dbi, session, apiModelId) {
  const { pickMessagesToSummarize } = require('./textChatContextService')
  const block = pickMessagesToSummarize(dbi, session.id)
  if (!block.length) return false

  const newSummary = await summarizeBlock(dbi, apiModelId, session.summary, block)
  if (!newSummary) return false

  const mark = dbi.prepare(
    `UPDATE text_chat_messages SET included_in_summary = 1 WHERE id = ? AND session_id = ?`,
  )
  for (const row of block) {
    mark.run(row.id, session.id)
  }

  dbi
    .prepare(
      `UPDATE text_chat_sessions SET summary = ?, summary_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    )
    .run(newSummary, session.id)

  session.summary = newSummary
  return true
}

/** 循环压缩直到低于阈值或无可压缩块 */
async function ensureContextWithinBudget(dbi, session, apiModelId, pendingUserRow = null) {
  const { shouldSummarize } = require('./textChatContextService')
  let rounds = 0
  while (rounds < 5 && shouldSummarize(dbi, session, pendingUserRow)) {
    const did = await compressOldestBlock(dbi, session, apiModelId)
    if (!did) break
    rounds += 1
  }
}

module.exports = {
  summarizeBlock,
  compressOldestBlock,
  ensureContextWithinBudget,
  estimateSummaryTokens: estimateTextTokens,
}
