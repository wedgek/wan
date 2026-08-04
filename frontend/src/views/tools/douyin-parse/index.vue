<template>
  <div class="page-container douyin-parse">
    <!-- 粘贴解析区 -->
    <div class="parse-box">
      <el-input
        v-model="parseText"
        type="textarea"
        :rows="3"
        resize="none"
        placeholder="粘贴抖音分享文案或链接，例如：3.14 复制打开抖音，看看...  https://v.douyin.com/xxxxx/"
        class="parse-input"
      />
      <div class="parse-actions">
        <el-button type="primary" :loading="parsing" :icon="$icons.MagicStick" @click="onParse">提取素材</el-button>
        <el-button :disabled="parsing" @click="parseText = ''">清空</el-button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="搜索链接 / 标题"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <el-select
          v-if="showCreatorFilter"
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
          placeholder="提取状态"
          class="filter-select-status"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option label="解析中" value="processing" />
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

    <!-- 记录表格 -->
    <div class="page-table-box table-wrap">
      <el-table
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        :header-cell-style="{ 'text-align': 'center' }"
      >
        <el-table-column prop="id" label="ID" width="72" align="center" fixed="left" />
        <el-table-column label="抖音链接" min-width="220" align="left">
          <template #default="{ row }">
            <div class="link-cell">
              <a
                v-if="douyinLink(row)"
                :href="douyinLink(row)"
                target="_blank"
                rel="noopener"
                class="link-a"
                :title="row.inputText || douyinLink(row)"
              >
                {{ douyinLink(row) }}
              </a>
              <span v-else class="muted">—</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="作品" min-width="200" align="left">
          <template #default="{ row }">
            <div class="work-cell">
              <el-image v-if="row.cover" :src="row.cover" fit="cover" class="work-cover" lazy preview-teleported :preview-src-list="[row.cover]" />
              <div class="work-meta">
                <div class="work-title" :title="row.title">{{ row.title || "（无标题）" }}</div>
                <div class="work-author">{{ row.author ? "@" + row.author : "—" }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="原链接素材" min-width="300" align="left">
          <template #default="{ row }">
            <div v-if="row.status === 'success' && (row.resultUrl || row.images.length)" class="material-cell">
              <el-tag v-if="isExpired(row)" size="small" type="danger" effect="light">可能已过期</el-tag>
              <a :href="primaryUrl(row)" target="_blank" rel="noopener" class="material-url" :title="primaryUrl(row)">
                {{ primaryUrl(row) }}
              </a>
              <div v-if="!downloadingIds.has(row.id)" class="material-actions">
                <el-button link type="primary" size="small" :icon="$icons.CopyDocument" @click="copyMaterial(row)">复制</el-button>
                <el-button link type="primary" size="small" :icon="$icons.Download" @click="downloadMaterial(row)">下载</el-button>
              </div>
              <div v-else class="download-progress">
                <el-progress
                  class="download-progress-bar"
                  :percentage="downloadProgress[row.id] >= 0 ? downloadProgress[row.id] : 0"
                  :indeterminate="downloadProgress[row.id] < 0"
                  :duration="1"
                  :stroke-width="6"
                />
                <el-button link type="info" size="small" @click="cancelDownload(row)">取消</el-button>
              </div>
              <div v-if="row.expiresAt" class="expire-at">有效期至 {{ row.expiresAt }}</div>
            </div>
            <span v-else-if="isProcessing(row)" class="processing-text">
              <el-icon class="is-loading"><component :is="$icons.Loading" /></el-icon> 解析中
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="提取耗时" width="100" align="center">
          <template #default="{ row }">
            <span v-if="row.durationMs != null">{{ formatDuration(row.durationMs) }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="104" align="center" class-name="col-status">
          <template #default="{ row }">
            <el-tag v-if="isProcessing(row)" type="primary" size="small" class="status-tag-processing">
              <el-icon class="is-loading status-spin"><component :is="$icons.Loading" /></el-icon>
              <span>解析中</span>
            </el-tag>
            <el-tag v-else-if="row.status === 'success'" type="success" size="small">成功</el-tag>
            <el-tag v-else type="danger" size="small">失败</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建人" min-width="100" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ displayNickname(row) }}</template>
        </el-table-column>
        <el-table-column label="创建账号" min-width="110" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.username || "—" }}</template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="160" align="center" show-overflow-tooltip />
        <el-table-column label="失败原因" min-width="180" align="center" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.errorMessage" class="err-text">{{ row.errorMessage }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="center" fixed="right" class-name="col-actions">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              :icon="$icons.Refresh"
              :loading="reparsingIds.has(row.id)"
              :disabled="isProcessing(row)"
              @click="onReparse(row)"
            >
              重新获取
            </el-button>
            <el-button link type="danger" size="small" :icon="$icons.Delete" :loading="deletingIds.has(row.id)" @click="onDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
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

  </div>
