<template>
  <div class="page-container novel-page has-toolbar novel-ocean-accounts">
    <el-tabs v-model="tableParams.copyright" class="copyright-tabs" @tab-change="onCopyrightTab">
      <el-tab-pane v-for="item in copyrightTabs" :key="item.name" :name="item.name">
        <template #label>{{ item.label }}</template>
      </el-tab-pane>
    </el-tabs>
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="账户ID / 账户名称"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
          @keyup.enter="tableSearch"
        />
        <el-select v-model="tableParams.subject" placeholder="主体" class="filter-select-sm" clearable clear-icon="Close" filterable>
          <el-option v-for="item in subjects" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select v-model="tableParams.template" placeholder="充值模板" class="filter-select-sm" clearable clear-icon="Close">
          <el-option v-for="item in templates" :key="item" :label="item" :value="item" />
        </el-select>
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <div class="page-table-header-left">
        <el-button type="primary" @click="importVisible = true">从巨量导入</el-button>
        <el-button :icon="$icons.Refresh" :loading="syncing" title="只更新正在使用的账户：名称、授权状态、账户主体、所属组织、创建时间和缺失的头像" @click="syncRemote()">同步线上信息</el-button>
        <el-button v-if="selectedRows.length" :loading="syncing" @click="syncRemote(selectedIds)">同步所选</el-button>
        <el-button v-if="selectedRows.length" @click="removeUsing">移出使用</el-button>
        <el-dropdown v-if="selectedRows.length" @command="onBatchCommand">
          <el-button type="primary">
            批量操作
            <el-icon class="el-icon--right"><component :is="$icons.ArrowDown" /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="copyright">设置版权方</el-dropdown-item>
              <el-dropdown-item command="rename">修改名称</el-dropdown-item>
              <el-dropdown-item command="avatar">更换头像</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div class="page-table-header-actions">
        <span class="batch-selected">正在使用 {{ usingTotal }} 个</span>
        <span v-if="selectedRows.length" class="batch-selected">已选 {{ selectedRows.length }} 个</span>
      </div>
    </div>

    <div class="page-table-box table-wrap">
      <el-table
        ref="tableRef"
        :data="tableData"
        v-loading="tableLoading || syncing || avatarSaving"
        border
        height="100%"
        row-key="advertiserId"
        :header-cell-style="{ 'text-align': 'center' }"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="46" align="center" fixed="left" reserve-selection />
        <el-table-column label="账户名称" min-width="220" fixed="left">
          <template #default="{ row }">
            <div class="name-cell">
            <img
              v-if="row.avatarUrl"
              class="account-avatar"
              :src="row.avatarUrl"
              referrerpolicy="no-referrer"
              alt=""
              @error="row.avatarUrl = ''"
            />
            <el-avatar v-else :size="32">{{ nameInitial(row.name) }}</el-avatar>
              <span class="name-text" :title="row.name">{{ row.name || "—" }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="主体" width="120" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.subject || "—" }}</template>
        </el-table-column>
        <el-table-column label="充值模板" width="100" align="center">
          <template #default="{ row }">
            <span v-if="row.template" class="tier" :class="tierClass(row.template)">{{ row.template }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column width="80" align="center">
          <template #header>
            <span title="按充值模板换算：1.9→2.1，2.9→3.1，3.9→4.1，9.9→13，29.9→31，39.9→41">出价</span>
          </template>
          <template #default="{ row }">
            <span v-if="row.bid" class="tier" :class="tierClass(row.template)">{{ row.bid }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="advertiserId" label="账户ID" width="180" align="center">
          <template #default="{ row }">
            <span class="copy-id" title="点击复制" @click="copyText(row.advertiserId)">{{ row.advertiserId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="授权状态" width="110" align="center">
          <template #default="{ row }">
            <span class="auth-dot" :class="{ off: row.statusLabel === '已禁用' }" />
            {{ row.statusLabel || "已授权" }}
          </template>
        </el-table-column>
        <el-table-column prop="company" label="账户主体" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.company || "—" }}</template>
        </el-table-column>
        <el-table-column prop="orgName" label="所属组织" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.orgName || row.orgId || "—" }}</template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="180" align="center">
          <template #default="{ row }">{{ row.createTime || "—" }}</template>
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

    <el-dialog v-model="copyrightVisible" title="设置版权方" width="420px">
      <p class="import-hint">巨量账户上没有版权方。这里记在本系统，用来区分这些户在投哪个版权方。</p>
      <el-select v-model="copyrightOwner" filterable allow-create default-first-option placeholder="选择或填写，例如番茄" style="width: 100%">
        <el-option v-for="item in copyrightChoices" :key="item" :label="item" :value="item" />
      </el-select>
      <template #footer>
        <el-button @click="copyrightVisible = false">取消</el-button>
        <el-button type="primary" :loading="copyrightSaving" @click="saveCopyright">保存</el-button>
      </template>
    </el-dialog>
    <AccountRenameDialog v-model="renameVisible" :accounts="selectedRows" @done="afterBatch" />
    <CzImageCropperModal
      v-model="avatarVisible"
      title="更换头像"
      accept=".jpg,.jpeg,.png,.bmp"
      :max-size="5"
      :target-width="300"
      :target-height="300"
      output-type="image/jpeg"
      @success="applyAvatar"
    />
    <el-dialog v-model="importVisible" title="从巨量导入" width="920px">
      <p class="import-hint">按巨量当前账户搜索，结果和后台一致。勾选后导入，或把这次搜索到的全部导入。</p>
      <div class="import-bar">
        <el-input v-model="poolKeyword" placeholder="账户名称，例如点众小说" clearable clear-icon="Close" @keyup.enter="searchOcean(1)" />
        <el-button type="primary" :loading="poolLoading" @click="searchOcean(1)">搜索</el-button>
        <el-button :loading="importing" :disabled="!poolTotal" @click="importMatched">全选并导入</el-button>
      </div>
      <el-table
        ref="poolTableRef"
        :data="poolRows"
        v-loading="poolLoading"
        border
        height="360"
        row-key="advertiserId"
        @selection-change="onPoolSelect"
      >
        <el-table-column type="selection" width="46" align="center" :selectable="(row) => !row.inUse" reserve-selection />
        <el-table-column prop="name" label="账户名称" min-width="240" show-overflow-tooltip />
        <el-table-column label="主体" width="110" align="center">
          <template #default="{ row }">{{ row.subject || "—" }}</template>
        </el-table-column>
        <el-table-column label="充值模板" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.template" class="tier" :class="tierClass(row.template)">{{ row.template }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="出价" width="70" align="center">
          <template #default="{ row }">
            <span v-if="row.bid" class="tier" :class="tierClass(row.template)">{{ row.bid }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">{{ row.inUse ? "已使用" : "未导入" }}</template>
        </el-table-column>
        <el-table-column prop="advertiserId" label="账户ID" width="170" align="center" />
      </el-table>
      <div class="import-foot">
        <span>巨量共 {{ poolTotal }} 个</span>
        <el-pagination
          v-if="poolTotal"
          layout="prev, pager, next"
          :total="poolTotal"
          :page-size="poolPageSize"
          :current-page="poolPage"
          @current-change="searchOcean"
        />
      </div>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" :loading="importing" :disabled="!poolSelected.length" @click="importSelected">导入所选</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup name="novelOceanAccounts">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import CzImageCropperModal from "@/components/cz-image-cropper-modal/index.vue"
import request from "@/request"
import AccountRenameDialog from "./account-rename-dialog.vue"

const tableRef = ref(null)
const syncing = ref(false)
const avatarSaving = ref(false)
const renameVisible = ref(false)
const avatarVisible = ref(false)
const selectedRows = ref([])
const subjects = ref([])
const templates = ref([])
const copyrights = ref([])
const copyrightCounts = ref({})
const copyrightVisible = ref(false)
const copyrightOwner = ref("")
const copyrightSaving = ref(false)
const copyrightPresets = ["点众", "番茄", "凤娱"]
const usingTotal = ref(0)
const importVisible = ref(false)
const importing = ref(false)
const poolTableRef = ref(null)
const poolKeyword = ref("")
const poolLoading = ref(false)
const poolRows = ref([])
const poolTotal = ref(0)
const poolPage = ref(1)
const poolPageSize = 20
const poolSelected = ref([])

const defaultTableParams = () => ({
  keyword: "",
  subject: "",
  template: "",
  copyright: "点众",
  scope: "using",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch } = useTable(
  "/admin-api/oceanengine/accounts/page",
  defaultTableParams,
  {
    timeout: 30000,
    onSuccess(data, ctx) {
      ctx.tableData.value = (data && data.list) || []
      ctx.tableTotal.value = (data && data.total) || 0
      usingTotal.value = (data && data.usingTotal) || 0
      if (Array.isArray(data && data.subjects)) subjects.value = data.subjects
      if (Array.isArray(data && data.templates)) templates.value = data.templates
      if (Array.isArray(data && data.copyrights)) copyrights.value = data.copyrights
      copyrightCounts.value = (data && data.copyrightCounts) || {}
    },
  },
)

onMounted(() => {
  getTableData()
})

function handleSelectionChange(rows) {
  selectedRows.value = rows || []
}

const selectedIds = computed(() => selectedRows.value.map((row) => row.advertiserId).filter(Boolean))
const copyrightChoices = computed(() => [...new Set([...copyrightPresets, ...copyrights.value])])
const copyrightTabs = computed(() => {
  const counts = copyrightCounts.value || {}
  const names = []
  const seen = new Set()
  for (const name of [...copyrightPresets, ...copyrights.value, ...Object.keys(counts)]) {
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  const tabs = names.map((name) => ({ name, label: name, count: counts[name] || 0 }))
  if (counts[""]) tabs.push({ name: "__unset__", label: "未设置", count: counts[""] })
  return tabs
})

function onCopyrightTab() {
  tableParams.pageNo = 1
  tableParams.subject = ""
  tableParams.template = ""
  tableRef.value?.clearSelection()
  getTableData()
}

function resetFilters() {
  tableParams.keyword = ""
  tableParams.subject = ""
  tableParams.template = ""
  tableParams.pageNo = 1
  getTableData()
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

function tierClass(template) {
  return (
    {
      "1.9": "t19",
      "2.9": "t29",
      "3.9": "t39",
      "9.9": "t99",
      "29.9": "t299",
      "39.9": "t399",
    }[String(template)] || "tother"
  )
}

async function removeUsing() {
  const ids = selectedRows.value.map((row) => row.advertiserId).filter(Boolean)
  if (!ids.length) return
  const res = await request({
    url: "/admin-api/oceanengine/accounts/using",
    method: "POST",
    data: { advertiserIds: ids, using: false },
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "移出失败")
    return
  }
  ElMessage.success(`已移出 ${res.data?.count || ids.length} 个`)
  tableRef.value?.clearSelection()
  await getTableData()
}

async function searchOcean(page) {
  const keyword = poolKeyword.value.trim()
  if (keyword.length < 2) {
    ElMessage.warning("请输入至少两个字")
    return
  }
  poolPage.value = page || 1
  poolLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/accounts/ocean-search",
      params: { keyword, pageNo: poolPage.value, pageSize: poolPageSize },
      timeout: 30000,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "搜索失败")
      return
    }
    poolRows.value = (res.data && res.data.list) || []
    poolTotal.value = (res.data && res.data.total) || 0
    poolTableRef.value?.clearSelection()
  } finally {
    poolLoading.value = false
  }
}

function onPoolSelect(rows) {
  poolSelected.value = rows || []
}

async function finishImport(data) {
  importing.value = true
  ElMessage.info("正在从巨量导入，请稍等")
  try {
    const res = await request({
      url: "/admin-api/oceanengine/accounts/ocean-import",
      method: "POST",
      timeout: 180000,
      data,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "导入失败")
      return
    }
    const count = res.data?.count || 0
    ElMessage.success(res.data?.warning ? `已导入 ${count} 个，后面有一页没拉完` : `已导入 ${count} 个`)
    importVisible.value = false
    await getTableData()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || "导入失败")
  } finally {
    importing.value = false
  }
}

