<template>
  <div class="event-panel">
    <el-tabs v-model="tableParams.copyright" class="copyright-tabs" @tab-change="onCopyrightTab">
      <el-tab-pane v-for="item in copyrightTabs" :key="item.name" :name="item.name" :label="item.label" />
    </el-tabs>
    <section class="list-module">
      <div class="page-filter-box filter-bar">
        <div class="page-filter-left filters-wrap">
          <el-input
            v-model="tableParams.keyword"
            placeholder="账户ID / 账户名称"
            class="filter-input-keyword"
            clearable
            clear-icon="Close"
            @keyup.enter="searchUsing"
          />
          <el-select v-model="tableParams.subject" placeholder="主体" class="filter-select-sm" clearable clear-icon="Close" filterable>
            <el-option v-for="item in subjects" :key="item" :label="item" :value="item" />
          </el-select>
          <el-select v-model="tableParams.assetStatus" placeholder="状态" class="filter-select-status" clearable clear-icon="Close" @change="searchUsing">
            <el-option v-for="item in assetStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-select v-model="miniAppId" placeholder="小程序" class="filter-select-batch" filterable @change="onMiniAppChange">
            <el-option v-for="item in visibleMiniApps" :key="item.appId" :label="miniLabel(item)" :value="item.appId" />
          </el-select>
          <el-button type="primary" @click="searchUsing">查询</el-button>
          <el-button @click="resetUsing">重置</el-button>
        </div>
        <div class="page-filter-right list-side">
          <span v-if="selectedRows.length" class="using-count">已选 {{ selectedRows.length }}</span>
          <el-button type="primary" :loading="selectBatching" :disabled="syncing || !selectedRows.length" @click="openAddDialog">批量添加事件</el-button>
          <el-progress v-if="selectBatching" class="side-progress" :percentage="selectPercent" :stroke-width="8" :show-text="false" />
          <span v-if="selectProgress" class="using-count">{{ selectProgress }}</span>
          <el-button v-if="syncing" :loading="stopping" @click="stopSync">{{ stopping ? "正在停止" : "停止同步" }}</el-button>
          <el-button v-else :icon="$icons.Refresh" :disabled="selectBatching" @click="syncAll">从巨量同步</el-button>
          <el-progress v-if="syncing" class="side-progress" :percentage="syncPercent" :stroke-width="8" :show-text="false" />
          <span v-if="syncing && syncProgress" class="using-count">{{ syncProgress }}</span>
        </div>
      </div>
      <p v-if="!miniAppId" class="hint">先选小程序。付费和付费ROI按这个小程序的事件资产统计，添加事件也只补这一份。</p>
      <p v-if="authReady && !authorized" class="hint">请先在「授权」里完成巨量授权，才能读取和添加事件。</p>

    <div class="page-table-box">
      <el-table
        ref="tableRef"
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        row-key="advertiserId"
        :empty-text="emptyText"
        :header-cell-style="{ 'text-align': 'center' }"
        @selection-change="onSelect"
      >
        <el-table-column type="selection" width="46" align="center" fixed="left" reserve-selection />
        <el-table-column label="账户名称" min-width="220" fixed="left">
          <template #default="{ row }">
            <div class="name-cell">
              <img v-if="row.avatarUrl" class="account-avatar" :src="row.avatarUrl" referrerpolicy="no-referrer" alt="" @error="row.avatarUrl = ''" />
              <el-avatar v-else :size="32">{{ nameInitial(row.name) }}</el-avatar>
              <span class="name-text" :title="row.name">{{ row.name || "—" }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="主体" width="110" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.subject || "—" }}</template>
        </el-table-column>
        <el-table-column label="账户ID" width="180" align="center">
          <template #default="{ row }">
            <span class="copy-id" title="点击复制" @click="copyText(row.advertiserId)">{{ row.advertiserId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="事件资产" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="statusOf(row).syncing" class="evt wait">同步中</span>
            <span v-else-if="statusOf(row).pending" class="evt wait">未同步</span>
            <span v-else-if="statusOf(row).error" class="evt bad" :title="statusOf(row).error">{{ statusOf(row).error }}</span>
            <span v-else :class="{ 'evt miss': statusOf(row).foreign }" :title="assetTitle(row)">{{ assetText(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="付费" width="90" align="center">
          <template #default="{ row }">
            <span class="evt" :class="markClass(row, 'pay')">{{ markText(row, "pay") }}</span>
          </template>
        </el-table-column>
        <el-table-column label="付费ROI" width="100" align="center">
          <template #default="{ row }">
            <span class="evt" :class="markClass(row, 'roi')">{{ markText(row, "roi") }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="tableTotal" class="page-pagination-box">
      <CzPagination
        :total="tableTotal"
        v-model:page-no="pageNo"
        v-model:page-size="pageSize"
        @change="onPageChange"
      />
    </div>
    </section>

    <el-drawer v-model="detailVisible" :title="detailTitle" size="60%" destroy-on-close>
      <div v-if="advertiserId" class="event-body drawer-body" :class="{ single: !assetLoading && !filteredAssets.length }" v-loading="assetLoading">
        <aside class="asset-pane">
          <el-input v-model="assetKeyword" placeholder="资产名称 / AppID" clearable clear-icon="Close" />
          <el-radio-group v-model="shareFilter" class="share-filter">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="mine">我创建的</el-radio-button>
            <el-radio-button value="shared">被共享的</el-radio-button>
          </el-radio-group>
          <div v-if="detailError" class="hint warn">资产详情没读全：{{ detailError }}</div>
          <div v-if="truncated" class="hint warn">资产较多，只展示前 500 个。</div>
          <div v-if="assetError" class="hint warn">{{ assetError }}</div>
          <div v-else-if="!assetLoading && !filteredAssets.length" class="empty-asset">
            <p>这个账户下没有小程序事件资产</p>
            <el-button type="primary" :loading="quickAdding" @click="quickAddEvents">添加付费和付费ROI</el-button>
          </div>
          <button
            v-for="item in filteredAssets"
            :key="item.assetId"
            type="button"
            class="asset-item"
            :class="{ active: item.assetId === selectedAssetId }"
            @click="selectAsset(item.assetId)"
          >
            <span class="asset-name">{{ item.name || "未命名资产" }}</span>
            <span class="asset-meta">{{ item.microAppId || item.assetId }}</span>
            <span v-if="item.shareLabel" class="asset-share">{{ item.shareLabel }}</span>
          </button>
        </aside>
        <section v-if="filteredAssets.length" class="event-pane">
          <template v-if="selectedAsset">
            <div class="event-head">
              <div>
                <div class="event-title">{{ selectedAsset.name || "未命名资产" }}</div>
                <div class="event-facts">
                  <span>小程序 AppID {{ selectedAsset.microAppId || "—" }}</span>
                  <span>小程序资产 ID {{ selectedAsset.microAppInstanceId || "—" }}</span>
                  <span>事件资产 ID {{ selectedAsset.assetId }}</span>
                </div>
                <p v-if="selectedAsset.appForceInfo" class="hint warn">{{ selectedAsset.appForceInfo }}</p>
              </div>
              <div class="event-actions">
                <el-button type="primary" @click="openAdd">手动添加</el-button>
              </div>
            </div>
            <el-table :data="createdEvents" v-loading="eventLoading" border>
              <el-table-column prop="name" label="事件名称" min-width="140" show-overflow-tooltip />
              <el-table-column label="回传方式" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ row.trackLabels.join("、") || "—" }}</template>
              </el-table-column>
              <el-table-column label="联调状态" width="110" align="center">
                <template #default="{ row }">{{ row.debuggingLabel || "—" }}</template>
              </el-table-column>
              <el-table-column prop="createTime" label="创建时间" width="180" align="center">
                <template #default="{ row }">{{ row.createTime || "—" }}</template>
              </el-table-column>
            </el-table>
            <div v-if="!eventLoading && !createdEvents.length" class="placeholder compact">还没有事件</div>
          </template>
          <div v-else class="placeholder">从左侧选择一个事件资产</div>
        </section>
      </div>
    </el-drawer>

    <el-dialog v-model="addVisible" title="添加事件" width="520px" destroy-on-close>
      <div v-loading="availableLoading">
        <p v-if="!availableLoading && !availableEvents.length" class="hint">这个资产下没有还能添加的事件。同一资产里每个事件只能加一次。</p>
        <template v-else>
          <div class="field">
            <span class="field-label">事件</span>
            <el-select v-model="selectedEventId" placeholder="选择事件" filterable class="field-control">
              <el-option v-for="item in availableEvents" :key="item.eventId" :label="item.name" :value="item.eventId" />
            </el-select>
          </div>
          <p v-if="selectedAvailable && selectedAvailable.description" class="hint">{{ selectedAvailable.description }}</p>
          <div class="field">
            <span class="field-label">回传方式</span>
            <el-select v-model="selectedTrack" placeholder="选择回传方式" class="field-control">
              <el-option v-for="item in trackOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="!canSubmit" @click="submitEvent">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="addBatchVisible" title="批量添加事件" width="760px" :close-on-click-modal="!selectBatching" :close-on-press-escape="!selectBatching">
      <div class="add-batch-field">
        <span class="field-label">小程序</span>
        <el-select v-model="miniAppId" placeholder="小程序" class="field-control" filterable :disabled="selectBatching" @change="onMiniAppChange">
          <el-option v-for="item in visibleMiniApps" :key="item.appId" :label="miniLabel(item)" :value="item.appId" />
        </el-select>
      </div>
      <div class="add-batch-field">
        <span class="field-label">事件</span>
        <el-checkbox-group v-model="addEventNames" :disabled="selectBatching">
          <el-checkbox value="付费">付费</el-checkbox>
          <el-checkbox value="付费ROI">付费ROI</el-checkbox>
        </el-checkbox-group>
      </div>
      <el-table :data="selectedRows" border max-height="360" empty-text="还没有选择账户">
        <el-table-column label="账户名称" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name || "—" }}</template>
        </el-table-column>
        <el-table-column label="主体" width="100" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.subject || "—" }}</template>
        </el-table-column>
        <el-table-column label="账户ID" width="180" align="center">
          <template #default="{ row }">{{ row.advertiserId }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button link type="danger" :disabled="selectBatching" @click="removeSelectedAccount(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p class="lookup-note add-batch-note">已选 {{ selectedRows.length }} 个。在这里移除，表格里的勾选会一起取消。</p>
      <div v-if="selectBatching" class="add-batch-progress">
        <el-progress :percentage="selectPercent" :stroke-width="8" />
        <span>{{ selectProgress }}</span>
      </div>
      <template #footer>
        <el-button :disabled="selectBatching" @click="addBatchVisible = false">取消</el-button>
        <el-button type="primary" :loading="selectBatching" :disabled="!selectedRows.length || !addEventNames.length" @click="confirmAdd">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="failVisible" title="添加失败" width="720px">
      <el-table :data="failRows" border size="small" max-height="420">
        <el-table-column prop="accountName" label="账户" min-width="200" show-overflow-tooltip />
        <el-table-column prop="assetName" label="资产" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.assetName || "—" }}</template>
        </el-table-column>
        <el-table-column prop="eventName" label="事件" width="100">
          <template #default="{ row }">{{ row.eventName || "—" }}</template>
        </el-table-column>
        <el-table-column label="结果" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="batch-status fail">{{ row.message }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import request from "@/request"
import CzPagination from "@/components/cz-pagination/index.vue"
import { readCopyright, writeCopyright } from "../shared"

const props = defineProps({
  authorized: { type: Boolean, default: false },
  authReady: { type: Boolean, default: false },
})

const tableRef = ref(null)
const tableLoading = ref(false)
const tableData = ref([])
const tableTotal = ref(0)
const pageNo = ref(1)
const pageSize = ref(20)
const subjects = ref([])
const copyrights = ref([])
const copyrightCounts = ref({})
const miniApps = ref([])
const miniAppId = ref("")
const assetStatusOptions = [
  { value: "unsynced", label: "未同步" },
  { value: "unbound", label: "未绑定资产" },
  { value: "bound", label: "已绑定资产" },
  { value: "pay", label: "付费未添加" },
  { value: "roi", label: "付费ROI未添加" },
]
const tableParams = reactive({
  keyword: "",
  copyright: readCopyright(),
  subject: "",
  assetStatus: "",
})
const selectedRows = ref([])
const eventSync = ref({ total: 0, synced: 0, latest: "" })
const syncing = ref(false)
const stopping = ref(false)
const syncingIds = ref([])
const syncProgress = ref("")
const syncPercent = ref(0)
let syncPollTimer = 0
let syncPollLock = false
let sawSyncRunning = false
const failVisible = ref(false)
const failRows = ref([])
const quickAdding = ref(false)
let loadSeq = 0

const advertiserId = ref("")
const detailVisible = ref(false)
const detailAccount = ref(null)
const assetLoading = ref(false)
const assets = ref([])
const detailError = ref("")
const truncated = ref(false)
const assetError = ref("")
const assetKeyword = ref("")
const shareFilter = ref("all")
const selectedAssetId = ref("")
const eventLoading = ref(false)
const createdEvents = ref([])
const addVisible = ref(false)
const availableLoading = ref(false)
const availableEvents = ref([])
const selectedEventId = ref("")
const selectedTrack = ref("")
const creating = ref(false)
const selectBatching = ref(false)
const selectProgress = ref("")
const selectPercent = ref(0)
const addBatchVisible = ref(false)
const addEventNames = ref(["付费", "付费ROI"])
const batchEventNames = ["付费", "付费ROI"]

const emptyText = computed(() => (tableParams.assetStatus ? "没有符合条件的账户" : "没有正在使用的账户"))

const detailTitle = computed(() => {
  const row = detailAccount.value
  if (!row) return "事件资产"
  return row.name ? `${row.name}（${row.advertiserId}）` : row.advertiserId
})

const filteredAssets = computed(() => {
  const keyword = assetKeyword.value.trim().toLowerCase()
  return assets.value.filter((item) => {
    if (shareFilter.value === "mine" && item.shareType !== "MY_CREATIONS") return false
    if (shareFilter.value === "shared" && (!item.shareType || item.shareType === "MY_CREATIONS")) return false
    if (!keyword) return true
    const blob = `${item.name} ${item.microAppId} ${item.assetId} ${item.microAppInstanceId}`.toLowerCase()
    return blob.includes(keyword)
  })
})

const selectedAsset = computed(() => assets.value.find((item) => item.assetId === selectedAssetId.value) || null)

const selectedAvailable = computed(
  () => availableEvents.value.find((item) => item.eventId === selectedEventId.value) || null,
)

const trackOptions = computed(() => {
  const event = selectedAvailable.value
  if (!event) return []
  return event.trackTypes.map((value, index) => ({
    value,
    label: (event.trackLabels && event.trackLabels[index]) || value,
  }))
})

const canSubmit = computed(() => !!selectedEventId.value && !!selectedTrack.value && !availableLoading.value)

watch([shareFilter, assetKeyword], () => {
  const list = filteredAssets.value
  if (selectedAssetId.value && list.some((item) => item.assetId === selectedAssetId.value)) return
  selectedAssetId.value = list[0] ? list[0].assetId : ""
  createdEvents.value = []
  if (selectedAssetId.value) loadEvents()
})

watch(selectedEventId, () => {
  const options = trackOptions.value
  const preferred = options.find((item) => item.value === "MINI_PROGRAME_API")
  selectedTrack.value = (preferred || options[0] || {}).value || ""
})

onMounted(() => {
  loadMiniApps()
})

onUnmounted(() => {
  window.clearInterval(syncPollTimer)
  window.clearTimeout(missingRefillTimer)
  syncPollTimer = 0
})

const visibleMiniApps = computed(() => {
  const copyright = tableParams.copyright
  if (!copyright || copyright === "__unset__") return miniApps.value.filter((item) => !item.copyrightOwner)
  return miniApps.value.filter((item) => item.copyrightOwner === copyright)
})
const copyrightTabs = computed(() => {
  const counts = copyrightCounts.value || {}
  const names = []
  const seen = new Set()
  for (const name of ["点众", "番茄", ...copyrights.value]) {
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  const tabs = names.map((name) => ({ name, label: name }))
  if (counts[""]) tabs.push({ name: "__unset__", label: "未设置" })
  return tabs
})

function selectedMini() {
  return miniApps.value.find((item) => item.appId === miniAppId.value) || null
}

function miniLabel(item) {
  const name = item.name || item.appId
  return item.copyrightOwner ? `${name} · ${item.copyrightOwner}` : name
}

function miniPayload() {
  const item = selectedMini()
  if (!item) return null
  return { appId: item.appId, name: item.name }
}

function requireMini() {
  const payload = miniPayload()
  if (payload) return payload
  ElMessage.warning("请先选择小程序。还没有的话，到「小程序」页从巨量添加")
  return null
}

async function loadMiniApps() {
  try {
    const res = await request({ url: "/admin-api/oceanengine/mini-apps" })
    if (res.code !== 0) return
    miniApps.value = ((res.data && res.data.list) || []).filter((item) => item.copyrightOwner)
    const apps = visibleMiniApps.value
    if (!apps.some((item) => item.appId === miniAppId.value)) miniAppId.value = apps[0] ? apps[0].appId : ""
  } finally {
    await loadUsing()
    resumeSyncJob()
  }
}

function onMiniAppChange() {
  if (addBatchVisible.value) {
    pageNo.value = 1
    loadUsing()
    return
  }
  searchUsing()
}

function onCopyrightTab() {
  writeCopyright(tableParams.copyright)
  const apps = visibleMiniApps.value
  if (!apps.some((item) => item.appId === miniAppId.value)) miniAppId.value = apps[0] ? apps[0].appId : ""
  tableParams.subject = ""
  searchUsing()
}

function nameInitial(name) {
  const text = String(name || "").trim()
  return text ? text.slice(0, 1) : "账"
}

function copyText(value) {
  const text = String(value || "")
  if (!text) return
  navigator.clipboard.writeText(text).then(
    () => ElMessage.success("已复制"),
    () => ElMessage.error("复制失败"),
  )
}

function onSelect(rows) {
  selectedRows.value = rows || []
}

function searchUsing() {
  pageNo.value = 1
  tableRef.value?.clearSelection()
  loadUsing()
}

function showFailures(rows) {
  failRows.value = rows
  failVisible.value = true
}

function resetUsing() {
  tableParams.keyword = ""
  tableParams.subject = ""
  tableParams.assetStatus = ""
  searchUsing()
}

function onPageChange() {
  loadUsing()
}

function accountQuery() {
  const query = {
    keyword: tableParams.keyword,
    copyright: tableParams.copyright,
    subject: tableParams.subject,
  }
  if (miniAppId.value) query.eventAppId = miniAppId.value
  if (tableParams.assetStatus) query.assetStatus = tableParams.assetStatus
  return query
}

async function loadUsing(options = {}) {
  const seq = ++loadSeq
  if (!options.silent) tableLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/accounts/page",
      params: { ...accountQuery(), pageNo: pageNo.value, pageSize: pageSize.value },
      timeout: 30000,
    })
    if (seq !== loadSeq) return
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取账户失败")
      return
    }
    const data = res.data || {}
    tableData.value = data.list || []
    tableTotal.value = data.total || 0
    if (Array.isArray(data.subjects)) subjects.value = data.subjects
    if (Array.isArray(data.copyrights)) copyrights.value = data.copyrights
    copyrightCounts.value = data.copyrightCounts || {}
    eventSync.value = data.eventSync || { total: 0, synced: 0, latest: "" }
  } finally {
    if (seq === loadSeq) tableLoading.value = false
  }
}

