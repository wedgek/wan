<template>
  <div class="page-container novel-page has-toolbar has-copyright-tabs novel-recharge-tpl">
    <el-tabs v-model="tableParams.source" class="copyright-tabs" @tab-change="onSourceChange">
      <el-tab-pane v-for="item in COPYRIGHT_OPTIONS" :key="item.value" :name="item.value">
        <template #label>{{ item.label }}</template>
      </el-tab-pane>
    </el-tabs>
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="名称 / 档位ID / 创建人"
          class="filter-input-keyword"
          :suffix-icon="$icons.Search"
          clearable
          clear-icon="Close"
        />
        <el-select
          v-model="tableParams.channel"
          :placeholder="isChangdu ? '应用' : '投放账号'"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option v-for="c in channels" :key="c.id" :label="c.label" :value="c.id" />
        </el-select>
        <el-select
          v-model="tableParams.enabled"
          placeholder="投入使用"
          class="filter-select-sm"
          clearable
          clear-icon="Close"
          :suffix-icon="$icons.ArrowDown"
        >
          <el-option label="投入使用" value="1" />
          <el-option label="未投入使用" value="0" />
        </el-select>
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetAll">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <el-button type="primary" :icon="$icons.Plus" @click="openEdit()">新增模板</el-button>
      <el-button :icon="$icons.Refresh" :loading="refreshing" @click="refreshRemote">
        {{ isChangdu ? "从常读拉取" : "从点众拉取" }}
      </el-button>
    </div>

    <div class="page-table-box table-wrap">
      <el-table
        :data="tableData"
        v-loading="tableLoading"
        border
        height="100%"
        :header-cell-style="{ 'text-align': 'center' }"
      >
        <el-table-column prop="batchId" label="模板ID" width="130" align="center">
          <template #default="{ row }">{{ row.batchId || "—" }}</template>
        </el-table-column>
        <el-table-column prop="creator" label="创建人" width="140" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.creator || "—" }}</template>
        </el-table-column>
        <el-table-column prop="name" label="充值模板名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="createTime" label="创建时间" width="170" align="center" />
        <el-table-column prop="updateTime" label="更新时间" width="170" align="center" />
        <el-table-column :label="isChangdu ? '应用' : '投放账号'" width="110" align="center">
          <template #default="{ row }">{{ channelLabel(row.channelId, channels) }}</template>
        </el-table-column>
        <el-table-column label="投入使用" width="110" align="center" fixed="right">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="(v) => onToggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
            <el-button v-if="!row.locked" type="danger" link @click="onDelete(row)">删除</el-button>
            <span v-else class="muted">锁定</span>
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
      width="480px"
      append-to-body
      destroy-on-close
    >
      <el-form ref="editRef" :model="editForm" :rules="editRules" label-width="96px">
        <el-form-item label="模板名称" prop="name">
          <el-input v-model="editForm.name" maxlength="40" placeholder="例如：9.9" />
        </el-form-item>
        <el-form-item label="档位ID" prop="batchId">
          <el-input v-model="editForm.batchId" :placeholder="isChangdu ? '常读付费面板 ID，创建链接时会带上' : '点众模板 ID，创建链接时会带上'" />
        </el-form-item>
        <el-form-item :label="isChangdu ? '应用' : '投放账号'">
          <el-select v-model="editForm.channelId" clearable placeholder="可选" style="width: 100%">
            <el-option v-for="c in channels" :key="c.id" :label="c.label" :value="c.id" />
          </el-select>
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
import { COPYRIGHT_OPTIONS, channelLabel, copyrightSource, readCopyright, sourceCopyright, writeCopyright } from "../shared"

const refreshing = ref(false)
const editVisible = ref(false)
const saving = ref(false)
const editRef = ref(null)
const channels = ref([])
const editForm = reactive({
  id: 0,
  name: "",
  batchId: "",
  channelId: "",
  remark: "",
})

const editRules = {
  name: [{ required: true, message: "请填写模板名称", trigger: "blur" }],
  batchId: [{ required: true, message: "请填写档位ID", trigger: "blur" }],
}

const defaultTableParams = () => ({
  keyword: "",
  source: copyrightSource(readCopyright()),
  channel: "",
  enabled: "",
  pageNo: 1,
  pageSize: 20,
})

const isChangdu = computed(() => tableParams.source === "changdu")
const channelsUrl = computed(() =>
  isChangdu.value ? "/admin-api/novel/promo-links/changdu/channels" : "/admin-api/novel/promo-links/dianzhong/channels",
)
const refreshUrl = computed(() =>
  isChangdu.value
    ? "/admin-api/novel/recharge-templates/changdu/refresh"
    : "/admin-api/novel/recharge-templates/dianzhong/refresh",
)

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch } = useTable(
  "/admin-api/novel/recharge-templates/page",
  defaultTableParams,
)

onMounted(() => {
  loadChannels()
  getTableData()
})

async function loadChannels() {
  const res = await request({ url: channelsUrl.value })
  if (res.code === 0 && Array.isArray(res.data)) channels.value = res.data
  else channels.value = []
}

function onSourceChange() {
  writeCopyright(sourceCopyright(tableParams.source))
  tableParams.channel = ""
  loadChannels()
  tableParams.pageNo = 1
  getTableData()
}

function resetAll() {
  tableParams.keyword = ""
  tableParams.channel = ""
  tableParams.enabled = ""
  tableParams.pageNo = 1
  getTableData()
}

function openEdit(row) {
  editForm.id = row?.id || 0
  editForm.name = row?.name || ""
  editForm.batchId = row?.batchId || ""
  editForm.channelId = row?.channelId || ""
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
        channelId: editForm.channelId,
        remark: editForm.remark,
        source: tableParams.source,
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

async function onToggle(row, enabled) {
  const prev = row.enabled
  row.enabled = enabled
  const res = await request({
    url: `/admin-api/novel/recharge-templates/${row.id}/enabled`,
    method: "PATCH",
    data: { enabled: enabled ? 1 : 0 },
  })
  if (res.code === 0) {
    ElMessage.success(enabled ? "已投入使用" : "已设为未投入使用")
    Object.assign(row, res.data || {})
  } else {
    row.enabled = prev
    ElMessage.error(res.msg || "更新失败")
  }
}

async function refreshRemote() {
  refreshing.value = true
  try {
    const res = await request({
      url: refreshUrl.value,
      method: "POST",
      data: { channelId: tableParams.channel || undefined },
      timeout: 60000,
    })
    if (res.code === 0) {
      ElMessage.success(`已同步 ${res.data?.upserted || 0} 条`)
      if (res.data?.warnings?.length) ElMessage.warning(res.data.warnings.join("；"))
      getTableData()
    } else {
      ElMessage.error(res.msg || "拉取失败")
    }
  } finally {
    refreshing.value = false
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `删除充值模板「${row.name}」？仅从本系统移除，${isChangdu.value ? "常读" : "点众"}上仍保留。`,
      "提示",
      {
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
