<template>
  <div class="video-chat" :class="{ 'video-chat--wide': isWideMode }">
    <main class="video-chat__main">
      <div class="video-chat__bg" aria-hidden="true" />

      <header class="video-chat__toolbar">
        <div class="video-chat__toolbar-start">
          <el-tooltip :content="isWideMode ? '退出宽屏' : '宽屏'" placement="bottom" :show-after="280">
            <el-button
              class="wide-toggle-btn"
              circle
              plain
              :type="isWideMode ? 'primary' : 'default'"
              @click="toggleWideMode"
            >
              <el-icon :size="18"><component :is="$icons.ScaleToOriginal" /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
        <div class="video-chat__toolbar-center">
          <el-select
            v-model="selectedModelId"
            placeholder="选择模型"
            class="toolbar-model"
            filterable
            size="default"
          >
            <el-option
              v-for="x in models"
              :key="x.id"
              :label="x.name"
              :value="x.id"
            />
          </el-select>
        </div>
        <div class="video-chat__toolbar-end">
          <el-button type="primary" :icon="$icons.Plus" @click="createSession">新建对话</el-button>
          <el-button @click="sessionsDrawer = true">
            <el-icon class="video-chat__toolbar-ic"><component :is="$icons.ChatLineRound" /></el-icon>
            对话记录
          </el-button>
        </div>
      </header>

      <div v-if="!sessionReady" class="video-chat__boot" v-loading="true" element-loading-text="加载会话…" />
      <template v-else-if="activeSessionId">
        <div class="video-chat__stream-slot">
          <el-scrollbar ref="msgScrollRef" class="msg-scroll">
            <div class="msg-stream" :class="{ 'msg-stream--has-msgs': messages.length }">
              <div
                v-for="round in messageRounds"
                :key="messageRoundKey(round)"
                class="msg-round"
              >
                <div v-for="m in round" :key="m.id" class="msg-row" :class="'msg-row--' + m.role">
              <div class="msg-feed-head">
                <span class="msg-feed-role">{{ feedRoleLabel(m) }}</span>
              </div>
              <div class="msg-bubble msg-feed__body" :class="{ 'msg-bubble--has-media': messageHasMedia(m) }">
                <div v-if="messageHasMedia(m)" class="msg-media-row">
                  <template v-if="m.attachments?.images?.length">
                    <img
                      v-for="(u, i) in m.attachments.images"
                      :key="'mi' + i"
                      :src="u"
                      alt=""
                      class="att-img att-img--inline"
                    />
                  </template>
                  <template v-for="(u, i) in m.attachments?.videos || []" :key="'mv' + i">
                    <video
                      v-if="!failedVideoUrls.has(u)"
                      :src="u"
                      controls
                      class="att-vid att-vid--inline"
                      preload="none"
                      @error="markVideoFailed(u)"
                    />
                    <div v-else class="att-vid att-vid--inline att-vid--err" role="img" aria-label="视频无法加载">
                      无法加载
                    </div>
                  </template>
                </div>
                <div v-if="m.text" class="msg-text-stack">
                  <div
                    :ref="(el) => bindMsgTextEl(m.id, el)"
                    class="msg-text"
                    :class="{ 'msg-text--clamped-2': !isMsgTextExpanded(m.id) }"
                  >
                    {{ m.text }}
                  </div>
                  <div v-if="msgTextOverflow[String(m.id)]" class="msg-text-toggle-wrap">
                    <button type="button" class="msg-text-toggle" @click="toggleMsgTextExpand(m.id)">
                      {{ isMsgTextExpanded(m.id) ? "收起全文" : "展开全文" }}
                    </button>
                  </div>
                </div>
                <template v-if="m.role === 'assistant'">
                  <div v-if="assistantShowAssistBlock(m)" class="msg-assist-foot">
                    <div v-if="assistantIsRunning(m)" class="msg-assist-card msg-assist-card--loading">
                      <el-icon class="msg-assist-card__spin" :size="22">
                        <component :is="$icons.Loading" />
                      </el-icon>
                      <div class="msg-assist-card__body">
                        <div class="msg-assist-card__title">正在生成视频</div>
                        <div class="msg-assist-card__sub">任务进行中，可随时离开页面，稍后回来查看结果</div>
                      </div>
                    </div>
                    <template v-else-if="assistantIsSuccess(m)">
                      <div class="msg-assist-card msg-assist-card--success">
                        <el-icon class="msg-assist-card__ico" :size="22">
                          <component :is="$icons.CircleCheckFilled" />
                        </el-icon>
                        <div class="msg-assist-card__body">
                          <div class="msg-assist-card__title">生成成功</div>
                          <div class="msg-assist-card__sub">已出片，可在线预览或新窗口打开</div>
                        </div>
                      </div>
                      <a
                        v-if="m.resultUrl"
                        class="msg-link"
                        :href="m.resultUrl"
                        target="_blank"
                        rel="noopener"
                      >
                        <el-icon class="msg-link__icon"><component :is="$icons.VideoPlay" /></el-icon>
                        查看成片
                      </a>
                    </template>
                    <div v-else-if="assistantIsFailed(m)" class="msg-assist-card msg-assist-card--fail">
                      <el-icon class="msg-assist-card__ico" :size="22">
                        <component :is="$icons.CircleCloseFilled" />
                      </el-icon>
                      <div class="msg-assist-card__body">
                        <div class="msg-assist-card__title">生成未成功</div>
                        <div v-if="m.errorMessage" class="msg-assist-card__err">{{ m.errorMessage }}</div>
                        <div v-else class="msg-assist-card__sub">请调整指令或参考素材后重试</div>
                      </div>
                    </div>
                    <div v-else class="msg-meta">
                      <span class="msg-meta__label">状态</span>
                      <span class="msg-meta__val">{{ m.status || "—" }}</span>
                    </div>
                  </div>
                </template>
              </div>
              <div
                v-if="m.role === 'user' || !deleteMessageDisabled(m)"
                class="msg-feed-actions msg-feed-actions--below"
              >
                <template v-if="m.role === 'user'">
                  <el-tooltip content="重新编辑" placement="top" :show-after="400">
                    <button type="button" class="msg-act-btn" @click="reEditMessage(m)">
                      <el-icon :size="16"><component :is="$icons.EditPen" /></el-icon>
                    </button>
                  </el-tooltip>
                  <el-tooltip content="再次生成" placement="top" :show-after="400">
                    <button
                      type="button"
                      class="msg-act-btn"
                      :disabled="sending"
                      @click="regenerateMessage(m)"
                    >
                      <el-icon :size="16"><component :is="$icons.RefreshRight" /></el-icon>
                    </button>
                  </el-tooltip>
                </template>
                <template v-if="!deleteMessageDisabled(m)">
                  <el-tooltip content="删除" placement="top" :show-after="400">
                    <span class="msg-act-tooltip-span">
                      <button type="button" class="msg-act-btn msg-act-btn--danger" @click="deleteMessage(m)">
                        <el-icon :size="16"><component :is="$icons.Delete" /></el-icon>
                      </button>
                    </span>
                  </el-tooltip>
                </template>
              </div>
            </div>
              </div>
            </div>
          </el-scrollbar>
          <div v-if="!messages.length" class="video-chat__empty-logo-overlay" aria-hidden="true">
            <img :src="logoMark" alt="" class="msg-stream__logo-img" />
          </div>
        </div>

        <div class="composer-shell">
          <div
            class="composer-card"
            :class="{ 'composer-card--drag': isDragOver }"
            @dragenter.prevent="onComposerDragEnter"
            @dragover.prevent="onComposerDragOver"
            @dragleave.prevent="onComposerDragLeave"
            @drop.prevent="onComposerDrop"
          >
            <div v-show="isDragOver" class="composer-drop-hint" aria-hidden="true">
              {{ dragDropHint }}
            </div>
            <div class="composer-head">
              <div class="composer-head__uploads">
                <el-upload
                  :show-file-list="false"
                  accept="image/*"
                  multiple
                  :disabled="uploadBusy"
                  :http-request="onPickImages"
                >
                  <el-button
                    class="composer-icon-btn composer-icon-btn--rail"
                    :disabled="uploadBusy"
                    title="添加图片"
                    circle
                  >
                    <el-icon :size="20"><component :is="$icons.Picture" /></el-icon>
                  </el-button>
                </el-upload>
                <el-upload
                  :show-file-list="false"
                  accept="video/*"
                  :disabled="uploadBusy || !referenceVideoAllowed"
                  :http-request="onPickVideo"
                >
                  <el-button
                    class="composer-icon-btn composer-icon-btn--rail"
                    :class="{ 'composer-icon-btn--disabled': !referenceVideoAllowed }"
                    :disabled="uploadBusy || !referenceVideoAllowed"
                    :title="referenceVideoAllowed ? '参考视频（智能参考）' : '未开启参考视频，见后台视频模型配置'"
                    circle
                  >
                    <el-icon :size="20"><component :is="$icons.VideoCamera" /></el-icon>
                  </el-button>
                </el-upload>
              </div>
              <div class="composer-head__spacer" />
              <el-button
                class="composer-icon-btn composer-icon-btn--rail"
                circle
                title="选择提示词（与「提示词管理」数据同步）"
                @click="openPromptPicker"
              >
                <el-icon :size="20"><component :is="$icons.Collection" /></el-icon>
              </el-button>
            </div>

            <div class="composer-body">
              <div v-if="pendingImages.length || pendingVideos.length" class="pending-strip">
                <div v-for="(u, i) in pendingImages" :key="'pi' + i" class="pending-tile">
                  <button type="button" class="pending-tile__x" title="移除" @click="removePendingImage(i)">
                    <el-icon><component :is="$icons.Close" /></el-icon>
                  </button>
                  <img :src="u" alt="" class="pending-tile-media" />
                </div>

                <div v-for="(u, i) in pendingVideos" :key="'pv' + i" class="pending-tile pending-tile--vid">
                  <button type="button" class="pending-tile__x" title="移除" @click="removePendingVideo(i)">
                    <el-icon><component :is="$icons.Close" /></el-icon>
                  </button>
                  <video
                    v-if="!failedVideoUrls.has(u)"
                    :src="u"
                    class="pv"
                    muted
                    playsinline
                    preload="none"
                    @error="markVideoFailed(u)"
                  />
                  <div v-else class="pv pv--err">无法预览</div>
                </div>
              </div>

              <el-input
                v-model="inputText"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 8 }"
                :maxlength="INPUT_MAX_LENGTH"
                :placeholder="'描述要生成的视频…'"
                class="composer-input"
                resize="none"
                @keydown.enter.ctrl.exact.prevent="send"
              />
            </div>
            <div class="composer-foot">
              <span class="composer-hint">Ctrl + Enter 发送</span>
              <div class="composer-foot__right">
                <span class="composer-count">{{ inputText.length }} / {{ INPUT_MAX_LENGTH }}</span>
                <el-button type="primary" round :loading="sending" :disabled="!canSend" @click="send">
                  发送
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-else-if="sessionReady" class="main-empty">
        <div class="main-empty__card">
          <p class="main-empty__title">开始一段视频创作对话</p>
          <p class="main-empty__sub">{{ mainEmptySub }}</p>
        </div>
      </div>
    </main>

    <el-dialog
      v-model="promptDialogVisible"
      title="选择提示词"
      width="480px"
      append-to-body
      align-center
      destroy-on-close
      class="vc-prompt-dialog"
      @opened="loadManagedPrompts"
    >
      <div v-loading="promptLibLoading" class="vc-prompt-picker">
        <div v-if="!promptLibLoading && !managedPrompts.length" class="vc-prompt-picker__empty">
          暂无已启用的提示词，请在侧栏「提示词管理」页面中新增并启用。
        </div>
        <el-scrollbar v-else max-height="380px">
          <button
            v-for="p in managedPrompts"
            :key="p.id"
            type="button"
            class="vc-prompt-picker__row"
            @click="applyManagedPrompt(p)"
          >
            <span class="vc-prompt-picker__name">{{ p.name || "未命名" }}</span>
            <span class="vc-prompt-picker__preview">{{ truncatePromptPreview(p.content) }}</span>
          </button>
        </el-scrollbar>
      </div>
    </el-dialog>

    <el-drawer
      v-model="sessionsDrawer"
      direction="rtl"
      :size="sessionsDrawerSize"
      append-to-body
      class="vc-sessions-drawer"
      body-class="vc-sessions-drawer__body"
    >
      <template #header>
        <div class="vc-drawer-head">
          <span class="vc-drawer-head__title">对话记录</span>
          <span class="vc-drawer-head__meta">共 {{ sessions.length }} 条 · 按更新时间排序</span>
        </div>
      </template>
      <div class="session-drawer">
        <p class="session-drawer__tip">在顶部工具栏可「新建对话」</p>
        <el-scrollbar class="session-drawer__scroll">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="sess-item"
            :class="{ active: s.id === activeSessionId }"
            @click="selectSession(s.id)"
          >
            <div class="sess-item__row">
              <span class="sess-title">{{ s.title }}</span>
              <div class="sess-item__trail">
                <el-tooltip content="删除对话" placement="top" :show-after="320">
                  <button
                    type="button"
                    class="sess-item__del"
                    aria-label="删除对话"
                    @click.stop="deleteSessionEntry(s)"
                  >
                    <el-icon :size="16"><component :is="$icons.Delete" /></el-icon>
                  </button>
                </el-tooltip>
              </div>
            </div>
            <span class="sess-time">{{ formatSessionTime(s.updateTime || s.createTime) }}</span>
          </div>
          <div v-if="!sessions.length" class="sess-empty">暂无会话记录</div>
        </el-scrollbar>
      </div>
    </el-drawer>
  </div>
