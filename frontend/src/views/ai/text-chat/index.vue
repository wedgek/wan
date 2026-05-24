<template>
  <div class="text-chat">
    <main class="text-chat__main">
      <div class="text-chat__bg" aria-hidden="true" />

      <header class="text-chat__toolbar">
        <div class="text-chat__toolbar-start">
          <el-radio-group v-model="generationMode" size="small" class="mode-switch" @change="onModeChange">
            <el-radio-button value="reply">对话</el-radio-button>
            <el-radio-button value="image">生图</el-radio-button>
          </el-radio-group>
          <el-tooltip
            v-if="generationMode === 'reply' && contextMeta"
            :content="contextTooltip"
            placement="bottom"
            :show-after="200"
          >
            <div class="context-meter">
              <span class="context-meter__label">上下文 {{ contextMeta.usagePercent }}%</span>
              <el-progress
                :percentage="contextMeta.usagePercent"
                :stroke-width="4"
                :show-text="false"
                :status="contextMeta.usagePercent >= contextMeta.summarizeThresholdPercent ? 'warning' : ''"
              />
            </div>
          </el-tooltip>
        </div>
        <div class="text-chat__toolbar-center">
          <el-select
            v-model="activeModelId"
            placeholder="选择模型"
            class="toolbar-model"
            filterable
            size="default"
          >
            <template v-if="activeModel" #label>
              <div class="toolbar-model-option toolbar-model-option--selected">
                <VendorBadge
                  :vendor="activeModel.vendor"
                  :api-model-id="activeModel.apiModelId"
                  :show-label="false"
                  compact
                />
                <span class="toolbar-model-option__name">{{ activeModel.name }}</span>
              </div>
            </template>
            <el-option v-for="x in activeModels" :key="x.id" :label="x.name" :value="x.id">
              <div class="toolbar-model-option">
                <VendorBadge :vendor="x.vendor" :api-model-id="x.apiModelId" :show-label="false" compact />
                <span class="toolbar-model-option__name">{{ x.name }}</span>
                <el-tag v-if="generationMode === 'reply' && x.supportsVision" size="small" type="success">视觉</el-tag>
                <el-tag v-if="generationMode === 'image' && x.supportsImageEdit" size="small" type="warning">图生图</el-tag>
              </div>
            </el-option>
          </el-select>
        </div>
        <div class="text-chat__toolbar-end">
          <router-link to="/ai/video-chat" class="toolbar-link">视频生成</router-link>
          <el-button type="primary" :icon="$icons.Plus" @click="createSession">新建对话</el-button>
          <el-button @click="sessionsDrawer = true">
            <el-icon class="text-chat__toolbar-ic"><component :is="$icons.ChatLineRound" /></el-icon>
            对话记录
          </el-button>
        </div>
      </header>

      <div v-if="!sessionReady" class="text-chat__boot" v-loading="true" element-loading-text="加载会话…" />
      <template v-else>
        <div class="text-chat__stream-slot">
          <el-scrollbar ref="msgScrollRef" class="msg-scroll">
            <div class="msg-stream" :class="{ 'msg-stream--has-msgs': messages.length }">
              <div v-for="m in messages" :key="m.id" class="msg-row" :class="'msg-row--' + m.role">
                <div class="msg-bubble">
                  <div v-if="m.role === 'assistant'" class="msg-role">助手</div>
                  <div v-else class="msg-role">我</div>
                  <div v-if="m.attachments?.images?.length" class="msg-images">
                    <img
                      v-for="(img, idx) in m.attachments.images"
                      :key="idx"
                      :src="img"
                      alt=""
                      class="msg-image"
                      loading="lazy"
                    />
                  </div>
                  <div
                    v-if="m.role === 'assistant' && m.id === streamingAssistId && isAssistantLoading(m)"
                    class="msg-loading"
                  >
                    <span class="dot-pulse" />
                    <span class="msg-loading__hint">{{ generationMode === 'image' ? '生成图片中…' : '思考中…' }}</span>
                  </div>
                  <div v-else-if="m.generationMode === 'image' && m.resultUrls?.length" class="msg-results">
                    <img
                      v-for="(url, idx) in m.resultUrls"
                      :key="idx"
                      :src="url"
                      alt=""
                      class="msg-result-image"
                      loading="lazy"
                    />
                    <div class="msg-result-actions">
                      <el-button
                        v-for="(url, idx) in m.resultUrls"
                        :key="'dl-' + idx"
                        size="small"
                        link
                        type="primary"
                        @click="downloadImage(url, idx)"
                      >
                        下载图片{{ m.resultUrls.length > 1 ? idx + 1 : '' }}
                      </el-button>
                    </div>
                  </div>
                  <div v-else-if="m.status === 'failed'" class="msg-error">{{ m.errorMessage || '生成失败' }}</div>
                  <div v-else-if="m.text" class="msg-text">{{ m.text }}</div>
                  <div v-if="m.modelName && m.role === 'assistant'" class="msg-meta">{{ m.modelName }}</div>
                </div>
              </div>
              <div v-if="!messages.length" class="text-chat__empty">
                <p>{{ generationMode === 'image' ? '描述你想生成的画面' : '开始一段新对话' }}</p>
                <p class="text-chat__empty-hint">
                  {{
                    generationMode === 'image'
                      ? '支持文生图与参考图编辑，可与对话混用同一会话'
                      : '支持文字与图片输入，会话内自动摘要以延长记忆'
                  }}
                </p>
              </div>
            </div>
          </el-scrollbar>
        </div>

        <footer class="composer">
          <div v-if="pendingImages.length" class="pending-strip">
            <div v-for="(img, idx) in pendingImages" :key="img + idx" class="pending-tile">
              <img :src="img" alt="" />
              <button type="button" class="pending-tile__remove" @click="removePendingImage(idx)">×</button>
            </div>
          </div>
          <div class="composer__row">
            <el-upload
              :show-file-list="false"
              accept="image/*"
              multiple
              :http-request="onPickImages"
              :disabled="sending || pendingImages.length >= MAX_IMAGES"
            >
              <el-button :icon="$icons.Picture" circle plain :disabled="sending" />
            </el-upload>
            <el-input
              v-model="inputText"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 8 }"
              :placeholder="composerPlaceholder"
              class="composer__input"
              :maxlength="generationMode === 'image' ? IMAGE_INPUT_MAX : INPUT_MAX"
              :disabled="sending"
              @keydown.ctrl.enter.prevent="sendMessage"
            />
            <el-button type="primary" :loading="sending" :disabled="!canSend" @click="sendMessage">
              {{ generationMode === 'image' ? '生成' : '发送' }}
            </el-button>
          </div>
          <div class="composer__foot">
            <div v-if="generationMode === 'image'" class="composer__image-opts">
              <el-select v-model="imageSize" size="small" style="width: 150px">
                <el-option label="1:1" value="1024x1024" />
                <el-option label="9:16 竖屏" value="1024x1792" />
                <el-option label="16:9 横屏" value="1792x1024" />
              </el-select>
              <el-select v-model="imageCount" size="small" style="width: 88px">
                <el-option v-for="n in 4" :key="n" :label="`${n} 张`" :value="n" />
              </el-select>
            </div>
            <span class="composer__count">
              {{ inputText.length }}/{{ generationMode === 'image' ? IMAGE_INPUT_MAX : INPUT_MAX }}
            </span>
            <span class="composer__hint">Ctrl + Enter {{ generationMode === 'image' ? '生成' : '发送' }}</span>
          </div>
        </footer>
      </template>
    </main>

    <el-drawer v-model="sessionsDrawer" title="对话记录" size="320px" class="tc-sessions-drawer">
      <div class="sess-list">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="sess-item"
          :class="{ 'sess-item--active': s.id === activeSessionId }"
          @click="switchSession(s.id)"
        >
          <div class="sess-item__title">{{ s.title }}</div>
          <div class="sess-item__time">{{ formatTime(s.updateTime || s.createTime) }}</div>
          <el-button
            class="sess-item__del"
            type="danger"
            link
            :icon="$icons.Delete"
            @click.stop="deleteSessionEntry(s.id)"
          />
        </div>
        <div v-if="!sessions.length" class="sess-empty">暂无对话</div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import VendorBadge from '@/components/vendor-badge/index.vue'
