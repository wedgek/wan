<template>
  <div class="event-panel">
    <section class="module">
      <el-input
        v-model="batchText"
        type="textarea"
        :rows="3"
        placeholder="一行一个，可以是账户 ID，也可以是账户名称"
      />
      <div class="module-actions">
        <el-button type="primary" :loading="pasteBatching" @click="addPasted">添加事件</el-button>
        <el-tag type="primary" effect="plain">付费</el-tag>
        <el-tag type="primary" effect="plain">付费ROI</el-tag>
        <el-progress v-if="pasteBatching" class="side-progress" :percentage="pastePercent" :stroke-width="8" :show-text="false" />
        <span v-if="pasteProgress" class="hint inline">{{ pasteProgress }}</span>
        <span class="actions-spacer" />
        <el-button :icon="$icons.Search" @click="lookupVisible = true">查询线上账户</el-button>
      </div>
    </section>

    <section class="module list-module">
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
          <el-select v-model="tableParams.copyright" placeholder="版权方" class="filter-select-sm" clearable clear-icon="Close">
            <el-option v-for="item in copyrights" :key="item" :label="item" :value="item" />
          </el-select>
          <el-select v-model="tableParams.subject" placeholder="主体" class="filter-select-sm" clearable clear-icon="Close" filterable>
            <el-option v-for="item in subjects" :key="item" :label="item" :value="item" />
          </el-select>
          <el-button type="primary" @click="searchUsing">查询</el-button>
          <el-button @click="resetUsing">重置</el-button>
        </div>
        <div class="page-filter-right list-side">
          <el-checkbox v-model="onlyMissing" @change="onOnlyMissing">只看未绑定资产</el-checkbox>
          <span v-if="selectedRows.length" class="using-count">已选 {{ selectedRows.length }}</span>
          <el-button type="primary" :loading="selectBatching" @click="addSelected">批量添加事件</el-button>
          <el-progress v-if="selectBatching" class="side-progress" :percentage="selectPercent" :stroke-width="8" :show-text="false" />
          <span v-if="selectProgress" class="using-count">{{ selectProgress }}</span>
        </div>
      </div>
      <p v-if="authReady && !authorized" class="hint">请先在「授权」里完成巨量授权，才能读取和添加事件。</p>

    <div class="page-table-box">
      <el-table
        ref="tableRef"
        :data="shownRows"
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
        <el-table-column label="版权方" width="100" align="center">
          <template #default="{ row }">{{ row.copyrightOwner || "—" }}</template>
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
            <span v-if="statusOf(row).loading" class="evt wait">读取中</span>
            <span v-else-if="statusOf(row).error" class="evt bad" :title="statusOf(row).error">{{ statusOf(row).error }}</span>
            <span v-else>{{ statusOf(row).assetName || "无资产" }}</span>
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

    <el-dialog v-model="lookupVisible" title="查询线上账户" width="820px">
      <p class="lookup-note">按账户 ID 或名称查巨量上的户有没有绑定事件资产。正在使用的户、还没导入的户都可以。</p>
      <div class="lookup-bar">
        <el-input
          v-model="lookupText"
          type="textarea"
          :rows="4"
          placeholder="账户 ID 或名称，多个用换行或逗号分开"
        />
        <el-button type="primary" :icon="$icons.Search" :loading="lookupLoading" @click="runLookup">查询</el-button>
      </div>
      <el-table :data="lookupRows" v-loading="lookupLoading" border class="lookup-table" max-height="320" :empty-text="lookupEmpty">
        <el-table-column label="账户" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name ? `${row.name}（${row.advertiserId || "—"}）` : row.advertiserId || "—" }}</template>
        </el-table-column>
        <el-table-column label="事件资产" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.error" class="evt bad">{{ row.error }}</span>
            <span v-else>{{ row.assetName || "无资产" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="付费" width="90" align="center">
          <template #default="{ row }">{{ row.error ? "—" : row.pay ? "已添加" : "未添加" }}</template>
        </el-table-column>
        <el-table-column label="付费ROI" width="100" align="center">
          <template #default="{ row }">{{ row.error ? "—" : row.roi ? "已添加" : "未添加" }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button v-if="row.advertiserId" link type="primary" @click="openLookupDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
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
const tableParams = reactive({
  keyword: "",
  copyright: "",
  subject: "",
})
const onlyMissing = ref(false)
const selectedRows = ref([])
const eventStatus = ref({})
const lookupVisible = ref(false)
const lookupText = ref("")
const lookupLoading = ref(false)
const lookupRows = ref([])
const lookupSearched = ref(false)
const failVisible = ref(false)
const failRows = ref([])
const quickAdding = ref(false)
let statusSeq = 0
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
const batchText = ref("")
const pasteBatching = ref(false)
const selectBatching = ref(false)
const pasteProgress = ref("")
const selectProgress = ref("")
const pastePercent = ref(0)
const selectPercent = ref(0)
const batchEventNames = ["付费", "付费ROI"]

const emptyText = computed(() => (onlyMissing.value ? "这一页没有未绑定事件资产的户" : "没有正在使用的账户"))
const shownRows = computed(() => {
  if (!onlyMissing.value) return tableData.value
  return tableData.value.filter((row) => {
    const status = eventStatus.value[row.advertiserId]
    if (!status || status.loading || status.error) return true
    return !status.assetName
  })
})

const lookupEmpty = computed(() => (lookupSearched.value ? "没有查到账户" : "输入账户后点查询"))

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
  loadUsing()
})

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