</template>

<script setup name="aiVideoChat">
import { nextTick, onMounted, onUnmounted, ref, watch, computed } from "vue"
import { ElMessageBox } from "element-plus"
import dayjs from "dayjs"
import request from "@/request"
import { uploadImage, uploadVideo, getFileExt } from "@/request/oss"
import logoMark from "@/assets/images/logo.svg"

const VC_WIDE_STORAGE_KEY = "wan-ai-video-chat-wide"
/** 对话页所选视频模型，刷新后恢复（须仍在当前启用列表中） */
const VC_MODEL_ID_STORAGE_KEY = "wan-ai-video-chat-model-id"

function formatSessionTime(d) {
  if (d == null || d === "") return ""
  const t = dayjs(d)
  if (!t.isValid()) return String(d)
  const now = dayjs()
  if (t.isSame(now, "day")) return `今天 ${t.format("HH:mm")}`
  if (t.isSame(now.subtract(1, "day"), "day")) return `昨天 ${t.format("HH:mm")}`
  if (t.isSame(now, "year")) return t.format("M月D日 HH:mm")
  return t.format("YYYY-MM-DD HH:mm")
}

function messageHasMedia(m) {
  const nImg = m?.attachments?.images?.length ?? 0
  const nVid = m?.attachments?.videos?.length ?? 0
  return nImg + nVid > 0
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"])
const VIDEO_EXTS = new Set(["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm"])

/** 输入框字数上限（与 Element 计数器一致） */
const INPUT_MAX_LENGTH = 20000

function truncatePromptPreview(raw, maxLen = 96) {
  const s = String(raw || "").replace(/\s+/g, " ").trim()
  if (s.length <= maxLen) return s || "（无内容）"
  return `${s.slice(0, maxLen)}…`
}

/** 参考视频是否允许：以「视频模型配置」中「支持参考视频」开关为准（见 /admin-api/video/model/list-enabled） */
function modelAllowsReferenceVideo(m) {
  return !!(m && m.supportsReferenceVideo)
}

const sessions = ref([])
/** 会话列表是否已从接口拉回：避免刷新时短暂 activeSessionId 为空而误显 main-empty */
const sessionReady = ref(false)
const activeSessionId = ref(null)
const messages = ref([])
const models = ref([])
const selectedModelId = ref(null)
const inputText = ref("")
const pendingImages = ref([])
const pendingVideos = ref([])
const uploadCount = ref(0)
const sending = ref(false)
const msgScrollRef = ref(null)
const sessionsDrawer = ref(false)
const isWideMode = ref(false)
const msgTextExpanded = ref(/** @type {Record<string, boolean>} */ ({}))
/** 正文是否超过 2 行（用于「展开全文」仅在需要时显示） */
const msgTextOverflow = ref(/** @type {Record<string, boolean>} */ ({}))
/** @type {Map<string, ResizeObserver>} */
const msgTextObservers = new Map()
const isDragOver = ref(false)
const promptDialogVisible = ref(false)
const promptLibLoading = ref(false)
/** @type {import('vue').Ref<Array<{ id: number; name?: string; content?: string }>>} */
const managedPrompts = ref([])
let dragDepth = 0
let pollTimer = null

/** 视频地址加载失败（如 404）时记入此处，移除 video 元素，避免浏览器对同一 URL 反复请求 */
const failedVideoUrls = ref(new Set())

function markVideoFailed(url) {
  const u = String(url || "")
  if (!u) return
  const next = new Set(failedVideoUrls.value)
  next.add(u)
  failedVideoUrls.value = next
}

function assistantStillRunning(m) {
  if (m.role !== "assistant") return false
  if (m.errorMessage && String(m.errorMessage).trim()) return false
  const s = String(m.status || "").toLowerCase()
  return !!(s && ["pending", "processing"].includes(s))
}

function assistantIsRunning(m) {
  return assistantStillRunning(m)
}

function assistantIsSuccess(m) {
  if (m.role !== "assistant") return false
  if (assistantIsRunning(m)) return false
  if (m.errorMessage && String(m.errorMessage).trim()) return false
  const s = String(m.status || "").toLowerCase()
  if (m.resultUrl && String(m.resultUrl).trim()) return true
  return ["succeeded", "success", "completed", "complete", "done"].includes(s)
}

function assistantIsFailed(m) {
  if (m.role !== "assistant") return false
  if (assistantIsRunning(m)) return false
  if (assistantIsSuccess(m)) return false
  const s = String(m.status || "").toLowerCase()
  if (m.errorMessage && String(m.errorMessage).trim()) return true
  return ["failed", "cancelled", "canceled", "error"].includes(s)
}

function assistantShowAssistBlock(m) {
  if (m.role !== "assistant") return false
  return !!(m.status || m.resultUrl || m.errorMessage)
}

/** 将消息按「一轮 = 用户 + （可选）助手」分组，分隔线画在轮与轮之间 */
const messageRounds = computed(() => {
  const list = messages.value
  const rounds = []
  let i = 0
  while (i < list.length) {
    const cur = list[i]
    if (cur.role === "user") {
      const chunk = [cur]
      i++
      if (i < list.length && list[i].role === "assistant") {
        chunk.push(list[i])
        i++
      }
      rounds.push(chunk)
    } else {
      rounds.push([cur])
      i++
    }
  }
  return rounds
})

function messageRoundKey(round) {
  return round.map((x) => x.id).join("-")
}

/** 生成中：禁止删除（前端隐藏删除入口，接口侧仍做校验） */
function deleteMessageDisabled(m) {
  const list = messages.value
  const idx = list.findIndex((x) => x.id === m.id)
  if (idx < 0) return true
  if (list[idx].role === "assistant" && assistantIsRunning(list[idx])) return true
  if (list[idx].role === "user") {
    const next = list[idx + 1]
    if (next && next.role === "assistant" && assistantIsRunning(next)) return true
  }
  return false
}

function feedRoleLabel(m) {
  if (m.role === "user") return "创作指令"
  const n = String(m.videoModelName || "").trim()
  return n || "生成任务"
}

const uploadBusy = computed(() => uploadCount.value > 0)

const selectedModel = computed(() => models.value.find((x) => x.id === selectedModelId.value) || null)

const referenceVideoAllowed = computed(() => modelAllowsReferenceVideo(selectedModel.value))

const dragDropHint = computed(() =>
  referenceVideoAllowed.value ? "松开以上传图片或参考视频" : "松开以上传图片（当前模型未开启参考视频）",
)

const mainEmptySub = computed(() =>
  referenceVideoAllowed.value
    ? "点击顶部「新建对话」开始；历史会话在「对话记录」中切换。支持参考图与参考视频。"
    : "点击顶部「新建对话」开始。参考视频由后台「视频模型配置」控制；历史在「对话记录」中。",
)

const sessionsDrawerSize = computed(() =>
  isWideMode.value ? "min(460px, 42vw)" : "min(380px, 92vw)",
)

function toggleWideMode() {
  isWideMode.value = !isWideMode.value
  try {
    sessionStorage.setItem(VC_WIDE_STORAGE_KEY, isWideMode.value ? "1" : "0")
  } catch (_) {
    /* ignore */
  }
}

function isMsgTextExpanded(id) {
  return !!msgTextExpanded.value[String(id)]
}

function toggleMsgTextExpand(id) {
  const key = String(id)
  msgTextExpanded.value = { ...msgTextExpanded.value, [key]: !msgTextExpanded.value[key] }
  nextTick(() => {
    const el = msgTextElNodes.get(key)
    if (el) measureMsgTextOverflow(key, el)
  })
}

/** @type {Map<string, Element>} */
const msgTextElNodes = new Map()

function measureMsgTextOverflow(key, el) {
  if (!(el instanceof HTMLElement) || !el.isConnected) return
  if (msgTextExpanded.value[key]) return
  const over = el.scrollHeight > el.clientHeight + 1
  if (msgTextOverflow.value[key] === over) return
  msgTextOverflow.value = { ...msgTextOverflow.value, [key]: over }
}

function bindMsgTextEl(id, el) {
  const key = String(id)
  const prevObs = msgTextObservers.get(key)
  if (prevObs) {
    prevObs.disconnect()
    msgTextObservers.delete(key)
  }
  if (!el) {
    msgTextElNodes.delete(key)
    return
  }
  msgTextElNodes.set(key, el)
  const ro = new ResizeObserver(() => measureMsgTextOverflow(key, el))
  ro.observe(el)
  msgTextObservers.set(key, ro)
  nextTick(() => measureMsgTextOverflow(key, el))
}

function reEditMessage(m) {
  if (m.role !== "user") return
  inputText.value = m.text || ""
  pendingImages.value = [...(m.attachments?.images || [])]
  pendingVideos.value = [...(m.attachments?.videos || [])]
  ElMessage.success("已导入到输入框，可修改后发送")
}

async function postChatSendPayload(payload) {
  return request({
    url: "/admin-api/video/chat/send",
    method: "POST",
    timeout: 120000,
    data: {
      sessionId: activeSessionId.value,
      videoModelId: selectedModelId.value,
      ...payload,
    },
  })
}

async function regenerateMessage(m) {
  if (m.role !== "user") return
  if (!activeSessionId.value || !selectedModelId.value) {
    ElMessage.warning("请先选择会话和模型")
    return
  }
  const text = String(m.text || "").trim()
  const imageUrls = [...(m.attachments?.images || [])]
  const videoUrls = [...(m.attachments?.videos || [])]
  if (!text && imageUrls.length === 0 && videoUrls.length === 0) {
    ElMessage.warning("该条消息没有可发送的内容")
    return
  }
  if (videoUrls.length && !referenceVideoAllowed.value) {
    ElMessage.warning("当前模型不支持参考视频，无法按原参考视频再次生成")
    return
  }
  if (sending.value) return
  sending.value = true
  try {
    const res = await postChatSendPayload({ text, imageUrls, videoUrls })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "发送失败")
      return
    }
    await loadMessages({ scrollToBottom: true })
    await loadSessions()
  } catch (e) {
    console.error(e)
    ElMessage.error("发送失败")
  } finally {
    sending.value = false
  }
}

