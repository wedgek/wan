<template>
  <div class="page-container novel-page has-toolbar ocean-mini-apps">
    <el-tabs v-model="copyright" class="copyright-tabs" @tab-change="onCopyrightTab">
      <el-tab-pane v-for="item in tabs" :key="item.name" :name="item.name" :label="item.label" />
    </el-tabs>
    <div class="page-table-header">
      <div class="page-table-header-left">
        <el-button type="primary" :disabled="copyright === '__unset__'" @click="openAdd">从巨量添加</el-button>
        <el-button :icon="$icons.Refresh" :loading="refreshing" @click="refreshOcean">同步巨量信息</el-button>
        <el-button v-if="selected.length" @click="removeSelected">移除</el-button>
      </div>
      <div class="page-table-header-actions">
        <span v-if="selected.length" class="hint">已选 {{ selected.length }} 个</span>
      </div>
    </div>
    <div class="page-table-box">
      <el-table
        :data="shown"
        v-loading="loading"
        border
        row-key="appId"
        :header-cell-style="headerStyle"
        @selection-change="onSelect"
      >
        <el-table-column type="selection" width="46" align="center" />
        <el-table-column prop="name" label="小程序" min-width="140" show-overflow-tooltip />
        <el-table-column prop="category" label="类目" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.category || "—" }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || "—" }}</template>
        </el-table-column>
        <el-table-column prop="appId" label="AppID" min-width="200" show-overflow-tooltip />
        <el-table-column label="审核状态" width="120" align="center">
          <template #default="{ row }">
            <span class="audit" :class="{ ok: row.auditStatus === 'AUDIT_ACCEPTED' }" :title="row.reason || ''">{{ row.auditLabel }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="170" align="center">
          <template #default="{ row }">{{ row.createTime || "—" }}</template>
        </el-table-column>
        <el-table-column prop="modifyTime" label="更新时间" width="170" align="center">
          <template #default="{ row }">{{ row.modifyTime || "—" }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="danger" @click="removeOne(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="addVisible" title="从巨量添加" width="980px">
      <p class="import-hint">拉的是投放户上已经共享、并且审核通过的小程序。勾选后加进当前版权「{{ copyright }}」，不会自动全加。</p>
      <div class="import-bar">
        <el-input v-model="keyword" placeholder="小程序名称或 AppID" clearable clear-icon="Close" @keyup.enter="search" />
        <el-button type="primary" :loading="searching" @click="search">搜索</el-button>
      </div>
      <el-table
        :data="oceanRows"
        v-loading="searching"
        border
        height="360"
        row-key="appId"
        @selection-change="onOceanSelect"
      >
        <el-table-column type="selection" width="46" align="center" :selectable="(row) => !row.added" />
        <el-table-column prop="name" label="小程序" min-width="140" show-overflow-tooltip />
        <el-table-column prop="category" label="类目" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.category || "—" }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || "—" }}</template>
        </el-table-column>
        <el-table-column prop="appId" label="AppID" min-width="180" show-overflow-tooltip />
        <el-table-column prop="auditLabel" label="审核状态" width="110" align="center" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">{{ row.added ? "已添加" : "未添加" }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="addVisible = false">关闭</el-button>
        <el-button type="primary" :loading="adding" :disabled="!oceanSelected.length" @click="addChosen">添加所选</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup name="novelOceanMiniApps">
import request from "@/request"
import { readCopyright, writeCopyright } from "../shared"

const loading = ref(false)
const searching = ref(false)
const adding = ref(false)
const refreshing = ref(false)
const rows = ref([])
const copyright = ref(readCopyright())
const selected = ref([])
const addVisible = ref(false)
const keyword = ref("")
const oceanRows = ref([])
const oceanSelected = ref([])

const tabs = computed(() => {
  const list = ["点众", "番茄"].map((name) => ({ name, label: name }))
  if (rows.value.some((item) => !item.copyrightOwner)) list.push({ name: "__unset__", label: "未设置" })
  return list
})
const shown = computed(() =>
  rows.value.filter((item) => (copyright.value === "__unset__" ? !item.copyrightOwner : item.copyrightOwner === copyright.value)),
)

const centerHeaders = new Set(["审核状态", "创建时间", "更新时间", "操作"])

function headerStyle({ column }) {
  const label = column && (column.label || "")
  if (centerHeaders.has(label) || column.type === "selection") return { "text-align": "center" }
  return { "text-align": "left" }
}

onMounted(load)

async function load() {
  loading.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/mini-apps" })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取失败")
      return
    }
    rows.value = (res.data && res.data.list) || []
  } finally {
    loading.value = false
  }
}

async function refreshOcean() {
  refreshing.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/mini-apps/refresh", method: "POST", timeout: 120000 })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "同步失败")
      return
    }
    rows.value = (res.data && res.data.list) || []
    ElMessage.success("已同步审核状态和类目")
  } finally {
    refreshing.value = false
  }
}

function onCopyrightTab() {
  writeCopyright(copyright.value)
}

function onSelect(list) {
  selected.value = list || []
}

function openAdd() {
  if (copyright.value === "__unset__") return
  keyword.value = ""
  oceanRows.value = []
  oceanSelected.value = []
  addVisible.value = true
  search()
}

async function search() {
  searching.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/mini-apps/search",
      timeout: 120000,
      params: { keyword: keyword.value.trim() },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取失败")
      return
    }
    oceanRows.value = (res.data && res.data.list) || []
  } finally {
    searching.value = false
  }
}

function onOceanSelect(list) {
  oceanSelected.value = (list || []).filter((item) => !item.added)
}

async function addChosen() {
  adding.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/mini-apps",
      method: "POST",
      data: {
        copyrightOwner: copyright.value,
        items: oceanSelected.value.map((item) => ({
          appId: item.appId,
          name: item.name,
          auditStatus: item.auditStatus,
          remark: item.remark,
          category: item.category,
          createTime: item.createTime,
          modifyTime: item.modifyTime,
          reason: item.reason,
          ebpAsset: item.ebpAsset,
        })),
      },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "添加失败")
      return
    }
    rows.value = (res.data && res.data.list) || []
    addVisible.value = false
    ElMessage.success(`已添加 ${res.data.count || oceanSelected.value.length} 个`)
  } finally {
    adding.value = false
  }
}

async function removeIds(ids) {
  const res = await request({
    url: "/admin-api/oceanengine/mini-apps/remove",
    method: "POST",
    data: { appIds: ids },
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "移除失败")
    return
  }
  rows.value = (res.data && res.data.list) || []
  selected.value = []
  if (copyright.value === "__unset__" && !rows.value.some((item) => !item.copyrightOwner)) copyright.value = "点众"
}

function removeOne(row) {
  removeIds([row.appId])
}

function removeSelected() {
  removeIds(selected.value.map((item) => item.appId))
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.ocean-mini-apps.page-container {
  padding-top: 0;
}

.copyright-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 12px;
  }

  :deep(.el-tabs__content) {
    display: none;
  }
}

.hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.audit.ok {
  color: var(--el-color-success);
}

.import-hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.import-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
</style>
