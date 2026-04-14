<template>
  <div class="page-container creation-log">
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="搜索提示词"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <el-select
          v-model="tableParams.userId"
          placeholder="选择创建人"
          class="filter-select-user"
          clearable
          clear-icon="Close"
          filterable
          remote
          remote-show-suffix
          reserve-keyword
          :suffix-icon="$icons.ArrowDown"
          :remote-method="remoteUserSearch"
          :loading="userLoading"
        >
          <el-option v-for="u in userOptions" :key="u.id" :label="userLabel(u)" :value="u.id" />
        </el-select>
        <el-select
          v-model="tableParams.status"
          placeholder="任务状态"
          class="filter-select-status"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option label="排队中" value="pending" />
          <el-option label="生成中" value="processing" />
          <el-option label="成功" value="success" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-date-picker
          v-model="tableParams.createTimeRange"
          class="filter-date-range"
          type="daterange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          clearable
          clear-icon="Close"
        />
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>
    </div>

    <div class="page-table-box table-wrap">
      <el-table
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        :header-cell-style="{ 'text-align': 'center' }"
      >
        <el-table-column prop="id" label="任务 ID" width="88" align="center" fixed="left" />
        <el-table-column label="生成结果" width="100" align="center" fixed="left">
          <template #default="{ row }">
            <div v-if="row.resultUrl" class="result-cell">
              <div class="result-wrap ratio-9-16" @click="openResult(row.resultUrl)">
                <LazyVideo :src="row.resultUrl" class="result-mini" />
                <div class="result-play-mask">
                  <el-icon class="result-play-icon" :size="26"><component :is="$icons.VideoPlay" /></el-icon>
                </div>
              </div>
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="提示词" min-width="240" align="left">
          <template #default="{ row }">
            <div class="prompt-cell">
              <div
                class="prompt-text"
                :class="isPromptExpanded(row.id) ? 'prompt-text--expanded' : 'prompt-text--collapsed'"
              >
                {{ String(row.prompt || "").trim() || "（无文本）" }}
              </div>
              <div class="prompt-toggle" @click="togglePromptExpand(row.id)">
                <span>{{ isPromptExpanded(row.id) ? "收起" : "展开" }}</span>
                <el-icon class="prompt-toggle-icon">
                  <component :is="isPromptExpanded(row.id) ? $icons.ArrowUp : $icons.ArrowDown" />
                </el-icon>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="参考图 / 视频" min-width="300" align="center" class-name="col-ref-media">
          <template #default="{ row }">
            <div class="ref-col-inner">
              <div v-if="getRowMedia(row).items.length" class="ref-grid">
                <div
                  v-for="(item, idx) in getRowMedia(row).items"
                  :key="item.type + idx + item.url.slice(-24)"
                  class="ref-tile"
                >
                  <div class="ref-media-box ratio-9-16">
                    <el-tag
                      size="small"
                      :type="item.type === 'image' ? 'success' : 'warning'"
                      effect="dark"
                      class="ref-corner-tag"
                    >
                      {{ item.type === "image" ? "图片" : "视频" }}
                    </el-tag>
                    <template v-if="item.type === 'image'">
                      <el-image
                        :src="item.url"
                        fit="cover"
                        class="ref-thumb-img"
                        lazy
                        preview-teleported
                        :preview-src-list="getRowMedia(row).images"
                        :initial-index="item.imageIndex ?? 0"
                      />
                    </template>
                    <template v-else>
                      <div class="ref-vid-wrap" @click="openRefVideo(item.url)">
                        <LazyVideo :src="item.url" class="ref-vid-mini" />
                        <div class="ref-play-mask">
                          <el-icon class="ref-play-icon" :size="26"><component :is="$icons.VideoPlay" /></el-icon>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
              <span v-else class="muted">—</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="modelName" label="模型" min-width="120" align="center" show-overflow-tooltip />
        <el-table-column label="参数" width="100" align="center">
          <template #default="{ row }">
            <span v-if="row.aspectRatio || row.durationSec != null">
              {{ row.aspectRatio || "—" }}<template v-if="row.durationSec != null"> · {{ row.durationSec }}s</template>
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="statusKind(row.status) === 'run'" type="warning" size="small">{{ statusLabel(row.status) }}</el-tag>
            <el-tag v-else-if="statusKind(row.status) === 'ok'" type="success" size="small">{{ statusLabel(row.status) }}</el-tag>
            <el-tag v-else-if="statusKind(row.status) === 'bad'" type="danger" size="small">{{ statusLabel(row.status) }}</el-tag>
            <el-tag v-else size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="失败原因" min-width="180" align="center" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.errorMessage" class="err-text">{{ row.errorMessage }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="创建人" min-width="100" align="center" show-overflow-tooltip>
          <template #default="{ row }">
            {{ displayNickname(row) }}
          </template>
        </el-table-column>
        <el-table-column label="创建账号" min-width="110" align="center" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.username || "—" }}
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="168" align="center" show-overflow-tooltip />
      </el-table>
    </div>

    <div class="page-pagination-box">
      <CzPagination
        :total="tableTotal"
        v-model:page-no="tableParams.pageNo"
        v-model:page-size="tableParams.pageSize"
        @change="getTableData"
      />
    </div>

    <el-dialog
      v-model="resultDialogVisible"
      :title="resultDialogTitle"
      width="min(560px, 94vw)"
      destroy-on-close
      align-center
      @closed="onResultDialogClose"
    >
      <div class="result-video-wrap">
        <video v-if="resultPlayUrl" :src="resultPlayUrl" controls playsinline class="result-video" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup name="aiVideoManage">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import { debounce } from "@/utils"

