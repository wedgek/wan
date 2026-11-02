<template>
  <div class="page-container novel-page has-toolbar novel-ocean-accounts">
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
        <el-select
          v-model="tableParams.company"
          placeholder="账户主体"
          class="filter-select"
          clearable
          clear-icon="Close"
          filterable
        >
          <el-option v-for="item in companies" :key="item" :label="item" :value="item" />
        </el-select>
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetTable">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <div class="page-table-header-left">
        <el-button :icon="$icons.Refresh" :loading="syncing" @click="syncRemote">从巨量同步</el-button>
        <el-dropdown v-if="selectedRows.length" @command="onBatchCommand">
          <el-button type="primary">
            批量操作
            <el-icon class="el-icon--right"><component :is="$icons.ArrowDown" /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="rename">修改名称</el-dropdown-item>
              <el-dropdown-item command="avatar">更换头像</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div v-if="selectedRows.length" class="page-table-header-actions">
        <span class="batch-selected">已选 {{ selectedRows.length }} 个</span>
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
              <el-avatar :size="32" :src="row.avatarUrl || undefined">{{ nameInitial(row.name) }}</el-avatar>
              <span class="name-text" :title="row.name">{{ row.name || "—" }}</span>
            </div>
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
const companies = ref([])

const defaultTableParams = () => ({
  keyword: "",
  company: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/oceanengine/accounts/page",
  defaultTableParams,
  {
    timeout: 30000,
    onSuccess(data, ctx) {
      ctx.tableData.value = (data && data.list) || []
      ctx.tableTotal.value = (data && data.total) || 0
      if (Array.isArray(data && data.companies)) companies.value = data.companies
    },
  },
)

onMounted(() => {
  getTableData()
})

function handleSelectionChange(rows) {
  selectedRows.value = rows || []
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

function onBatchCommand(command) {
  if (!selectedRows.value.length) {
    ElMessage.warning("请先选择账户")
    return
  }
  if (command === "rename") renameVisible.value = true
  if (command === "avatar") avatarVisible.value = true
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

async function syncRemote() {
  syncing.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/accounts/sync",
      method: "POST",
      timeout: 180000,
      data: {},
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "同步失败")
      return
    }
    ElMessage.success(`已同步 ${res.data?.count || 0} 个账户`)
    if (res.data?.needScope) ElMessage.warning("部分详情接口没有权限，已先写入账户名称")
    tableRef.value?.clearSelection()
    await getTableData()
  } finally {
    syncing.value = false
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

.name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
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
</style>
