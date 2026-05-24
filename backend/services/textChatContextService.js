/**
 * 对话创作：上下文窗口组装（Summary Buffer Memory）
 */

const CONTEXT_BUDGET = Math.max(4000, Number(process.env.TEXT_CHAT_CONTEXT_BUDGET || 28000))
const SUMMARIZE_THRESHOLD = Math.min(0.95, Math.max(0.5, Number(process.env.TEXT_CHAT_SUMMARIZE_THRESHOLD || 0.75)))
const RECENT_TURNS_MAX = Math.max(4, Number(process.env.TEXT_CHAT_RECENT_TURNS || 16))
const SYSTEM_PROMPT_RESERVE = 2000
const SUMMARY_MAX_TOKENS = 4000
const REPLY_RESERVE = 4096
const IMAGE_TOKEN_OVERHEAD = 500
const MAX_IMAGES_PER_MESSAGE = 4

const SYSTEM_PROMPT = `你是万相 AI 管理系统的对话助手，帮助用户解答问题、分析图片、整理思路与撰写文案。

请用清晰、准确的中文回复。若用户上传了图片，请结合图片内容作答。`

function estimateTextTokens(text) {
  const s = String(text || '')
  if (!s) return 0
  return Math.ceil(s.length / 3.5)
}

function parseAttachments(json) {
  if (!json || !String(json).trim()) return []
  try {
    const o = JSON.parse(json)
    if (Array.isArray(o)) return o.filter((x) => x && x.type === 'image' && x.url)
    if (o && typeof o === 'object' && Array.isArray(o.images)) {
      return o.images
        .filter((u) => u && String(u).startsWith('http'))
        .map((url) => ({ type: 'image', url: String(url) }))
    }
  } catch (_) {
    /* ignore */
  }
  return []
}

function attachmentsToJson(images) {
  const list = Array.isArray(images)
    ? images.filter((u) => u && String(u).startsWith('http')).map((url) => ({ type: 'image', url: String(url) }))
    : []
  return list.length ? JSON.stringify(list) : null
}

function estimateMessageTokens(text, attachments = []) {
  let tokens = estimateTextTokens(text)
  const imgs = Array.isArray(attachments) ? attachments : parseAttachments(attachments)
  tokens += imgs.length * IMAGE_TOKEN_OVERHEAD
  return tokens
}

function getSessionBudget(session) {
  const custom = session?.context_budget_tokens
  if (custom != null && Number(custom) > 0) return Number(custom)
  return CONTEXT_BUDGET
}

function getHistoryBudget(session) {
  return Math.max(2000, getSessionBudget(session) - SYSTEM_PROMPT_RESERVE - REPLY_RESERVE)
}

function loadActiveMessages(dbi, sessionId) {
  return dbi
    .prepare(
      `SELECT id, role, text, attachments_json, token_estimate, included_in_summary, model_name,
              generation_mode, created_at
       FROM text_chat_messages
       WHERE session_id = ? AND included_in_summary = 0
       ORDER BY id ASC`,
    )
    .all(sessionId)
}

function isReplyMode(row) {
  const mode = String(row?.generation_mode || 'reply').trim()
  return mode === 'reply' || mode === ''
}

function loadReplyMessages(dbi, sessionId) {
  return loadActiveMessages(dbi, sessionId).filter(isReplyMode)
}

function messageToApiContent(row) {
  const text = String(row.text || '').trim()
  const attachments = parseAttachments(row.attachments_json)
  if (!attachments.length) {
    return text || ' '
  }
  const parts = []
  if (text) parts.push({ type: 'text', text })
  else parts.push({ type: 'text', text: '请结合图片回答。' })
  for (const att of attachments.slice(0, MAX_IMAGES_PER_MESSAGE)) {
    parts.push({ type: 'image_url', image_url: { url: att.url } })
  }
  return parts
}

function estimateApiMessagesTokens(messages) {
  let total = 0
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += estimateTextTokens(m.content)
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part?.type === 'text') total += estimateTextTokens(part.text)
        else if (part?.type === 'image_url') total += IMAGE_TOKEN_OVERHEAD
      }
    }
  }
  return total
}

function buildSummaryMessage(summary) {
  const s = String(summary || '').trim()
  if (!s) return null
  return {
    role: 'system',
    content: `以下是此前对话的摘要，供你理解上下文（用户看不到此段）：\n${s}`,
  }
}

/**
 * 选取 recent buffer：最近 RECENT_TURNS_MAX 轮（user+assistant 算一轮）
 */
