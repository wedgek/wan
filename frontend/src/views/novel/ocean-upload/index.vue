<template>
  <div class="page-container ocean-upload">
    <section class="module upload-module">
      <div
        class="file-well"
        :class="{ over: dragging, busy: running, 'is-empty': !rows.length }"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @click="onWellClick"
      >
        <div v-if="!rows.length" class="well-empty">
          <span class="upload-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="42" height="42">
              <path d="M24 30V14m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M14 30.5c-4.2.4-7 2.6-7 5.2C7 39.4 11.5 42 18 42h12c6.5 0 11-2.6 11-6.3 0-2.6-2.8-4.8-7-5.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
            </svg>
          </span>
          <p>将视频或文件夹拖到此处，或 <span>点击上传</span></p>
        </div>
        <div v-else class="card-grid">
          <div v-for="row in rows" :key="row.key" class="card" :class="row.status">
            <video
              v-if="row.previewUrl"
              :src="row.previewUrl"
              muted
              playsinline
              preload="metadata"
              @loadedmetadata="paintFrame"
            />
            <div v-else class="card-fallback">无法预览</div>
            <button v-if="canRemove(row)" type="button" class="card-del" @click.stop="removeRow(row)">删除</button>
            <div class="card-name" :title="row.name">{{ row.name }}</div>
            <div class="card-meta" :title="row.error">{{ cardText(row) }}</div>
          </div>
        </div>
      </div>
      <div class="module-actions">
        <el-select v-model="orgId" placeholder="上传到的组织" class="org-select" :disabled="!orgs.length || running">
          <el-option v-for="item in orgs" :key="item.id" :label="orgLabel(item)" :value="item.id" />
        </el-select>
        <el-button type="primary" :disabled="!canStart" @click="startTask">开始上传</el-button>
        <el-button v-if="rows.length && !running" @click="clearTask">清空</el-button>
        <span v-if="rows.length" class="hint">{{ taskSummary }}</span>
        <span class="actions-spacer" />
        <span v-if="authReady && !authorized" class="hint warn">请先完成巨量授权</span>
        <input
          ref="fileInput"
          class="file-input"
          type="file"
          multiple
          accept=".mp4,.mpeg,.mpg,.3gp,.avi,video/mp4,video/mpeg,video/3gpp,video/x-msvideo"
          @change="addFiles"
        />
      </div>
    </section>
    <section class="module board">
    <el-tabs v-model="tab" class="upload-tabs">
      <el-tab-pane :label="taskTabLabel" name="task">
          <div v-if="!serverTasks.length" class="pane-empty">
            <span class="empty-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="40" height="40">
                <rect x="11" y="8" width="26" height="32" rx="3" fill="none" stroke="currentColor" stroke-width="2.2" />
                <path d="M18 20h12M18 26h12M18 32h8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
              </svg>
            </span>
            <p>还没有进行中的任务</p>
            <span>开始上传后，进度会显示在这里</span>
          </div>
          <div v-else class="server-tasks">
            <div v-for="task in serverTasks" :key="task.localId || task.id" class="server-task">
              <div class="server-task-head">
                <span>{{ task.createdAt }} · {{ task.orgName || task.orgId }}</span>
                <span>{{ task.done }}/{{ task.total }}</span>
                <button v-if="taskBusy(task)" type="button" class="task-close danger" @click.stop.prevent="stopServerTask(task)">停止</button>
                <button v-else type="button" class="task-close" @click.stop.prevent="dismissServerTask(task)">关闭</button>
              </div>
          <div class="card-grid">
            <div v-for="item in task.items" :key="item.filename + '\0' + item.localSize" class="card" :class="item.status">
              <video
                v-if="previewOf(task, item)"
                :src="previewOf(task, item)"
                muted
                playsinline
                preload="metadata"
                @loadedmetadata="paintFrame"
              />
              <div v-else class="card-fallback" />
              <span class="card-state" :class="item.status">
                <i v-if="item.status === 'uploading'" class="state-dot" />
                {{ itemState(item) }}
              </span>
              <button
                v-if="item.status === 'waiting' || item.status === 'uploading'"
                type="button"
                class="card-del"
                @click.stop="stopServerItem(task, item)"
              >{{ item.status === "uploading" ? "停止" : "取消" }}</button>
              <button
                v-else-if="item.status === 'fail' && !item.draft"
                type="button"
                class="card-del"
                @click.stop="retryServerItem(task, item)"
              >重试</button>
              <div class="card-name" :title="item.filename">{{ item.filename }}</div>
              <div v-if="item.status === 'fail'" class="card-error" :title="item.error">{{ item.error || "失败" }}</div>
              <div v-else class="card-meta">{{ itemText(item) }}</div>
            </div>
          </div>
            </div>
          </div>
      </el-tab-pane>
      <el-tab-pane label="上传记录" name="history">
      <div class="page-table-box">
        <el-table :data="history" border height="100%">
          <template #empty>
            <div class="table-empty">
              <p>还没有上传记录</p>
              <span>传完的视频会留在这里</span>
            </div>
          </template>
          <el-table-column label="时间" width="170" align="center">
            <template #default="{ row }">{{ row.createdAt || "—" }}</template>
          </el-table-column>
          <el-table-column label="文件" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.filename }}</template>
          </el-table-column>
          <el-table-column label="组织" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.orgName || row.orgId || "—" }}</template>
          </el-table-column>
          <el-table-column label="体积" width="110" align="center">
            <template #default="{ row }">{{ formatSize(row.localSize) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <span v-if="row.status === 'success'" class="ok">已上传</span>
              <span v-else-if="row.status === 'stopped'" class="muted">已中断</span>
              <span v-else class="fail">失败</span>
            </template>
          </el-table-column>
          <el-table-column label="原因" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.status === 'success'">—</span>
              <span v-else :class="row.status === 'stopped' ? 'muted' : 'fail'">{{ row.error || "未返回原因" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="素材 ID" min-width="170" show-overflow-tooltip>
            <template #default="{ row }">{{ row.materialId || "—" }}</template>
          </el-table-column>
        </el-table>
      </div>
      <div v-if="historyTotal" class="page-pagination-box">
        <CzPagination
          :total="historyTotal"
          v-model:page-no="historyPage"
          v-model:page-size="historyPageSize"
          @change="loadHistory"
        />
      </div>
      </el-tab-pane>
    </el-tabs>
    </section>
  </div>
</template>

<script setup name="novelOceanUpload">
import request from "@/request"
import CzPagination from "@/components/cz-pagination/index.vue"

const ALLOWED = new Set(["mp4", "mpeg", "mpg", "3gp", "avi"])
const MAX_BYTES = 1000 * 1024 * 1024
const MIN_KBPS = 516

const fileInput = ref(null)
const dragging = ref(false)
let dragDepth = 0
const orgs = ref([])
const orgId = ref("")
const authorized = ref(false)
const authReady = ref(false)
const concurrency = ref(2)
const rows = ref([])
const history = ref([])
const historyPage = ref(1)
const historyPageSize = ref(20)
const historyTotal = ref(0)
const serverTasks = ref([])
const tab = ref("task")
const taskPreviews = new Map()
const dismissedIds = new Set()
const drafts = new Map()
const cancelledKeys = new Set()
const taskTabLabel = computed(() => (serverTasks.value.length ? `任务区 ${serverTasks.value.length}` : "任务区"))

const running = computed(() => rows.value.some((row) => row.status === "uploading"))
const canStart = computed(() => authorized.value && !!orgId.value && rows.value.some((row) => row.status === "waiting") && !running.value)
const taskSummary = computed(() => {
  const list = rows.value
  const success = list.filter((row) => row.status === "success").length
  const failed = list.filter((row) => row.status === "fail").length
  const stopped = list.filter((row) => row.status === "stopped").length
  const pending = list.filter((row) => row.status === "uploading" || row.status === "waiting").length
  return `本批 ${list.length} 个，进行中 ${pending}，成功 ${success}，失败 ${failed}${stopped ? `，已停止 ${stopped}` : ""}`
})

function orgLabel(item) {
  const name = item.name || "未命名组织"
  return item.parentName ? `${name}（${item.parentName}下级） ${item.id}` : `${name} ${item.id}`
}

function fileKey(file) {
  return `${file.name}\0${file.size}`
}

function takenKeys() {
  const keys = new Set()
  for (const row of rows.value) {
    if (!row.file) continue
    if (row.status === "fail" || row.status === "stopped") continue
    keys.add(fileKey(row.file))
  }
  return keys
}

function formatSize(size) {
  const n = Number(size) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function extOf(name) {
  const text = String(name || "")
  const index = text.lastIndexOf(".")
  return index >= 0 ? text.slice(index + 1).toLowerCase() : ""
}

function pick() {
  fileInput.value && fileInput.value.click()
}

function onWellClick(event) {
  if (running.value) return
  if (event.target.closest("button")) return
  pick()
}

function canRemove(row) {
  return !running.value && (row.status === "waiting" || row.status === "invalid" || row.status === "stopped" || row.status === "fail" || row.status === "success")
}

function cardText(row) {
  if (row.status === "uploading") return "上传中"
  if (row.status === "success") return "已上传"
  if (row.status === "invalid" || row.status === "fail") return row.error || "不合格"
  if (row.status === "stopped") return "已停止"
  return `${formatSize(row.localSize)} · 等待上传`
}

function paintFrame(event) {
  const video = event.target
  if (!video || !video.duration) return
  const frame = Math.min(0.2, video.duration / 2)
  if (frame > 0) video.currentTime = frame
}

function releaseRow(row) {
  if (row && row.previewUrl) URL.revokeObjectURL(row.previewUrl)
}

function probeVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onerror = null
      video.removeAttribute("src")
      video.load()
      if (error) {
        URL.revokeObjectURL(url)
        reject(error)
      } else {
        resolve(value)
      }
    }
    const timer = setTimeout(() => finish(new Error("读不出画面，无法校验")), 8000)
    video.preload = "metadata"
    video.muted = true
    video.onloadedmetadata = () => {
      finish(null, {
        url,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        duration: Number(video.duration) || 0,
      })
    }
    video.onerror = () => finish(new Error("读不出画面，无法校验"))
    video.src = url
  })
}