</template>

<script setup name="toolsDouyinParse">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import { debounce } from "@/utils"
import { useAuthStore } from "@/stores/auth.js"

const authStore = useAuthStore()
/** 仅本人数据范围时无需筛选创建人 */
const showCreatorFilter = computed(() => authStore.dataScopeInfo?.mode !== "self")

const parseText = ref("")
const parsing = ref(false)
/** 用集合记录多行的进行中状态，避免连续点击互相覆盖 loading */
const reparsingIds = reactive(new Set())
const deletingIds = reactive(new Set())
const downloadingIds = reactive(new Set())
/** 下载进度：id -> 百分比（0~100；-1 表示无法获知总大小，走不确定态） */
const downloadProgress = reactive({})
/** 下载中止控制器：id -> AbortController（非响应式） */
const downloadAborters = {}

const defaultTableParams = () => ({
  userId: "",
  status: "",
  keyword: "",
  createTimeRange: null,
  pageNo: 1,
  pageSize: 10,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/douyin/logs/page",
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

onMounted(() => {
  if (!showCreatorFilter.value) {
    tableParams.userId = ""
  } else {
    loadUserOptions("")
  }
  getTableData()
})

/* ============ 提取（异步批量） ============ */
function isProcessing(row) {
  const s = String(row?.status || "").toLowerCase()
  return s === "processing" || s === "pending"
}

async function onParse() {
  const text = String(parseText.value || "").trim()
  if (!text) {
    ElMessage.warning("请粘贴抖音分享链接或文案")
    return
  }
  parsing.value = true
  try {
    const res = await request({ url: "/admin-api/douyin/parse", method: "POST", data: { text } })
    if (res.code === 0) {
      const list = Array.isArray(res.data?.list) ? res.data.list : []
      ElMessage.success(list.length > 1 ? `已加入 ${list.length} 条解析任务` : "已加入解析任务")
      parseText.value = ""
      // 回到第 1 页展示刚建立的「解析中」记录，随后由轮询就地更新状态
      tableParams.pageNo = 1
      getTableData()
    } else {
      ElMessage.error(res.msg || "提取失败")
    }
  } catch (e) {
    ElMessage.error("网络错误，请稍后重试")
  } finally {
    parsing.value = false
  }
}

async function onReparse(row) {
  if (!row || !row.id || reparsingIds.has(row.id) || isProcessing(row)) return
  reparsingIds.add(row.id)
  try {
    const res = await request({ url: `/admin-api/douyin/logs/${row.id}/reparse`, method: "POST" })
    if (res.code === 0) {
      // 后端已置为「解析中」，就地更新该行，交给轮询继续跟踪，避免整表刷新
      patchRow(res.data)
      ensurePolling()
    } else {
      ElMessage.error(res.msg || "重新获取失败")
    }
  } catch (e) {
    ElMessage.error("网络错误，请稍后重试")
  } finally {
    reparsingIds.delete(row.id)
  }
}

/* ============ 轻量状态轮询：只更新「解析中」的行，不刷新整表 ============ */
const POLL_INTERVAL = 2500
let pollTimer = null
let polling = false

/** 就地把最新数据合并进对应行（保持行对象引用不变，避免整表重渲染） */
function patchRow(fresh) {
  if (!fresh || !fresh.id) return
  const list = tableData.value
  const target = list.find((r) => r.id === fresh.id)
  if (target) Object.assign(target, fresh)
}

function processingIds() {
  return (tableData.value || []).filter((r) => isProcessing(r)).map((r) => r.id)
}

async function pollOnce() {
  if (polling) return
  if (typeof document !== "undefined" && document.hidden) return // 页面不可见时暂停，省资源
  const ids = processingIds()
  if (!ids.length) {
    stopPolling()
    return
  }
  polling = true
  try {
    const res = await request({ url: `/admin-api/douyin/logs/status?ids=${ids.join(",")}`, method: "GET" })
    if (res.code === 0 && Array.isArray(res.data?.list)) {
      for (const item of res.data.list) patchRow(item)
    }
  } catch (_) {
    /* 忽略单次轮询失败，下次继续 */
  } finally {
    polling = false
    if (!processingIds().length) stopPolling()
  }
}

function ensurePolling() {
  if (pollTimer || !processingIds().length) return
  pollTimer = setInterval(pollOnce, POLL_INTERVAL)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// 表格数据变化（提取/翻页/刷新）后，若出现「解析中」行则启动轮询
watch(tableData, () => ensurePolling())

onUnmounted(() => stopPolling())

async function onDelete(row) {
  if (!row || !row.id) return
  try {
    await ElMessageBox.confirm("确定删除该条解析记录吗？删除后不可恢复。", "删除确认", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    })
  } catch (_) {
    return
  }
  if (deletingIds.has(row.id)) return
  deletingIds.add(row.id)
  try {
    const res = await request({ url: `/admin-api/douyin/logs/${row.id}`, method: "DELETE" })
    if (res.code === 0) {
      ElMessage.success("已删除")
      getTableData()
    } else {
      ElMessage.error(res.msg || "删除失败")
    }
  } catch (e) {
    ElMessage.error("网络错误，请稍后重试")
  } finally {
    deletingIds.delete(row.id)
  }
}

/* ============ 创建人筛选 ============ */
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
    const res = await request({ url: "/admin-api/system/user/list-all-simple", method: "GET", params: { nickname: kw || undefined } })
    if (res.code === 0) userOptions.value = Array.isArray(res.data) ? res.data : []
  } finally {
    userLoading.value = false
  }
}

