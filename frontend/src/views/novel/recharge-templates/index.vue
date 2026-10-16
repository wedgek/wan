<template>
  <div class="page-container novel-page has-toolbar novel-recharge-tpl">
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="名称 / 档位ID / 备注"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetTable">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <el-button type="primary" :icon="$icons.Plus" @click="openEdit()">新增模板</el-button>
      <el-button :loading="importing" @click="importFromLinks">从已同步链接带入</el-button>
    </div>

    <div class="page-table-box table-wrap">
      <el-table
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        :header-cell-style="{ 'text-align': 'center' }"
      >
        <el-table-column prop="name" label="模板名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="batchId" label="档位ID" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.batchId">{{ row.batchId }}</span>
            <span v-else class="muted">未填</span>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || "—" }}</template>
        </el-table-column>
        <el-table-column label="推广模板" width="100" align="center">
          <template #default="{ row }">{{ row.promoTplCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="已用链接" width="100" align="center">
          <template #default="{ row }">{{ row.linkCount || 0 }}</template>
        </el-table-column>
        <el-table-column prop="updateTime" label="更新时间" width="170" align="center" />
        <el-table-column label="操作" width="140" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
            <el-button type="danger" link @click="onDelete(row)">删除</el-button>
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

    <el-dialog
      v-model="editVisible"
      :title="editForm.id ? '编辑充值模板' : '新增充值模板'"
      width="460px"
      append-to-body
      destroy-on-close
    >
      <el-form ref="editRef" :model="editForm" :rules="editRules" label-width="88px">
        <el-form-item label="模板名称" prop="name">
          <el-input v-model="editForm.name" maxlength="40" placeholder="例如：常规档 / 高价档" />
        </el-form-item>
        <el-form-item label="档位ID" prop="batchId">
          <el-input v-model="editForm.batchId" placeholder="点众 batchId，创建链接时会带上" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="2" maxlength="120" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup name="novelRechargeTemplates">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"

const importing = ref(false)
const editVisible = ref(false)
const saving = ref(false)
const editRef = ref(null)
const editForm = reactive({
  id: 0,
  name: "",
  batchId: "",
  remark: "",
})

const editRules = {
  name: [{ required: true, message: "请填写模板名称", trigger: "blur" }],
}

const defaultTableParams = () => ({
  keyword: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/novel/recharge-templates/page",
  defaultTableParams,
)

onMounted(() => {
  getTableData()
})

function openEdit(row) {
  editForm.id = row?.id || 0
  editForm.name = row?.name || ""
  editForm.batchId = row?.batchId || ""
  editForm.remark = row?.remark || ""
  editVisible.value = true
}

async function saveEdit() {
  const ok = await editRef.value?.validate().catch(() => false)
  if (!ok) return
  saving.value = true
  try {
    const res = await request({
      url: editForm.id
        ? `/admin-api/novel/recharge-templates/${editForm.id}`
        : "/admin-api/novel/recharge-templates",
      method: editForm.id ? "PUT" : "POST",
      data: {
        name: editForm.name,
        batchId: editForm.batchId,
        remark: editForm.remark,
      },
    })
    if (res.code === 0) {
      ElMessage.success("已保存")
      editVisible.value = false
      getTableData()
    } else {
      ElMessage.error(res.msg || "保存失败")
    }
  } finally {
    saving.value = false
  }
}

async function importFromLinks() {
  importing.value = true
  try {
    const res = await request({
      url: "/admin-api/novel/recharge-templates/import-from-links",
      method: "POST",
    })
    if (res.code === 0) {
      const n = res.data?.created || 0
      ElMessage.success(n ? `已带入 ${n} 条` : "没有新的档位可带入")
      getTableData()
    } else {
      ElMessage.error(res.msg || "带入失败")
    }
  } finally {
    importing.value = false
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`删除充值模板「${row.name}」？关联的推广模板会去掉该档位。`, "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    })
    const res = await request({ url: `/admin-api/novel/recharge-templates/${row.id}`, method: "DELETE" })
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
</style>