function importSelected() {
  finishImport({
    accounts: poolSelected.value.map((row) => ({ advertiserId: row.advertiserId, name: row.name })),
  })
}

function importMatched() {
  finishImport({ keyword: poolKeyword.value.trim() })
}

function onBatchCommand(command) {
  if (!selectedRows.value.length) {
    ElMessage.warning("请先选择账户")
    return
  }
  if (command === "rename") renameVisible.value = true
  if (command === "avatar") avatarVisible.value = true
  if (command === "copyright") {
    copyrightOwner.value = copyrights.value[0] || copyrightPresets[0]
    copyrightVisible.value = true
  }
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function syncRemote(ids) {
  syncing.value = true
  const selected = Array.isArray(ids) && ids.length
  ElMessage.info(selected ? "正在同步所选账户" : "正在同步正在使用的账户")
  try {
    const res = await request({
      url: "/admin-api/oceanengine/accounts/sync",
      method: "POST",
      timeout: 180000,
      data: selected ? { advertiserIds: ids } : {},
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "同步失败")
      return
    }
    ElMessage.success(`已同步 ${res.data?.count || 0} 个账户的线上信息`)
    if (res.data?.needScope) ElMessage.warning("部分详情或头像接口没有权限")
    if (selected) tableRef.value?.clearSelection()
    await getTableData()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || "同步失败")
  } finally {
    syncing.value = false
  }
}