async function inspectFile(file) {
  if (!ALLOWED.has(extOf(file.name))) return { reason: "只支持 mp4、mpeg、3gp、avi" }
  if (!file.size) return { reason: "文件是空的" }
  if (file.size > MAX_BYTES) return { reason: "超过 1000MB" }
  try {
    const meta = await probeVideo(file)
    const reason = checkMeta(file, meta)
    if (reason) URL.revokeObjectURL(meta.url)
    return { reason, previewUrl: reason ? "" : meta.url }
  } catch (e) {
    return { reason: e.message || "读不出画面，无法校验" }
  }
}

function fitRange(value, min, max) {
  return value >= min && value <= max
}

function checkMeta(file, meta) {
  const duration = meta.duration
  if (!(duration >= 4 && duration <= 3600)) return `时长 ${duration.toFixed(1)} 秒，需要 4 到 3600 秒`
  const kbps = (file.size * 8) / duration / 1000
  if (kbps < MIN_KBPS) return `码率约 ${Math.round(kbps)}kbps，需要至少 516kbps`
  const { width, height } = meta
  const ratio = height ? width / height : 0
  const landscape = Math.abs(ratio - 16 / 9) <= 0.03 && fitRange(width, 1280, 2560) && fitRange(height, 720, 1440)
  const portrait = Math.abs(ratio - 9 / 16) <= 0.03 && fitRange(width, 720, 1440) && fitRange(height, 1280, 2560)
  if (!landscape && !portrait) return `${width}×${height} 不符合 16:9 或 9:16 的分辨率`
  return ""
}