import { uploadImage } from '@/request/oss'
import {
  createTextChatSessionApi,
  deleteTextChatSessionApi,
  getTextChatMessagesApi,
  getTextChatSessionsApi,
  listEnabledImageModelsApi,
  listEnabledTextModelsApi,
  sendTextChatStreamApi,
} from '@/api/textChat'

const INPUT_MAX = 20000
const IMAGE_INPUT_MAX = 2000
const MAX_IMAGES = 4
const MODEL_STORAGE_KEY = 'wan-ai-text-chat-model-id'
const IMAGE_MODEL_STORAGE_KEY = 'wan-ai-text-chat-image-model-id'
const MODE_STORAGE_KEY = 'wan-ai-text-chat-generation-mode'

const textModels = ref([])
const imageModels = ref([])
const selectedTextModelId = ref(null)
const selectedImageModelId = ref(null)
const generationMode = ref('reply')
const imageSize = ref('1024x1024')
const imageCount = ref(1)
const sessions = ref([])
const activeSessionId = ref(null)
const messages = ref([])
const sessionReady = ref(false)
const sessionsDrawer = ref(false)
const inputText = ref('')
const pendingImages = ref([])
const sending = ref(false)
const streamingAssistId = ref(null)
const contextMeta = ref(null)
const msgScrollRef = ref(null)

