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
      <template v-else-if="sessionReady">
        <div class="video-chat__stream-slot">
          <el-scrollbar ref="msgScrollRef" class="msg-scroll" @scroll="onMsgScroll">
            <div class="msg-stream" :class="{ 'msg-stream--has-msgs': messages.length }">
              <div
                v-for="(round, roundIdx) in messageRounds"
                :key="messageRoundKey(round)"
                class="msg-round"
                :data-round-idx="roundIdx"
              >
                  <div v-for="m in round" :key="m.id" class="msg-row" :class="'msg-row--' + m.role">
                    <div class="msg-feed-head">
                      <div class="msg-feed-head__line">
                        <span class="msg-feed-role">{{ feedRoleLabel(m) }}</span>
                        <template v-if="messageFeedTimePart(m)">
                          <span class="msg-feed-head__sep" aria-hidden="true">·</span>
                          <span class="msg-feed-time">{{ messageFeedTimePart(m) }}</span>
                        </template>
                      </div>
                    </div>
                    <div class="msg-bubble msg-feed__body" :class="{ 'msg-bubble--has-media': messageHasMedia(m) }">
                      <div v-if="messageHasMedia(m)" class="msg-media-row">
                        <template v-if="m.attachments?.images?.length">
                          <div
                            v-for="(u, i) in m.attachments.images"
                            :key="'mi' + i"
                            class="msg-media-slot msg-media-slot--image"
                          >
                            <LazyImage
                              :src="u"
                              :preview-src-list="chatAttachmentImageUrls(m)"
                              :initial-index="i"
                            />
                          </div>
                        </template>
                        <template v-for="(u, i) in m.attachments?.videos || []" :key="'mv' + i">
                          <div
                            v-if="!failedVideoUrls.has(u)"
                            class="msg-media-slot msg-media-slot--video"
                          >
                            <LazyVideo
                              :src="u"
                              preload-level="none"
                              @loadedmetadata="nudgeVideoFirstFrame"
                              @error="markVideoFailed(u)"
                            />
                          </div>
                          <div v-else class="msg-media-slot msg-media-slot--video msg-media-slot--err" role="img" aria-label="视频无法加载">
                            无法加载
                          </div>
                        </template>
                      </div>
                      <div v-if="m.text" class="msg-text-stack">
                        <div
                          :ref="(el) => bindMsgTextEl(m.id, el)"
                          class="msg-text"
                          :class="{ 'msg-text--clamped-2': !isMsgTextExpanded(m.id) }"
                          v-html="highlightMediaRefs(m.text)"
                        />
                      </div>
                      <template v-if="m.role === 'assistant'">
                        <div v-if="assistantShowAssistBlock(m)" class="msg-assist-foot">
                          <div v-if="assistantIsRunning(m)" class="msg-assist-loading">
                            <span class="msg-assist-loading__ring" aria-hidden="true" />
                            <div class="msg-assist-loading__copy">
                              <span class="msg-assist-loading__title">正在生成视频</span>
                              <span class="msg-assist-loading__sub">任务进行中，可随时离开页面，稍后回来查看结果</span>
                            </div>
                          </div>
                          <template v-else-if="assistantIsSuccess(m)">
                            <div v-if="m.resultUrl" class="msg-result-vid-wrap">
                              <div
                                v-if="!failedVideoUrls.has(m.resultUrl)"
                                class="msg-media-slot msg-media-slot--video"
                              >
                                <LazyVideo
                                  :key="'result-' + m.id"
                                  :src="m.resultUrl"
                                  :poster="resultVideoPosters[String(m.id)] || undefined"
                                  preload-level="metadata"
                                  @loadedmetadata="(e) => onAssistantResultVideoMeta(e, m)"
                                  @error="markVideoFailed(m.resultUrl)"
                                />
                              </div>
                              <div v-else class="msg-media-fail-banner" role="status">
                                成片无法在此解码，请检查链接或重新生成
                              </div>
                            </div>
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
                      v-if="
                        m.role === 'user' ||
                        !deleteMessageDisabled(m) ||
                        (m.text && msgTextOverflow[String(m.id)]) ||
                        assistantCanDownloadResult(m)
                      "
                      class="msg-feed-actions msg-feed-actions--below"
                    >
                      <div
                        v-if="
                          m.role === 'user' || assistantCanDownloadResult(m) || !deleteMessageDisabled(m)
                        "
                        class="msg-feed-actions__left"
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
                        <template v-if="assistantCanDownloadResult(m)">
                          <el-tooltip content="下载成片" placement="top" :show-after="400">
                            <span class="msg-act-tooltip-span">
                              <button
                                type="button"
                                class="msg-act-btn"
                                :disabled="!!assistantDownloadBusy[String(m.id)]"
                                @click="downloadAssistantResult(m)"
                              >
                                <el-icon :size="16"><component :is="$icons.Download" /></el-icon>
                              </button>
                            </span>
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
                      <div v-if="m.text && msgTextOverflow[String(m.id)]" class="msg-feed-actions__tail">
                        <button type="button" class="msg-text-toggle" @click="toggleMsgTextExpand(m.id)">
                          {{ isMsgTextExpanded(m.id) ? "收起" : "展开" }}
                        </button>
                      </div>
                    </div>
                  </div>
              </div>
            </div>
          </el-scrollbar>
          <div v-if="!messages.length" class="video-chat__empty-logo-overlay" aria-hidden="true">
            <img :src="logoMark" alt="" class="msg-stream__logo-img" />
          </div>
          <div v-if="messageRounds.length > 1" class="round-nav">
            <button
              type="button"
              class="round-nav__btn"
              @click="scrollToTop"
            >
              <el-icon :size="18"><component :is="$icons.ArrowUp" /></el-icon>
            </button>
            <span class="round-nav__indicator">{{ currentVisibleRound }}/{{ messageRounds.length }}</span>
            <button
              type="button"
              class="round-nav__btn"
              @click="scrollToEnd"
            >
              <el-icon :size="18"><component :is="$icons.ArrowDown" /></el-icon>
            </button>
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
                <el-tooltip content="参考图片" placement="top" :show-after="280">
                  <span class="composer-rail-item">
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
                        title="参考图片"
                        circle
                      >
                        <el-icon :size="20"><component :is="$icons.Picture" /></el-icon>
                      </el-button>
                    </el-upload>
                  </span>
                </el-tooltip>
                <el-tooltip content="参考视频" placement="top" :show-after="280">
                  <span class="composer-rail-item">
                    <el-upload
                      :show-file-list="false"
                      accept=".mp4,.mov,video/mp4,video/quicktime"
                      :disabled="uploadBusy || !referenceVideoAllowed"
                      :http-request="onPickVideo"
                    >
                      <el-button
                        class="composer-icon-btn composer-icon-btn--rail"
                        :class="{ 'composer-icon-btn--disabled': !referenceVideoAllowed }"
                        :disabled="uploadBusy || !referenceVideoAllowed"
                        title="参考视频"
                        circle
                      >
                        <el-icon :size="20"><component :is="$icons.VideoCamera" /></el-icon>
                      </el-button>
                    </el-upload>
                  </span>
                </el-tooltip>
                <el-tooltip content="提示词库" placement="top" :show-after="280">
                  <span class="composer-rail-item">
                    <el-button
                      class="composer-icon-btn composer-icon-btn--rail"
                      circle
                      title="提示词库"
                      @click="openPromptPicker"
                    >
                      <el-icon :size="20"><component :is="$icons.Collection" /></el-icon>
                    </el-button>
                  </span>
                </el-tooltip>
                <el-tooltip content="产品库" placement="top" :show-after="280">
                  <span class="composer-rail-item">
                    <el-button
                      class="composer-icon-btn composer-icon-btn--rail"
                      circle
                      title="产品库"
                      @click="openProductLibraryPicker"
                    >
                      <el-icon :size="20"><component :is="$icons.Goods" /></el-icon>
                    </el-button>
                  </span>
                </el-tooltip>
              </div>
              <div class="composer-head__gen toolbar-gen-opts">
                <el-select
                  v-model="videoAspectRatio"
                  class="toolbar-gen-select"
                  size="small"
                  placement="top"
                  teleported
                  popper-class="vc-toolbar-gen-popper"
                >
                  <el-option label="9:16" value="9:16" />
                  <el-option label="16:9" value="16:9" />
                  <el-option label="1:1" value="1:1" />
                </el-select>
                <el-select
                  v-model="videoDurationSec"
                  class="toolbar-gen-select toolbar-gen-select--dur"
                  size="small"
                  placement="top"
                  teleported
                  popper-class="vc-toolbar-gen-popper"
                >
                  <el-option v-for="sec in videoDurationChoices" :key="sec" :label="`${sec}s`" :value="sec" />
                </el-select>
                <el-select
                  v-model="videoResolution"
                  class="toolbar-gen-select toolbar-gen-select--res"
                  size="small"
                  placement="top"
                  teleported
                  popper-class="vc-toolbar-gen-popper"
                >
                  <el-option label="720p" value="720p" />
                  <el-option label="1080p" value="1080p" />
                </el-select>
              </div>
            </div>

            <div class="composer-body">
              <div v-if="pendingImages.length || pendingVideos.length" class="pending-strip">
                <draggable
                  :list="pendingImages"
                  :item-key="(url) => url"
                  class="pending-drag-group"
                  ghost-class="pending-tile--ghost"
                  :animation="150"
                >
                  <template #item="{ element: u, index: i }">
                    <div class="pending-tile pending-tile--img">
                      <button type="button" class="pending-tile__x" title="移除" @click.stop="removePendingImage(i)">
                        <el-icon><component :is="$icons.Close" /></el-icon>
                      </button>
                      <span class="pending-tile__badge pending-tile__badge--img">图片{{ i + 1 }}</span>
                      <el-image
                        :src="u"
                        fit="cover"
                        class="pending-tile-elimg"
                        :preview-src-list="[u]"
                        preview-teleported
                        hide-on-click-modal
                      />
                    </div>
                  </template>
                </draggable>

                <draggable
                  :list="pendingVideos"
                  :item-key="(url) => url"
                  class="pending-drag-group"
                  ghost-class="pending-tile--ghost"
                  :animation="150"
                  @end="onVideosDragEnd"
                >
                  <template #item="{ element: u, index: i }">
                    <div
                      class="pending-tile pending-tile--vid"
                      role="button"
                      tabindex="0"
                      title="点击播放预览"
                      @click="openPendingVideoPreview(u)"
                      @keydown.enter.prevent="openPendingVideoPreview(u)"
                    >
                      <span class="pending-tile__badge pending-tile__badge--vid">视频{{ i + 1 }}</span>
                      <span class="pending-tile__play" aria-hidden="true">
                        <el-icon :size="26"><component :is="$icons.VideoPlay" /></el-icon>
                      </span>
                      <button type="button" class="pending-tile__x" title="移除" @click.stop="removePendingVideo(i)">
                        <el-icon><component :is="$icons.Close" /></el-icon>
                      </button>
                      <video
                        v-if="!failedVideoUrls.has(u)"
                        :src="u"
                        class="pv pending-tile__vid-dec"
                        muted
                        playsinline
                        preload="auto"
                        @loadedmetadata="nudgeVideoFirstFrame"
                        @error="markVideoFailed(u)"
                      />
                      <div v-else class="pv pv--err">无法预览</div>
                    </div>
                  </template>
                </draggable>
              </div>

              <div class="composer-input-wrap">
                <el-input
                  ref="composerInputRef"
                  v-model="inputText"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 8 }"
                  :maxlength="INPUT_MAX_LENGTH"
                  :placeholder="mentionPlaceholder"
                  class="composer-input"
                  resize="none"
                  @keydown.enter.ctrl.exact.prevent="send"
                  @keydown="onInputKeydown"
                  @input="onInputChange"
                  @blur="onInputBlur"
                />
                <div
                  v-if="mentionDropdownVisible && mentionOptions.length"
                  class="mention-dropdown"
                  :style="mentionDropdownStyle"
                >
                  <div
                    v-for="(opt, idx) in mentionOptions"
                    :key="opt.value"
                    class="mention-dropdown__item"
                    :class="{ 'mention-dropdown__item--active': mentionActiveIndex === idx }"
                    @mousedown.prevent="selectMentionOption(opt)"
                    @mouseenter="mentionActiveIndex = idx"
                  >
                    <div class="mention-dropdown__thumb-wrap">
                      <img v-if="opt.type === 'image'" :src="opt.thumb" class="mention-dropdown__thumb" />
                      <video
                        v-else
                        :src="opt.videoUrl"
                        class="mention-dropdown__thumb"
                        muted
                        preload="metadata"
                      />
                      <span class="mention-dropdown__type-badge" :class="opt.type === 'video' ? 'mention-dropdown__type-badge--video' : ''">
                        {{ opt.type === 'video' ? '视频' : '图片' }}
                      </span>
                    </div>
                    <span class="mention-dropdown__label">{{ opt.label }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="composer-foot">
              <span class="composer-hint">Ctrl + Enter 发送</span>
              <div class="composer-foot__right">
                <span class="composer-count">{{ inputText.length }} / {{ INPUT_MAX_LENGTH }}</span>
                <el-button type="primary" round :disabled="!canSend || sending" @click="send">
                  发送
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </template>
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

    <ProductLibraryPickerDialog v-model="productLibraryDialogVisible" @picked="mergeProductLibraryImages" />

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

    <el-dialog
      v-model="pendingVideoDialogVisible"
      title="视频预览"
      width="min(720px, 94vw)"
      append-to-body
      align-center
      destroy-on-close
      class="vc-pending-vid-dialog"
      @closed="pendingVideoPreviewUrl = ''"
    >
      <div class="vc-pending-vid-dialog__wrap">
        <video
          v-if="pendingVideoPreviewUrl"
          :key="pendingVideoPreviewUrl"
          class="vc-pending-vid-dialog__video"
          :src="pendingVideoPreviewUrl"
          controls
          playsinline
          preload="auto"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup name="aiVideoChat">
import { nextTick, onMounted, onUnmounted, onActivated, ref, watch, computed, defineComponent, h } from "vue"
import { ElMessage, ElMessageBox } from "element-plus"
import dayjs from "dayjs"
import draggable from "vuedraggable"
import request from "@/request"
import { uploadImage, uploadVideo, getFileExt } from "@/request/oss"
import logoMark from "@/assets/images/logo.svg"
import ProductLibraryPickerDialog from "./ProductLibraryPickerDialog.vue"

/** 懒加载图片组件：进入可视区域后才加载 */
const LazyImage = defineComponent({
  props: {
    src: String,
    previewSrcList: Array,
    initialIndex: { type: Number, default: 0 },
  },
  setup(props) {
    const containerRef = ref(null)
    const shouldLoad = ref(false)
    let observer = null

    onMounted(() => {
      const el = containerRef.value
      if (!el) return
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            shouldLoad.value = true
            observer?.disconnect()
            observer = null
          }
        },
        { rootMargin: "300px" },
      )
      observer.observe(el)
    })

    onUnmounted(() => {
      observer?.disconnect()
      observer = null
    })

    return () =>
      h(
        "div",
        { ref: containerRef, class: "lazy-image-container" },
        shouldLoad.value
          ? h(resolveComponent("el-image"), {
              src: props.src,
              fit: "cover",
              class: "msg-media-elimage",
              previewSrcList: props.previewSrcList,
              initialIndex: props.initialIndex,
              previewTeleported: true,
              hideOnClickModal: true,
            })
          : h("div", { class: "lazy-image-placeholder" }),
      )
  },
})

