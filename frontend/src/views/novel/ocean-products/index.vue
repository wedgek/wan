<template>
  <div class="page-container novel-page has-toolbar novel-ocean-products">
    <div class="build-panel">
      <el-input
        v-model="bookText"
        type="textarea"
        :rows="8"
        placeholder="一本书一行&#10;可我只是来捞一顿海底捞&#10;心头血浇的海棠，萧瑟在凤仪时"
      />
      <div class="build-actions">
        <el-button type="primary" :loading="building" @click="buildProducts">批量添加</el-button>
        <span class="usage-label">添加到</span>
        <div class="usage-tags">
          <el-tag v-for="item in enabledLibraries" :key="item.id" size="small" effect="plain">{{ item.name }}</el-tag>
          <span v-if="usageReady && !enabledLibraries.length" class="usage-empty">未开启</span>
        </div>
        <p v-if="usageReady && enabledLibraries.length" class="build-note">当前 {{ enabledLibraries.length }} 个库，每本书各建 {{ enabledLibraries.length }} 条。模板、封面随机，重名加编号。</p>
        <p v-else-if="usageReady" class="build-note">先在「商品库」里打开要添加的库。</p>
      </div>
      <el-table v-if="failures.length" :data="failures" border size="small" class="build-result">
        <el-table-column prop="book" label="输入书名" min-width="140" show-overflow-tooltip />
        <el-table-column prop="libraryName" label="商品库" min-width="140" show-overflow-tooltip />
        <el-table-column prop="error" label="失败原因" min-width="240" show-overflow-tooltip />
      </el-table>
    </div>

    <el-tabs v-model="tab" class="ocean-tabs">
      <el-tab-pane label="商品" name="build">
        <div class="build-pane">
        <div class="page-table-header">
          <div class="header-search">
            <el-input
              v-model="tableParams.keyword"
              placeholder="书名 / 商品ID"
              class="filter-input-keyword"
              clearable
              clear-icon="Close"
              @keyup.enter="tableSearch"
              @clear="tableSearch"
            />
            <el-select
              v-model="tableParams.platformId"
              placeholder="商品库"
              class="filter-select"
              clearable
              clear-icon="Close"
              @change="tableSearch"
              @clear="tableSearch"
            >
              <el-option v-for="item in catalogLibraries" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
            <el-select
              v-model="tableParams.status"
              placeholder="状态"
              class="filter-select-sm"
              clearable
              clear-icon="Close"
              @change="tableSearch"
              @clear="tableSearch"
            >
              <el-option label="可投放" value="可投放" />
              <el-option label="不可投放" value="不可投放" />
              <el-option label="审核中" value="审核中" />
              <el-option label="审核未通过" value="审核未通过" />
            </el-select>
            <el-button type="primary" @click="tableSearch">查询</el-button>
            <el-button @click="resetTable">重置</el-button>
          </div>
          <el-button :icon="$icons.Refresh" :loading="syncing" @click="syncRemote()">从巨量同步</el-button>
        </div>

        <div class="page-table-box table-wrap">
          <el-table :data="tableData" v-loading="tableLoading || syncing || building" border height="100%" :header-cell-style="{ 'text-align': 'center' }">
            <el-table-column prop="name" label="商品名称" min-width="180" show-overflow-tooltip />
            <el-table-column prop="productId" label="商品ID" width="180" align="center" />
            <el-table-column prop="platformName" label="商品库" min-width="140" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="110" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.status" :type="statusTag(row.status)" size="small" effect="plain">{{ row.status }}</el-tag>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column prop="firstCategory" label="一级分类" width="100" align="center" show-overflow-tooltip />
            <el-table-column prop="subCategory" label="二级分类" width="110" align="center" show-overflow-tooltip />
            <el-table-column prop="thirdCategory" label="三级分类" width="110" align="center" show-overflow-tooltip />
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
        </div>
      </el-tab-pane>

      <el-tab-pane label="商品库" name="libraries">
        <p class="hint pane-hint">这里打开几个，批量添加时就进几个库。一本书会在每个打开的库里各建一条。小说库用「小说搭建模板」，漫剧库按现有必填项。</p>
        <el-table :data="libraries" v-loading="configLoading" border>
          <el-table-column label="投入使用" width="120" align="center">
            <template #default="{ row }">
              <el-switch :model-value="row.enabled" @change="(v) => toggleLibrary(row, v)" />
            </template>
          </el-table-column>
          <el-table-column prop="name" label="商品库" min-width="180" show-overflow-tooltip />
          <el-table-column prop="industry" label="类型" width="120" align="center" />
          <el-table-column prop="id" label="商品库 ID" width="180" align="center" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="小说搭建模板" name="templates">
        <div class="page-table-header section-head">
          <el-button type="primary" :icon="$icons.Plus" @click="openEdit()">新增模板</el-button>
          <p class="hint">添加时从已开启的模板里随机取。同一本书进多个小说库时用同一个模板。书名和商品图不在模板里。</p>
        </div>
        <el-table :data="templates" v-loading="configLoading" border>
          <el-table-column prop="name" label="模板" min-width="140" show-overflow-tooltip />
          <el-table-column prop="categoryLabel" label="品类" min-width="160" align="center" show-overflow-tooltip />
          <el-table-column prop="gender" label="男女频" width="100" align="center" />
          <el-table-column prop="charCount" label="字数" width="100" align="center" />
          <el-table-column prop="payStartChapter" label="起始章节" width="100" align="center" />
          <el-table-column prop="chapterPrice" label="单章价格" width="100" align="center" />
          <el-table-column prop="copyrightOwner" label="版权方" width="100" align="center" />
          <el-table-column prop="author" label="作者" width="100" align="center" />
          <el-table-column label="投入使用" width="110" align="center">
            <template #default="{ row }">
              <el-switch :model-value="row.enabled" @change="(v) => toggleTemplate(row, v)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
              <el-button type="danger" link @click="removeTemplate(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="editVisible" :title="form.id ? '编辑模板' : '新增模板'" width="480px" append-to-body destroy-on-close>
      <el-form label-width="108px">
        <el-form-item label="模板名称" required>
          <el-input v-model="form.name" maxlength="40" placeholder="例如：古代言情·男频" />
        </el-form-item>
        <el-form-item label="书籍品类" required>
          <el-select v-model="form.categoryKey" style="width: 100%">
            <el-option v-for="item in categories" :key="item.key" :label="item.label" :value="item.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="男女频" required>
          <el-select v-model="form.gender" style="width: 100%">
            <el-option label="男频书" value="男频书" />
            <el-option label="女频书" value="女频书" />
            <el-option label="其他" value="其他" />
          </el-select>
        </el-form-item>
        <el-form-item label="全篇字数" required>
          <el-select v-model="form.charCount" style="width: 100%">
            <el-option label="1w-10w" value="1w-10w" />
            <el-option label="10w-20w" value="10w-20w" />
            <el-option label="20w+" value="20w+" />
          </el-select>
        </el-form-item>
        <el-form-item label="起始付费章节" required>
          <el-input v-model="form.payStartChapter" />
        </el-form-item>
        <el-form-item label="单章价格" required>
          <el-input v-model="form.chapterPrice" />
        </el-form-item>
        <el-form-item label="版权方" required>
          <el-input v-model="form.copyrightOwner" maxlength="100" />
        </el-form-item>
        <el-form-item label="作者" required>
          <el-input v-model="form.author" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveTemplate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup name="novelOceanProducts">
