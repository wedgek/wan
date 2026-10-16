<template>
  <div class="page-container novel-page has-toolbar novel-promo-tpl">
    <div class="page-filter-box filter-bar">
      <div class="page-filter-left filters-wrap">
        <el-input
          v-model="tableParams.keyword"
          placeholder="模板名 / 充值档 / 档位ID"
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
        <el-button type="primary" @click="tableSearch">查询</el-button>
        <el-button @click="resetTable">重置</el-button>
      </div>
    </div>

    <div class="page-table-header">
      <el-button type="primary" :icon="$icons.Plus" @click="openEdit()">新增模板</el-button>
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
        <el-table-column label="投放账号" width="110" align="center">
          <template #default="{ row }">{{ channelLabel(row.channelId, channels) }}</template>
        </el-table-column>
        <el-table-column label="媒体" width="88" align="center">
          <template #default="{ row }">{{ mediaSourceLabel(row.mediaSource) }}</template>
        </el-table-column>
        <el-table-column label="起始章节" width="88" align="center">
          <template #default="{ row }">{{ row.chapterIdx }}</template>
        </el-table-column>
        <el-table-column label="条数" width="64" align="center">
          <template #default="{ row }">{{ row.count }}</template>
        </el-table-column>
        <el-table-column label="充值模板" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.rechargeName">{{ row.rechargeName }}</span>
            <span v-else class="muted">—</span>
            <span v-if="row.batchId" class="muted">（{{ row.batchId }}）</span>
          </template>
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
      :title="editForm.id ? '编辑推广模板' : '新增推广模板'"
      width="480px"
      append-to-body
      destroy-on-close
    >
      <el-form ref="editRef" :model="editForm" :rules="editRules" label-width="96px">
        <el-form-item label="模板名称" prop="name">
          <el-input v-model="editForm.name" maxlength="40" placeholder="例如：巨量1-抖音-1条" />
        </el-form-item>
        <el-form-item label="投放账号" prop="channelId">
          <el-select v-model="editForm.channelId" style="width: 100%">
            <el-option v-for="c in channels" :key="c.id" :label="c.label" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="回传媒体" prop="mediaSource">
          <el-select v-model="editForm.mediaSource" style="width: 100%">
            <el-option v-for="s in MEDIA_SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="起始章节" prop="chapterIdx">
          <el-input-number v-model="editForm.chapterIdx" :min="1" :max="20" />
        </el-form-item>
        <el-form-item label="生成条数" prop="count">
          <el-radio-group v-model="editForm.count">
            <el-radio-button v-for="n in PROMO_COUNT_OPTIONS" :key="n" :value="n">{{ n }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="充值模板">
          <div class="tpl-row">
            <el-select
              v-model="editForm.rechargeTemplateId"
              placeholder="可选，创建时带上档位"
              clearable
              style="flex: 1"
            >
              <el-option
                v-for="r in recharges"
                :key="r.id"
                :label="rechargeOptionLabel(r)"
                :value="r.id"
              />
            </el-select>
            <el-button link type="primary" @click="$router.push('/novel/recharge-templates')">管理</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup name="novelPromoTemplates">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"
import { MEDIA_SOURCE_OPTIONS, PROMO_COUNT_OPTIONS, channelLabel, mediaSourceLabel } from "../shared"

const channels = ref([])
const recharges = ref([])
const editVisible = ref(false)
const saving = ref(false)
const editRef = ref(null)
const editForm = reactive({
  id: 0,
  name: "",
  channelId: "",
  mediaSource: "dy",
  chapterIdx: 1,
  count: 1,
  rechargeTemplateId: "",
})

const editRules = {
  name: [{ required: true, message: "请填写模板名称", trigger: "blur" }],
  channelId: [{ required: true, message: "请选择投放账号", trigger: "change" }],
}

const defaultTableParams = () => ({
  keyword: "",
  channel: "",
  mediaSource: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/novel/promo-links/templates/page",
  defaultTableParams,
)

onMounted(() => {
  loadChannels()
  loadRecharges()
  getTableData()
})

function rechargeOptionLabel(r) {
  const id = r.batchId ? `（${r.batchId}）` : ""
  return `${r.name}${id}`
}

async function loadChannels() {
  const res = await request({ url: "/admin-api/novel/promo-links/dianzhong/channels" })
  if (res.code === 0 && Array.isArray(res.data)) channels.value = res.data
}

async function loadRecharges() {
  const res = await request({ url: "/admin-api/novel/recharge-templates" })
  if (res.code === 0 && Array.isArray(res.data)) recharges.value = res.data
}

function openEdit(row) {
  editForm.id = row?.id || 0
  editForm.name = row?.name || ""
  editForm.channelId = row?.channelId || (channels.value[0] && channels.value[0].id) || ""
  editForm.mediaSource = row?.mediaSource || "dy"
  editForm.chapterIdx = row?.chapterIdx || 1
  editForm.count = row?.count || 1
  editForm.rechargeTemplateId = row?.rechargeTemplateId || ""
  loadRecharges()
  editVisible.value = true
}

async function saveEdit() {
  const ok = await editRef.value?.validate().catch(() => false)
  if (!ok) return
  saving.value = true
  try {
    const payload = {
      name: editForm.name,
      channelId: editForm.channelId,
      mediaSource: editForm.mediaSource,
      chapterIdx: editForm.chapterIdx,
      count: editForm.count,
      rechargeTemplateId: editForm.rechargeTemplateId || null,
    }
    const res = await request({
      url: editForm.id
        ? `/admin-api/novel/promo-links/templates/${editForm.id}`
        : "/admin-api/novel/promo-links/templates",
      method: editForm.id ? "PUT" : "POST",
      data: payload,
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

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`删除模板「${row.name}」？`, "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    })
    const res = await request({ url: `/admin-api/novel/promo-links/templates/${row.id}`, method: "DELETE" })
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

.tpl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
</style>