/** 懒加载视频组件：进入可视区域后才加载 metadata */
const LazyVideo = defineComponent({
  props: {
    src: String,
    poster: String,
    controls: { type: Boolean, default: true },
    preloadLevel: { type: String, default: "none" },
  },
  emits: ["loadedmetadata", "error"],
  setup(props, { emit }) {
    const containerRef = ref(null)
    const shouldLoad = ref(false)
    let observer = null

    onMounted(() => {
      const el = containerRef.value
      if (!el) return
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            shouldLoad.value = true
            observer?.disconnect()
            observer = null
          }
        },
        { rootMargin: "200px" },
      )
      observer.observe(el)
    })

    onUnmounted(() => {
      observer?.disconnect()
      observer = null
    })

    return () =>
      h(
        "div",
        { ref: containerRef, class: "lazy-video-container" },
        shouldLoad.value
          ? h("video", {
              src: props.src,
              poster: props.poster || undefined,
              controls: props.controls,
              playsinline: true,
              muted: false,
              preload: props.preloadLevel,
              class: "msg-vid-el",
              onLoadedmetadata: (e) => emit("loadedmetadata", e),
              onError: (e) => emit("error", e),
            })
          : h("div", { class: "lazy-video-placeholder" }, [
              h("span", { class: "lazy-video-placeholder__icon" }, "▶"),
            ]),
      )
  },
})

import { resolveComponent } from "vue"

const VC_WIDE_STORAGE_KEY = "wan-ai-video-chat-wide"
/** 对话页所选视频模型，刷新后恢复（须仍在当前启用列表中） */
const VC_MODEL_ID_STORAGE_KEY = "wan-ai-video-chat-model-id"
const VC_ASPECT_STORAGE_KEY = "wan-ai-video-chat-aspect"
const VC_DURATION_STORAGE_KEY = "wan-ai-video-chat-duration"
const VC_RESOLUTION_STORAGE_KEY = "wan-ai-video-chat-resolution"

/** 与后端 videoChat normalize 及方舟 Seedance 文档常见区间对齐 */
const VIDEO_GEN_DURATION_MIN = 4
const VIDEO_GEN_DURATION_MAX = 15

const VALID_RESOLUTIONS = ["720p", "1080p"]

const videoAspectRatio = ref("9:16")
const videoDurationSec = ref(5)
const videoResolution = ref("1080p")
const videoDurationChoices = computed(() => {
  const list = []
  for (let s = VIDEO_GEN_DURATION_MIN; s <= VIDEO_GEN_DURATION_MAX; s++) list.push(s)
  return list
})

