<template>
  <div class="page-container novel-page has-toolbar novel-sync">
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-select
          v-model="tableParams.type"
          placeholder="导入类型"
          class="filter-select"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option v-for="t in BATCH_TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-date-picker
          v-model="tableParams.statDate"
          class="filter-date"
          type="date"
          placeholder="统计日"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          clearable
          clear-icon="Close"
        />
        <el-select
          v-model="tableParams.status"
          placeholder="状态"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option label="成功" value="success" />
          <el-option label="部分成功" value="partial" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetTable">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <div class="page-table-header-left">
        <span class="today-badge">今日书籍日报 {{ todayInfo.imported }}/{{ todayInfo.target }}</span>
        <el-tag v-if="todayInfo.slots.morning" size="small" type="success">上午已导</el-tag>
        <el-tag v-else size="small" type="info">上午未导</el-tag>
        <el-tag v-if="todayInfo.slots.afternoon" size="small" type="success">下午已导</el-tag>
        <el-tag v-else size="small" type="info">下午未导</el-tag>
      </div>
      <div class="page-table-header-actions">
        <el-button type="primary" :icon="$icons.Upload" @click="openImport">导入</el-button>
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
        <el-table-column prop="id" label="批次" width="72" align="center" />
        <el-table-column label="类型" width="100" align="center">
          <template #default="{ row }">{{ typeLabel(row.type) }}</template>
        </el-table-column>
        <el-table-column prop="statDate" label="统计日" width="110" align="center" />
        <el-table-column label="时段" width="80" align="center">
          <template #default="{ row }">{{ slotLabel(row.slot) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="batchTag(row.status)" size="small">{{ batchStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="条数" width="140" align="center">
          <template #default="{ row }">{{ row.successCount }} / {{ row.totalCount }}</template>
        </el-table-column>
        <el-table-column prop="filename" label="文件" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.filename || "粘贴 JSON" }}</template>
        </el-table-column>
        <el-table-column label="失败原因" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.errorMessage || "—" }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="120" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.nickname || row.username || "—" }}</template>
        </el-table-column>
        <el-table-column prop="createTime" label="导入时间" width="170" align="center" />
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

    <el-dialog v-model="importVisible" title="导入云帆数据" width="560px" destroy-on-close>
      <el-form :model="importForm" label-width="96px">
        <el-form-item label="数据类型" required>
          <el-select v-model="importForm.type" style="width: 220px">
            <el-option v-for="t in BATCH_TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="统计日期" required>
          <el-date-picker
            v-model="importForm.statDate"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="时段">
          <el-radio-group v-model="importForm.slot">
            <el-radio value="morning">上午</el-radio>
            <el-radio value="afternoon">下午</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="文件">
          <el-upload
            :auto-upload="false"
            :limit="1"
            accept=".json,.csv,.txt,.xlsx"
            :on-change="onFileChange"
            :on-remove="onFileRemove"
          >
            <el-button :icon="$icons.Upload">选择 xlsx / CSV / JSON</el-button>
          </el-upload>
          <div class="hint">
            {{
              importForm.type === "promo"
                ? "云帆「批量导出xlsx表格」可直接上传。一行一条链接，表头含链接名称、推广链接、书名或书籍ID。"
                : "云帆导出的 xlsx / CSV 可直接上传；或从浏览器网络面板保存列表接口 JSON。"
            }}
          </div>
        </el-form-item>
        <el-form-item label="粘贴 JSON">
          <el-input
            v-model="importForm.payload"
            type="textarea"
            :rows="6"
            placeholder="也可直接粘贴接口返回的 JSON"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="submitImport">开始导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup name="novelSync">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import { BATCH_TYPE_OPTIONS, inferSlot, slotLabel, todayDate, typeLabel } from "../shared"

const defaultTableParams = () => ({
  type: "",
  statDate: "",
  status: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/novel/sync/page",
  defaultTableParams,
)

const todayInfo = reactive({ imported: 0, target: 2, slots: { morning: false, afternoon: false } })
const importVisible = ref(false)
const importing = ref(false)
const importFile = ref(null)
const importForm = reactive({
  type: "books",
  statDate: todayDate(),
  slot: inferSlot(),
  payload: "",
})

onMounted(() => {
  getTableData()
  loadToday()
})

async function loadToday() {
  const res = await request({ url: "/admin-api/novel/sync/today", method: "GET" })
  if (res.code === 0 && res.data) {
    todayInfo.imported = res.data.imported || 0
    todayInfo.target = res.data.target || 2
    todayInfo.slots = res.data.slots || { morning: false, afternoon: false }
  }
}

function openImport() {
  importForm.type = "books"
  importForm.statDate = todayDate()
  importForm.slot = inferSlot()
  importForm.payload = ""
  importFile.value = null
  importVisible.value = true
}

function onFileChange(file) {
  importFile.value = file?.raw || null
}

function onFileRemove() {
  importFile.value = null
}

function batchTag(status) {
  if (status === "success") return "success"
  if (status === "partial") return "warning"
  if (status === "failed") return "danger"
  return "info"
}

function batchStatusLabel(status) {
  if (status === "success") return "成功"
  if (status === "partial") return "部分成功"
  if (status === "failed") return "失败"
  if (status === "pending") return "处理中"
  return status || "—"
}

async function submitImport() {
  if (!importForm.type || !importForm.statDate) {
    ElMessage.warning("请选择类型和统计日期")
    return
  }
  if (!importFile.value && !importForm.payload.trim()) {
    ElMessage.warning("请上传文件或粘贴 JSON")
    return
  }
  const fd = new FormData()
  fd.append("type", importForm.type)
  fd.append("statDate", importForm.statDate)
  fd.append("slot", importForm.slot)
  if (importFile.value) fd.append("file", importFile.value)
  if (importForm.payload.trim()) fd.append("payload", importForm.payload.trim())
  importing.value = true
  try {
    const res = await request({
      url: "/admin-api/novel/sync/import",
      method: "POST",
      data: fd,
      timeout: 60000,
    })
    if (res.code === 0) {
      ElMessage.success(`导入完成：成功 ${res.data.success} / ${res.data.total}`)
      importVisible.value = false
      getTableData()
      loadToday()
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

.hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
</style>
