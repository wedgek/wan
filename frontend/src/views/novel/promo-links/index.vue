<template>
  <div class="page-container novel-page has-toolbar novel-promo">
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="书名 / 书籍ID / 推广ID / 添量渠道"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <el-select
          v-model="tableParams.channel"
          placeholder="投放账号"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option v-for="c in channels" :key="c.id" :label="c.label" :value="c.id" />
        </el-select>
        <el-date-picker
          v-model="createRange"
          class="filter-date"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="创建起"
          end-placeholder="创建止"
          clearable
          clear-icon="Close"
        />
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetAll">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <el-button type="primary" @click="batchVisible = true">批量打链接</el-button>
      <el-button :icon="$icons.Refresh" :loading="refreshing" @click="refreshRemote">从点众刷新</el-button>
    </div>

    <div class="page-table-box table-wrap">
      <el-table
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        :header-cell-style="{ 'text-align': 'center' }"
      >
        <el-table-column prop="referralId" label="推广ID" width="120" align="center">
          <template #default="{ row }">{{ row.referralId || "—" }}</template>
        </el-table-column>
        <el-table-column label="书名" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bookName || "—" }}</template>
        </el-table-column>
        <el-table-column label="书 ID" width="140" align="center">
          <template #default="{ row }">{{ row.externalBookId || "—" }}</template>
        </el-table-column>
        <el-table-column label="充值模板" width="96" align="center">
          <template #default="{ row }">{{ row.rechargeName || "—" }}</template>
        </el-table-column>
        <el-table-column label="启动页面" min-width="200">
          <template #default="{ row }">
            <div v-if="row.launchPage" class="copy-cell">
              <span class="copy-text" :title="row.launchPage">{{ row.launchPage }}</span>
              <el-button type="primary" link @click="copyText(row.launchPage)">复制</el-button>
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="启动参数" min-width="260">
          <template #default="{ row }">
            <div v-if="row.launchQuery" class="copy-cell">
              <span class="copy-text" :title="row.launchQuery">{{ row.launchQuery }}</span>
              <el-button type="primary" link @click="copyText(row.launchQuery)">复制</el-button>
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="添量渠道" min-width="210" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name || "—" }}</template>
        </el-table-column>
        <el-table-column label="推广链接" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.path || "—" }}</template>
        </el-table-column>
        <el-table-column label="投放账号" width="110" align="center">
          <template #default="{ row }">{{ channelLabel(row.channel, channels) }}</template>
        </el-table-column>
        <el-table-column label="媒体" width="80" align="center">
          <template #default="{ row }">{{ mediaSourceLabel(row.mediaSource) }}</template>
        </el-table-column>
        <el-table-column label="充值" width="100" align="center">
          <template #default="{ row }">
            <span :title="row.snapDate ? `书籍快照 ${row.snapDate}` : ''">{{ fmtNum(row.rechargeAmount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="消耗" width="100" align="center">
          <template #default="{ row }">{{ fmtNum(row.cost) }}</template>
        </el-table-column>
        <el-table-column label="回收" width="88" align="center">
          <template #default="{ row }">{{ fmtPct(row.recovery) }}</template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="170" align="center" fixed="right" />
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

    <PromoBatchCreateDialog v-model="batchVisible" @created="getTableData" />
  </div>
</template>

<script setup name="novelPromoLinks">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import PromoBatchCreateDialog from "../components/promo-batch-create-dialog.vue"
import { channelLabel, copyText, fmtNum, fmtPct, mediaSourceLabel } from "../shared"

const createRange = ref([])
const batchVisible = ref(false)
const refreshing = ref(false)
const channels = ref([])

const defaultTableParams = () => ({
  keyword: "",
  channel: "",
  startTime: "",
  endTime: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/novel/promo-links/page",
  defaultTableParams,
  {
    transformParams(params) {
      const range = createRange.value || []
      if (range[0]) params.startTime = range[0]
      if (range[1]) params.endTime = range[1]
      return params
    },
  },
)

onMounted(() => {
  loadChannels()
  getTableData()
})

async function loadChannels() {
  const res = await request({ url: "/admin-api/novel/promo-links/dianzhong/channels" })
  if (res.code === 0 && Array.isArray(res.data)) {
    channels.value = res.data
  }
}

function resetAll() {
  createRange.value = []
  resetTable()
}

function keywordBookId() {
  const s = String(tableParams.keyword || "").trim()
  return /^\d{6,}$/.test(s) ? s : ""
}

async function refreshRemote() {
  refreshing.value = true
  try {
    const range = createRange.value || []
    const res = await request({
      url: "/admin-api/novel/promo-links/dianzhong/refresh",
      method: "POST",
      data: {
        externalBookId: keywordBookId() || undefined,
        channelId: tableParams.channel || undefined,
        startTime: range[0],
        endTime: range[1],
      },
      timeout: 60000,
    })
    if (res.code === 0) {
      ElMessage.success(`已同步 ${res.data?.upserted || 0} 条`)
      getTableData()
    } else {
      ElMessage.error(res.msg || "刷新失败")
    }
  } finally {
    refreshing.value = false
  }
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.copy-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.copy-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.novel-promo :deep(.filter-input-keyword.el-input) {
  width: 280px;
}
</style>