async function deleteMessage(m) {
  if (deleteMessageDisabled(m)) {
    ElMessage.warning("视频生成中，暂不可删除")
    return
  }
  try {
    await ElMessageBox.confirm("确定删除这条消息？删除后不可恢复。", "删除消息", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    })
  } catch {
    return
  }
  const res = await request({
    url: `/admin-api/video/chat/messages/${m.id}`,
    method: "DELETE",
    params: { sessionId: activeSessionId.value },
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "删除失败")
    return
  }
  await loadMessages({ scrollToBottom: false })
  await loadSessions()
}

async function loadManagedPrompts() {
  promptLibLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/system/ai-prompt/page",
      method: "GET",
      params: { pageNo: 1, pageSize: 200, status: 0 },
    })
    if (res.code !== 0) {
      managedPrompts.value = []
      return
    }
    managedPrompts.value = res.data?.list || []
  } catch (e) {
    console.error(e)
    managedPrompts.value = []
  } finally {
    promptLibLoading.value = false
  }
}

function applyManagedPrompt(p) {
  const t = String(p?.content || "").trim()
  if (!t) {
    ElMessage.warning("该提示词内容为空")
    return
  }
  inputText.value = t
  promptDialogVisible.value = false
}

function openPromptPicker() {
  promptDialogVisible.value = true
}