function onDragEnter(event) {
  event.preventDefault()
  dragDepth += 1
  dragging.value = true
}

function onDragOver(event) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = running.value ? "none" : "copy"
}

function onDragLeave(event) {
  event.preventDefault()
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    dragging.value = false
  }
}

async function onDrop(event) {
  event.preventDefault()
  dragDepth = 0
  dragging.value = false
  if (running.value) {
    ElMessage.warning("这一批还在上传")
    return
  }
  const files = await filesFromDrop(event.dataTransfer)
  pushFiles(files)
}

function readEntries(reader) {
  return new Promise((resolve) => {
    const all = []
    const read = () => {
      reader.readEntries((entries) => {
        if (!entries.length) {
          resolve(all)
          return
        }
        all.push(...entries)
        read()
      }, () => resolve(all))
    }
    read()
  })
}

function fileFromEntry(entry) {
  return new Promise((resolve) => {
    entry.file((file) => resolve(file), () => resolve(null))
  })
}

async function walkEntry(entry, files) {
  if (!entry) return
  if (entry.isFile) {
    const file = await fileFromEntry(entry)
    if (file) files.push(file)
    return
  }
  if (!entry.isDirectory) return
  const children = await readEntries(entry.createReader())
  for (const child of children) await walkEntry(child, files)
}

