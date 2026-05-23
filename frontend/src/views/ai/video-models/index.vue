<template>
  <div class="page-container">
    <div class="page-filter-box">
      <div class="page-filter-left">
        <el-input
          v-model="tableParams.name"
          placeholder="展示名称 / 模型 ID"
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
        <el-select v-model="tableParams.status" placeholder="状态" clearable clear-icon="Close" class="filter-select">
          <el-option label="启用" value="0" />
          <el-option label="停用" value="1" />
        </el-select>
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetTable">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <el-button type="primary" @click="modelModalRef?.showAdd()" :icon="$icons.Plus">新增</el-button>
    </div>

    <div class="page-table-box">
      <el-table
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        :header-cell-style="{ 'text-align': 'center' }"
      >
        <el-table-column prop="sort" label="排序" width="72" align="center" fixed="left" />
        <el-table-column prop="status" label="启用" width="72" align="center" fixed="left">
          <template #default="{ row }">
            <el-tooltip content="关闭后不会在对话创作模型列表中出现" placement="top" :show-after="300">
              <el-switch
                v-model="row.status"
                :active-value="0"
                :inactive-value="1"
                @change="handleStatusChange(row)"
              />
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="展示名称" min-width="140" fixed="left" align="center" show-overflow-tooltip />
        <el-table-column prop="apiModelId" label="模型 ID" min-width="200" align="left" show-overflow-tooltip />
        <el-table-column prop="vendor" label="厂商" width="168" align="center" class-name="col-vendor">
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
        <el-table-column label="参考视频" width="92" align="center">
          <template #default="{ row }">
            <template v-if="row.modality === 'video'">
              <el-tag v-if="row.supportsReferenceVideo" type="success" size="small">支持</el-tag>
              <span v-else class="muted">否</span>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="默认" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isDefault" type="success" size="small">是</el-tag>
            <span v-else class="muted">否</span>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="220" align="left" show-overflow-tooltip />
        <el-table-column prop="createTime" label="创建时间" min-width="160" align="center" show-overflow-tooltip />
        <el-table-column label="操作" width="160" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" link :icon="$icons.Edit" @click="modelModalRef?.showEdit(row)">编辑</el-button>
            <el-button type="danger" link :icon="$icons.Delete" @click="handleDelete(row.id)">删除</el-button>
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

    <ModelModal ref="modelModalRef" @success="onModelSaved" />
  </div>
</template>

<script setup name="aiVideoModelManage">
import request from "@/request"
import { useTable } from "@/hooks/useTable"
import { useDelete } from "@/hooks/useDelete"
import { getVendorBrand } from "@/utils/vendorBrand"
import CzPagination from "@/components/cz-pagination/index.vue"
import VendorBadge from "@/components/vendor-badge/index.vue"
import ModelModal from "./model-modal.vue"

onMounted(() => {
  getTableData()
  loadVendors()
})

const defaultTableParams = () => ({
  name: "",
  vendor: "",
  modality: "",
  status: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/system/video-model/page",
  defaultTableParams,
)

const handleDelete = useDelete({
  url: "/admin-api/system/video-model/delete",
  refresh: getTableData,
})

const modelModalRef = ref()
const vendorOptions = ref([])

async function loadVendors() {
  try {
    const res = await request({ url: "/admin-api/system/video-model/vendors" })
    if (res.code === 0) {
      vendorOptions.value = (res.data || []).sort((a, b) =>
        getVendorBrand(a).label.localeCompare(getVendorBrand(b).label, "zh-CN"),
      )
    }
  } catch (_) {
    /* request 内已提示 */
  }
}

function onModelSaved() {
  getTableData()
  loadVendors()
}

async function handleStatusChange(row) {
  try {
    const res = await request({
      url: "/admin-api/system/video-model/update-status",
      method: "PUT",
      data: { id: row.id, status: row.status },
    })
    if (res.code === 0) {
      ElMessage.success(row.status === 0 ? "已启用" : "已停用")
    } else {
      ElMessage.error(res.msg || "修改失败")
      row.status = row.status === 0 ? 1 : 0
    }
  } catch (_) {
    row.status = row.status === 0 ? 1 : 0
  }
}

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
  .page-pagination-box {
    margin-top: 15px;
  }
}
.muted {
  color: var(--el-text-color-placeholder);
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
</style>

<style lang="scss">
.vendor-filter-dropdown.el-select-dropdown {
  .el-select-dropdown__item {
    padding: 0 12px;
    height: 34px;
    line-height: 34px;
  }
  .vendor-badge {
    width: 100%;
  }
}
</style>