function onOnlyMissing() {
  tableRef.value?.clearSelection()
}

function showFailures(rows) {
  failRows.value = rows
  failVisible.value = true
}

function resetUsing() {
  tableParams.keyword = ""
  tableParams.copyright = ""
  tableParams.subject = ""
  onlyMissing.value = false
  searchUsing()
}

function onPageChange() {
  loadUsing()
}

function accountQuery() {
  return {
    keyword: tableParams.keyword,
    copyright: tableParams.copyright,
    subject: tableParams.subject,
  }
}

async function loadUsing() {
  const seq = ++loadSeq
  tableLoading.value = true
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
    loadEventStatus(tableData.value)
  } finally {
    if (seq === loadSeq) tableLoading.value = false
  }
}

async function findLookupAccount(keyword) {
  const local = await request({
    url: "/admin-api/oceanengine/accounts/page",
    params: { keyword, pageNo: 1, pageSize: 20 },
    timeout: 30000,
  })
  const list = local.code === 0 ? local.data?.list || [] : []
  const exact = list.find((row) => row.name === keyword || row.advertiserId === keyword)
  if (exact) return { advertiserId: exact.advertiserId, name: exact.name || "" }
  if (list.length === 1) return { advertiserId: list[0].advertiserId, name: list[0].name || "" }
  if (keyword.length < 2) return null
  const ocean = await request({
    url: "/admin-api/oceanengine/accounts/ocean-search",
    params: { keyword, pageNo: 1, pageSize: 10 },
    timeout: 30000,
  })
  const oceanList = ocean.code === 0 ? ocean.data?.list || [] : []
  const hit = oceanList.find((row) => row.name === keyword) || (oceanList.length === 1 ? oceanList[0] : null)
  if (!hit) return null
  return { advertiserId: hit.advertiserId, name: hit.name || "" }
}

async function runLookup() {
  const raw = lookupText.value.trim()
  if (!raw) {
    ElMessage.warning("请输入账户 ID 或名称")
    return
  }
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  lookupLoading.value = true
  lookupSearched.value = true
  lookupRows.value = []
  try {
    const tokens = [...new Set(raw.split(/[\r\n,，;；]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 20)
    const accounts = []
    for (const token of tokens) {
      if (/^\d{8,}$/.test(token)) {
        accounts.push({ advertiserId: token, name: "" })
        continue
      }
      const found = await findLookupAccount(token)
      accounts.push(found || { advertiserId: "", name: token, error: "没有找到这个账户" })
    }
    const ids = accounts.map((item) => item.advertiserId).filter(Boolean)
    const byId = new Map()
    if (ids.length) {
      const res = await request({
        url: "/admin-api/oceanengine/events/status",
        method: "POST",
        timeout: 120000,
        data: { advertiserIds: ids },
      })
      if (res.code !== 0) {
        ElMessage.error(res.msg || "查询失败")
        return
      }
      for (const item of (res.data && res.data.list) || []) byId.set(item.advertiserId, item)
    }
    lookupRows.value = accounts.map((account) => {
      if (!account.advertiserId) return { ...account, assetName: "", pay: false, roi: false }
      const item = byId.get(account.advertiserId) || {}
      return {
        advertiserId: account.advertiserId,
        name: account.name || "",
        assetName: item.assetName || "",
        error: item.error || "",
        pay: !!item.pay,
        roi: !!item.roi,
      }
    })
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || "查询失败")
  } finally {
    lookupLoading.value = false
  }
}

function openLookupDetail(row) {
  lookupVisible.value = false
  openDetail(row)
}

async function quickAddEvents() {
  if (!advertiserId.value) return
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  quickAdding.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/events/batch",
      method: "POST",
      timeout: 300000,
      data: { advertiserIds: [advertiserId.value], eventNames: batchEventNames },
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
    loadEventStatus([{ advertiserId: advertiserId.value }])
  } finally {
    quickAdding.value = false
  }
}

function statusOf(row) {
  return eventStatus.value[row.advertiserId] || { loading: !props.authReady || props.authorized, pay: false, roi: false, assetName: "", error: "" }
}

function markText(row, key) {
  const status = statusOf(row)
  if (status.loading) return "读取中"
  if (status.error) return "—"
  return status[key] ? "已添加" : "未添加"
}