import { useTable } from "@/hooks/useTable"
import CzPagination from "@/components/cz-pagination/index.vue"
import request from "@/request"

const tab = ref("build")
const syncing = ref(false)
const building = ref(false)
const configLoading = ref(false)
const saving = ref(false)
const bookText = ref("")
const failures = ref([])
const libraries = ref([])
const templates = ref([])
const usageReady = ref(false)
const enabledLibraries = computed(() => libraries.value.filter((item) => item.enabled))
let usageStamp = 0
const categories = ref([])
const editVisible = ref(false)
const configLoaded = ref(false)
const form = reactive({
  id: null,
  name: "",
  categoryKey: "ancient",
  gender: "男频书",
  charCount: "1w-10w",
  payStartChapter: "0",
  chapterPrice: "1",
  copyrightOwner: "点众",
  author: "无名",
})

const catalogLibraries = ref([])

const defaultTableParams = () => ({
  keyword: "",
  platformId: "",
  status: "",
  pageNo: 1,
  pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } = useTable(
  "/admin-api/oceanengine/products/page",
  defaultTableParams,
  {
    onSuccess(data, ctx) {
      ctx.tableData.value = data.list || []
      ctx.tableTotal.value = data.total || 0
      catalogLibraries.value = data.libraries || []
    },
  },
)

function statusTag(status) {
  if (status === "可投放") return "success"
  if (status === "审核未通过") return "danger"
  if (status === "审核中") return "warning"
  return "info"
}

onMounted(() => {
  getTableData()
  loadUsage()
})

watch(tab, (name) => {
  if (name !== "build" && !configLoaded.value) loadConfig()
})

async function loadUsage() {
  const stamp = usageStamp
  const res = await request({ url: "/admin-api/oceanengine/settings", params: { scope: "usage" } })
  if (stamp !== usageStamp || res.code !== 0 || configLoaded.value) return
  const data = res.data || {}
  libraries.value = data.libraries || []
  templates.value = data.templates || []
  if (Array.isArray(data.categories) && data.categories.length) categories.value = data.categories
  usageReady.value = true
}

async function loadConfig() {
  usageStamp += 1
  configLoading.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/settings", timeout: 30000 })
    if (res.code !== 0) return
    const data = res.data || {}
    libraries.value = data.libraries || []
    templates.value = data.templates || []
    if (Array.isArray(data.categories) && data.categories.length) categories.value = data.categories
    configLoaded.value = true
    usageReady.value = true
  } finally {
    configLoading.value = false
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

async function refreshCreated(rows) {
  const groups = new Map()
  for (const row of rows) {
    const list = groups.get(row.libraryId) || []
    list.push(row.productId)
    groups.set(row.libraryId, list)
  }
  const responses = await Promise.all(
    [...groups].map(async ([platformId, productIds]) => {
      try {
        return await request({
          url: "/admin-api/oceanengine/products/refresh",
          method: "POST",
          timeout: 30000,
          data: { platformId, productIds },
        })
      } catch {
        return null
      }
    }),
  )
  if (responses.some((res) => res && res.code === 0 && res.data && res.data.count)) await getTableData()
}

async function syncRemote(platformIds) {
  syncing.value = true
  try {
    const ids = Array.isArray(platformIds) && platformIds.length ? platformIds : [""]
    for (const platformId of ids) {
      const res = await request({
        url: "/admin-api/oceanengine/products/sync",
        method: "POST",
        timeout: 180000,
        data: { platformId },
      })
      if (res.code !== 0) {
        ElMessage.error(res.msg || "同步失败")
        return false
      }
    }
    await getTableData()
    return true
  } finally {
    syncing.value = false
  }
}

async function buildProducts() {
  const names = String(bookText.value || "").trim()
  if (!names) {
    ElMessage.warning("请填写书名")
    return
  }
  building.value = true
  failures.value = []
  try {
    const res = await request({
      url: "/admin-api/oceanengine/products/batch",
      method: "POST",
      timeout: 180000,
      data: { names },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "添加失败")
      return
    }
    const results = (res.data && res.data.results) || []
    failures.value = results.filter((item) => item.error)
    const okCount = results.length - failures.value.length
    if (okCount) {
      const renamed = results.filter((item) => !item.error && item.renamed)
      const libraries = new Set(renamed.map((item) => item.libraryName).filter(Boolean))
      const lines = renamed.slice(0, 6).map((item) => {
        const where = libraries.size > 1 && item.libraryName ? `（${item.libraryName}）` : ""
        return `「${item.book}」改为「${item.name}」${where}`
      })
      if (renamed.length > 6) lines.push(`等 ${renamed.length} 条`)
      const headline = failures.value.length ? `成功 ${okCount} 条，失败 ${failures.value.length} 条` : `已添加 ${okCount} 条`
      ElMessage.success({
        message: [headline, ...lines].map(escapeHtml).join("<br>"),
        dangerouslyUseHTMLString: true,
        duration: lines.length ? 8000 : 3000,
        showClose: true,
      })
      if (!failures.value.length) bookText.value = ""
      tableParams.pageNo = 1
      await getTableData()
      refreshCreated(results.filter((item) => !item.error && item.productId))
    } else if (failures.value.length) {
      ElMessage.error(`失败 ${failures.value.length} 条`)
    }
  } finally {
    building.value = false
  }
}

async function toggleLibrary(row, enabled) {
  const prev = row.enabled
  row.enabled = enabled
  const res = await request({
    url: "/admin-api/oceanengine/libraries/enabled",
    method: "POST",
    data: { platformId: row.id, enabled },
  })
  if (res.code !== 0) {
    row.enabled = prev
    ElMessage.error(res.msg || "更新失败")
  }
}

function openEdit(row) {
  form.id = row ? row.id : null
  form.name = row ? row.name : ""
  form.categoryKey = row ? row.categoryKey : "ancient"
  form.gender = row ? row.gender : "男频书"
  form.charCount = row ? row.charCount : "1w-10w"
  form.payStartChapter = row ? row.payStartChapter : "0"
  form.chapterPrice = row ? row.chapterPrice : "1"
  form.copyrightOwner = row ? row.copyrightOwner : "点众"
  form.author = row ? row.author : "无名"
  editVisible.value = true
}

async function saveTemplate() {
  if (!String(form.name || "").trim()) {
    ElMessage.warning("请填写模板名称")
    return
  }
  saving.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/templates", method: "POST", data: { ...form } })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "保存失败")
      return
    }
    editVisible.value = false
    await loadConfig()
  } finally {
    saving.value = false
  }
}