const activeModels = computed(() => (generationMode.value === 'image' ? imageModels.value : textModels.value))

const activeModelId = computed({
  get() {
    return generationMode.value === 'image' ? selectedImageModelId.value : selectedTextModelId.value
  },
  set(id) {
    if (generationMode.value === 'image') selectedImageModelId.value = id
    else selectedTextModelId.value = id
  },
})

const activeModel = computed(() => activeModels.value.find((m) => m.id === activeModelId.value) || null)

const composerPlaceholder = computed(() => {
  if (generationMode.value === 'image') {
    return activeModel.value?.supportsImageEdit
      ? '描述要生成的画面，可上传参考图…'
      : '描述要生成的画面…'
  }
  return '输入消息，可上传图片…'
})

const canSend = computed(() => {
  if (sending.value) return false
  const hasText = String(inputText.value || '').trim().length > 0
  const hasImg = pendingImages.value.length > 0
  if (generationMode.value === 'image') return hasText && !!activeModelId.value
  return (hasText || hasImg) && !!activeModelId.value
})

const contextTooltip = computed(() => {
  if (!contextMeta.value) return ''
  const m = contextMeta.value
  let tip = `已用约 ${m.usedTokens} / ${m.budgetTokens} tokens（${m.usagePercent}%）`
  if (m.summaryActive) tip += '；较早对话已自动摘要'
  if (m.usagePercent >= m.summarizeThresholdPercent) tip += '；接近上下文上限'
  return tip
})

function formatTime(iso) {
  if (!iso) return ''
  return dayjs(iso).format('MM-DD HH:mm')
}

function scrollBottom() {
  nextTick(() => {
    const el = msgScrollRef.value?.wrapRef
    if (el) el.scrollTop = el.scrollHeight
  })
}

function loadModelFromStorage(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) return Number(raw) || null
  } catch (_) {
    /* ignore */
  }
  return null
}

function saveModelToStorage(key, id) {
  try {
    if (id) sessionStorage.setItem(key, String(id))
  } catch (_) {
    /* ignore */
  }
}

function loadModeFromStorage() {
  try {
    const raw = sessionStorage.getItem(MODE_STORAGE_KEY)
    if (raw === 'image' || raw === 'reply') return raw
  } catch (_) {
    /* ignore */
  }
  return 'reply'
}

function onModeChange(mode) {
  try {
    sessionStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch (_) {
    /* ignore */
  }
}

function isAssistantLoading(m) {
  if (m.generationMode === 'image') {
    return m.status === 'processing' || (!m.resultUrls?.length && !m.errorMessage)
  }
  return !m.text
}

async function downloadImage(url, idx) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `wan-ai-image-${Date.now()}-${idx + 1}.png`
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (_) {
    window.open(url, '_blank')
  }
}

async function loadTextModels() {
  const res = await listEnabledTextModelsApi()
  if (res.code !== 0) return
  textModels.value = res.data || []
  const stored = loadModelFromStorage(MODEL_STORAGE_KEY)
  const hit = textModels.value.find((m) => m.id === stored)
  const def = textModels.value.find((m) => m.isDefault)
  selectedTextModelId.value = hit?.id || def?.id || textModels.value[0]?.id || null
}

async function loadImageModels() {
  const res = await listEnabledImageModelsApi()
  if (res.code !== 0) return
  imageModels.value = res.data || []
  const stored = loadModelFromStorage(IMAGE_MODEL_STORAGE_KEY)
  const hit = imageModels.value.find((m) => m.id === stored)
  const def = imageModels.value.find((m) => m.isDefault)
  selectedImageModelId.value = hit?.id || def?.id || imageModels.value[0]?.id || null
}

async function loadModels() {
  await Promise.all([loadTextModels(), loadImageModels()])
}

async function loadSessions() {
  const res = await getTextChatSessionsApi({ pageNo: 1, pageSize: 50 })
  if (res.code !== 0) return
  sessions.value = res.data?.list || []
}

