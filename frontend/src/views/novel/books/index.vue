<template>
  <div class="page-container novel-page has-toolbar novel-books">
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="书名 / 书籍ID / 作者"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <el-select
          v-model="tableParams.store"
          placeholder="书城"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option v-for="s in stores" :key="s" :label="s" :value="s" />
        </el-select>
        <el-select
          v-model="tableParams.launchStatus"
          placeholder="投放状态"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option v-for="s in LAUNCH_STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetTable">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <div class="page-table-header-left">
        <span class="today-badge">今日已导入 {{ todayInfo.imported }} 次</span>
        <el-button link type="primary" @click="recentVisible = true">最近导入</el-button>
      </div>
      <div class="page-table-header-actions">
        <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx,.csv,.txt,.json" :on-change="onImportFile">
          <el-button type="primary" :icon="$icons.Upload" :loading="importing">导入 xlsx</el-button>
        </el-upload>
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
        <el-table-column prop="name" label="书名" min-width="160" fixed="left" align="center" show-overflow-tooltip />
        <el-table-column prop="externalBookId" label="书籍ID" width="120" align="center" />
        <el-table-column prop="store" label="书城" width="88" align="center" />
        <el-table-column label="素材数" width="80" align="center">
          <template #default="{ row }">{{ row.materialCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="新素材" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.newMaterialCount" type="warning" size="small">{{ row.newMaterialCount }}</el-tag>
            <span v-else class="muted">0</span>
          </template>
        </el-table-column>
        <el-table-column label="链接数" width="80" align="center">
          <template #default="{ row }">{{ row.promoCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="投放状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.launchStatus === 'launched' ? 'success' : row.isNew ? 'warning' : 'info'" size="small">
              {{ row.launchStatus === "launched" ? "已投放" : row.isNew ? "新书" : "未投放" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="firstSeenAt" label="首次入库" width="170" align="center" />
        <el-table-column prop="lastSeenAt" label="最近见到" width="170" align="center" />
        <el-table-column label="操作" width="320" fixed="right" align="center">
          <template #default="{ row }">
            <el-button
              v-if="row.launchStatus !== 'launched'"
              type="primary"
              link
              @click="setLaunch(row, true)"
            >
              标为已投放
            </el-button>
            <el-button v-else type="primary" link @click="setLaunch(row, false)">取消投放</el-button>
            <el-button type="primary" link @click="openPromo(row)">创建链接</el-button>
            <el-button v-if="row.latestMonitor" type="primary" link @click="copyText(row.latestMonitor)">复制监测链</el-button>
            <el-button type="primary" link @click="drawerRef?.show(row.id, 'mat')">看素材</el-button>
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

    <BookDrawer ref="drawerRef" />
    <PromoCreateDialog
      v-model="promoVisible"
      :book-id="promoBookId"
      :book-name="promoBookName"
      @created="getTableData"
    />

    <el-drawer v-model="recentVisible" title="最近导入" size="420px">
      <el-timeline v-if="recentBatches.length">
        <el-timeline-item v-for="b in recentBatches" :key="b.id" :timestamp="b.createTime" placement="top">
          <div>{{ typeLabel(b.type) }} · {{ b.filename || "无文件名" }}</div>
          <div class="muted">成功 {{ b.successCount }} / {{ b.totalCount }}{{ b.failCount ? `，失败 ${b.failCount}` : "" }}</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="还没有导入记录" />
    </el-drawer>
  </div>
</template>

<script setup name="novelBooks">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import { LAUNCH_STATUS_OPTIONS, copyText, typeLabel } from "../shared"
import BookDrawer from "./book-drawer.vue"
import PromoCreateDialog from "../components/promo-create-dialog.vue"

const drawerRef = ref(null)
const stores = ref([])
const todayInfo = reactive({ imported: 0 })
const importing = ref(false)
const promoVisible = ref(false)
const promoBookId = ref("")
const promoBookName = ref("")
const recentVisible = ref(false)
const recentBatches = ref([])

const defaultTableParams = () => ({
  keyword: "",
  store: "",
  launchStatus: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/novel/books/page",
  defaultTableParams,
)

onMounted(async () => {
  getTableData()
  loadStores()
  loadToday()
  loadRecent()
})

async function loadStores() {
  const res = await request({ url: "/admin-api/novel/books/stores", method: "GET" })
  if (res.code === 0) stores.value = res.data || []
}

async function loadToday() {
  const res = await request({ url: "/admin-api/novel/sync/today", method: "GET" })
  if (res.code === 0 && res.data) todayInfo.imported = res.data.imported || 0
}

async function loadRecent() {
  const res = await request({ url: "/admin-api/novel/sync/recent", method: "GET" })
  if (res.code === 0) recentBatches.value = res.data || []
}

function openPromo(row) {
  promoBookId.value = row.id
  promoBookName.value = row.name || ""
  promoVisible.value = true
}

async function setLaunch(row, launched) {
  const res = await request({
    url: `/admin-api/novel/books/${row.id}/launch`,
    method: "PATCH",
    data: { launched },
  })
  if (res.code === 0) {
    ElMessage.success(launched ? "已标记为已投放" : "已取消投放标记")
    getTableData()
  } else {
    ElMessage.error(res.msg || "更新失败")
  }
}

async function onImportFile(file) {
  const raw = file?.raw
  if (!raw) return
  const fd = new FormData()
  fd.append("file", raw)
  importing.value = true
  try {
    const res = await request({
      url: "/admin-api/novel/books/import",
      method: "POST",
      data: fd,
      timeout: 60000,
    })
    if (res.code === 0) {
      const d = res.data || {}
      ElMessage.success(
        `导入完成：新书 ${d.newBooks || 0}、新素材 ${d.newMaterials || 0}、已存在更新 ${Number(d.updatedBooks || 0) + Number(d.updatedMaterials || 0)}`,
      )
      getTableData()
      loadStores()
      loadToday()
      loadRecent()
    } else {
      ElMessage.error(res.msg || "导入失败")
    }
  } finally {
    importing.value = false
  }
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";
</style>