async function toggleTemplate(row, enabled) {
  const prev = row.enabled
  row.enabled = enabled
  const res = await request({
    url: `/admin-api/oceanengine/templates/${row.id}/enabled`,
    method: "POST",
    data: { enabled },
  })
  if (res.code !== 0) {
    row.enabled = prev
    ElMessage.error(res.msg || "更新失败")
  }
}

async function removeTemplate(row) {
  const res = await request({ url: `/admin-api/oceanengine/templates/${row.id}`, method: "DELETE" })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "删除失败")
    return
  }
  templates.value = templates.value.filter((item) => item.id !== row.id)
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.ocean-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;

  :deep(.el-tabs__header) {
    flex-shrink: 0;
  }

  :deep(.el-tabs__content) {
    flex: 1;
    min-height: 0;
  }

  :deep(.el-tab-pane) {
    height: 100%;
    overflow: auto;
  }
}

.build-pane {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.build-panel {
  margin-bottom: 12px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.usage-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  white-space: nowrap;
}

.build-note {
  margin: 0 0 0 auto;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.build-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.build-actions .el-button {
  flex-shrink: 0;
}

.usage-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.usage-empty {
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

.hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.pane-hint {
  margin-bottom: 12px;
}

.section-head {
  margin-bottom: 12px;
  gap: 16px;
}

.section-head .hint {
  flex: 1;
  min-width: 0;
  text-align: right;
}

.build-result {
  margin-top: 12px;
}

.header-search {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.header-search .filter-input-keyword {
  width: 200px;
}

.header-search .filter-select {
  width: 168px;
}

.header-search .filter-select-sm {
  width: 120px;
}

.build-panel,
.page-table-header,
.page-pagination-box {
  flex-shrink: 0;
}
</style>