async function quickAddEvents() {
  if (!advertiserId.value) return
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  if (!requireMini()) return
  quickAdding.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/events/batch",
      method: "POST",
      timeout: 300000,
      data: { advertiserIds: [advertiserId.value], eventNames: batchEventNames, ...miniPayload() },
    })
    if (res.code !== 0) {
      showFailures([{ accountName: detailTitle.value, assetName: "—", eventName: "—", message: res.msg || "添加失败", status: "fail" }])
      return
    }
    const data = res.data || {}
    const failed = (data.results || []).filter((row) => row.status === "fail")
    if (failed.length) showFailures(failed)
    else if (data.stopped) showFailures([{ accountName: detailTitle.value, assetName: "—", eventName: "—", message: data.stopped, status: "fail" }])
    else ElMessage.success(`已添加 ${data.added || 0}，跳过 ${data.skipped || 0}`)
    await loadAssets()
    await loadUsing()
  } finally {
    quickAdding.value = false
  }
}

function statusOf(row) {
  const names = Array.isArray(row.eventAssetNames) ? row.eventAssetNames : []
  const syncingRow = !row.eventSynced && syncingIds.value.includes(row.advertiserId)
  if (!row.eventSynced) return { pending: true, syncing: syncingRow, pay: false, roi: false, assetName: "", assetNames: [], matchedCount: 0, foreign: false, error: "" }
  const assetName = row.eventAssetName || ""
  return {
    pending: false,
    syncing: false,
    pay: !!row.eventPay,
    roi: !!row.eventRoi,
    assetName,
    assetNames: names,
    matchedCount: Number(row.eventMatchedCount) || 0,
    foreign: !assetName && names.length > 0,
    error: row.eventError || "",
  }
}