const canSend = computed(() => {
  if (!activeSessionId.value || !selectedModelId.value) return false
  if (uploadBusy.value) return false
  const t = inputText.value.trim()
  return !!(t || pendingImages.value.length || pendingVideos.value.length)
})

function rawUploadFile(file) {
  if (file?.raw instanceof File) return file.raw
  if (file instanceof File) return file
  return file
}

function classifyDroppedFile(file) {
  if (!(file instanceof File)) return null
  const t = file.type || ""
  if (t.startsWith("image/")) return "image"
  if (t.startsWith("video/")) return "video"
  const ext = getFileExt(file)
  if (IMAGE_EXTS.has(ext)) return "image"
  if (VIDEO_EXTS.has(ext)) return "video"
  return null
}

async function addUploadedImageFile(file) {
  const raw = rawUploadFile(file)
  uploadCount.value++
  try {
    const { url } = await uploadImage(raw)
    pendingImages.value.push(url)
  } catch (e) {
    ElMessage.error(e?.message || "图片上传失败")
  } finally {
    uploadCount.value--
  }
}

async function addUploadedVideoFile(file) {
  if (!referenceVideoAllowed.value) {
    ElMessage.warning("当前模型未开启参考视频，请在「视频模型配置」中打开该能力或切换模型")
    return
  }
  const raw = rawUploadFile(file)
  uploadCount.value++
  try {
    const { url } = await uploadVideo(raw)
    pendingVideos.value.push(url)
  } catch (e) {
    ElMessage.error(e?.message || "视频上传失败")
  } finally {
    uploadCount.value--
  }
}