async function filesFromDrop(dataTransfer) {
  const files = []
  const items = Array.from((dataTransfer && dataTransfer.items) || [])
  if (!items.length) return Array.from((dataTransfer && dataTransfer.files) || [])
  const walks = []
  for (const item of items) {
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry()
    if (entry) walks.push(walkEntry(entry, files))
    else if (item.kind === "file") {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  await Promise.all(walks)
  return files
}

function addFiles(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ""
  pushFiles(files)
}

async function pushFiles(files) {
  if (running.value) {
    ElMessage.warning("这一批还在上传")
    return
  }
  if (rows.value.length && !rows.value.some((row) => row.status === "waiting")) {
    rows.value.forEach(releaseRow)
    rows.value = []
  }
  const taken = takenKeys()
  let duplicated = 0
  const queue = []
  for (const file of files) {
    if (taken.has(fileKey(file))) {
      duplicated += 1
      continue
    }
    taken.add(fileKey(file))
    queue.push(file)
  }
  const org = orgs.value.find((item) => item.id === orgId.value)
  let cursor = 0
  let blocked = 0
  async function worker() {
    while (cursor < queue.length) {
      const file = queue[cursor]
      cursor += 1
      const result = await inspectFile(file)
      if (result.reason) blocked += 1
      rows.value.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${rows.value.length}`,
        file,
        name: file.name,
        localSize: file.size,
        orgId: orgId.value,
        orgName: org && org.name ? org.name : "",
        status: result.reason ? "invalid" : "waiting",
        previewUrl: result.previewUrl || "",
        progress: 0,
        error: result.reason || "",
        videoId: "",
        materialId: "",
        remoteSize: 0,
        sizeMatched: null,
        controller: null,
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()))
  if (duplicated) ElMessage.warning(`${duplicated} 个已经在这批里，已跳过`)
  if (blocked) ElMessage.warning(`${blocked} 个视频不合格，已拦住，不会上传`)
}

function clearTask() {
  if (running.value) return
  rows.value.forEach(releaseRow)
  rows.value = []
}

function removeRow(row) {
  if (!canRemove(row)) return
  releaseRow(row)
  rows.value = rows.value.filter((item) => item.key !== row.key)
}

function itemState(item) {
  if (item.status === "uploading") return "上传中"
  if (item.status === "success") return "已上传"
  if (item.status === "fail") return "失败"
  if (item.status === "stopped") return "已停止"
  return "等待"
}

function itemText(item) {
  if (item.status === "fail") return item.error || "失败"
  if (item.status === "stopped") return "已停止"
  return formatSize(item.localSize)
}

function previewKey(taskId, item) {
  return `${taskId}\0${item.filename}\0${item.localSize}`
}

function previewOf(task, item) {
  return taskPreviews.get(previewKey(task.id, item)) || ""
}

function keepPreview(taskId, row) {
  if (!row.previewUrl) return
  taskPreviews.set(previewKey(taskId, { filename: row.name, localSize: row.localSize }), row.previewUrl)
  row.previewUrl = ""
}

function syncPreviews(list) {
  const live = new Set()
  for (const task of list) {
    for (const item of task.items || []) live.add(previewKey(task.id, item))
  }
  for (const draft of drafts.values()) {
    const id = draft.serverId || draft.localId
    for (const item of draft.items) live.add(previewKey(id, item))
  }
  for (const [key, url] of taskPreviews) {
    if (live.has(key)) continue
    URL.revokeObjectURL(url)
    taskPreviews.delete(key)
  }
}

function activeItems(task) {
  return (task.items || []).filter((item) => {
    if (dismissedIds.has(item.id)) return false
    return item.status === "waiting" || item.status === "uploading" || item.status === "fail"
  })
}

function nowText() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function moveItemToHistory(task, item, status, error) {
  dismissedIds.add(item.id)
  const key = previewKey(task.id, item)
  const url = taskPreviews.get(key)
  if (url) {
    URL.revokeObjectURL(url)
    taskPreviews.delete(key)
  }
  serverTasks.value = serverTasks.value
    .map((row) => (row.id === task.id ? { ...row, items: row.items.filter((file) => file.id !== item.id) } : row))
    .filter((row) => row.items.some((file) => file.status === "waiting" || file.status === "uploading" || file.status === "fail"))
  history.value = [
    {
      id: `local-${item.id}`,
      createdAt: nowText(),
      filename: item.filename,
      orgName: task.orgName || "",
      orgId: task.orgId || "",
      localSize: item.localSize || 0,
      status,
      error,
      materialId: "",
    },
    ...history.value.filter((row) => row.filename !== item.filename || row.createdAt !== nowText()),
  ]
}

function cardKey(item) {
  return `${item.filename}\0${item.localSize}`
}

function itemsInOrder(order, draftItems, serverItems) {
  const byKey = new Map()
  for (const item of serverItems) byKey.set(cardKey(item), item)
  for (const item of draftItems) {
    const key = cardKey(item)
    if (!byKey.has(key)) byKey.set(key, item)
  }
  const used = new Set()
  const items = []
  for (const key of order) {
    const item = byKey.get(key)
    if (!item) continue
    items.push(item)
    used.add(key)
  }
  for (const item of serverItems) {
    const key = cardKey(item)
    if (used.has(key)) continue
    items.push(item)
  }
  return items
}

function showDraft(draft) {
  const id = draft.serverId || draft.localId
  const current = serverTasks.value.find((task) => task.localId === draft.localId || task.id === id)
  const serverItems = ((current && current.items) || []).filter((item) => !item.draft)
  const items = itemsInOrder(draft.order, draft.items, serverItems)
  const view = { ...draft, id, items, total: Math.max(draft.total, (current && current.total) || 0) }
  const rest = serverTasks.value.filter((task) => task !== current && task.localId !== draft.localId && task.id !== draft.localId && task.id !== id)
  serverTasks.value = items.length ? [view, ...rest] : rest
}

function mergeDrafts(shown, serverList) {
  for (const draft of [...drafts.values()]) {
    const id = draft.serverId || draft.localId
    const raw = serverList.find((task) => task.id === draft.serverId)
    const known = new Set((raw && raw.items ? raw.items : []).map((item) => `${item.filename}\0${item.localSize}`))
    draft.items = draft.items.filter((item) => !known.has(`${item.filename}\0${item.localSize}`))
    if (!draft.items.length) {
      drafts.delete(draft.localId)
      continue
    }
    const found = shown.find((task) => task.id === id)
    if (found) {
      found.items = itemsInOrder(draft.order, draft.items, found.items)
      found.total = Math.max(Number(found.total) || 0, draft.total)
      found.localId = draft.localId
    } else {
      shown.unshift({ ...draft, id, items: itemsInOrder(draft.order, draft.items, []), done: 0 })
    }
  }
  return shown.filter((task) => task.items.length)
}

function findDraft(task) {
  if (!task) return null
  for (const draft of drafts.values()) {
    if (draft.localId === task.localId || draft.localId === task.id || (draft.serverId && draft.serverId === task.id)) return draft
  }
  return null
}

function taskKey(task) {
  return task.localId || task.id
}

function patchTaskList(next) {
  const prev = new Map(serverTasks.value.map((task) => [taskKey(task), task]))
  serverTasks.value = next.map((task) => {
    const old = prev.get(taskKey(task))
    if (!old) return task
    old.done = task.done
    old.total = task.total
    old.status = task.status
    old.orgName = task.orgName || old.orgName
    old.createdAt = task.createdAt || old.createdAt
    old.id = task.id
    const oldItems = new Map(old.items.map((item) => [cardKey(item), item]))
    old.items = task.items.map((item) => {
      const exist = oldItems.get(cardKey(item))
      if (!exist) return item
      exist.status = item.status
      exist.error = item.error || ""
      exist.id = item.id
      exist.draft = !!item.draft
      return exist
    })
    return old
  })
}

let activeSeq = 0

async function loadActive() {
  const seq = ++activeSeq
  const res = await request({ url: "/admin-api/oceanengine/materials/tasks/active" })
  if (seq !== activeSeq || !res || res.code !== 0) return
  const list = Array.isArray(res.data) ? res.data : []
  syncPreviews(list)
  const had = serverTasks.value.some((task) => task.done > 0)
  const shown = list
    .map((task) => ({ ...task, items: activeItems(task) }))
    .filter((task) => task.items.length)
  patchTaskList(mergeDrafts(shown, list))
  if (had || list.some((task) => task.done > 0)) loadHistory()
}

async function retryServerItem(task, item) {
  const previous = item.error
  item.status = "waiting"
  item.error = ""
  try {
    const res = await request({
      url: `/admin-api/oceanengine/materials/tasks/${task.id}/items/${item.id}/retry`,
      method: "POST",
    })
    if (!res || res.code !== 0) {
      item.status = "fail"
      item.error = (res && res.msg) || previous || "重试失败"
      ElMessage.error(item.error)
    }
  } catch (e) {
    item.status = "fail"
    item.error = submitErrorText(e && e.message)
    ElMessage.error(item.error)
  }
  loadActive()
}

async function stopServerItem(task, item) {
  const uploading = item.status === "uploading"
  if (uploading) {
    try {
      await ElMessageBox.confirm(`停止「${item.filename}」？这个文件会中断，其他文件继续传。`, "停止这个视频", {
        type: "warning",
        confirmButtonText: "停止",
        cancelButtonText: "返回",
      })
    } catch {
      return
    }
  }
  const draft = item.draft ? findDraft(task) : null
  if (draft) {
    cancelledKeys.add(item.id)
    draft.items = draft.items.filter((row) => row.id !== item.id)
    if (!draft.items.length) drafts.delete(draft.localId)
    moveItemToHistory(task, item, "stopped", uploading ? "已停止" : "已取消")
    showDraft(draft)
    return
  }
  moveItemToHistory(task, item, "stopped", uploading ? "已停止" : "已取消")
  const res = await request({
    url: `/admin-api/oceanengine/materials/tasks/${task.id}/items/${item.id}/stop`,
    method: "POST",
  })
  if (!res || res.code !== 0) {
    ElMessage.error((res && res.msg) || "操作失败")
    return
  }
  loadActive()
  historyPage.value = 1
  loadHistory()
}

function taskBusy(task) {
  return (task.items || []).some((item) => item.status === "waiting" || item.status === "uploading")
}

async function dismissServerTask(task) {
  const draft = findDraft(task)
  if (draft) {
    draft.items = draft.items.filter((item) => item.status === "waiting" || item.status === "uploading")
    if (!draft.items.length) drafts.delete(draft.localId)
  }
  const key = taskKey(task)
  serverTasks.value = serverTasks.value.filter((row) => taskKey(row) !== key)
  if (!task.id || String(task.id).startsWith("draft-")) return
  try {
    const res = await request({ url: `/admin-api/oceanengine/materials/tasks/${task.id}/dismiss`, method: "POST" })
    if (!res || res.code !== 0) {
      ElMessage.error((res && res.msg) || "关闭失败")
      loadActive()
    }
  } catch (e) {
    ElMessage.error(submitErrorText(e && e.message))
    loadActive()
  }
}

async function stopServerTask(task) {
  const left = Math.max(0, Number(task.total) - Number(task.done))
  try {
    await ElMessageBox.confirm(
      left ? `还有 ${left} 个文件没传完，停止后不会继续上传。已经传完的会留在记录里。` : "确定停止这个任务？",
      "停止上传",
      {
        type: "warning",
        confirmButtonText: "停止",
        cancelButtonText: "取消",
      },
    )
  } catch {
    return
  }
  const draft = findDraft(task)
  const pending = (task.items || []).filter((item) => item.status === "waiting" || item.status === "uploading")
  pending.forEach((item) => {
    if (item.draft) cancelledKeys.add(item.id)
    moveItemToHistory(task, item, "stopped", item.status === "uploading" ? "已停止" : "已取消")
  })
  if (draft) {
    draft.items = []
    drafts.delete(draft.localId)
    showDraft(draft)
  }
  const serverId = (draft && draft.serverId) || (!draft && task.id)
  if (!serverId) return
  const res = await request({ url: `/admin-api/oceanengine/materials/tasks/${serverId}/stop`, method: "POST" })
  if (!res || res.code !== 0) {
    ElMessage.error((res && res.msg) || "停止失败")
    return
  }
  loadActive()
  historyPage.value = 1
  loadHistory()
}

function movePreviews(fromId, toId, batch) {
  for (const row of batch) {
    const from = previewKey(fromId, { filename: row.name, localSize: row.localSize })
    const url = taskPreviews.get(from)
    if (!url) continue
    taskPreviews.set(previewKey(toId, { filename: row.name, localSize: row.localSize }), url)
    taskPreviews.delete(from)
  }
}

function restorePreview(taskId, row) {
  const key = previewKey(taskId, { filename: row.name, localSize: row.localSize })
  const url = taskPreviews.get(key)
  if (!url) return
  row.previewUrl = url
  taskPreviews.delete(key)
}

function submitErrorText(message) {
  const text = String(message || "")
  if (!text || text === "Network Error") return "网络中断，没能提交"
  return text
}

async function postTaskFile(taskId, row) {
  const form = new FormData()
  form.append("file", row.file, row.file.name)
  form.append("filename", row.file.name)
  let last = "提交失败"
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await request({
        url: `/admin-api/oceanengine/materials/tasks/${taskId}/files`,
        method: "POST",
        data: form,
        timeout: 600000,
      })
      if (res && res.code === 0) return res
      return { error: (res && res.msg) || "提交失败" }
    } catch (e) {
      last = submitErrorText(e && e.message)
      const network = !e || !e.response || e.code === "ERR_NETWORK" || e.message === "Network Error"
      if (attempt === 0 && network) {
        await new Promise((resolve) => setTimeout(resolve, 600))
        continue
      }
      return { error: last }
    }
  }
  return { error: last }
}

async function startTask() {
  if (!canStart.value) return
  const batch = rows.value.filter((row) => row.status === "waiting")
  const org = orgs.value.find((item) => item.id === orgId.value)
  const localId = `draft-${Date.now()}`
  const draft = {
    localId,
    serverId: 0,
    draft: true,
    orgId: orgId.value,
    orgName: org && org.name ? org.name : "",
    createdAt: nowText(),
    status: "running",
    total: batch.length,
    done: 0,
    order: batch.map((row) => `${row.name}\0${row.localSize}`),
    items: batch.map((row) => ({
      id: row.key,
      filename: row.name,
      localSize: row.localSize,
      status: "waiting",
      error: "",
      draft: true,
    })),
  }
  drafts.set(localId, draft)
  batch.forEach((row) => keepPreview(localId, row))
  rows.value = rows.value.filter((row) => row.status !== "waiting")
  tab.value = "task"
  showDraft(draft)
  let created
  try {
    created = await request({
      url: "/admin-api/oceanengine/materials/tasks",
      method: "POST",
      data: { orgId: orgId.value, orgName: draft.orgName },
    })
  } catch (e) {
    created = { code: 1, msg: submitErrorText(e && e.message) }
  }
  if (!created || created.code !== 0) {
    drafts.delete(localId)
    batch.forEach((row) => restorePreview(localId, row))
    rows.value = batch.concat(rows.value)
    serverTasks.value = serverTasks.value.filter((task) => task.localId !== localId && task.id !== localId)
    ElMessage.error((created && created.msg) || "创建任务失败")
    return
  }
  const taskId = created.data.id
  draft.serverId = taskId
  movePreviews(localId, taskId, batch)
  showDraft(draft)
  let saved = 0
  let cursor = 0
  async function sendFile() {
    while (cursor < batch.length) {
      const row = batch[cursor]
      cursor += 1
      if (cancelledKeys.has(row.key)) continue
      const item = draft.items.find((file) => file.id === row.key)
      const res = await postTaskFile(taskId, row)
      if (cancelledKeys.has(row.key)) {
        const itemId = res && res.data && res.data.id
        if (itemId) {
          request({
            url: `/admin-api/oceanengine/materials/tasks/${taskId}/items/${itemId}/stop`,
            method: "POST",
          })
        }
        continue
      }
      if (res && res.code === 0) {
        saved += 1
      } else if (item) {
        item.status = "fail"
        item.error = submitErrorText(res && res.error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, batch.length) }, () => sendFile()))
  if (!saved && draft.serverId) {
    await request({ url: `/admin-api/oceanengine/materials/tasks/${draft.serverId}/stop`, method: "POST" })
  }
  loadActive()
}

async function loadHistory() {
  const res = await request({
    url: "/admin-api/oceanengine/materials/records",
    params: { page: historyPage.value, pageSize: historyPageSize.value },
  })
  if (!res || res.code !== 0) return
  const data = res.data || {}
  history.value = Array.isArray(data.list) ? data.list : []
  historyTotal.value = Number(data.total) || 0
}

async function loadTargets() {
  const res = await request({ url: "/admin-api/oceanengine/materials/targets" })
  authReady.value = true
  if (!res || res.code !== 0) {
    authorized.value = false
    ElMessage.error((res && res.msg) || "读取组织失败")
    return
  }
  const data = res.data || {}
  orgs.value = Array.isArray(data.orgs) ? data.orgs : []
  orgId.value = data.orgId || (orgs.value[0] && orgs.value[0].id) || ""
  authorized.value = !!data.authorized
  const limit = Number(data.concurrency)
  if (limit >= 1) concurrency.value = limit
}

loadTargets()
loadHistory()
loadActive()
setInterval(loadActive, 2000)
</script>

<style scoped lang="scss">
.ocean-upload {
  gap: 16px;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.module {
  flex-shrink: 0;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.board {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 16px 12px;
  overflow: hidden;
}

.file-well {
  max-height: 280px;
  min-height: 148px;
  overflow: auto;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-light);
  cursor: pointer;
}

.file-well.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-well:hover {
  border-color: var(--el-color-primary);
}

.file-well.over {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.file-well.busy {
  cursor: not-allowed;
}

.well-empty {
  margin: 0;
  padding: 28px 16px 36px;
  color: var(--el-text-color-regular);
  font-size: 14px;
  text-align: center;
}

.well-empty p {
  margin: 8px 0 0;
}

.well-empty span {
  color: var(--el-color-primary);
}

.upload-mark {
  display: inline-flex;
  color: var(--el-color-primary);
}

.pane-empty,
.table-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--el-text-color-placeholder);
}

.pane-empty {
  flex: 1;
  min-height: 0;
  gap: 6px;
}

.pane-empty p,
.table-empty p {
  margin: 8px 0 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.pane-empty > span,
.table-empty span {
  font-size: 13px;
}

.empty-mark {
  display: inline-flex;
  color: var(--el-text-color-placeholder);
}

.table-empty {
  padding: 28px 0 36px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 12px;
  padding: 12px;
}

.card {
  position: relative;
  min-width: 0;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.card video,
.card-fallback {
  width: 100%;
  height: 96px;
  object-fit: cover;
  display: block;
  background: #1f2329;
  border-radius: 6px 6px 0 0;
}

.card-fallback {
  color: #fff;
  font-size: 12px;
  line-height: 96px;
  text-align: center;
}

.card-del {
  position: absolute;
  top: 6px;
  right: 6px;
  border: none;
  border-radius: 4px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.card-state {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 12px;
  line-height: 22px;
  pointer-events: none;
}

.card-state.uploading {
  background: var(--el-color-primary);
}

.card-state.success {
  background: var(--el-color-success);
}

.card-state.fail {
  background: var(--el-color-danger);
}

.state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  animation: state-pulse 1s ease-in-out infinite;
}

@keyframes state-pulse {
  50% {
    opacity: 0.3;
  }
}

.card-name,
.card-meta {
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.card-error {
  margin: 0 6px 6px;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
  white-space: normal;
  word-break: break-all;
}

.card-name {
  margin-top: 6px;
}

.card-meta {
  margin-bottom: 6px;
  color: var(--el-text-color-secondary);
}

.card.invalid {
  outline: 1px solid var(--el-color-danger);
}

.module-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.module-actions :deep(.org-select) {
  width: 280px;
}

.module-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.actions-spacer {
  flex: 1;
}

.server-tasks {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.server-task {
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px 12px 4px;
  background: #fff;
}

.server-task-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  padding: 0 4px 8px;
  font-size: 13px;
}

.server-task-head :deep(.el-button),
.task-close {
  margin-left: auto;
}

.task-close {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
  cursor: pointer;
}

.task-close.danger {
  color: var(--el-color-danger);
}

.server-task .card-grid {
  padding: 0 0 8px;
}

.server-task .card-meta.success {
  color: var(--el-color-success);
}

.server-task .card-meta.fail {
  color: var(--el-color-danger);
}

.server-task .card.waiting {
  outline: 1px solid var(--el-border-color);
}

.server-task .card.uploading {
  outline: 1px solid var(--el-color-primary);
}

.server-task .card.success {
  outline: 1px solid var(--el-color-success);
}

.server-task .card.fail {
  outline: 1px solid var(--el-color-danger);
}

.upload-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.upload-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin: 0 0 12px;
}

.upload-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background-color: var(--el-border-color-lighter);
}

.upload-tabs :deep(.el-tabs__item) {
  height: 46px;
  padding: 0 18px;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.upload-tabs :deep(.el-tabs__item.is-active) {
  color: var(--el-color-primary);
  font-weight: 600;
}

.upload-tabs :deep(.el-tabs__active-bar) {
  height: 2px;
  border-radius: 2px;
}

.upload-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.upload-tabs :deep(.el-tab-pane) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.board .page-pagination-box {
  flex-shrink: 0;
  padding-top: 12px;
}

.upload-module {
  flex-shrink: 0;
}

.file-input {
  display: none;
}

.hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.warn {
  color: var(--el-color-warning);
}

.ok {
  color: var(--el-color-success);
}

.fail {
  color: var(--el-color-danger);
}

.muted {
  color: var(--el-text-color-secondary);
}
</style>