function assetText(row) {
  const status = statusOf(row)
  if (status.assetName) return status.matchedCount > 1 ? `${status.assetName} 等 ${status.matchedCount} 个` : status.assetName
  if (status.assetNames.length === 1) return status.assetNames[0]
  if (status.assetNames.length > 1) return `${status.assetNames[0]} 等 ${status.assetNames.length} 个`
  return "无资产"
}

function assetTitle(row) {
  const status = statusOf(row)
  const mini = selectedMini()
  const miniName = (mini && mini.name) || "当前小程序"
  if (status.assetName && status.matchedCount > 1) return `这个户有 ${status.matchedCount} 个「${miniName}」事件资产，付费和付费ROI按第一个统计`
  if (status.foreign) return `不是「${miniName}」的资产：${status.assetNames.join("、")}`
  return ""
}

function markText(row, key) {
  const status = statusOf(row)
  if (status.syncing) return "同步中"
  if (status.pending) return "未同步"
  if (status.error || status.foreign) return "—"
  return status[key] ? "已添加" : "未添加"
}

function markClass(row, key) {
  const status = statusOf(row)
  if (status.pending) return "wait"
  if (status.error || !status[key]) return "miss"
  return "ok"
}

let missingRefillTimer = 0

function matchesAssetStatus(row, status) {
  if (!status) return true
  if (status === "unsynced") return !row.eventSynced
  if (status === "unbound") return !row.eventAssetName
  if (status === "bound") return !!row.eventAssetName
  if (status === "pay") return !!row.eventSynced && !row.eventPay
  if (status === "roi") return !!row.eventSynced && !row.eventRoi
  return true
}

