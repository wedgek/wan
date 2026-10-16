<template>
  <div class="page-container novel-page has-toolbar novel-promo">
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="名称 / path / 书名 / referralId"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <BookSelect v-model="tableParams.bookId" class="filter-select-book" placeholder="所属书籍" />
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
        <el-select
          v-model="tableParams.mediaSource"
          placeholder="回传媒体"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option v-for="s in MEDIA_SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
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
      <el-button type="primary" :icon="$icons.Plus" @click="createVisible = true">创建</el-button>
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
        <el-table-column prop="name" label="链接名称" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name || "—" }}</template>
        </el-table-column>
        <el-table-column label="path" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.path || row.url">{{ row.path || row.url }}</span>
            <span v-else class="muted">—</span>
            <el-button
              v-if="row.path || row.url"
              type="primary"
              link
              @click="copyText(row.path || row.url)"
            >
              复制
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="监测链接" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <div v-if="row.monitor1 || row.monitor2" class="monitor-cell">
              <a v-if="row.monitor1" :href="row.monitor1" target="_blank" rel="noopener" class="link-a">监测1</a>
              <a v-if="row.monitor2" :href="row.monitor2" target="_blank" rel="noopener" class="link-a">监测2</a>
              <el-button v-if="row.monitor1" type="primary" link @click="copyText(row.monitor1)">复制</el-button>
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="所属书籍" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bookName || "—" }}</template>
        </el-table-column>
        <el-table-column label="投放账号" width="100" align="center">
          <template #default="{ row }">{{ channelLabel(row.channel, channels) }}</template>
        </el-table-column>
        <el-table-column label="媒体" width="90" align="center">
          <template #default="{ row }">{{ mediaSourceLabel(row.mediaSource) }}</template>
        </el-table-column>
        <el-table-column label="起始章节" width="88" align="center">
          <template #default="{ row }">{{ row.chapterIdx != null ? row.chapterIdx : "—" }}</template>
        </el-table-column>
        <el-table-column label="收费起始" width="88" align="center">
          <template #default="{ row }">{{ row.chapterChargeStart != null ? row.chapterChargeStart : "—" }}</template>
        </el-table-column>
        <el-table-column label="看点" width="72" align="center">
          <template #default="{ row }">{{ row.chapterKandian != null ? row.chapterKandian : "—" }}</template>
        </el-table-column>
        <el-table-column label="充值档" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.goods || row.goodsBatchId">
              {{ row.goods || "—" }}
              <span v-if="row.goodsBatchId" class="muted">（{{ row.goodsBatchId }}）</span>
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="回传配置" width="110" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.callbackConfigId || "—" }}</template>
        </el-table-column>
        <el-table-column prop="referralId" label="referralId" width="130" align="center">
          <template #default="{ row }">{{ row.referralId || "—" }}</template>
        </el-table-column>
        <el-table-column label="来源" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.source === 'dianzhong' ? 'success' : 'info'">
              {{ sourceLabel(row.source) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="170" align="center" />
        <el-table-column label="操作" width="80" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="danger" link :icon="$icons.Delete" @click="onDelete(row)">删除</el-button>
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

    <PromoCreateDialog v-model="createVisible" @created="getTableData" />
  </div>
</template>

<script setup name="novelPromoLinks">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import BookSelect from "../components/book-select.vue"
import PromoCreateDialog from "../components/promo-create-dialog.vue"
import { MEDIA_SOURCE_OPTIONS, channelLabel, copyText, mediaSourceLabel, sourceLabel } from "../shared"

const createRange = ref([])
const createVisible = ref(false)
const refreshing = ref(false)
const channels = ref([])

const defaultTableParams = () => ({
  keyword: "",
  bookId: "",
  channel: "",
  mediaSource: "",
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

async function refreshRemote() {
  refreshing.value = true
  try {
    const range = createRange.value || []
    const res = await request({
      url: "/admin-api/novel/promo-links/dianzhong/refresh",
      method: "POST",
      data: {
        bookId: tableParams.bookId || undefined,
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

async function onDelete(row) {
  try {
    await ElMessageBox.confirm("是否删除该推广链接？", "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    })
    const res = await request({ url: `/admin-api/novel/promo-links/${row.id}`, method: "DELETE" })
    if (res.code === 0) {
      ElMessage.success("已删除")
      getTableData()
    } else {
      ElMessage.error(res.msg || "删除失败")
    }
  } catch (_) {
    /* 取消 */
  }
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.monitor-cell {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
}
</style>