function onComposerDragEnter() {
  dragDepth++
  isDragOver.value = true
}

function onComposerDragOver(e) {
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
}

function onComposerDragLeave() {
  dragDepth--
  if (dragDepth <= 0) {
    dragDepth = 0
    isDragOver.value = false
  }
}

async function onComposerDrop(e) {
  dragDepth = 0
  isDragOver.value = false
  const list = e.dataTransfer?.files
  if (!list?.length) return
  const files = Array.from(list)
  let warned = false
  for (const f of files) {
    const kind = classifyDroppedFile(f)
    if (kind === "image") await addUploadedImageFile(f)
    else if (kind === "video") {
      if (!referenceVideoAllowed.value) {
        if (!warned) {
          warned = true
          ElMessage.warning("当前模型不支持参考视频，已跳过视频文件")
        }
        continue
      }
      await addUploadedVideoFile(f)
    } else if (!warned) {
      warned = true
      ElMessage.warning("只支持图片或常见视频格式")
    }
  }
}

function removePendingImage(i) {
  pendingImages.value.splice(i, 1)
}

function removePendingVideo(i) {
  pendingVideos.value.splice(i, 1)
}

function readStoredModelId() {
  try {
    const raw = sessionStorage.getItem(VC_MODEL_ID_STORAGE_KEY)
    if (raw == null || raw === "") return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch (_) {
    return null
  }
}

function persistModelId(id) {
  if (id == null) return
  try {
    sessionStorage.setItem(VC_MODEL_ID_STORAGE_KEY, String(id))
  } catch (_) {
    /* ignore */
  }
}

function pickInitialModelId(list) {
  if (!list?.length) return null
  const stored = readStoredModelId()
  if (stored != null) {
    const hit = list.find((m) => Number(m.id) === Number(stored) || String(m.id) === String(stored))
    if (hit) return hit.id
  }
  const def = list.find((m) => m.isDefault)
  if (def) return def.id
  const multimodal = list.find((m) => modelAllowsReferenceVideo(m))
  if (multimodal) return multimodal.id
  return list[0].id
}

async function loadModels() {
  const res = await request({ url: "/admin-api/video/model/list-enabled", method: "GET" })
  if (res.code !== 0) return
  models.value = res.data || []
  selectedModelId.value = pickInitialModelId(models.value)
}

watch(selectedModelId, (id) => {
  if (id != null) persistModelId(id)
})

async function loadSessions() {
  try {
    const res = await request({
      url: "/admin-api/video/chat/sessions/page",
      method: "GET",
      params: { pageNo: 1, pageSize: 100 },
    })
    if (res.code !== 0) return
    sessions.value = res.data?.list || []
    if (!activeSessionId.value && sessions.value.length) {
      activeSessionId.value = sessions.value[0].id
      await loadMessages({ scrollToBottom: true })
    }
  } finally {
    if (!sessionReady.value) sessionReady.value = true
  }
}

async function createSession() {
  const res = await request({
    url: "/admin-api/video/chat/sessions",
    method: "POST",
    data: { title: "新对话" },
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "创建失败")
    return
  }
  sessions.value.unshift(res.data)
  activeSessionId.value = res.data.id
  messages.value = []
  stopPoll()
  sessionsDrawer.value = false
}

async function selectSession(id) {
  activeSessionId.value = id
  sessionsDrawer.value = false
  await loadMessages({ scrollToBottom: true })
}

/**
 * @param {{ scrollToBottom?: boolean }} [opts]
 * - 仅用户点击「发送 / 再次生成」成功后传 scrollToBottom: true；轮询、删消息等刷新不要滚到底，避免打断阅读。
 */
async function loadMessages(opts = {}) {
  const scrollToBottom = !!opts.scrollToBottom
  if (!activeSessionId.value) return
  const res = await request({
    url: "/admin-api/video/chat/messages/page",
    method: "GET",
    params: { sessionId: activeSessionId.value, pageNo: 1, pageSize: 200 },
  })
  if (res.code !== 0) return
  messages.value = res.data?.list || []
  if (scrollToBottom) nextTick(() => scrollBottom())
  setupPoll()
}

function scrollBottom() {
  const el = msgScrollRef.value?.wrapRef
  if (el) el.scrollTop = el.scrollHeight
}

function onPickImages({ file }) {
  return addUploadedImageFile(file)
}

function onPickVideo({ file }) {
  return addUploadedVideoFile(file)
}

async function send() {
  if (!canSend.value || sending.value) return
  sending.value = true
  try {
    const res = await postChatSendPayload({
      text: inputText.value.trim(),
      imageUrls: [...pendingImages.value],
      videoUrls: [...pendingVideos.value],
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "发送失败")
      return
    }
    inputText.value = ""
    pendingImages.value = []
    pendingVideos.value = []
    await loadMessages({ scrollToBottom: true })
    await loadSessions()
  } catch (e) {
    console.error(e)
    ElMessage.error("发送失败")
  } finally {
    sending.value = false
  }
}

async function deleteSessionEntry(s) {
  try {
    await ElMessageBox.confirm(
      `确定删除对话「${String(s.title || "新对话").trim() || "新对话"}」？会话内所有消息将一并删除且不可恢复。`,
      "删除对话",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
      },
    )
  } catch {
    return
  }
  const id = s.id
  const res = await request({
    url: `/admin-api/video/chat/sessions/${id}`,
    method: "DELETE",
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "删除失败")
    return
  }
  sessions.value = sessions.value.filter((x) => x.id !== id)
  if (activeSessionId.value === id) {
    stopPoll()
    activeSessionId.value = sessions.value[0]?.id ?? null
    if (activeSessionId.value) {
      await loadMessages({ scrollToBottom: false })
    } else {
      messages.value = []
    }
  }
  if (!sessions.value.length && !activeSessionId.value) {
    messages.value = []
    stopPoll()
  }
}