function applyLocalRows(list) {
  const byId = new Map((list || []).filter((item) => item && item.synced).map((item) => [item.advertiserId, item]))
  for (const row of tableData.value) {
    const item = byId.get(row.advertiserId)
    if (!item) continue
    row.eventSynced = true
    row.eventAssetId = item.assetId || ""
    row.eventAssetName = item.assetName || ""
    row.eventAssetNames = Array.isArray(item.assetNames) ? item.assetNames : []
    row.eventMatchedCount = Number(item.matchedCount) || 0
    row.eventPay = !!item.pay
    row.eventRoi = !!item.roi
    row.eventError = item.error || ""
    row.eventSyncedAt = item.syncedAt || ""
  }
  refillIfFilterMisses()
}

function refillIfFilterMisses() {
  const status = tableParams.assetStatus
  if (!status || tableData.value.every((row) => matchesAssetStatus(row, status))) return
  tableData.value = tableData.value.filter((row) => matchesAssetStatus(row, status))
  window.clearTimeout(missingRefillTimer)
  missingRefillTimer = window.setTimeout(() => {
    if (tableParams.assetStatus) loadUsing({ silent: true })
  }, 400)
}

function applyBatchResults(results) {
  const grouped = new Map()
  for (const row of results || []) {
    const advertiserId = String(row.advertiserId || "")
    if (!advertiserId) continue
    const item = grouped.get(advertiserId) || { assetId: "", assetName: "", pay: false, roi: false, error: "", ok: false }
    if (row.assetId) item.assetId = String(row.assetId)
    if (row.assetName && row.assetName !== "—") item.assetName = String(row.assetName)
    const eventName = String(row.eventName || "").replace(/\s+/g, "")
    if (row.status === "added" || row.status === "skip") {
      item.ok = true
      if (eventName === "付费") item.pay = true
      if (eventName === "付费ROI") item.roi = true
    } else if (row.status === "fail" && !item.error) {
      item.error = row.message || "添加失败"
    }
    grouped.set(advertiserId, item)
  }
  if (!grouped.size) return
  for (const row of tableData.value) {
    const item = grouped.get(String(row.advertiserId || ""))
    if (!item) continue
    row.eventSynced = true
    if (item.assetId) row.eventAssetId = item.assetId
    if (item.assetName) {
      row.eventAssetName = item.assetName
      const names = Array.isArray(row.eventAssetNames) ? row.eventAssetNames.slice() : []
      if (!names.includes(item.assetName)) names.unshift(item.assetName)
      row.eventAssetNames = names
      row.eventMatchedCount = Math.max(Number(row.eventMatchedCount) || 0, 1)
    }
    if (item.pay) row.eventPay = true
    if (item.roi) row.eventRoi = true
    row.eventError = item.ok || item.assetId ? "" : item.error
  }
  refillIfFilterMisses()
}