const remoteUserSearch = debounce((q) => loadUserOptions(String(q || "").trim()), 280)

function onReset() {
  resetTable()
  if (showCreatorFilter.value) loadUserOptions("")
  else tableParams.userId = ""
}

/* ============ 素材操作 ============ */
function isExpired(row) {
  if (!row.expiresAt) return false
  const t = new Date(String(row.expiresAt).replace(/-/g, "/")).getTime()
  return Number.isFinite(t) && t < Date.now()
}

function primaryUrl(row) {
  return row.resultUrl || (Array.isArray(row.images) && row.images[0]) || ""
}

async function copyMaterial(row) {
  const url = primaryUrl(row)
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success("已复制链接")
  } catch (e) {
    ElMessage.error("复制失败，请手动复制")
  }
}

/** API 根地址（与 axios 保持一致；为空则同源，dev 走 Vite 代理） */
function apiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (raw == null || String(raw).trim() === "") return ""
  return String(raw).trim().replace(/\/+$/, "")
}

/**
 * 下载素材：经后端代理流式拉取，边下边写，实时显示进度。
 * - 支持「先选保存位置」的浏览器（Chromium 的 File System Access API）：先弹出保存对话框，
 *   用户选好位置后再开始下载，内容按块直接写入磁盘（内存占用低）。
 * - 其它浏览器：回退为收集为 blob 后走默认下载目录，同样显示进度。
 */
async function downloadMaterial(row) {
  if (!row || !row.id || downloadingIds.has(row.id)) return
  if (!primaryUrl(row)) return

  const isImage = row.mediaType === "images"
  const fileName = `douyin_${row.awemeId || row.id}.${isImage ? "jpg" : "mp4"}`

  // 1) 先让用户选保存位置（必须在用户手势内、任何 await 之前触发）
  const canPickSave = typeof window.showSaveFilePicker === "function"
  let fileHandle = null
  if (canPickSave) {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          isImage
            ? { description: "图片", accept: { "image/jpeg": [".jpg", ".jpeg"] } }
            : { description: "视频", accept: { "video/mp4": [".mp4"] } },
        ],
      })
    } catch (e) {
      if (e && e.name === "AbortError") return // 用户取消选择位置
      fileHandle = null // 选择器异常则退回默认下载
    }
  }

  downloadingIds.add(row.id)
  downloadProgress[row.id] = 0
  const controller = new AbortController()
  downloadAborters[row.id] = controller

  const endpoint = `${apiBase()}/admin-api/douyin/logs/${row.id}/download`
  const token = authStore.token
  try {
    const resp = await fetch(endpoint, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
    if (!resp.ok || !resp.body) {
      throw new Error(resp.status === 404 ? "记录不存在" : "下载失败，链接可能已过期，请重新获取")
    }

    const total = Number(resp.headers.get("Content-Length")) || 0
    const reader = resp.body.getReader()
    let received = 0
    const bump = (chunkLen) => {
      received += chunkLen
      downloadProgress[row.id] = total ? Math.min(99, Math.round((received / total) * 100)) : -1
    }

    if (fileHandle) {
      const writable = await fileHandle.createWritable()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await writable.write(value)
          bump(value.length)
        }
        await writable.close()
      } catch (err) {
        try {
          await writable.abort()
        } catch (_) {
          /* ignore */
        }
        throw err
      }
    } else {
      const chunks = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        bump(value.length)
      }
      const blob = new Blob(chunks, { type: isImage ? "image/jpeg" : "video/mp4" })
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = objectUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
    }

    downloadProgress[row.id] = 100
    ElMessage.success("下载完成")
  } catch (e) {
    if (e && e.name === "AbortError") {
      ElMessage.info("已取消下载")
    } else {
      ElMessage.error(e?.message || "下载失败，链接可能已过期，请重新获取")
    }
  } finally {
    downloadingIds.delete(row.id)
    delete downloadAborters[row.id]
    setTimeout(() => {
      delete downloadProgress[row.id]
    }, 1200)
  }
}