function setupPoll() {
  stopPoll()
  const need = messages.value.some(assistantStillRunning)
  if (!need || !activeSessionId.value) return
  pollTimer = window.setInterval(() => {
    loadMessages({ scrollToBottom: false })
  }, 4000)
}

function stopPoll() {
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(messages, () => {
  const need = messages.value.some(assistantStillRunning)
  if (need && !pollTimer) setupPoll()
  if (!need) stopPoll()
})

watch(referenceVideoAllowed, (allowed) => {
  if (!allowed && pendingVideos.value.length) {
    pendingVideos.value = []
    ElMessage.info("已切换到不支持参考视频的模型，待发送视频已清除")
  }
})

onMounted(async () => {
  try {
    isWideMode.value = sessionStorage.getItem(VC_WIDE_STORAGE_KEY) === "1"
  } catch (_) {
    /* ignore */
  }
  await loadModels()
  await loadSessions()
  await loadManagedPrompts()
})

onUnmounted(() => {
  stopPoll()
  for (const ro of msgTextObservers.values()) ro.disconnect()
  msgTextObservers.clear()
  msgTextElNodes.clear()
})
</script>

<style scoped lang="scss">
.video-chat {
  --vc-stream-max: min(920px, 100%);
  --vc-bubble-max: 100%;
  --vc-scroll-pad-r: 16px;

  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
  border-radius: 0;
  overflow: hidden;
  border: none;
  box-shadow: none;

  &.video-chat--wide {
    --vc-stream-max: min(1480px, 100%);
  }
}

.video-chat__main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.video-chat__bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  /* 底层与全局工作台背景一致，再高一层极淡渐变，避免「白盒套灰底」的嵌套感 */
  background:
    radial-gradient(ellipse 120% 70% at 50% -25%, color-mix(in srgb, var(--el-color-primary) 10%, transparent) 0%, transparent 52%),
    radial-gradient(ellipse 55% 40% at 100% 0%, rgba(99, 102, 241, 0.045) 0%, transparent 48%),
    linear-gradient(180deg, var(--app-bg) 0%, color-mix(in srgb, var(--app-bg) 92%, var(--el-color-primary-light-9)) 100%);
  background-attachment: local;
}

.video-chat__bg::after {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0.35;
  background-image: radial-gradient(rgba(15, 23, 42, 0.045) 1px, transparent 1px);
  background-size: 20px 20px;
  mask-image: radial-gradient(ellipse 80% 70% at 50% 40%, black 20%, transparent 100%);
}

/* 左右等宽占位 + 中间 auto，模型选择在整条工具栏水平正中（flex 居中会在左窄右宽时偏左） */
.video-chat__toolbar {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--el-bg-color) 76%, transparent);
  backdrop-filter: blur(14px);
}