function showSyncProgress(job) {
  const done = job.done || 0
  const total = job.total || 0
  syncPercent.value = total ? Math.round((done / total) * 100) : 0
  syncProgress.value = job.stopRequested && job.running ? `正在停止 ${done}/${total}` : `正在同步 ${done}/${total}`
  stopping.value = !!(job.stopRequested && job.running)
  syncingIds.value = Array.isArray(job.active) ? job.active : []
}

async function refreshVisibleStatus() {
  const ids = tableData.value.map((row) => row.advertiserId).filter(Boolean)
  const appId = miniAppId.value
  if (!ids.length || !appId) return
  const res = await request({
    url: "/admin-api/oceanengine/events/local-status",
    method: "POST",
    data: { advertiserIds: ids, appId },
  })
  if (res.code === 0) applyLocalRows((res.data && res.data.list) || [])
}

function finishSyncJob(job) {
  window.clearInterval(syncPollTimer)
  syncPollTimer = 0
  sawSyncRunning = false
  syncing.value = false
  stopping.value = false
  syncingIds.value = []
  syncProgress.value = ""
  syncPercent.value = 0
  loadUsing()
  if (job.error) ElMessage.error(job.error)
  else if (job.stopped) ElMessage.warning(`已停止，完成 ${job.done || 0}/${job.total || 0}`)
  else if (job.failed) ElMessage.warning(`同步结束，${job.failed} 个账户这次没读成。已有结果的仍显示上次同步`)
  else ElMessage.success("同步完成")
}

