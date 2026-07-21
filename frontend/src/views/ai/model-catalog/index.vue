<template>
  <div class="page-container">
    <div class="page-filter-box">
      <div class="page-filter-left">
        <el-input
          v-model="tableParams.keyword"
          placeholder="模型名称 / 标签"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
          class="filter-keyword"
          @keyup.enter="tableSearch"
        />
        <el-select
          v-model="tableParams.vendor"
          placeholder="厂商"
          clearable
          clear-icon="Close"
          filterable
          popper-class="vendor-filter-dropdown"
          class="filter-vendor"
        >
          <template v-if="tableParams.vendor" #label="{ value }">
            <VendorBadge :vendor="String(value)" compact />
          </template>
          <el-option v-for="v in vendorOptions" :key="v" :label="v" :value="v">
            <VendorBadge :vendor="v" />
          </el-option>
        </el-select>
        <el-select v-model="tableParams.modality" placeholder="模态" clearable clear-icon="Close" class="filter-modality">
          <el-option label="视频" value="video" />
          <el-option label="图片" value="image" />
          <el-option label="文本" value="text" />
          <el-option label="未分类" value="unknown" />
        </el-select>
        <el-select v-model="tableParams.source" placeholder="来源" clearable clear-icon="Close" class="filter-select">
          <el-option label="同步" value="sync" />
          <el-option label="手动" value="manual" />
        </el-select>
        <el-select
          v-model="tableParams.supportsReferenceVideo"
          placeholder="参考视频"
          clearable
          clear-icon="Close"
          class="filter-select"
        >
          <el-option label="支持" value="1" />
          <el-option label="不支持" value="0" />
        </el-select>
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetTable">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <div class="page-table-header-left">
        <el-button type="primary" @click="catalogModalRef?.showAdd()" :icon="$icons.Plus">新增</el-button>
        <el-button type="success" :loading="syncLoading" @click="handleSync">同步 DMXAPI</el-button>
      </div>
      <div v-if="selectedRows.length" class="page-table-header-actions">
        <span class="batch-selected">已选 {{ selectedRows.length }} 条</span>
        <el-button type="success" :loading="batchPublishLoading" @click="handleBatchPublish">批量上架</el-button>
      </div>
    </div>

    <div class="page-table-box">
      <el-table
        ref="tableRef"
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        row-key="id"
        :header-cell-style="{ 'text-align': 'center' }"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="46" align="center" fixed="left" />
        <el-table-column prop="apiModelId" label="模型名称" min-width="240" fixed="left" align="left" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="copy-id model-id-cell" title="点击复制" @click="copyText(row.apiModelId)">
              {{ row.apiModelId || '—' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="vendor" label="厂商" width="130" align="center" class-name="col-vendor">
          <template #default="{ row }">
            <div class="vendor-cell">
              <VendorBadge :vendor="row.vendor" :api-model-id="row.apiModelId" />
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="modality" label="模态" width="88" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="modalityTagType(row.modality)">{{ modalityLabel(row.modality) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="80" align="center">
          <template #default="{ row }">
            {{ sourceLabel(row.source) }}
          </template>
        </el-table-column>
        <el-table-column label="API 来源" width="108" align="center">
          <template #default="{ row }">
            <template v-if="row.modality === 'video'">
              <el-tag v-if="row.apiProvider === 'ark'" type="warning" size="small">官方</el-tag>
              <el-tag v-else-if="row.apiProvider === 'dmxapi'" size="small">DMXAPI</el-tag>
              <span v-else class="muted">自动</span>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="参考视频" width="92" align="center">
          <template #default="{ row }">
            <template v-if="row.modality === 'video'">
              <el-tag v-if="row.supportsReferenceVideo" type="success" size="small">支持</el-tag>
              <span v-else class="muted">否</span>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="tags" label="标签" min-width="128" align="center">
          <template #default="{ row }">
            <template v-if="displayTags(row).length">
              <el-tag v-for="t in displayTags(row)" :key="t" size="small" class="tag-chip">{{ t }}</el-tag>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="dmxapiPriceText" label="价格" min-width="168" align="left" class-name="col-dmxapi-price">
          <template #default="{ row }">
            <DmxapiPriceCell :display="row.dmxapiPrice" :fallback-text="row.dmxapiPriceText" />
          </template>
        </el-table-column>
        <el-table-column prop="syncedAt" label="最近同步" min-width="168" align="center" show-overflow-tooltip />
        <el-table-column label="操作" width="248" fixed="right" align="center">
          <template #default="{ row }">
            <div class="table-actions">
              <span class="table-actions__publish">
                <template v-if="row.publishedToStore">
                  <el-tooltip content="该模型已在模型商店中" placement="top" :show-after="300">
                    <el-button type="success" link disabled :icon="$icons.CircleCheck">已经上架</el-button>
                  </el-tooltip>
                </template>
                <el-tooltip
                  v-else
                  content="添加到模型商店；视频生成仅使用视频类模型，对话创作使用文本类模型"
                  placement="top"
                  :show-after="300"
                >
                  <el-button type="primary" link :icon="$icons.ShoppingCart" @click="handlePublish(row)">上架商店</el-button>
                </el-tooltip>
              </span>
              <el-button type="primary" link :icon="$icons.Edit" @click="catalogModalRef?.showEdit(row)">编辑</el-button>
              <el-button type="danger" link :icon="$icons.Delete" @click="handleDelete(row.id)">删除</el-button>
            </div>
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

    <CatalogModal ref="catalogModalRef" @success="onCatalogSaved" />
  </div>
</template>

<script setup name="aiModelCatalog">
import request from "@/request"
import { useTable } from "@/hooks/useTable"
import { useDelete } from "@/hooks/useDelete"
import { copyText } from "@/utils/public"
import { getVendorBrand } from "@/utils/vendorBrand"
import CzPagination from "@/components/cz-pagination/index.vue"
import VendorBadge from "@/components/vendor-badge/index.vue"
import DmxapiPriceCell from "@/components/dmxapi-price-cell/index.vue"
import CatalogModal from "./catalog-modal.vue"

onMounted(() => {
  getTableData()
  loadVendors()
})

const defaultTableParams = () => ({
  keyword: "",
  modality: "",
  vendor: "",
  source: "",
  supportsReferenceVideo: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/system/model-catalog/page",
  defaultTableParams,
)

const handleDelete = useDelete({
  url: "/admin-api/system/model-catalog/delete",
  refresh: getTableData,
})

const tableRef = ref()
const catalogModalRef = ref()
const syncLoading = ref(false)
const batchPublishLoading = ref(false)
const vendorOptions = ref([])
const selectedRows = ref([])

function modalityLabel(v) {
  const map = { video: "视频", image: "图片", text: "文本", unknown: "未分类" }
  return map[v] || v || "—"
}

function modalityTagType(v) {
  if (v === "video") return "warning"
  if (v === "image") return "success"
  if (v === "text") return "primary"
  return "info"
}

function sourceLabel(v) {
  const map = { sync: "同步", manual: "手动" }
  return map[v] || v || "—"
}

function parseTags(raw) {
  return String(raw || "")
    .split(/[,，、|]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 与「模态」列重复的泛化标签（如 图片/视频）不在标签列重复展示 */
function displayTags(row) {
  const modLabel = modalityLabel(row.modality)
  return parseTags(row.tags).filter((t) => t !== modLabel)
}

function handleSelectionChange(rows) {
  selectedRows.value = rows || []
}

function clearSelection() {
  tableRef.value?.clearSelection()
  selectedRows.value = []
}

async function loadVendors() {
  try {
    const res = await request({ url: "/admin-api/system/model-catalog/vendors" })
    if (res.code === 0) {
      vendorOptions.value = (res.data || []).sort((a, b) =>
        getVendorBrand(a).label.localeCompare(getVendorBrand(b).label, "zh-CN"),
      )
    }
  } catch (_) {
    /* request 内已提示 */
  }
}

function onCatalogSaved() {
  getTableData()
  loadVendors()
}

async function handleBatchPublish() {
  if (!selectedRows.value.length) {
    ElMessage.warning("请先勾选目录条目")
    return
  }

  const rows = selectedRows.value

  try {
    await ElMessageBox.confirm(
      `将把选中的 ${rows.length} 条模型上架到模型商店（已存在的会自动跳过）。是否继续？`,
      "批量上架",
      { type: "info", confirmButtonText: "开始上架", cancelButtonText: "取消" },
    )
  } catch (_) {
    return
  }

  batchPublishLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/system/model-catalog/batch-publish",
      method: "POST",
      data: { catalogIds: rows.map((r) => r.id) },
    })
    if (res.code === 0) {
      const s = res.data || {}
      ElMessage.success(`上架 ${s.published ?? 0} 条，跳过 ${s.skipped ?? 0} 条，失败 ${s.failed ?? 0} 条`)
      clearSelection()
    } else {
      ElMessage.error(res.msg || "批量上架失败")
    }
  } finally {
    batchPublishLoading.value = false
  }
}

async function handleSync() {
  try {
    await ElMessageBox.confirm(
      "将从 DMXAPI 拉取最新模型列表并写入目录（已有同步项会更新，手动条目不受影响）。模型较多时可能需要几十秒，是否继续？",
      "同步 DMXAPI",
      { type: "info", confirmButtonText: "开始同步", cancelButtonText: "取消" },
    )
  } catch (_) {
    return
  }

  syncLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/system/model-catalog/sync-dmxapi",
      method: "POST",
      timeout: 120000,
    })
    if (res.code === 0) {
      const s = res.data || {}
      ElMessage.success(
        `同步完成：共 ${s.total ?? 0} 条，新增 ${s.inserted ?? 0}，更新 ${s.updated ?? 0}，跳过手动 ${s.skippedManual ?? 0}`,
      )
      getTableData()
      loadVendors()
    } else {
      ElMessage.error(res.msg || "同步失败")
    }
  } finally {
    syncLoading.value = false
  }
}

async function handlePublish(row) {
  try {
    const res = await request({
      url: "/admin-api/system/video-model/publish-from-catalog",
      method: "POST",
      data: { catalogId: row.id },
    })
    if (res.code === 0) {
      if (res.data?.duplicate) {
        ElMessage({ message: "已在模型商店中", grouping: true })
      } else {
        ElMessage.success("已上架到模型商店")
      }
      getTableData()
    } else {
      ElMessage.error(res.msg || "上架失败")
    }
  } catch (_) {
    /* request 内已提示 */
  }
}
</script>

<style lang="scss" scoped>
.page-container {
  .page-filter-box {
    margin-bottom: 16px;
    .filter-keyword {
      width: 220px;
    }
    .filter-vendor {
      width: 220px;
      :deep(.el-select__wrapper) {
        padding-left: 12px;
      }
      :deep(.el-select__selection) {
        flex-wrap: nowrap;
        min-width: 0;
      }
      :deep(.el-select__selected-item) {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        overflow: hidden;
      }
      :deep(.vendor-badge) {
        min-width: 0;
        max-width: 100%;
      }
    }
    .filter-modality,
    .filter-select {
      width: 130px;
    }
  }
  .batch-selected {
    font-size: 13px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }
  .page-pagination-box {
    margin-top: 15px;
  }
}
.muted {
  color: var(--el-text-color-placeholder);
}
.copy-id {
  cursor: pointer;
  &:hover {
    color: var(--el-color-primary);
  }
}
.model-id-cell {
  font-weight: 500;
}
.vendor-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 32px;
}
:deep(.col-vendor .cell) {
  display: flex;
  align-items: center;
  justify-content: center;
}
.table-actions {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 0;
  vertical-align: middle;

  &__publish {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 82px;
    flex-shrink: 0;
  }

  :deep(.el-button.is-link) {
    vertical-align: middle;
  }

  :deep(.el-button.is-link.is-disabled) {
    &.el-button--success {
      color: var(--el-color-success);
    }
  }
}
.tag-chip {
  margin: 0 4px 2px 0;
}
:deep(.col-dmxapi-price .cell) {
  overflow: visible;
  white-space: normal;
  line-height: 1.45;
}
</style>

<style lang="scss">
.vendor-filter-dropdown.el-select-dropdown {
  .el-select-dropdown__item {
    padding: 0 12px 0 12px;
    height: 34px;
    line-height: 34px;
  }
  .vendor-badge {
    width: 100%;
  }
}
</style>