function pickRecentMessages(allActive, excludeLastUser = false) {
  const msgs = [...allActive]
  if (excludeLastUser && msgs.length && msgs[msgs.length - 1].role === 'user') {
    msgs.pop()
  }
  const maxMessages = RECENT_TURNS_MAX * 2
  if (msgs.length <= maxMessages) return msgs
  return msgs.slice(-maxMessages)
}

function buildMessagesForApi(dbi, session, currentUserRow = null) {
  const summary = String(session.summary || '').trim()
  const allActive = loadReplyMessages(dbi, session.id)
  const recentRows = pickRecentMessages(allActive, !!currentUserRow)

  const apiMessages = [{ role: 'system', content: SYSTEM_PROMPT }]
  const summaryMsg = buildSummaryMessage(summary)
  if (summaryMsg) apiMessages.push(summaryMsg)

  for (const row of recentRows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue
    apiMessages.push({ role: row.role, content: messageToApiContent(row) })
  }

  if (currentUserRow) {
    apiMessages.push({ role: 'user', content: messageToApiContent(currentUserRow) })
  }

  return apiMessages
}

function computeContextUsage(dbi, session, pendingUserRow = null) {
  const historyBudget = getHistoryBudget(session)
  const allActive = loadReplyMessages(dbi, session.id)
  const recentRows = pickRecentMessages(allActive, !!pendingUserRow)
  const summary = String(session.summary || '').trim()

  let used = SYSTEM_PROMPT_RESERVE
  if (summary) used += Math.min(SUMMARY_MAX_TOKENS, estimateTextTokens(summary))
  for (const row of recentRows) {
    used += row.token_estimate || estimateMessageTokens(row.text, row.attachments_json)
  }
  if (pendingUserRow) {
    used += estimateMessageTokens(pendingUserRow.text, pendingUserRow.attachments_json)
  }

  const recentTurns = Math.ceil(recentRows.length / 2)
  return {
    usedTokens: used,
    budgetTokens: historyBudget,
    usagePercent: Math.min(100, Math.round((used / historyBudget) * 100)),
    summaryActive: !!summary,
    recentTurns,
    summarizeThresholdPercent: Math.round(SUMMARIZE_THRESHOLD * 100),
  }
}

function shouldSummarize(dbi, session, pendingUserRow = null) {
  const meta = computeContextUsage(dbi, session, pendingUserRow)
  return meta.usedTokens >= meta.budgetTokens * SUMMARIZE_THRESHOLD
}

/**
 * 取出应被压缩的最旧消息块（不含 recent buffer）
 */
function pickMessagesToSummarize(dbi, sessionId) {
  const allActive = loadActiveMessages(dbi, sessionId)
  const recentRows = pickRecentMessages(allActive, false)
  const recentIds = new Set(recentRows.map((r) => r.id))
  const candidates = allActive.filter((r) => !recentIds.has(r.id))
  if (candidates.length < 4) return []
  const blockSize = Math.min(10, candidates.length)
  return candidates.slice(0, blockSize)
}

function formatMessagesForSummary(rows) {
  return rows
    .map((r) => {
      const mode = String(r.generation_mode || 'reply').trim()
      if (mode === 'image') {
        if (r.role === 'user') {
          const preview = String(r.text || '').trim().slice(0, 50)
          return `[用户生成了图片：${preview}${preview.length >= 50 ? '…' : ''}]`
        }
        if (r.role === 'assistant') return '[助手：已返回生成图片]'
        return ''
      }
      const role = r.role === 'assistant' ? '助手' : '用户'
      const imgs = parseAttachments(r.attachments_json)
      const imgNote = imgs.length ? ` [含 ${imgs.length} 张图片]` : ''
      return `${role}：${String(r.text || '').trim()}${imgNote}`
    })
    .filter(Boolean)
    .join('\n')
}

module.exports = {
  SYSTEM_PROMPT,
  CONTEXT_BUDGET,
  SUMMARIZE_THRESHOLD,
  RECENT_TURNS_MAX,
  MAX_IMAGES_PER_MESSAGE,
  estimateTextTokens,
  estimateMessageTokens,
  parseAttachments,
  attachmentsToJson,
  getSessionBudget,
  getHistoryBudget,
  loadActiveMessages,
  loadReplyMessages,
  isReplyMode,
  buildMessagesForApi,
  computeContextUsage,
  shouldSummarize,
  pickMessagesToSummarize,
  formatMessagesForSummary,
  estimateApiMessagesTokens,
  messageToApiContent,
}