async function pullSyncJob() {
  if (syncPollLock) return
  syncPollLock = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/events/sync/job" })
    if (res.code !== 0) return
    const job = res.data || {}
    if (job.running) {
      sawSyncRunning = true
      syncing.value = true
      showSyncProgress(job)
      if (!job.appId || job.appId === miniAppId.value) await refreshVisibleStatus()
      return
    }
    if (sawSyncRunning) finishSyncJob(job)
  } catch {
    // 这一拍没问到进度，下一秒再试
  } finally {
    syncPollLock = false
  }
}

function beginSyncPoll() {
  if (syncPollTimer) return
  pullSyncJob()
  syncPollTimer = window.setInterval(pullSyncJob, 1000)
}

async function resumeSyncJob() {
  const res = await request({ url: "/admin-api/oceanengine/events/sync/job" })
  if (res.code !== 0 || !res.data || !res.data.running) return
  sawSyncRunning = true
  syncing.value = true
  showSyncProgress(res.data)
  beginSyncPoll()
}

async function stopSync() {
  if (!syncing.value || stopping.value) return
  stopping.value = true
  const res = await request({ url: "/admin-api/oceanengine/events/sync/stop", method: "POST" })
  if (res.code !== 0) {
    stopping.value = false
    ElMessage.error(res.msg || "停止失败")
    return
  }
  showSyncProgress(res.data || {})
}

async function syncAll() {
  if (syncing.value || selectBatching.value) return
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  const mini = requireMini()
  if (!mini) return
  const picked = selectedRows.value.map((row) => row.advertiserId).filter(Boolean)
  const total = picked.length || eventSync.value.total || 0
  if (!total) {
    ElMessage.warning("当前版权方下没有正在使用的账户")
    return
  }
  const tab = copyrightTabs.value.find((item) => item.name === tableParams.copyright)
  const label = tab ? tab.label : "当前版权方"
  const scope = picked.length ? `已选的 ${picked.length} 个账户` : `${label}下全部 ${total} 个账户`
  try {
    await ElMessageBox.confirm(
      `同步${scope}。账户多的时候要几分钟，结果会留在本地。刷新页面也会继续，可以随时停止。`,
      "从巨量同步",
      { confirmButtonText: "开始同步", cancelButtonText: "取消", type: "warning" },
    )
  } catch {
    return
  }
  const res = await request({
    url: "/admin-api/oceanengine/events/sync/start",
    method: "POST",
    data: { copyright: tableParams.copyright, advertiserIds: picked, ...mini },
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "开始同步失败")
    return
  }
  sawSyncRunning = true
  syncing.value = true
  showSyncProgress(res.data || { done: 0, total, running: true })
  beginSyncPoll()
}