/** 懒加载视频组件：进入可视区域后才加载 metadata */
const LazyVideo = defineComponent({
  props: { src: String },
  setup(props) {
    const videoRef = ref(null)
    const shouldLoad = ref(false)
    let observer = null

    onMounted(() => {
      const el = videoRef.value
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
      h("video", {
        ref: videoRef,
        src: shouldLoad.value ? props.src : undefined,
        muted: true,
        preload: "metadata",
        playsinline: true,
      })
  },
})

onMounted(() => {
  getTableData()
  loadUserOptions("")
})

const userOptions = ref([])
const userLoading = ref(false)

function userLabel(u) {
  const nick = String(u.nickname || "").trim()
  const name = String(u.username || "").trim()
  if (nick && name) return `${nick} (${name})`
  return nick || name || `#${u.id}`
}

async function loadUserOptions(kw) {
  userLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/system/user/list-all-simple",
      method: "GET",
      params: { nickname: kw || undefined },
    })
    if (res.code === 0) {
      userOptions.value = Array.isArray(res.data) ? res.data : []
    }
  } finally {
    userLoading.value = false
  }
}

const remoteUserSearch = debounce((q) => loadUserOptions(String(q || "").trim()), 280)

const defaultTableParams = () => ({
  userId: "",
  status: "",
  keyword: "",
  createTimeRange: null,
  pageNo: 1,
  pageSize: 10,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/video/admin/jobs/page",
  defaultTableParams,
  {
    transformParams: (raw) => {
      const p = { ...raw }
      if (Array.isArray(p.createTimeRange) && p.createTimeRange.length === 2) {
        const a = p.createTimeRange[0] ? String(p.createTimeRange[0]).trim() : ""
        const b = p.createTimeRange[1] ? String(p.createTimeRange[1]).trim() : ""
        p.createTimeFrom = a ? `${a} 00:00:00` : ""
        p.createTimeTo = b ? `${b} 23:59:59` : ""
      }
      delete p.createTimeRange
      return p
    },
  },
)

function onReset() {
  resetTable()
  expandedPromptById.value = {}
  loadUserOptions("")
}

/** 缓存每行的媒体数据，避免重复计算 */
const rowMediaCache = new WeakMap()

function getRowMedia(row) {
  if (rowMediaCache.has(row)) return rowMediaCache.get(row)

  const imgArr = Array.isArray(row.sourceImageUrls) ? row.sourceImageUrls : []
  const cleanedImgs = imgArr.filter((u) => u && String(u).trim().startsWith("http")).map((u) => String(u).trim())
  const images = cleanedImgs.length
    ? [...new Set(cleanedImgs)]
    : row.sourceImageUrl && String(row.sourceImageUrl).trim().startsWith("http")
      ? [String(row.sourceImageUrl).trim()]
      : []

  const vidArr = Array.isArray(row.sourceVideoUrls) ? row.sourceVideoUrls : []
  const videos = [...new Set(vidArr.filter((u) => u && String(u).trim().startsWith("http")).map((u) => String(u).trim()))]

  const items = [
    ...images.map((url, idx) => ({ type: "image", url, imageIndex: idx })),
    ...videos.map((url) => ({ type: "video", url })),
  ]

  const result = { images, videos, items }
  rowMediaCache.set(row, result)
  return result
}

const expandedPromptById = ref(/** @type {Record<number, boolean>} */ ({}))

function isPromptExpanded(id) {
  return !!expandedPromptById.value[Number(id)]
}

function togglePromptExpand(id) {
  const n = Number(id)
  const next = { ...expandedPromptById.value, [n]: !expandedPromptById.value[n] }
  expandedPromptById.value = next
}

/** 创建人列：优先展示昵称，无则退化为账号 */
function displayNickname(row) {
  const nick = String(row.nickname || "").trim()
  if (nick) return nick
  const u = String(row.username || "").trim()
  return u || "—"
}

const resultDialogVisible = ref(false)
const resultPlayUrl = ref("")
const resultDialogTitle = ref("成片预览")

function openResult(url) {
  resultDialogTitle.value = "成片预览"
  resultPlayUrl.value = String(url || "").trim()
  if (resultPlayUrl.value) resultDialogVisible.value = true
}

function openRefVideo(url) {
  resultDialogTitle.value = "参考视频预览"
  resultPlayUrl.value = String(url || "").trim()
  if (resultPlayUrl.value) resultDialogVisible.value = true
}

function onResultDialogClose() {
  resultPlayUrl.value = ""
}

/** @returns {'run'|'ok'|'bad'|'other'} */
function statusKind(raw) {
  const x = String(raw || "").toLowerCase().trim()
  if (["pending", "processing", "queued", "running"].includes(x)) return "run"
  if (["succeeded", "success", "completed", "complete", "done"].includes(x)) return "ok"
  if (["failed", "error", "cancelled", "canceled"].includes(x)) return "bad"
  return "other"
}

function statusLabel(raw) {
  const x = String(raw || "").toLowerCase().trim()
  const map = {
    pending: "排队中",
    queued: "排队中",
    processing: "生成中",
    running: "生成中",
    succeeded: "成功",
    success: "成功",
    completed: "成功",
    complete: "成功",
    done: "成功",
    failed: "失败",
    error: "失败",
    cancelled: "已取消",
    canceled: "已取消",
  }
  if (map[x]) return map[x]
  const s = String(raw || "").trim()
  return s || "—"
}
</script>

<style lang="scss" scoped>
.page-container {
  .page-filter-box {
    margin-bottom: 16px;
  }
  .page-pagination-box {
    margin-top: 15px;
  }
}
.creation-log .table-wrap {
  margin-top: 0;
}
.creation-log .filters-wrap {
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.creation-log .page-filter-left .filter-input-keyword.el-input {
  width: 220px;
}
.creation-log .page-filter-left .filter-select-user.el-select {
  width: 220px;
}
/* 任务状态：与模型商店「状态」列宽接近，不必与创建人同宽 */
.creation-log .page-filter-left .filter-select-status.el-select {
  width: 130px;
}
.creation-log .page-filter-left .filter-date-range.el-date-editor {
  width: 280px;
  flex: 0 0 280px;
}
/* 参考图/视频列：单元格内容水平居中（与表头 align 一致） */
.creation-log :deep(.el-table .col-ref-media .cell) {
  display: flex;
  justify-content: center;
  align-items: center;
}
.prompt-cell {
  position: relative;
  padding: 4px 0;
}
.prompt-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-word;
}
.prompt-text--collapsed {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.prompt-text--expanded {
  max-height: none;
}
.prompt-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  float: right;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-color-primary);
  cursor: pointer;
  user-select: none;
}
.prompt-toggle:hover {
  opacity: 0.85;
}
.prompt-toggle-icon {
  vertical-align: middle;
}
.result-cell {
  display: flex;
  justify-content: center;
  align-items: center;
}
.ratio-9-16 {
  width: var(--ref-media-w);
  aspect-ratio: 9 / 16;
  height: auto;
}
.result-wrap {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  background: var(--el-fill-color-dark);
}
.result-mini {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.result-play-mask {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.result-play-icon {
  color: #fff;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
}
.ref-col-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  text-align: center;
}
.creation-log {
  --ref-media-w: 72px;
}
.ref-grid {
  display: grid;
  grid-template-columns: repeat(3, var(--ref-media-w));
  gap: 10px 12px;
  width: fit-content;
  max-width: 100%;
  margin-left: auto;
  margin-right: auto;
  justify-content: center;
}
.ref-tile {
  width: var(--ref-media-w);
  justify-self: center;
}
.ref-media-box {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-fill-color-dark);
}
.ref-corner-tag {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 3;
  margin: 0;
  --el-tag-border-color: transparent;
  line-height: 1.15;
  padding: 2px 6px;
}
.ref-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.ref-thumb-img :deep(.el-image__wrapper) {
  width: 100%;
  height: 100%;
}
.ref-thumb-img :deep(.el-image__inner) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ref-vid-wrap {
  position: absolute;
  inset: 0;
  cursor: pointer;
}
.ref-vid-mini {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.ref-play-mask {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.ref-play-icon {
  color: #fff;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.err-text {
  font-size: 12px;
  color: var(--el-color-danger);
}
.result-video-wrap {
  width: 100%;
  aspect-ratio: 9 / 16;
  max-height: 70vh;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 8px;
  background: #000;
}
</style>