const pendingVideoDialogVisible = ref(false)
const pendingVideoPreviewUrl = ref("")

function openPendingVideoPreview(u) {
  const s = String(u || "").trim()
  if (!s) return
  pendingVideoPreviewUrl.value = s
  pendingVideoDialogVisible.value = true
}

function readStoredAspectRatio() {
  try {
    const r = sessionStorage.getItem(VC_ASPECT_STORAGE_KEY)
    if (r && ["9:16", "16:9", "1:1"].includes(r)) return r
  } catch (_) {
    /* ignore */
  }
  return null
}

function readStoredDurationSec() {
  try {
    const r = sessionStorage.getItem(VC_DURATION_STORAGE_KEY)
    const n = parseInt(String(r || ""), 10)
    if (Number.isFinite(n) && n >= VIDEO_GEN_DURATION_MIN && n <= VIDEO_GEN_DURATION_MAX) return n
  } catch (_) {
    /* ignore */
  }
  return null
}

function readStoredResolution() {
  try {
    const r = sessionStorage.getItem(VC_RESOLUTION_STORAGE_KEY)
    if (r && VALID_RESOLUTIONS.includes(r)) return r
  } catch (_) {
    /* ignore */
  }
  return null
}

watch(videoAspectRatio, (v) => {
  try {
    sessionStorage.setItem(VC_ASPECT_STORAGE_KEY, v)
  } catch (_) {
    /* ignore */
  }
})

watch(videoDurationSec, (v) => {
  try {
    sessionStorage.setItem(VC_DURATION_STORAGE_KEY, String(v))
  } catch (_) {
    /* ignore */
  }
})

watch(videoResolution, (v) => {
  try {
    sessionStorage.setItem(VC_RESOLUTION_STORAGE_KEY, v)
  } catch (_) {
    /* ignore */
  }
})

/**
 * 解析时间：后端返回 ISO UTC 字符串（带 Z），dayjs 自动按浏览器本地时区显示。
 */
function parseMessageInstant(d) {
  if (d == null || d === "") return null
  const s = String(d).trim()
  if (!s) return null
  const t = dayjs(s)
  return t.isValid() ? t : null
}

/** 会话列表、消息头等：时间精确到秒 */
function formatSessionTime(d) {
  const t = parseMessageInstant(d)
  if (!t || !t.isValid()) return d == null || d === "" ? "" : String(d)
  const now = dayjs()
  if (t.isSame(now, "day")) return `今天 ${t.format("HH:mm:ss")}`
  if (t.isSame(now.subtract(1, "day"), "day")) return `昨天 ${t.format("HH:mm:ss")}`
  if (t.isSame(now, "year")) return t.format("M月D日 HH:mm:ss")
  return t.format("YYYY-MM-DD HH:mm:ss")
}

function messageHasMedia(m) {
  const nImg = m?.attachments?.images?.length ?? 0
  const nVid = m?.attachments?.videos?.length ?? 0
  return nImg + nVid > 0
}

/** 当前消息图片 URL 列表（供 el-image 预览组图） */
function chatAttachmentImageUrls(m) {
  const raw = m?.attachments?.images
  if (!Array.isArray(raw) || !raw.length) return []
  return raw.map((u) => String(u || "").trim()).filter(Boolean)
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"])
/** 参考视频：仅 MP4 / MOV（扩展名或小写 MIME） */
const REFERENCE_VIDEO_EXTS = new Set(["mp4", "mov"])

/** 参考附件总数上限：图 + 视 + 音（当前仅图/视，音留作同上限计数） */
const REF_ATTACHMENT_MAX_TOTAL = 12
/** 参考视频条数上限 */
const REF_VIDEO_MAX_COUNT = 3
/** 参考视频总时长（秒）：所有参考视频时长之和 */
const REF_VIDEO_DURATION_SUM_MIN = 2
const REF_VIDEO_DURATION_SUM_MAX = 15
/** 参考视频体积：单文件与总和均须 < 此值（字节） */
const REF_VIDEO_MAX_BYTES = 50 * 1024 * 1024
/** 单路参考视频像素数（宽×高）；上限兼容 1080p（1920×1080 = 2073600） */
const REF_VIDEO_PIXELS_MIN = 409_600
const REF_VIDEO_PIXELS_MAX = 2_073_600

/** 输入框字数上限（与 Element 计数器一致） */
const INPUT_MAX_LENGTH = 20000

/**
 * 存在「生成中」助手消息时的列表轮询间隔（毫秒）。
 * 固定 4s 对 1～3 分钟级视频偏密，徒增请求与日志；8～12s 对完成态延迟通常可接受，可按业务微调。
 */
const VIDEO_CHAT_POLL_INTERVAL_MS = 8000

function truncatePromptPreview(raw, maxLen = 96) {
  const s = String(raw || "").replace(/\s+/g, " ").trim()
  if (s.length <= maxLen) return s || "（无内容）"
  return `${s.slice(0, maxLen)}…`
}

/** 参考视频是否允许：以「模型管理」中「支持参考视频」开关为准（见 /admin-api/video/model/list-enabled） */
function modelAllowsReferenceVideo(m) {
  return !!(m && m.supportsReferenceVideo)
}

const sessions = ref([])
/** 会话列表是否已从接口拉回 */
const sessionReady = ref(false)
const activeSessionId = ref(null)
const messages = ref([])
/** 防止多条 loadMessages 并发时后发先至，用旧列表覆盖新数据导致界面闪回 */
let loadMessagesSeq = 0
const models = ref([])
const selectedModelId = ref(null)
const inputText = ref("")
const composerInputRef = ref(null)
const pendingImages = ref([])
const pendingVideos = ref([])
/** 与 pendingVideos 下标对齐：本地/已探测到的元数据；reEdit 导入未探测时为 null */
const pendingVideosMeta = ref(/** @type {Array<{ size: number, duration: number, width: number, height: number } | null>} */ ([]))
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
const productLibraryDialogVisible = ref(false)
const promptLibLoading = ref(false)
/** @type {import('vue').Ref<Array<{ id: number; name?: string; content?: string }>>} */
const managedPrompts = ref([])
let dragDepth = 0
let pollTimer = null

/** 视频地址加载失败（如 404）时记入此处，移除 video 元素，避免浏览器对同一 URL 反复请求 */
const failedVideoUrls = ref(new Set())

/** 助手成片 inline video 的 poster（无跨域 CORS 时 canvas 无法导出，多数情况无封面但仍可播放） */
const resultVideoPosters = ref(/** @type {Record<string, string>} */ ({}))

function markVideoFailed(url) {
  const u = String(url || "")
  if (!u) return
  const next = new Set(failedVideoUrls.value)
  next.add(u)
  failedVideoUrls.value = next
}

/** 小尺寸内联 video：仅用 preload=none 时往往不拉数据，画面一直是灰块；在拿到时长后略 seek 触发首帧解码 */
function nudgeVideoFirstFrame(ev) {
  const v = ev.target
  if (!(v instanceof HTMLVideoElement)) return
  try {
    const d = v.duration
    if (!Number.isFinite(d) || d <= 0) return
    const t = Math.min(0.2, Math.max(0.05, d * 0.02))
    if (Math.abs(v.currentTime - t) > 0.01) v.currentTime = t
  } catch (_) {
    /* ignore */
  }
}

function onAssistantResultVideoMeta(ev, m) {
  const v = ev.target
  if (!(v instanceof HTMLVideoElement) || !m?.resultUrl) return
  const key = String(m.id)
  if (resultVideoPosters.value[key]) return

  const savePoster = () => {
    if (resultVideoPosters.value[key]) return
    try {
      const w = v.videoWidth
      const h = v.videoHeight
      if (!w || !h) return
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(v, 0, 0, w, h)
      resultVideoPosters.value = {
        ...resultVideoPosters.value,
        [key]: canvas.toDataURL("image/jpeg", 0.82),
      }
    } catch (_) {
      /* 无 CORS 时 canvas 受污染，无法导出；保留无 poster 的可播放 video */
    }
  }

  const onSeeked = () => {
    v.removeEventListener("seeked", onSeeked)
    window.clearTimeout(fallbackTimer)
    savePoster()
  }

  const fallbackTimer = window.setTimeout(() => {
    v.removeEventListener("seeked", onSeeked)
    savePoster()
  }, 1200)

  v.addEventListener("seeked", onSeeked, { once: true })
  try {
    const dur = v.duration
    const t =
      Number.isFinite(dur) && dur > 0
        ? Math.min(0.35, Math.max(0.05, dur * 0.02))
        : 0.1
    v.currentTime = t
  } catch (_) {
    v.removeEventListener("seeked", onSeeked)
    window.clearTimeout(fallbackTimer)
    savePoster()
  }
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

/** 助手成片可下载：成功且 URL 可用、当前未标记为解码失败 */
function assistantCanDownloadResult(m) {
  if (m.role !== "assistant") return false
  if (!assistantIsSuccess(m)) return false
  const u = String(m.resultUrl || "").trim()
  if (!u || !u.startsWith("http")) return false
  if (failedVideoUrls.value.has(u)) return false
  return true
}

/** 助手消息下载中（防重复点击） */
const assistantDownloadBusy = ref(/** @type {Record<string, boolean>} */ ({}))

function resultVideoFilename(url, messageId) {
  try {
    const u = new URL(url)
    const seg = decodeURIComponent(u.pathname.split("/").pop() || "")
    const base = seg.split("?")[0]
    if (base && /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(base)) return base
  } catch (_) {
    /* ignore */
  }
  return `wan-ai-video-${messageId}.mp4`
}

/**
 * 下载成片：优先 fetch+CORS 拿 Blob 触发本地下载（可走磁盘直写、HTTP 缓存复用）；
 * 跨域无 CORS 时回退新标签打开，由用户另存为。
 */
async function downloadAssistantResult(m) {
  if (m.role !== "assistant") return
  const url = String(m.resultUrl || "").trim()
  if (!url || !url.startsWith("http")) {
    ElMessage.warning("无可下载链接")
    return
  }
  const key = String(m.id)
  if (assistantDownloadBusy.value[key]) return
  assistantDownloadBusy.value = { ...assistantDownloadBusy.value, [key]: true }
  const filename = resultVideoFilename(url, m.id)
  try {
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 180000)
    const res = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      signal: ac.signal,
      cache: "default",
    })
    window.clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    try {
      const a = document.createElement("a")
      a.href = objUrl
      a.download = filename
      a.rel = "noopener"
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      URL.revokeObjectURL(objUrl)
    }
    ElMessage.success("下载已开始")
  } catch (e) {
    console.warn("[video-chat] download fallback", e)
    try {
      const a = document.createElement("a")
      a.href = url
      a.target = "_blank"
      a.rel = "noopener noreferrer"
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (_) {
      window.open(url, "_blank", "noopener,noreferrer")
    }
    ElMessage.info("若未自动保存，请在新标签的视频上右键「另存为」")
  } finally {
    const next = { ...assistantDownloadBusy.value }
    delete next[key]
    assistantDownloadBusy.value = next
  }
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

function scrollToTop() {
  const scrollWrap = msgScrollRef.value?.wrapRef
  if (scrollWrap) {
    scrollWrap.scrollTo({ top: 0, behavior: "smooth" })
  }
}

function scrollToEnd() {
  scrollBottom()
}

// 当前可见轮次（仅用于显示，不触发任何其他更新）
const currentVisibleRound = ref(1)
let scrollRafId = null

function onMsgScroll() {
  if (scrollRafId) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null
    const scrollWrap = msgScrollRef.value?.wrapRef
    if (!scrollWrap) return
    const rounds = messageRounds.value
    if (!rounds.length) return
    const roundEls = scrollWrap.querySelectorAll(".msg-round")
    if (!roundEls.length) return
    const wrapRect = scrollWrap.getBoundingClientRect()
    const threshold = wrapRect.top + wrapRect.height * 0.3
    let foundIndex = 0
    for (let i = 0; i < roundEls.length; i++) {
      const rect = roundEls[i].getBoundingClientRect()
      if (rect.top <= threshold) {
        foundIndex = i
      } else {
        break
      }
    }
    const newVal = foundIndex + 1
    if (currentVisibleRound.value !== newVal) {
      currentVisibleRound.value = newVal
    }
  })
}