async function saveCopyright() {
  const name = copyrightOwner.value.trim()
  if (!name) {
    ElMessage.warning("请填写版权方")
    return
  }
  copyrightSaving.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/accounts/copyright",
      method: "POST",
      data: { advertiserIds: selectedIds.value, copyrightOwner: name },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "设置失败")
      return
    }
    ElMessage.success(`已把 ${res.data?.count || selectedIds.value.length} 个账户标为${name}`)
    copyrightVisible.value = false
    tableRef.value?.clearSelection()
    await getTableData()
  } finally {
    copyrightSaving.value = false
  }
}

async function applyAvatar(url) {
  const ids = selectedRows.value.map((row) => row.advertiserId).filter(Boolean)
  if (!ids.length) {
    ElMessage.warning("请先选择账户")
    return
  }
  avatarSaving.value = true
  try {
    let success = 0
    let fail = 0
    const errors = []
    for (const part of chunk(ids, 30)) {
      const res = await request({
        url: "/admin-api/oceanengine/accounts/avatar",
        method: "POST",
        timeout: 180000,
        data: { imageUrl: url, advertiserIds: part },
      })
      if (res.code !== 0) {
        ElMessage.error(res.msg || "更换头像失败")
        return
      }
      const data = res.data || {}
      success += Number(data.success) || 0
      fail += Number(data.fail) || 0
      for (const item of data.results || []) {
        if (!item.ok && item.error) errors.push(`${item.advertiserId}：${item.error}`)
      }
    }
    if (fail) ElMessage.warning(`成功 ${success} 个，失败 ${fail} 个`)
    else ElMessage.success(`已更换 ${success} 个账户头像`)
    if (errors.length && errors.length <= 5) ElMessage.warning(errors.join("；"))
    await afterBatch()
  } finally {
    avatarSaving.value = false
  }
}

async function afterBatch() {
  await getTableData()
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.batch-selected {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.novel-ocean-accounts.page-container {
  padding-top: 0;
}

.copyright-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 12px;
  }

  :deep(.el-tabs__content) {
    display: none;
  }
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

.auth-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--el-color-success);
  vertical-align: middle;
}

.auth-dot.off {
  background: var(--el-color-info);
}

.novel-ocean-accounts :deep(.filter-input-keyword.el-input) {
  width: 240px;
}

.import-hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.import-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.import-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.import-bar .el-input {
  flex: 1;
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
</style>