async function loadMessages(scroll = true) {
  if (!activeSessionId.value) {
    messages.value = []
    contextMeta.value = null
    return
  }
  const res = await getTextChatMessagesApi({
    sessionId: activeSessionId.value,
    pageNo: 1,
    pageSize: 200,
  })
  if (res.code !== 0) return
  messages.value = res.data?.list || []
  contextMeta.value = res.data?.contextMeta || null
  if (scroll) scrollBottom()
}

async function activateNewChatSession() {
  const res = await createTextChatSessionApi({
    modelId: selectedTextModelId.value,
    imageModelId: selectedImageModelId.value,
  })
  if (res.code !== 0) throw new Error(res.msg || '创建会话失败')
  const sess = res.data
  sessions.value = [sess, ...sessions.value.filter((s) => s.id !== sess.id)]
  activeSessionId.value = sess.id
  messages.value = []
  contextMeta.value = null
}

async function ensureSession() {
  if (activeSessionId.value) return
  if (sessions.value.length) {
    activeSessionId.value = sessions.value[0].id
    return
  }
  await activateNewChatSession()
}

async function createSession() {
  await activateNewChatSession()
  sessionsDrawer.value = false
}

async function switchSession(id) {
  if (id === activeSessionId.value) {
    sessionsDrawer.value = false
    return
  }
  activeSessionId.value = id
  await loadMessages()
  sessionsDrawer.value = false
}

async function deleteSessionEntry(id) {
  const res = await deleteTextChatSessionApi(id)
  if (res.code !== 0) {
    ElMessage.error(res.msg || '删除失败')
    return
  }
  sessions.value = sessions.value.filter((s) => s.id !== id)
  if (activeSessionId.value === id) {
    activeSessionId.value = sessions.value[0]?.id || null
    if (!activeSessionId.value) await activateNewChatSession()
    else await loadMessages()
  }
}

async function onPickImages({ file }) {
  if (pendingImages.value.length >= MAX_IMAGES) {
    ElMessage.warning(`最多 ${MAX_IMAGES} 张图片`)
    return
  }
  try {
    const { url } = await uploadImage(file)
    if (url) pendingImages.value.push(url)
  } catch (e) {
    ElMessage.error(e.message || '上传失败')
  }
}

function removePendingImage(idx) {
  pendingImages.value.splice(idx, 1)
}

async function sendMessage() {
  if (!canSend.value) return

  if (generationMode.value === 'reply' && pendingImages.value.length && !activeModel.value?.supportsVision) {
    ElMessage.warning('当前模型不支持图片，请更换支持视觉的模型或移除图片')
    return
  }

  if (generationMode.value === 'image' && pendingImages.value.length && !activeModel.value?.supportsImageEdit) {
    ElMessage.warning('当前模型不支持参考图编辑，请更换模型或移除参考图')
    return
  }

  const capturedText = String(inputText.value || '').trim()
  const capturedImages = [...pendingImages.value]
  const capturedSize = imageSize.value
  const capturedCount = imageCount.value
  const capturedMode = generationMode.value
  inputText.value = ''
  pendingImages.value = []

  if (!activeSessionId.value) {
    try {
      await activateNewChatSession()
    } catch (e) {
      ElMessage.error(e.message || '创建会话失败')
      inputText.value = capturedText
      pendingImages.value = capturedImages
      return
    }
  }

  const optimisticUserId = -Date.now()
  const optimisticAssistId = optimisticUserId - 1
  streamingAssistId.value = optimisticAssistId
  const nowStr = new Date().toISOString()

  messages.value = [
    ...messages.value,
    {
      id: optimisticUserId,
      sessionId: activeSessionId.value,
      role: 'user',
      text: capturedText,
      attachments: { images: capturedImages },
      generationMode: capturedMode,
      createTime: nowStr,
    },
    {
      id: optimisticAssistId,
      sessionId: activeSessionId.value,
      role: 'assistant',
      text: '',
      attachments: { images: [] },
      generationMode: capturedMode,
      status: 'processing',
      resultUrls: [],
      modelName: activeModel.value?.name || '',
      createTime: '',
    },
  ]
  scrollBottom()

  sending.value = true
  try {
    const result = await sendTextChatStreamApi(
      {
        sessionId: activeSessionId.value,
        text: capturedText,
        imageUrls: capturedImages,
        modelId: activeModelId.value,
        generationMode: capturedMode,
        size: capturedSize,
        n: capturedCount,
      },
      (text) => {
        if (capturedMode !== 'reply') return
        const idx = messages.value.findIndex((m) => m.id === optimisticAssistId)
        if (idx >= 0) messages.value[idx] = { ...messages.value[idx], text }
        scrollBottom()
      },
    )
    await loadMessages(false)
    if (result.contextMeta) contextMeta.value = result.contextMeta
    scrollBottom()
  } catch (e) {
    messages.value = messages.value.filter((m) => m.id !== optimisticUserId && m.id !== optimisticAssistId)
    inputText.value = capturedText
    pendingImages.value = capturedImages
    if (capturedMode === 'image') {
      imageSize.value = capturedSize
      imageCount.value = capturedCount
    }
    ElMessage.error(e.message || '发送失败')
  } finally {
    sending.value = false
    streamingAssistId.value = null
  }
}