onUnmounted(() => {
  if (scrollRafId) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
})

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

/** 与角色名同一行：「创作指令 · 今天 12:00」（不写「发送/生成」前缀） */
function messageFeedTimePart(m) {
  if (!m) return ""
  if (m.role === "user") {
    if (!m.createTime) return ""
    return formatSessionTime(m.createTime)
  }
  if (m.role === "assistant") {
    if (assistantIsRunning(m)) return "生成中…"
    const doneRaw = m.completedTime != null && String(m.completedTime).trim() ? String(m.completedTime).trim() : ""
    if (assistantIsSuccess(m)) {
      const show = doneRaw || (m.createTime ? String(m.createTime).trim() : "")
      return show ? formatSessionTime(show) : ""
    }
    if (assistantIsFailed(m)) {
      const show = doneRaw || (m.createTime ? String(m.createTime).trim() : "")
      return show ? formatSessionTime(show) : ""
    }
    if (m.createTime) return formatSessionTime(m.createTime)
  }
  return ""
}

const uploadBusy = computed(() => uploadCount.value > 0)

const selectedModel = computed(() => models.value.find((x) => x.id === selectedModelId.value) || null)

const referenceVideoAllowed = computed(() => modelAllowsReferenceVideo(selectedModel.value))

const dragDropHint = computed(() =>
  referenceVideoAllowed.value ? "松开以上传图片或参考视频" : "松开以上传图片（当前模型未开启参考视频）",
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
  pendingVideosMeta.value = pendingVideos.value.map(() => null)
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
      aspectRatio: videoAspectRatio.value,
      duration: videoDurationSec.value,
      resolution: videoResolution.value,
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
  if (imageUrls.length + videoUrls.length > REF_ATTACHMENT_MAX_TOTAL) {
    ElMessage.warning(`参考文件（图+视+音）最多 ${REF_ATTACHMENT_MAX_TOTAL} 个`)
    return
  }
  if (videoUrls.length > REF_VIDEO_MAX_COUNT) {
    ElMessage.warning(`参考视频最多 ${REF_VIDEO_MAX_COUNT} 个`)
    return
  }
  if (videoUrls.length) {
    const vOk = await resolveAndValidateVideoUrlsForSend(videoUrls, videoUrls.map(() => null))
    if (!vOk) return
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

function openProductLibraryPicker() {
  productLibraryDialogVisible.value = true
}

/**
 * 将产品库图片并入待发参考图；总数受 REF_ATTACHMENT_MAX_TOTAL 与当前视频条数约束，超出则从队列头部剔除较早图片。
 */
function mergeProductLibraryImages(urls) {
  const cap = REF_ATTACHMENT_MAX_TOTAL - pendingVideos.value.length
  if (cap <= 0) {
    ElMessage.warning(
      `参考文件（图+视+音）最多 ${REF_ATTACHMENT_MAX_TOTAL} 个，请先移除部分参考视频或图片`,
    )
    return
  }
  const raw = (urls || [])
    .filter((u) => u && String(u).trim().startsWith("http"))
    .map((u) => String(u).trim())
  const pendingSet = new Set(pendingImages.value)
  const toAdd = []
  const seenNew = new Set()
  for (const u of raw) {
    if (pendingSet.has(u) || seenNew.has(u)) continue
    seenNew.add(u)
    pendingSet.add(u)
    toAdd.push(u)
  }
  if (!toAdd.length) {
    ElMessage.info("所选产品的图片已全部在待发列表中")
    return
  }
  let merged = [...pendingImages.value]
  let evicted = 0
  for (const url of toAdd) {
    if (merged.includes(url)) continue
    merged.push(url)
    while (merged.length > cap) {
      merged.shift()
      evicted++
    }
  }
  pendingImages.value = merged
  if (evicted > 0) {
    ElMessage.info(
      `参考图已达上限（当前最多 ${cap} 张图片，与视频合计不超过 ${REF_ATTACHMENT_MAX_TOTAL} 个），已自动移除较早的图片`,
    )
  } else {
    ElMessage.success("已从产品库添加参考图")
  }
}

const canSend = computed(() => {
  if (!selectedModelId.value) return false
  if (uploadBusy.value) return false
  const t = inputText.value.trim()
  return !!(t || pendingImages.value.length || pendingVideos.value.length)
})

function rawUploadFile(file) {
  if (file?.raw instanceof File) return file.raw
  if (file instanceof File) return file
  return file
}

function isAllowedReferenceVideoFile(file) {
  if (!(file instanceof File)) return false
  const ext = getFileExt(file)
  if (REFERENCE_VIDEO_EXTS.has(ext)) return true
  const t = String(file.type || "").toLowerCase()
  return t === "video/mp4" || t === "video/quicktime"
}

function refAttachmentTotalCount() {
  return pendingImages.value.length + pendingVideos.value.length
}

/**
 * 本地文件：读取时长与分辨率
 * @returns {Promise<{ duration: number, width: number, height: number }>}
 */
function probeLocalVideoFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement("video")
    v.preload = "metadata"
    v.muted = true
    const done = (fn) => {
      try {
        URL.revokeObjectURL(url)
      } catch (_) {
        /* ignore */
      }
      try {
        v.removeAttribute("src")
        v.load()
      } catch (_) {
        /* ignore */
      }
      v.remove()
      fn()
    }
    v.onerror = () => done(() => reject(new Error("无法读取视频信息")))
    v.onloadedmetadata = () => {
      const duration = v.duration
      const width = v.videoWidth
      const height = v.videoHeight
      done(() => {
        if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
          reject(new Error("无法读取视频时长或分辨率"))
          return
        }
        resolve({ duration, width, height })
      })
    }
    v.src = url
  })
}

