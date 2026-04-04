<template>
  <div class="page-container">
    <div class="page-filter-box">
      <div class="page-filter-left">
        <el-input v-model="tableParams.name" placeholder="名称 / 模型 ID" :suffix-icon="$icons.Search" clearable clear-icon="Close" />
        <el-select v-model="tableParams.status" placeholder="状态" clearable clear-icon="Close" style="width: 120px">
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
        <el-table-column prop="name" label="名称" min-width="140" fixed="left" align="center" show-overflow-tooltip />
        <el-table-column prop="apiModelId" label="方舟模型 ID" min-width="200" align="left" show-overflow-tooltip />
        <el-table-column label="参考视频" width="92" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.supportsReferenceVideo" type="success" size="small">支持</el-tag>
            <span v-else class="muted">否</span>
          </template>
        </el-table-column>
        <el-table-column label="默认" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isDefault" type="success" size="small">是</el-tag>
            <span v-else class="muted">否</span>
          </template>
        </el-table-column>
        <el-table-column prop="sort" label="排序" width="80" align="center" />
        <el-table-column prop="status" label="状态" width="88" align="center">
          <template #default="{ row }">
            <el-tag type="success" v-if="row.status === 0">启用</el-tag>
            <el-tag type="info" v-else>停用</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" align="center" show-overflow-tooltip />
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

    <ModelModal ref="modelModalRef" @success="getTableData" />
  </div>
</template>

<script setup name="aiVideoModelManage">
import { useTable } from "@/hooks/useTable"
import { useDelete } from "@/hooks/useDelete"
import CzPagination from "@/components/cz-pagination/index.vue"
import ModelModal from "./model-modal.vue"

onMounted(() => {
  getTableData()
})

const defaultTableParams = () => ({
  name: "",
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
</script>

<style lang="scss" scoped>
.page-container {
  .page-filter-box {
    margin-bottom: 16px;
  }
  .page-pagination-box {
    margin-top: 15px;
  }
}
.muted {
  color: var(--el-text-color-placeholder);
}
</style>