function openDetail(row) {
  detailAccount.value = row
  advertiserId.value = row.advertiserId
  assets.value = []
  createdEvents.value = []
  selectedAssetId.value = ""
  assetKeyword.value = ""
  shareFilter.value = "all"
  detailError.value = ""
  truncated.value = false
  assetError.value = ""
  detailVisible.value = true
  loadAssets()
}

async function loadAssets() {
  if (!advertiserId.value) return
  assetLoading.value = true
  assetError.value = ""
  try {
    const res = await request({
      url: "/admin-api/oceanengine/events/assets",
      params: { advertiserId: advertiserId.value },
      timeout: 60000,
    })
    if (res.code !== 0) {
      assets.value = []
      assetError.value = res.msg || "读取事件资产失败"
      ElMessage.error(assetError.value)
      return
    }
    const data = res.data || {}
    assets.value = data.list || []
    detailError.value = data.detailError || ""
    truncated.value = !!data.truncated
    if (!filteredAssets.value.some((item) => item.assetId === selectedAssetId.value)) {
      selectedAssetId.value = filteredAssets.value[0] ? filteredAssets.value[0].assetId : ""
    }
    if (selectedAssetId.value) await loadEvents()
    else createdEvents.value = []
  } finally {
    assetLoading.value = false
  }
}

function selectAsset(assetId) {
  if (selectedAssetId.value === assetId) return
  selectedAssetId.value = assetId
  createdEvents.value = []
  loadEvents()
}

async function loadEvents() {
  if (!advertiserId.value || !selectedAssetId.value) {
    createdEvents.value = []
    return
  }
  eventLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/events/configs",
      params: { advertiserId: advertiserId.value, assetId: selectedAssetId.value },
      timeout: 30000,
    })
    if (res.code !== 0) {
      createdEvents.value = []
      ElMessage.error(res.msg || "读取已创建事件失败")
      return
    }
    createdEvents.value = (res.data && res.data.list) || []
  } finally {
    eventLoading.value = false
  }
}

async function openAdd() {
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  if (!selectedAssetId.value) return
  addVisible.value = true
  availableLoading.value = true
  availableEvents.value = []
  selectedEventId.value = ""
  selectedTrack.value = ""
  try {
    const res = await request({
      url: "/admin-api/oceanengine/events/available",
      params: { advertiserId: advertiserId.value, assetId: selectedAssetId.value },
      timeout: 30000,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取可添加事件失败")
      return
    }
    availableEvents.value = (res.data && res.data.list) || []
    const pay = availableEvents.value.find((item) => String(item.name || "").replace(/\s+/g, "") === "付费")
    selectedEventId.value = pay ? pay.eventId : ""
  } finally {
    availableLoading.value = false
  }
}

async function submitEvent() {
  if (!canSubmit.value) return
  creating.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/events",
      method: "POST",
      timeout: 30000,
      data: {
        advertiserId: advertiserId.value,
        assetId: selectedAssetId.value,
        assetName: (selectedAsset.value && selectedAsset.value.name) || "",
        eventId: selectedEventId.value,
        trackType: selectedTrack.value,
        ...(miniPayload() || {}),
      },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "添加事件失败")
      return
    }
    ElMessage.success(`已添加${res.data && res.data.name ? `「${res.data.name}」` : "事件"}`)
    addVisible.value = false
    await loadEvents()
    await loadUsing()
  } finally {
    creating.value = false
  }
}