/**
 * 已上传 URL：尽力读取元数据（依赖 CDN CORS）
 * @returns {Promise<{ duration: number, width: number, height: number }>}
 */
function probeRemoteVideoUrl(url) {
  const u = String(url || "").trim()
  return new Promise((resolve, reject) => {
    if (!u) {
      reject(new Error("视频地址无效"))
      return
    }
    const v = document.createElement("video")
    v.preload = "metadata"
    const timer = window.setTimeout(() => {
      try {
        v.removeAttribute("src")
        v.load()
      } catch (_) {
        /* ignore */
      }
      v.remove()
      reject(new Error("读取视频信息超时"))
    }, 20_000)
    const finish = (fn) => {
      window.clearTimeout(timer)
      try {
        v.removeAttribute("src")
        v.load()
      } catch (_) {
        /* ignore */
      }
      v.remove()
      fn()
    }
    v.onerror = () => finish(() => reject(new Error("无法读取视频信息")))
    v.onloadedmetadata = () => {
      const duration = v.duration
      const width = v.videoWidth
      const height = v.videoHeight
      finish(() => {
        if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
          reject(new Error("无法读取视频时长或分辨率"))
          return
        }
        resolve({ duration, width, height })
      })
    }
    v.src = u
  })
}

/** @returns {Promise<number | null>} Content-Length 字节数，失败为 null */
async function fetchUrlContentLength(url) {
  const u = String(url || "").trim()
  if (!u || !u.startsWith("http")) return null
  // 跨域对象存储对浏览器 HEAD 多无 CORS，会报错且拿不到 Content-Length；直接跳过，避免控制台噪音与无效请求
  try {
    if (typeof window !== "undefined") {
      const o = new URL(u)
      if (o.origin !== window.location.origin) return null
    }
  } catch (_) {
    return null
  }
  try {
    const res = await fetch(u, { method: "HEAD" })
    const cl = res.headers.get("content-length")
    if (cl == null || cl === "") return null
    const n = parseInt(String(cl), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch (_) {
    return null
  }
}

/**
 * @param {Array<{ size: number, duration: number, width: number, height: number }>} items
 */
function validateReferenceVideoRules(items, { prefixError }) {
  const pre = prefixError ? `${prefixError}` : ""
  if (items.length > REF_VIDEO_MAX_COUNT) {
    ElMessage.warning(`${pre}参考视频最多 ${REF_VIDEO_MAX_COUNT} 个`)
    return false
  }
  let sumDur = 0
  let sumSize = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const pixels = it.width * it.height
    if (pixels < REF_VIDEO_PIXELS_MIN || pixels > REF_VIDEO_PIXELS_MAX) {
      ElMessage.warning(
        `${pre}第 ${i + 1} 个参考视频分辨率不合要求：总像素须在 ${REF_VIDEO_PIXELS_MIN.toLocaleString()}～${REF_VIDEO_PIXELS_MAX.toLocaleString()} 之间（约 480p～1080p）`,
      )
      return false
    }
    if (it.size >= REF_VIDEO_MAX_BYTES) {
      ElMessage.warning(`${pre}第 ${i + 1} 个参考视频须小于 50 MB`)
      return false
    }
    sumDur += it.duration
    sumSize += it.size
  }
  if (sumDur < REF_VIDEO_DURATION_SUM_MIN - 1e-3 || sumDur > REF_VIDEO_DURATION_SUM_MAX + 1e-3) {
    ElMessage.warning(
      `${pre}参考视频总时长须在 ${REF_VIDEO_DURATION_SUM_MIN}～${REF_VIDEO_DURATION_SUM_MAX} 秒之间（当前合计 ${sumDur.toFixed(1)} 秒）`,
    )
    return false
  }
  if (sumSize >= REF_VIDEO_MAX_BYTES) {
    ElMessage.warning(`${pre}参考视频总大小须小于 50 MB`)
    return false
  }
  return true
}

/**
 * 发送前：将 videoUrls 与 meta 列表（与之一一对应，可为 null）补全并校验
 * @param {string[]} videoUrls
 * @param {Array<{ size: number, duration: number, width: number, height: number } | null | undefined>} metaList
 */
async function resolveAndValidateVideoUrlsForSend(videoUrls, metaList) {
  const urls = Array.isArray(videoUrls) ? videoUrls.map((u) => String(u || "").trim()).filter(Boolean) : []
  if (urls.length === 0) return true
  if (urls.length > REF_VIDEO_MAX_COUNT) {
    ElMessage.warning(`参考视频最多 ${REF_VIDEO_MAX_COUNT} 个`)
    return false
  }
  const meta = Array.isArray(metaList) ? [...metaList] : []
  while (meta.length < urls.length) meta.push(null)
  const resolved = /** @type {Array<{ size: number, duration: number, width: number, height: number }>} */ ([])
  for (let i = 0; i < urls.length; i++) {
    let m = meta[i] || null
    if (!m || m.size == null || !Number.isFinite(m.duration)) {
      const dim = await probeRemoteVideoUrl(urls[i])
      let size = m && Number.isFinite(m.size) ? m.size : 0
      if (!size) {
        const cl = await fetchUrlContentLength(urls[i])
        size = cl != null ? cl : 0
      }
      // 已能读到时长/分辨率说明链接可用；多数对象存储对浏览器 HEAD 不返回 Content-Length，
      // 无法在此校验体积。复用历史消息里的已上传地址时不应拦截（本地上传仍在上传流程里校验大小）。
      if (!size) size = 0
      m = { size, duration: dim.duration, width: dim.width, height: dim.height }
    }
    resolved.push(m)
  }
  return validateReferenceVideoRules(resolved, { prefixError: "" })
}

async function validateComposerAttachmentsForSend() {
  const ni = pendingImages.value.length
  const nv = pendingVideos.value.length
  if (ni + nv > REF_ATTACHMENT_MAX_TOTAL) {
    ElMessage.warning(`参考文件（图+视+音）最多 ${REF_ATTACHMENT_MAX_TOTAL} 个`)
    return false
  }
  if (nv > REF_VIDEO_MAX_COUNT) {
    ElMessage.warning(`参考视频最多 ${REF_VIDEO_MAX_COUNT} 个`)
    return false
  }
  if (nv === 0) return true
  return resolveAndValidateVideoUrlsForSend([...pendingVideos.value], [...pendingVideosMeta.value])
}

function classifyDroppedFile(file) {
  if (!(file instanceof File)) return null
  const t = file.type || ""
  if (t.startsWith("image/")) return "image"
  if (t.startsWith("video/")) {
    return isAllowedReferenceVideoFile(file) ? "video" : "bad_video"
  }
  const ext = getFileExt(file)
  if (IMAGE_EXTS.has(ext)) return "image"
  if (REFERENCE_VIDEO_EXTS.has(ext)) return "video"
  return null
}

async function addUploadedImageFile(file) {
  if (refAttachmentTotalCount() >= REF_ATTACHMENT_MAX_TOTAL) {
    ElMessage.warning(`参考文件（图+视+音）最多 ${REF_ATTACHMENT_MAX_TOTAL} 个`)
    return
  }
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
    ElMessage.warning("当前模型未开启参考视频，请在「模型管理」中打开该能力或切换模型")
    return
  }
  const raw = rawUploadFile(file)
  if (!(raw instanceof File)) return
  if (!isAllowedReferenceVideoFile(raw)) {
    ElMessage.warning("参考视频仅支持 MP4、MOV 格式")
    return
  }
  if (pendingVideos.value.length >= REF_VIDEO_MAX_COUNT) {
    ElMessage.warning(`参考视频最多 ${REF_VIDEO_MAX_COUNT} 个`)
    return
  }
  if (refAttachmentTotalCount() >= REF_ATTACHMENT_MAX_TOTAL) {
    ElMessage.warning(`参考文件（图+视+音）最多 ${REF_ATTACHMENT_MAX_TOTAL} 个`)
    return
  }
  if (raw.size >= REF_VIDEO_MAX_BYTES) {
    ElMessage.warning("单个参考视频须小于 50 MB")
    return
  }
  const sumSizeKnown =
    pendingVideosMeta.value.reduce((acc, x) => acc + (x && Number.isFinite(x.size) ? x.size : 0), 0) + raw.size
  if (sumSizeKnown >= REF_VIDEO_MAX_BYTES) {
    ElMessage.warning("参考视频总大小须小于 50 MB")
    return
  }

  let dim
  try {
    dim = await probeLocalVideoFile(raw)
  } catch (e) {
    ElMessage.warning(e?.message || "无法读取视频信息")
    return
  }

  const pixels = dim.width * dim.height
  if (pixels < REF_VIDEO_PIXELS_MIN || pixels > REF_VIDEO_PIXELS_MAX) {
    ElMessage.warning(
      `参考视频分辨率不合要求：总像素须在 ${REF_VIDEO_PIXELS_MIN.toLocaleString()}～${REF_VIDEO_PIXELS_MAX.toLocaleString()} 之间（约 480p～1080p）`,
    )
    return
  }

  const sumDur =
    pendingVideosMeta.value.reduce((acc, x) => acc + (x && Number.isFinite(x.duration) ? x.duration : 0), 0) +
    dim.duration
  if (
    sumDur < REF_VIDEO_DURATION_SUM_MIN - 1e-3 ||
    sumDur > REF_VIDEO_DURATION_SUM_MAX + 1e-3
  ) {
    ElMessage.warning(
      `参考视频总时长须在 ${REF_VIDEO_DURATION_SUM_MIN}～${REF_VIDEO_DURATION_SUM_MAX} 秒之间（当前合计 ${sumDur.toFixed(1)} 秒）`,
    )
    return
  }

  uploadCount.value++
  try {
    const { url } = await uploadVideo(raw)
    pendingVideos.value.push(url)
    pendingVideosMeta.value.push({
      size: raw.size,
      duration: dim.duration,
      width: dim.width,
      height: dim.height,
    })
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
    } else if (kind === "bad_video") {
      if (!warned) {
        warned = true
        ElMessage.warning("参考视频仅支持 MP4、MOV")
      }
    } else if (!warned) {
      warned = true
      ElMessage.warning("只支持图片或 MP4 / MOV 视频")
    }
  }
}