.video-chat__toolbar-start {
  justify-self: start;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.video-chat__toolbar-center {
  justify-self: center;
  min-width: 0;
  max-width: 100%;
  display: flex;
  justify-content: center;
}

.video-chat__toolbar-end {
  justify-self: end;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.video-chat__toolbar-ic {
  margin-right: 4px;
}

/* 模型名尽量完整展示：加大 min-width，减轻选中项被强制省略 */
.toolbar-model {
  width: auto;
  min-width: 0;
  max-width: min(720px, 100%);
}

:deep(.toolbar-model.el-select) {
  --el-select-border-color-hover: transparent;
  --el-select-input-focus-border-color: transparent;

  display: inline-flex;
  width: auto !important;
  min-width: 15rem;
  max-width: 100%;
  vertical-align: middle;

  .el-select__wrapper {
    min-height: 36px;
    min-width: 12rem;
    box-shadow: none !important;
    border: none !important;
    background: transparent !important;
    color: var(--el-text-color-primary);
  }

  .el-select__placeholder {
    color: var(--el-text-color-secondary);
  }

  .el-select__selected-item {
    color: var(--el-text-color-primary);
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .el-select__caret {
    color: var(--el-text-color-secondary);
    flex-shrink: 0;
  }

  .el-select__wrapper.is-hovering,
  .el-select__wrapper.is-focused {
    box-shadow: none !important;
    border: none !important;
    background: transparent !important;
  }
}

.wide-toggle-btn {
  flex-shrink: 0;
}

.video-chat__boot {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 120px;
}

/* 占位：与侧栏/顶栏之间的整块「会话区」，空会话时在其内绝对居中 Logo（不依赖 scrollbar 内部高度百分比） */
.video-chat__stream-slot {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.video-chat__empty-logo-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.msg-scroll {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  height: 100%;
  --scroll-pad-r: var(--vc-scroll-pad-r);

  :deep(.el-scrollbar) {
    height: 100%;
  }

  :deep(.el-scrollbar__wrap) {
    height: 100%;
    max-height: none;
  }

  :deep(.el-scrollbar__view) {
    box-sizing: border-box;
    min-height: 100%;
  }
}

.msg-stream {
  max-width: var(--vc-stream-max);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

/* 有消息：常规留白 */
.msg-stream--has-msgs {
  padding: 20px calc(20px + var(--scroll-pad-r)) 28px 24px;
}

.msg-stream__logo-img {
  width: min(128px, 30vw);
  height: auto;
  object-fit: contain;
  opacity: 0.16;
  filter: grayscale(1);
  user-select: none;
  pointer-events: none;
}

.msg-round {
  padding-bottom: 28px;
  margin-bottom: 28px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.065);

  &:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 8px;
  }
}

.msg-row {
  display: block;
  width: 100%;
  max-width: var(--vc-bubble-max);
  padding-bottom: 0;
  margin-bottom: 0;
  border-bottom: none;

  &:not(:last-child) {
    margin-bottom: 20px;
  }
}

.msg-feed-head {
  margin-bottom: 10px;
}

.msg-feed-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.msg-feed-actions--below {
  margin-top: 12px;
  padding-top: 2px;
}

.msg-act-tooltip-span {
  display: inline-flex;
  vertical-align: middle;
}

.msg-act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--el-fill-color) 88%, transparent);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--el-color-primary) 12%, var(--el-fill-color));
    color: var(--el-color-primary);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.msg-act-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--el-color-danger) 14%, var(--el-fill-color));
  color: var(--el-color-danger);
}

.msg-feed-role {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--el-text-color-placeholder);
}

.msg-bubble {
  padding: 0;
  font-size: 14px;
  line-height: 1.7;
  max-width: 100%;
  color: var(--el-text-color-primary);
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
}

.msg-feed__body {
  width: 100%;
}

.msg-bubble--has-media {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.msg-media-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px;
  overflow-x: auto;
  padding: 0 0 4px;
  margin: 0 0 12px;
  border-radius: 0;
  scrollbar-width: thin;
  background: transparent;
  border: none;
}

/* 正文 + 展开：纵向成组，链接贴在省略段落下方靠右，与截断处同一视觉块 */
.msg-text-stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  max-width: 100%;
}

.msg-text {
  width: 100%;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-text-toggle-wrap {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.msg-text--clamped-2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.msg-text-toggle {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--el-color-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  white-space: nowrap;
  opacity: 0.92;

  &:hover {
    opacity: 1;
  }
}

.att-img--inline {
  flex-shrink: 0;
  max-width: 200px;
  max-height: 150px;
  margin: 0;
  border-radius: 12px;
  object-fit: cover;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);
}

.att-vid--inline {
  flex-shrink: 0;
  width: 100%;
  max-width: min(520px, 100%);
  max-height: 292px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #0f0f10;
  box-shadow: 0 6px 28px rgba(15, 23, 42, 0.08);

  &.att-vid--err {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 120px;
    min-height: 72px;
    padding: 8px;
    font-size: 11px;
    color: var(--el-color-danger);
    background: var(--el-fill-color-lighter);
    border: 1px dashed var(--el-border-color);
    box-sizing: border-box;
  }
}

.msg-assist-foot {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin-top: 12px;
  padding-top: 0;
  border-top: none;
}

.msg-assist-card {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  max-width: 520px;
  padding: 14px 16px;
  border-radius: 12px;
  box-sizing: border-box;
  border: 1px solid rgba(15, 23, 42, 0.07);
  background: var(--el-fill-color-blank);
}

.msg-assist-card__body {
  min-width: 0;
  flex: 1;
}

.msg-assist-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.35;
}

.msg-assist-card__sub {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}

.msg-assist-card__err {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-color-danger);
}

.msg-assist-card__spin {
  flex-shrink: 0;
  color: var(--el-color-primary);
  animation: vc-spin 0.9s linear infinite;
}

@keyframes vc-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.msg-assist-card__ico {
  flex-shrink: 0;
}

.msg-assist-card--loading {
  background: color-mix(in srgb, var(--el-color-primary) 6%, var(--el-bg-color));
  border-color: color-mix(in srgb, var(--el-color-primary) 22%, transparent);
}

.msg-assist-card--success {
  background: color-mix(in srgb, var(--el-color-success) 8%, var(--el-bg-color));
  border-color: color-mix(in srgb, var(--el-color-success) 28%, transparent);
}

.msg-assist-card--success .msg-assist-card__ico {
  color: var(--el-color-success);
}

.msg-assist-card--fail {
  background: color-mix(in srgb, var(--el-color-danger) 7%, var(--el-bg-color));
  border-color: color-mix(in srgb, var(--el-color-danger) 22%, transparent);
}

.msg-assist-card--fail .msg-assist-card__ico {
  color: var(--el-color-danger);
}

.msg-meta {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: transparent;
  border: none;
  color: var(--el-text-color-secondary);
}

.msg-meta__label {
  color: var(--el-text-color-placeholder);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.05em;
}

.msg-meta__val {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.msg-err {
  margin-top: 0;
  font-size: 13px;
  color: var(--el-color-danger);
  line-height: 1.5;
}

.msg-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 0;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 28%, transparent);
  text-decoration: none;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
    border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
  }
}

.msg-link__icon {
  font-size: 16px;
}

.main-empty {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 36px 24px;
}

.main-empty__card {
  max-width: 400px;
  padding: 36px 32px;
  text-align: center;
  border-radius: 20px;
  background: color-mix(in srgb, var(--el-bg-color) 86%, transparent);
  border: 1px solid rgba(15, 23, 42, 0.07);
  box-shadow:
    0 8px 32px rgba(15, 23, 42, 0.07),
    0 0 0 1px rgba(255, 255, 255, 0.7) inset;
  backdrop-filter: blur(12px);
}