watch(selectedTextModelId, (id) => {
  if (id) saveModelToStorage(MODEL_STORAGE_KEY, id)
})

watch(selectedImageModelId, (id) => {
  if (id) saveModelToStorage(IMAGE_MODEL_STORAGE_KEY, id)
})

onMounted(async () => {
  generationMode.value = loadModeFromStorage()
  sessionReady.value = false
  try {
    await loadModels()
    await loadSessions()
    await ensureSession()
    await loadMessages(false)
  } finally {
    sessionReady.value = true
  }
})
</script>

<style scoped lang="scss">
.text-chat {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color-page);
}

.text-chat__main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.text-chat__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(64, 158, 255, 0.08), transparent);
}

.text-chat__toolbar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}

.text-chat__toolbar-start {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.mode-switch {
  flex-shrink: 0;
}

.toolbar-link {
  font-size: 13px;
  color: var(--el-color-primary);
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    text-decoration: underline;
  }
}

.text-chat__toolbar-center {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}

.text-chat__toolbar-end {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
}

.toolbar-model {
  width: min(360px, 100%);
}

.toolbar-model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.context-meter {
  width: 120px;

  &__label {
    display: block;
    font-size: 11px;
    color: var(--el-text-color-secondary);
    margin-bottom: 4px;
  }
}

.text-chat__boot {
  flex: 1;
  min-height: 200px;
}

.text-chat__stream-slot {
  flex: 1;
  min-height: 0;
  position: relative;
  z-index: 1;
}

.msg-scroll {
  height: 100%;
}

.msg-stream {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 16px 120px;
  min-height: 100%;
  box-sizing: border-box;
}

.msg-row {
  display: flex;
  margin-bottom: 20px;

  &--user {
    justify-content: flex-end;

    .msg-bubble {
      background: var(--el-color-primary-light-9);
      border-color: var(--el-color-primary-light-7);
    }
  }

  &--assistant .msg-bubble {
    background: var(--el-bg-color);
    border-color: var(--el-border-color-lighter);
  }
}

.msg-bubble {
  max-width: min(720px, 92%);
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid;
}

.msg-role {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.msg-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  font-size: 14px;
}

.msg-meta {
  margin-top: 8px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.msg-image {
  max-width: 200px;
  max-height: 160px;
  border-radius: 8px;
  object-fit: cover;
}

.msg-loading {
  padding: 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;

  &__hint {
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }
}

.msg-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.msg-result-image {
  max-width: min(360px, 100%);
  border-radius: 8px;
  object-fit: contain;
}

.msg-result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.msg-error {
  color: var(--el-color-danger);
  font-size: 14px;
}

.dot-pulse {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.text-chat__empty {
  text-align: center;
  padding: 80px 16px;
  color: var(--el-text-color-secondary);

  p {
    margin: 0 0 8px;
    font-size: 16px;
  }
}

.text-chat__empty-hint {
  font-size: 13px;
  opacity: 0.8;
}

.composer {
  position: relative;
  z-index: 3;
  margin: 0 auto 16px;
  width: min(860px, calc(100% - 32px));
  padding: 12px;
  border-radius: 16px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
}

.pending-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.pending-tile {
  position: relative;
  width: 64px;
  height: 64px;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
  }

  &__remove {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
}

.composer__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.composer__input {
  flex: 1;
}

.composer__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  gap: 8px;
  flex-wrap: wrap;
}

.composer__image-opts {
  display: flex;
  gap: 8px;
}

.sess-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sess-item {
  position: relative;
  padding: 10px 36px 10px 12px;
  border-radius: 8px;
  cursor: pointer;

  &:hover {
    background: var(--el-fill-color-light);
  }

  &--active {
    background: var(--el-color-primary-light-9);
  }

  &__title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__time {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-top: 4px;
  }

  &__del {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
  }
}

.sess-empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  padding: 24px;
}
</style>