function removePendingImage(i) {
  pendingImages.value.splice(i, 1)
}

function removePendingVideo(i) {
  pendingVideos.value.splice(i, 1)
  pendingVideosMeta.value.splice(i, 1)
}

// 视频拖拽排序后，同步 meta 数组
let videoOrderBeforeDrag = []
watch(pendingVideos, (newVal, oldVal) => {
  // 记录拖拽前的顺序，用于后续同步 meta
  if (oldVal && oldVal.length === newVal.length) {
    videoOrderBeforeDrag = [...oldVal]
  }
}, { flush: 'pre' })

function onVideosDragEnd() {
  if (!videoOrderBeforeDrag.length) return
  const oldMeta = [...pendingVideosMeta.value]
  const newMeta = pendingVideos.value.map((url) => {
    const oldIdx = videoOrderBeforeDrag.indexOf(url)
    return oldIdx >= 0 ? oldMeta[oldIdx] : null
  })
  pendingVideosMeta.value = newMeta
  videoOrderBeforeDrag = []
}

const mentionDropdownVisible = ref(false)
const mentionActiveIndex = ref(0)
const mentionTriggerPos = ref(0)
const mentionDropdownStyle = ref({})

const mentionPlaceholder = computed(() => {
  if (pendingImages.value.length || pendingVideos.value.length) {
    return "描述要生成的视频，输入 @ 可引用上传的素材…"
  }
  return "描述要生成的视频…"
})

/**
 * 将消息文本中的 @图片N / @视频N 高亮显示
 */
function highlightMediaRefs(text) {
  if (!text) return ""
  // 先转义 HTML 特殊字符，防止 XSS
  let safe = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
  // 高亮 @图片N（蓝色）
  safe = safe.replace(/@图片(\d+)/g, '<span class="media-ref media-ref--image">@图片$1</span>')
  // 高亮 @视频N（橙色）
  safe = safe.replace(/@视频(\d+)/g, '<span class="media-ref media-ref--video">@视频$1</span>')
  // 换行符转为 <br>
  safe = safe.replace(/\n/g, "<br>")
  return safe
}

const mentionOptions = computed(() => {
  const opts = []
  for (let i = 0; i < pendingImages.value.length; i++) {
    opts.push({
      type: "image",
      index: i + 1,
      label: `图片${i + 1}`,
      value: `@图片${i + 1}`,
      thumb: pendingImages.value[i],
    })
  }
  for (let i = 0; i < pendingVideos.value.length; i++) {
    opts.push({
      type: "video",
      index: i + 1,
      label: `视频${i + 1}`,
      value: `@视频${i + 1}`,
      videoUrl: pendingVideos.value[i],
    })
  }
  return opts
})

function getTextareaEl() {
  return composerInputRef.value?.$el?.querySelector("textarea")
}

function onInputChange() {
  const textarea = getTextareaEl()
  if (!textarea) return
  const text = inputText.value
  const cursorPos = textarea.selectionStart
  const textBeforeCursor = text.slice(0, cursorPos)
  const atMatch = textBeforeCursor.match(/@[^@\s]*$/)
  if (atMatch && (pendingImages.value.length || pendingVideos.value.length)) {
    mentionTriggerPos.value = cursorPos - atMatch[0].length
    mentionActiveIndex.value = 0
    mentionDropdownVisible.value = true
    updateMentionDropdownPosition(textarea)
  } else {
    mentionDropdownVisible.value = false
  }
}

function updateMentionDropdownPosition(textarea) {
  if (!textarea) return
  const rect = textarea.getBoundingClientRect()
  mentionDropdownStyle.value = {
    position: "absolute",
    left: "10px",
    bottom: "100%",
    marginBottom: "4px",
  }
}

function onInputKeydown(e) {
  if (!mentionDropdownVisible.value || !mentionOptions.value.length) return
  if (e.key === "ArrowDown") {
    e.preventDefault()
    mentionActiveIndex.value = (mentionActiveIndex.value + 1) % mentionOptions.value.length
  } else if (e.key === "ArrowUp") {
    e.preventDefault()
    mentionActiveIndex.value =
      (mentionActiveIndex.value - 1 + mentionOptions.value.length) % mentionOptions.value.length
  } else if (e.key === "Enter" && !e.ctrlKey) {
    e.preventDefault()
    const opt = mentionOptions.value[mentionActiveIndex.value]
    if (opt) selectMentionOption(opt)
  } else if (e.key === "Escape") {
    e.preventDefault()
    mentionDropdownVisible.value = false
  }
}

function onInputBlur() {
  setTimeout(() => {
    mentionDropdownVisible.value = false
  }, 150)
}

function selectMentionOption(opt) {
  const textarea = getTextareaEl()
  if (!textarea) return
  const text = inputText.value
  const cursorPos = textarea.selectionStart
  const before = text.slice(0, mentionTriggerPos.value)
  const after = text.slice(cursorPos)
  const insert = opt.value + " "
  inputText.value = before + insert + after
  mentionDropdownVisible.value = false
  nextTick(() => {
    const newPos = mentionTriggerPos.value + insert.length
    textarea.focus()
    textarea.setSelectionRange(newPos, newPos)
  })
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

/** 创建并切换到新会话（无会话时首次发送也会走此逻辑） */
async function activateNewChatSession() {
  const res = await request({
    url: "/admin-api/video/chat/sessions",
    method: "POST",
    data: { title: "新对话" },
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "创建失败")
    return false
  }
  sessions.value.unshift(res.data)
  activeSessionId.value = res.data.id
  messages.value = []
  stopPoll()
  return true
}

async function createSession() {
  const ok = await activateNewChatSession()
  if (ok) sessionsDrawer.value = false
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
  const sessionSnap = activeSessionId.value
  if (!sessionSnap) return
  const seq = ++loadMessagesSeq
  const res = await request({
    url: "/admin-api/video/chat/messages/page",
    method: "GET",
    params: { sessionId: sessionSnap, pageNo: 1, pageSize: 200 },
  })
  if (seq !== loadMessagesSeq) return
  if (activeSessionId.value !== sessionSnap) return
  if (res.code !== 0) return
  // 发送请求进行中时，轮询仍可能先于 /send 返回；服务端列表尚无本轮「生成中」行，整表替换会抹掉乐观更新
  if (!scrollToBottom && sending.value) {
    const keepOptimistic = messages.value.some(
      (m) => m.id < 0 && m.role === "assistant" && assistantStillRunning(m),
    )
    if (keepOptimistic) return
  }
  messages.value = res.data?.list || []
  if (scrollToBottom) nextTick(() => scrollBottom())
  setupPoll()
}

function scrollBottom() {
  nextTick(() => {
    const el = msgScrollRef.value?.wrapRef
    if (el) el.scrollTop = el.scrollHeight
  })
}

function onPickImages({ file }) {
  return addUploadedImageFile(file)
}

function onPickVideo({ file }) {
  return addUploadedVideoFile(file)
}

function rollbackOptimisticSend(
  optimisticUserId,
  optimisticAssistId,
  capturedText,
  capturedImages,
  capturedVideos,
  capturedVideosMeta,
) {
  messages.value = messages.value.filter((m) => m.id !== optimisticUserId && m.id !== optimisticAssistId)
  inputText.value = capturedText
  pendingImages.value = capturedImages
  pendingVideos.value = capturedVideos
  pendingVideosMeta.value = Array.isArray(capturedVideosMeta)
    ? [...capturedVideosMeta]
    : capturedVideos.map(() => null)
}

function pushOptimisticSendRound(capturedText, capturedImages, capturedVideos) {
  const modelName = String(selectedModel.value?.name || "").trim()
  const optimisticUserId = -Date.now()
  const optimisticAssistId = optimisticUserId - 1
  const sessionId = activeSessionId.value
  const nowStr = new Date().toISOString()
  messages.value = [
    ...messages.value,
    {
      id: optimisticUserId,
      sessionId,
      role: "user",
      text: capturedText,
      attachments: { images: [...capturedImages], videos: [...capturedVideos] },
      createTime: nowStr,
      completedTime: "",
    },
    {
      id: optimisticAssistId,
      sessionId,
      role: "assistant",
      text: "",
      attachments: { images: [], videos: [] },
      videoJobId: null,
      status: "processing",
      resultUrl: "",
      errorMessage: "",
      videoModelName: modelName,
      createTime: "",
      completedTime: "",
    },
  ]
  return { optimisticUserId, optimisticAssistId }
}

async function send() {
  if (!canSend.value || sending.value) return
  if (!activeSessionId.value) {
    const ok = await activateNewChatSession()
    if (!ok) return
  }

  const rulesOk = await validateComposerAttachmentsForSend()
  if (!rulesOk) return

  const capturedText = inputText.value.trim()
  const capturedImages = [...pendingImages.value]
  const capturedVideos = [...pendingVideos.value]
  const capturedVideosMeta = [...pendingVideosMeta.value]

  inputText.value = ""
  pendingImages.value = []
  pendingVideos.value = []
  pendingVideosMeta.value = []

  const { optimisticUserId, optimisticAssistId } = pushOptimisticSendRound(
    capturedText,
    capturedImages,
    capturedVideos,
  )
  nextTick(() => {
    scrollBottom()
    setupPoll()
  })

  sending.value = true
  try {
    const res = await postChatSendPayload({
      text: capturedText,
      imageUrls: capturedImages,
      videoUrls: capturedVideos,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "发送失败")
      rollbackOptimisticSend(
        optimisticUserId,
        optimisticAssistId,
        capturedText,
        capturedImages,
        capturedVideos,
        capturedVideosMeta,
      )
      return
    }
    await loadMessages({ scrollToBottom: true })
    await loadSessions()
  } catch (e) {
    console.error(e)
    ElMessage.error("发送失败")
    rollbackOptimisticSend(
      optimisticUserId,
      optimisticAssistId,
      capturedText,
      capturedImages,
      capturedVideos,
      capturedVideosMeta,
    )
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
  }, VIDEO_CHAT_POLL_INTERVAL_MS)
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
    pendingVideosMeta.value = []
    ElMessage.info("已切换到不支持参考视频的模型，待发送视频已清除")
  }
})