.main-empty__title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--el-text-color-primary);
}

.main-empty__sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--el-text-color-secondary);
}

.vc-drawer-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.vc-drawer-head__title {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--el-text-color-primary);
  line-height: 1.3;
}

.vc-drawer-head__meta {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.session-drawer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.session-drawer__tip {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-placeholder);
}

.session-drawer__scroll {
  flex: 1;
  min-height: 160px;
  padding-right: 4px;
}

.sess-item {
  padding: 14px 12px 14px 14px;
  margin-bottom: 0;
  cursor: pointer;
  border-radius: 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: background 0.15s ease;

  &:first-of-type {
    border-top: 1px solid var(--el-border-color-extra-light);
  }

  &:hover {
    background: var(--el-fill-color-lighter);
  }

  &.active {
    background: color-mix(in srgb, var(--el-color-primary) 8%, var(--el-bg-color));
    border-left: 3px solid var(--el-color-primary);
    padding-left: 11px;
  }
}

.sess-item__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.sess-item__trail {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.sess-item__del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--el-color-danger) 12%, var(--el-fill-color));
    color: var(--el-color-danger);
  }
}

.sess-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.01em;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sess-time {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.02em;
}

.sess-empty {
  padding: 28px 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  text-align: center;
  line-height: 1.55;
}

.composer-shell {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  padding: 12px calc(16px + var(--scroll-pad-r, 16px)) 28px 16px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    color-mix(in srgb, var(--app-bg) 40%, transparent) 35%,
    var(--app-bg) 100%
  );
}

.composer-card {
  position: relative;
  max-width: var(--vc-stream-max);
  margin: 0 auto;
  padding: 18px 18px 16px;
  border-radius: 22px;
  background: var(--el-bg-color);
  border: 1px solid rgba(15, 23, 42, 0.07);
  box-shadow:
    0 10px 44px rgba(15, 23, 42, 0.1),
    0 2px 8px rgba(15, 23, 42, 0.04);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &--drag {
    border-color: color-mix(in srgb, var(--el-color-primary) 45%, transparent);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--el-color-primary) 18%, transparent),
      0 14px 48px rgba(15, 23, 42, 0.12);
  }
}

.composer-drop-hint {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 22px;
  background: color-mix(in srgb, var(--el-color-primary-light-9) 92%, transparent);
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.composer-head {
  display: flex;
  align-items: center;
  padding-bottom: 10px;
  margin-bottom: 0;
  gap: 8px;
}

.composer-head__uploads {
  display: flex;
  align-items: center;
  gap: 10px;
}

.composer-head__spacer {
  flex: 1;
  min-width: 8px;
}

.composer-body {
  min-width: 0;
}

.vc-prompt-picker {
  min-height: 48px;
}

.vc-prompt-picker__empty {
  padding: 16px 14px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.vc-prompt-picker__row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  margin: 0;
  padding: 10px 14px;
  border: none;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--el-fill-color-light);
  }
}

.vc-prompt-picker__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.vc-prompt-picker__preview {
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.composer-icon-btn {
  color: var(--el-text-color-regular);

  .el-icon {
    margin: 0;
  }

  &:hover {
    background: var(--el-fill-color-light);
  }

  &.composer-icon-btn--rail {
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: var(--el-fill-color-lighter);
    box-shadow: none;

    &:hover {
      border-color: color-mix(in srgb, var(--el-color-primary) 28%, transparent);
      color: var(--el-color-primary);
    }
  }
}

.composer-icon-btn--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pending-strip {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  margin-bottom: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

.pending-tile {
  position: relative;
  flex-shrink: 0;
  width: 88px;
  height: 88px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: var(--el-fill-color-lighter);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);

  .pending-tile-media,
  .pv {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .pv--err {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--el-color-danger);
    text-align: center;
    padding: 4px;
    box-sizing: border-box;
  }
}

.pending-tile__x {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  width: 22px;
  height: 22px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--el-color-white);
  background: rgba(0, 0, 0, 0.45);
  transition: background 0.15s;

  &:hover {
    background: rgba(0, 0, 42, 0.75);
  }

  .el-icon {
    font-size: 14px;
  }
}

:deep(.composer-input.el-textarea) {
  .el-textarea__inner {
    border: none;
    box-shadow: none;
    padding: 10px 6px;
    font-size: 15px;
    line-height: 1.6;
    background: transparent;

    &:focus {
      box-shadow: none;
    }
  }
}

.composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

.composer-foot__right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.composer-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-placeholder);
  line-height: 1.45;
  white-space: nowrap;
}

.composer-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  line-height: 1.45;
}

@media (max-width: 768px) {
  .video-chat__toolbar {
    padding: 10px 12px;
    display: flex;
    flex-wrap: wrap;
  }

  .video-chat__toolbar-start {
    justify-self: auto;
  }

  .video-chat__toolbar-center {
    flex: 1 1 100%;
    order: 3;
    justify-content: stretch;
    justify-self: auto;
    max-width: none;
  }

  .video-chat__toolbar-end {
    flex: 1;
    justify-content: flex-end;
    justify-self: auto;
    margin-left: auto;
  }

  .toolbar-model {
    width: 100%;
    max-width: none;
  }

  :deep(.toolbar-model.el-select) {
    width: 100% !important;
    min-width: 0 !important;

    .el-select__wrapper {
      width: 100% !important;
      min-width: 0 !important;
      max-width: none !important;
    }
  }

  .msg-scroll {
    --scroll-pad-r: 12px;
  }

  .msg-stream {
    padding-left: 16px;
    padding-right: 16px;
  }

  .composer-shell {
    padding-left: 12px;
    padding-right: 12px;
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  }

  .main-empty {
    padding: 28px 16px;
  }
}
</style>

<style lang="scss">
/* Drawer 挂载到 body，需非 scoped */
.el-drawer.vc-sessions-drawer {
  .el-drawer__header {
    margin-bottom: 0;
    padding: 20px 20px 8px;
  }

  .el-drawer__body {
    padding-top: 0;
  }
}

.vc-sessions-drawer__body {
  padding: 0 16px 24px !important;
}

.vc-prompt-dialog .el-dialog__body {
  padding-top: 8px;
}
</style>