function chunkList(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function addInChunks(parts, onStep, eventNames = batchEventNames) {
  let added = 0
  let skipped = 0
  const failed = []
  let stopped = ""
  let done = 0
  const total = parts.reduce((sum, part) => sum + part.count, 0)
  onStep(0, total)
  for (const part of parts) {
    const res = await request({
      url: "/admin-api/oceanengine/events/batch",
      method: "POST",
      timeout: 300000,
      data: { ...part.data, eventNames },
    })
    done += part.count
    onStep(done, total)
    if (res.code !== 0) {
      failed.push({ accountName: "本批", assetName: "—", eventName: "—", message: res.msg || "添加失败", status: "fail" })
      break
    }
    const data = res.data || {}
    added += data.added || 0
    skipped += data.skipped || 0
    failed.push(...(data.results || []).filter((row) => row.status === "fail"))
    applyBatchResults(data.results)
    if (data.stopped) {
      stopped = data.stopped
      break
    }
  }
  return { added, skipped, failed, stopped, touched: done > 0 }
}

function finishAdd(result, clearSelection) {
  if (result.failed.length) showFailures(result.failed)
  else if (result.stopped) showFailures([{ accountName: "—", assetName: "—", eventName: "—", message: result.stopped, status: "fail" }])
  else {
    ElMessage.success(`已添加 ${result.added}，跳过 ${result.skipped}`)
    if (clearSelection) tableRef.value?.clearSelection()
  }
  if (result.touched) {
    loadUsing()
    if (detailVisible.value && advertiserId.value) loadAssets()
  }
}

function openAddDialog() {
  if (!selectedRows.value.length) {
    ElMessage.warning("请先勾选账户")
    return
  }
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  addEventNames.value = ["付费", "付费ROI"]
  addBatchVisible.value = true
}

function removeSelectedAccount(row) {
  tableRef.value?.toggleRowSelection(row, false)
}

async function confirmAdd() {
  const ids = selectedRows.value.map((row) => row.advertiserId).filter(Boolean)
  if (!ids.length) {
    ElMessage.warning("请先勾选账户")
    return
  }
  if (!addEventNames.value.length) {
    ElMessage.warning("请至少选择付费或付费ROI")
    return
  }
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  if (!requireMini()) return
  const eventNames = [...addEventNames.value]
  selectBatching.value = true
  selectPercent.value = 0
  selectProgress.value = `正在添加 0/${ids.length}`
  try {
    const parts = chunkList(ids, 5).map((group) => ({ count: group.length, data: { advertiserIds: group, ...miniPayload() } }))
    const result = await addInChunks(parts, (done, total) => {
      selectPercent.value = total ? Math.round((done / total) * 100) : 0
      selectProgress.value = `正在添加 ${done}/${total}`
    }, eventNames)
    finishAdd(result, true)
    if (!result.failed.length && !result.stopped) addBatchVisible.value = false
  } finally {
    selectBatching.value = false
    selectProgress.value = ""
    selectPercent.value = 0
  }
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.event-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  height: 100%;
}

.copyright-tabs {
  flex: none;
  margin-bottom: -8px;

  :deep(.el-tabs__header) {
    margin: 0;
  }

  :deep(.el-tabs__content) {
    display: none;
  }
}

.list-module {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.lookup-note {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.add-batch-field {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.add-batch-note {
  margin: 12px 0 0;
}

.add-batch-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;

  .el-progress {
    flex: 1;
  }
}

.empty-asset {
  padding: 36px 12px;
  text-align: center;
  color: var(--el-text-color-secondary);
}

.empty-asset p {
  margin: 0 0 16px;
}

.filter-bar {
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.list-side {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.side-progress {
  width: 120px;
}

.tool-actions {
  flex-wrap: wrap;
  gap: 8px;
}

.batch-table {
  flex-shrink: 0;
  margin-bottom: 12px;
}

.filter-bar {
  flex-shrink: 0;
}

.using-count {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.batch-status.added,
.evt.ok {
  color: var(--el-color-success);
}

.batch-status.skip,
.evt.wait,
.evt.miss {
  color: var(--el-text-color-secondary);
}

.batch-status.fail,
.evt.bad {
  color: var(--el-color-danger);
}

.hint {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.hint.warn {
  color: var(--el-color-warning);
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.account-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
  background: var(--el-fill-color-light);
}

.name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-id {
  cursor: pointer;
}

.copy-id:hover {
  color: var(--el-color-primary);
}

.tier {
  display: inline-block;
  min-width: 46px;
  padding: 0 6px;
  border-radius: 4px;
  font-weight: 600;
  line-height: 22px;
}

.t19 { color: #1d4ed8; background: #dbeafe; }
.t29 { color: #0f766e; background: #ccfbf1; }
.t39 { color: #15803d; background: #dcfce7; }
.t99 { color: #c2410c; background: #ffedd5; }
.t299 { color: #7e22ce; background: #f3e8ff; }
.t399 { color: #be123c; background: #ffe4e6; }
.tother { color: #475569; background: #f1f5f9; }

.placeholder {
  padding: 28px 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.placeholder.compact {
  padding: 16px 8px;
}

.drawer-body {
  height: calc(100vh - 100px);
}

.event-body {
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
}

.event-body.single {
  grid-template-columns: minmax(0, 1fr);
}

.asset-pane,
.event-pane {
  min-height: 0;
  overflow: auto;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.share-filter {
  margin: 10px 0;
}

.asset-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  margin: 0 0 8px;
  padding: 10px 12px;
  text-align: left;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  cursor: pointer;
}

.asset-item.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.asset-name {
  font-weight: 600;
}

.asset-meta,
.asset-share {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  word-break: break-all;
}

.event-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.event-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.event-title {
  font-weight: 600;
}

.event-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.field-label {
  flex: 0 0 72px;
  color: var(--el-text-color-regular);
}

.field-control {
  flex: 1;
}
</style>