/** 全屏结束时需清掉的内联样式（覆盖内联预览的 min/max + cover，否则全屏仍会被裁切） */
const VC_FS_STYLE_PROPS = [
  "object-fit",
  "object-position",
  "width",
  "height",
  "max-width",
  "max-height",
  "min-width",
  "min-height",
  "flex",
  "display",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "margin",
  "transform",
  "box-sizing",
  "border-radius",
  "background",
]

/** @type {HTMLVideoElement | null} */
let vcFullscreenStyledVideo = null

function resolveChatVideoInFullscreenRoot(fs) {
  if (!fs) return null
  if (fs instanceof HTMLVideoElement) {
    if (fs.classList.contains("msg-vid-el") || fs.classList.contains("vc-pending-vid-dialog__video")) return fs
    return null
  }
  if (typeof fs.querySelector === "function") {
    const v = fs.querySelector("video.msg-vid-el, video.vc-pending-vid-dialog__video")
    return v instanceof HTMLVideoElement ? v : null
  }
  return null
}

function clearChatVideoFullscreenOverrides() {
  const v = vcFullscreenStyledVideo
  vcFullscreenStyledVideo = null
  if (!v) return
  for (const k of VC_FS_STYLE_PROPS) {
    try {
      v.style.removeProperty(k)
    } catch (_) {
      /* ignore */
    }
  }
}

function syncChatVideoFullscreenLayout() {
  const fs = document.fullscreenElement || /** @type {Document & { webkitFullscreenElement?: Element }} */ (document).webkitFullscreenElement
  if (!fs) {
    clearChatVideoFullscreenOverrides()
    return
  }
  const vid = resolveChatVideoInFullscreenRoot(fs)
  if (!vid) {
    clearChatVideoFullscreenOverrides()
    return
  }
  if (vcFullscreenStyledVideo && vcFullscreenStyledVideo !== vid) clearChatVideoFullscreenOverrides()
  vcFullscreenStyledVideo = vid
  /*
   * 勿用 100vw×100vh 把 video 先拉成整屏再 contain：竖屏素材在部分 Chromium 上会仍像被裁切。
   * 用 auto + max + 居中，让画布按视频固有比例落在视口内＝完整画面。
   */
  vid.style.setProperty("box-sizing", "border-box", "important")
  vid.style.setProperty("display", "block", "important")
  vid.style.setProperty("flex", "none", "important")
  vid.style.setProperty("min-width", "0", "important")
  vid.style.setProperty("min-height", "0", "important")
  vid.style.setProperty("position", "fixed", "important")
  vid.style.removeProperty("inset")
  vid.style.removeProperty("right")
  vid.style.removeProperty("bottom")
  vid.style.setProperty("left", "50%", "important")
  vid.style.setProperty("top", "50%", "important")
  vid.style.setProperty("transform", "translate(-50%, -50%)", "important")
  vid.style.setProperty("width", "auto", "important")
  vid.style.setProperty("height", "auto", "important")
  vid.style.setProperty("max-width", "100vw", "important")
  vid.style.setProperty("max-height", "100vh", "important")
  vid.style.setProperty("margin", "0", "important")
  vid.style.setProperty("object-fit", "contain", "important")
  vid.style.setProperty("object-position", "center center", "important")
  vid.style.setProperty("background", "#000", "important")
  vid.style.setProperty("border-radius", "0", "important")
}

function onDocumentFullscreenChange() {
  requestAnimationFrame(() => syncChatVideoFullscreenLayout())
}

onMounted(async () => {
  try {
    isWideMode.value = sessionStorage.getItem(VC_WIDE_STORAGE_KEY) === "1"
  } catch (_) {
    /* ignore */
  }
  const ar = readStoredAspectRatio()
  if (ar) videoAspectRatio.value = ar
  const ds = readStoredDurationSec()
  if (ds != null) videoDurationSec.value = ds
  const rs = readStoredResolution()
  if (rs) videoResolution.value = rs
  document.addEventListener("fullscreenchange", onDocumentFullscreenChange)
  document.addEventListener("webkitfullscreenchange", onDocumentFullscreenChange)
  await loadModels()
  await loadSessions()
  await loadManagedPrompts()
  nextTick(() => scrollBottom())
})

onActivated(() => {
  nextTick(() => scrollBottom())
})

onUnmounted(() => {
  document.removeEventListener("fullscreenchange", onDocumentFullscreenChange)
  document.removeEventListener("webkitfullscreenchange", onDocumentFullscreenChange)
  clearChatVideoFullscreenOverrides()
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

.round-nav {
  position: absolute;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 6px;
  border-radius: 24px;
  background: color-mix(in srgb, var(--el-bg-color) 92%, transparent);
  backdrop-filter: blur(12px);
  box-shadow:
    0 4px 20px rgba(15, 23, 42, 0.08),
    0 1px 4px rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.round-nav__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--el-color-primary) 12%, var(--el-fill-color-light));
    color: var(--el-color-primary);
  }

  &:active:not(:disabled) {
    transform: scale(0.92);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}

.round-nav__indicator {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  line-height: 1.2;
  padding: 2px 0;
  user-select: none;
}

@media (max-width: 768px) {
  .round-nav {
    right: 10px;
    padding: 6px 4px;
  }

  .round-nav__btn {
    width: 30px;
    height: 30px;
  }

  .round-nav__indicator {
    font-size: 10px;
  }
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

  /* 创作指令与用户块、其下 AI 回答之间略留空 */
  &:not(:last-child) {
    margin-bottom: 28px;
  }
}

.msg-feed-head {
  margin-bottom: 10px;
}

.msg-feed-head__line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.msg-feed-head__sep {
  color: var(--el-text-color-placeholder);
  opacity: 0.55;
  font-weight: 500;
  user-select: none;
}

.msg-feed-actions {
  flex-shrink: 0;
}

.msg-feed-actions--below {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  width: 100%;
  max-width: 100%;
  margin-top: 6px;
  padding-top: 0;
}

.msg-feed-actions__left {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.msg-feed-actions__tail {
  margin-left: auto;
  flex-shrink: 0;
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

.msg-feed-time {
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--el-text-color-secondary);
  opacity: 0.88;
  text-transform: none;
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
  gap: 6px;
}

.msg-media-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px;
  overflow-x: auto;
  padding: 0 0 4px;
  margin: 0;
  border-radius: 0;
  scrollbar-width: thin;
  background: transparent;
  border: none;
}

.msg-text-stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  width: 100%;
  max-width: 100%;
}