function markClass(row, key) {
  const status = statusOf(row)
  if (status.loading) return "wait"
  if (status.error || !status[key]) return "miss"
  return "ok"
}

async function loadEventStatus(rows) {
  const ids = (rows || []).map((row) => row.advertiserId).filter(Boolean)
  const seq = ++statusSeq
  if (!ids.length) return
  if (props.authReady && !props.authorized) {
    const next = { ...eventStatus.value }
    for (const id of ids) next[id] = { loading: false, pay: false, roi: false, assetName: "", error: "请先完成巨量授权" }
    eventStatus.value = next
    return
  }
  const pending = { ...eventStatus.value }
  for (const id of ids) {
    pending[id] = { ...(pending[id] || {}), loading: true, error: "" }
  }
  eventStatus.value = pending
  try {
    const merged = []
    for (let i = 0; i < ids.length; i += 20) {
      const res = await request({
        url: "/admin-api/oceanengine/events/status",
        method: "POST",
        timeout: 120000,
        data: { advertiserIds: ids.slice(i, i + 20) },
      })
      if (seq !== statusSeq) return
      if (res.code !== 0) {
        const failed = { ...eventStatus.value }
        for (const id of ids) failed[id] = { loading: false, pay: false, roi: false, assetName: "", error: res.msg || "读取事件失败" }
        eventStatus.value = failed
        return
      }
      merged.push(...((res.data && res.data.list) || []))
    }
    if (seq !== statusSeq) return
    const next = { ...eventStatus.value }
    for (const item of merged) {
      next[item.advertiserId] = {
        loading: false,
        pay: !!item.pay,
        roi: !!item.roi,
        assetId: item.assetId || "",
        assetName: item.assetName || "",
        error: item.error || "",
      }
    }
    eventStatus.value = next
  } catch (e) {
    if (seq !== statusSeq) return
    const failed = { ...eventStatus.value }
    const message = e?.response?.data?.msg || e?.message || "读取事件失败"
    for (const id of ids) failed[id] = { loading: false, pay: false, roi: false, assetName: "", error: message }
    eventStatus.value = failed
  }
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
        eventId: selectedEventId.value,
        trackType: selectedTrack.value,
      },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "添加事件失败")
      return
    }
    ElMessage.success(`已添加${res.data && res.data.name ? `「${res.data.name}」` : "事件"}`)
    addVisible.value = false
    await loadEvents()
    loadEventStatus(tableData.value.filter((row) => row.advertiserId === advertiserId.value))
  } finally {
    creating.value = false
  }
}

function splitAccountLines(text) {
  const seen = new Set()
  const lines = []
  for (const part of String(text || "").split(/[\r\n,，;；]+/)) {
    const line = part.trim()
    if (!line) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(line)
  }
  return lines
}

function chunkList(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function addInChunks(parts, onStep) {
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
      data: { ...part.data, eventNames: batchEventNames },
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
    loadEventStatus(tableData.value)
    if (detailVisible.value && advertiserId.value) loadAssets()
  }
}

async function addPasted() {
  const lines = splitAccountLines(batchText.value)
  if (!lines.length) {
    ElMessage.warning("请先粘贴账户")
    return
  }
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  pasteBatching.value = true
  pastePercent.value = 0
  pasteProgress.value = `正在添加 0/${lines.length}`
  try {
    const parts = chunkList(lines, 5).map((group) => ({ count: group.length, data: { text: group.join("\n") } }))
    const result = await addInChunks(parts, (done, total) => {
      pastePercent.value = total ? Math.round((done / total) * 100) : 0
      pasteProgress.value = `正在添加 ${done}/${total}`
    })
    finishAdd(result, false)
  } finally {
    pasteBatching.value = false
    pasteProgress.value = ""
    pastePercent.value = 0
  }
}

async function addSelected() {
  const ids = selectedRows.value.map((row) => row.advertiserId).filter(Boolean)
  if (!ids.length) {
    ElMessage.warning("请先勾选账户")
    return
  }
  if (props.authReady && !props.authorized) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return
  }
  selectBatching.value = true
  selectPercent.value = 0
  selectProgress.value = `正在添加 0/${ids.length}`
  try {
    const parts = chunkList(ids, 5).map((group) => ({ count: group.length, data: { advertiserIds: group } }))
    const result = await addInChunks(parts, (done, total) => {
      selectPercent.value = total ? Math.round((done / total) * 100) : 0
      selectProgress.value = `正在添加 ${done}/${total}`
    })
    finishAdd(result, true)
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
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.module {
  flex-shrink: 0;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.list-module {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.module-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.actions-spacer {
  flex: 1;
}

.lookup-note {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.lookup-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.lookup-bar .el-textarea {
  width: 100%;
}

.lookup-table {
  margin-top: 20px;
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

.using-count,
.hint.inline {
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