/** 取消进行中的下载 */
function cancelDownload(row) {
  const c = row && downloadAborters[row.id]
  if (c) {
    try {
      c.abort()
    } catch (_) {
      /* ignore */
    }
  }
}

/* ============ 展示 ============ */
/** 提取耗时：毫秒 → 秒，保留一位小数（x.xs） */
function formatDuration(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n)) return "—"
  return `${(n / 1000).toFixed(1)}s`
}

/** 抖音链接列：只展示一条（优先已解析的长链，退化为原始输入） */
function douyinLink(row) {
  return String(row.douyinUrl || row.inputText || "").trim()
}

function displayNickname(row) {
  const nick = String(row.nickname || "").trim()
  if (nick) return nick
  const u = String(row.username || "").trim()
  return u || "—"
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
.parse-box {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}
.parse-input {
  margin-bottom: 12px;
}
.parse-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
/* Element Plus 相邻按钮自带 margin-left，与 flex gap 叠加会偏大，这里归零只用 gap */
.parse-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.douyin-parse .table-wrap {
  margin-top: 0;
}
/* 表格正文统一 12px */
.douyin-parse :deep(.el-table) {
  font-size: 12px;
}
.douyin-parse .filters-wrap {
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.douyin-parse .page-filter-left .filter-input-keyword.el-input {
  width: 220px;
}
.douyin-parse .page-filter-left .filter-select-user.el-select {
  width: 200px;
}
.douyin-parse .page-filter-left .filter-select-status.el-select {
  width: 130px;
}
.douyin-parse .page-filter-left .filter-date-range.el-date-editor {
  width: 280px;
  flex: 0 0 280px;
}
.link-cell {
  padding: 2px 0;
}
.link-a {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  color: var(--el-color-primary);
  font-size: 12px;
  word-break: break-all;
  text-decoration: none;
}
.link-a:hover {
  text-decoration: underline;
}
.work-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.work-cover {
  width: 46px;
  height: 62px;
  border-radius: 6px;
  flex: 0 0 46px;
  background: var(--el-fill-color-dark);
}
.work-meta {
  min-width: 0;
}
.work-title {
  font-size: 12px;
  color: var(--el-text-color-regular);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
}
.work-author {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.material-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.material-url {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  color: var(--el-color-primary);
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
  text-decoration: none;
  max-width: 100%;
}
.material-url:hover {
  text-decoration: underline;
}
.material-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.download-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.download-progress-bar {
  flex: 1;
  min-width: 0;
}
.download-progress-bar :deep(.el-progress__text) {
  font-size: 12px !important;
  min-width: 34px;
}
.expire-at {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.processing-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-color-primary);
}
.status-spin {
  margin-right: 2px;
}
/* 状态列：解析中标签不被截断出现省略号 */
.douyin-parse :deep(.col-status .cell) {
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
}
.status-tag-processing {
  display: inline-flex;
  align-items: center;
}
.status-tag-processing :deep(.el-tag__content) {
  display: inline-flex;
  align-items: center;
}
.err-text {
  font-size: 12px;
  color: var(--el-color-danger);
}
/* 操作列：按钮同一行不换行，间距适中 */
.douyin-parse :deep(.col-actions .cell) {
  white-space: nowrap;
}
.douyin-parse :deep(.col-actions .el-button + .el-button) {
  margin-left: 10px;
}
</style>