.msg-text {
  width: 100%;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-text :deep(.media-ref) {
  display: inline-block;
  padding: 0 6px;
  margin: 0 2px;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
  border-radius: 4px;
  vertical-align: middle;
}

.msg-text :deep(.media-ref--image) {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.msg-text :deep(.media-ref--video) {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
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

/* 聊天记录内图/视频：统一 9:16 竖槽；cover 铺满避免大字黑边；尺寸略小更整齐 */
.msg-media-slot {
  /* 略小于此前一档，聊天记录里图/视频竖槽仍保持 9:16 */
  --msg-chat-media-w: 132px;

  flex-shrink: 0;
  width: var(--msg-chat-media-w);
  max-width: min(var(--msg-chat-media-w), 34vw);
  aspect-ratio: 9 / 16;
  margin: 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--el-fill-color-darker, #0c0c0d);
  border: none;
  box-shadow: 0 2px 14px rgba(15, 23, 42, 0.06);
  box-sizing: border-box;
  line-height: 0;
}

.msg-media-slot--image {
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: var(--el-fill-color-darker, #0c0c0d);
}

.msg-media-slot--video {
  display: flex;
  align-items: stretch;
  justify-content: center;
}

.msg-media-elimage {
  display: block;
  flex: 1;
  width: 100%;
  min-width: 100%;
  min-height: 100%;
  cursor: zoom-in;

  :deep(.el-image__wrapper) {
    width: 100% !important;
    height: 100% !important;
  }

  :deep(.el-image__inner) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
  }

  :deep(.el-image__placeholder) {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
  }

  :deep(.el-image__error) {
    background: var(--el-fill-color-light);
    font-size: 11px;
  }
}

.msg-media-slot--err {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  font-size: 11px;
  line-height: 1.35;
  text-align: center;
  color: var(--el-color-danger);
  background: var(--el-fill-color-lighter);
  border: 1px dashed var(--el-border-color);
  box-shadow: none;
}

.lazy-image-container,
.lazy-video-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
}

.lazy-image-placeholder,
.lazy-video-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--el-fill-color-darker) 0%, var(--el-fill-color-dark) 100%);
  color: var(--el-text-color-placeholder);
}

.lazy-video-placeholder__icon {
  font-size: 24px;
  opacity: 0.5;
}

.msg-media-fail-banner {
  width: 100%;
  max-width: min(320px, 100%);
  min-height: 88px;
  padding: 14px 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border: 1px dashed var(--el-border-color);
  border-radius: 12px;
  box-sizing: border-box;
}

.msg-vid-el {
  display: block;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 100%;
  min-height: 100%;
  object-fit: cover;
  object-position: center;
}

/* 与同文件全局样式一致：全屏必须用更高优先级压住上面 cover/min 尺寸，否则会继续裁切 */
.msg-vid-el:fullscreen,
.msg-vid-el:-webkit-full-screen,
.msg-vid-el:-moz-full-screen {
  flex: none !important;
  min-width: 0 !important;
  min-height: 0 !important;
  width: auto !important;
  height: auto !important;
  max-width: 100vw !important;
  max-width: min(100vw, 100dvw) !important;
  max-height: 100vh !important;
  max-height: min(100vh, 100dvh) !important;
  margin: 0 !important;
  position: fixed !important;
  left: 50% !important;
  top: 50% !important;
  transform: translate(-50%, -50%) !important;
  box-sizing: border-box !important;
  object-fit: contain !important;
  object-position: center center !important;
  background: #000 !important;
  border-radius: 0 !important;
}

.msg-assist-loading {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-top: 2px;
  padding: 0;
  max-width: min(520px, 100%);
}

.msg-assist-loading__ring {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border: 2px solid color-mix(in srgb, var(--el-text-color-regular) 18%, transparent);
  border-top-color: color-mix(in srgb, var(--el-text-color-primary) 55%, var(--el-text-color-regular));
  border-radius: 50%;
  animation: vc-loading-ring 0.7s linear infinite;
}

@keyframes vc-loading-ring {
  to {
    transform: rotate(360deg);
  }
}

.msg-assist-loading__copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.msg-assist-loading__title {
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--el-text-color-primary);
  line-height: 1.35;
}

.msg-assist-loading__sub {
  font-size: 12px;
  line-height: 1.55;
  color: var(--el-text-color-secondary);
}

.msg-result-vid-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  max-width: 100%;
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

.msg-assist-card__ico {
  flex-shrink: 0;
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
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  margin-bottom: 0;
  gap: 8px 12px;
}

.composer-head__uploads {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* 四个图标统一间距：抵消 el-upload 默认 inline 间隙，每格等宽占位 */
.composer-rail-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  line-height: 0;
}

.composer-rail-item :deep(.el-upload) {
  display: inline-flex;
  margin: 0;
  line-height: 0;
}

.composer-head__gen {
  margin-left: auto;
  flex-shrink: 0;
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
  margin-bottom: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

.pending-drag-group {
  display: contents;
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
  cursor: grab;
}

.pending-tile:active {
  cursor: grabbing;
}

.pending-tile--ghost {
  opacity: 0.4;
}

.pending-tile.pending-tile--vid {
  cursor: pointer;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: left;
}

.pending-tile.pending-tile--vid:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--el-color-primary) 55%, transparent);
  outline-offset: 2px;
}

.pending-tile__badge {
  position: absolute;
  left: 6px;
  top: 6px;
  z-index: 2;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.02em;
  pointer-events: none;
}

.pending-tile__badge--img {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.pending-tile__badge--vid {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.pending-tile__play {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.95);
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  pointer-events: none;
  background: linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.15) 100%);
}

.pending-tile__vid-dec {
  pointer-events: none;
}

.pending-tile-elimg {
  width: 100%;
  height: 100%;
  display: block;
}

.pending-tile-elimg :deep(.el-image__inner) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

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

.pending-tile__x {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 4;
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

.composer-input-wrap {
  position: relative;
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

.mention-dropdown {
  z-index: 100;
  min-width: 140px;
  max-width: 280px;
  max-height: 200px;
  overflow-y: auto;
  padding: 6px 0;
  border-radius: 10px;
  background: var(--el-bg-color);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow:
    0 8px 24px rgba(15, 23, 42, 0.12),
    0 2px 6px rgba(15, 23, 42, 0.06);
}

.mention-dropdown__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.12s ease;

  &:hover,
  &.mention-dropdown__item--active {
    background: var(--el-fill-color-light);
  }
}

.mention-dropdown__thumb-wrap {
  position: relative;
  flex-shrink: 0;
}

.mention-dropdown__thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--el-fill-color-darker);
  display: block;
}

.mention-dropdown__type-badge {
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--el-color-primary);
  color: #fff;
  line-height: 1.2;
  white-space: nowrap;
}

.mention-dropdown__type-badge--video {
  background: var(--el-color-warning);
}

.mention-dropdown__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.toolbar-gen-opts {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

:deep(.toolbar-gen-select.el-select) {
  --el-select-border-color-hover: transparent;
  --el-select-input-focus-border-color: transparent;

  width: auto !important;
  vertical-align: middle;

  .el-select__wrapper {
    min-height: 32px;
    min-width: 4.25rem;
    padding: 4px 8px;
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

:deep(.toolbar-gen-select--dur.el-select .el-select__wrapper) {
  min-width: 4rem;
}

:deep(.toolbar-gen-select--res.el-select .el-select__wrapper) {
  min-width: 5.5rem;
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

.vc-pending-vid-dialog .el-dialog__body {
  padding-top: 8px;
}

.vc-pending-vid-dialog__wrap {
  aspect-ratio: 9 / 16;
  max-height: min(70vh, 560px);
  width: auto;
  margin: 0 auto;
  background: #0f0f10;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vc-pending-vid-dialog__video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 10px;
  background: #0f0f10;
}

/*
 * 全局再声明一遍：避免仅 data-v 选择器在部分环境下挂不上。
 * 不要用 100vw×100vh 先拉满再 contain，竖屏片在 Chromium 全屏里会像被放大裁切。
 * auto + max + 居中 = 整段画面落在视口内（可有黑边）。
 */
video.msg-vid-el:fullscreen,
video.msg-vid-el:-webkit-full-screen,
video.msg-vid-el:-moz-full-screen,
.vc-pending-vid-dialog__video:fullscreen,
.vc-pending-vid-dialog__video:-webkit-full-screen,
.vc-pending-vid-dialog__video:-moz-full-screen {
  max-width: 100vw !important;
  max-width: min(100vw, 100dvw) !important;
  max-height: 100vh !important;
  max-height: min(100vh, 100dvh) !important;
  width: auto !important;
  height: auto !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  flex: none !important;
  box-sizing: border-box !important;
  position: fixed !important;
  left: 50% !important;
  top: 50% !important;
  transform: translate(-50%, -50%) !important;
  object-fit: contain !important;
  object-position: center center !important;
  background: #000 !important;
  border-radius: 0 !important;
}

video.msg-vid-el:fullscreen::backdrop,
.vc-pending-vid-dialog__video:fullscreen::backdrop {
  background: #000;
}

/* 比例/时长下拉挂载到 body */
.vc-toolbar-gen-popper {
  .el-select-dropdown__item.is-selected {
    background: transparent !important;
    color: var(--el-color-primary);
    font-weight: 600;
  }
}
</style>
