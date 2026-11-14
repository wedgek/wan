<template>
  <div class="page-container novel-page has-toolbar ocean-titles">
    <template v-if="mode === 'list'">
      <div class="page-table-header">
        <div class="page-table-header-left">
          <el-input
            v-model="keyword"
            placeholder="搜索标题包名称"
            clearable
            clear-icon="Close"
            class="filter-input-keyword"
            @keyup.enter="noop"
          />
          <el-button type="primary" :icon="$icons.Plus" @click="openCreate">新增标题包</el-button>
          <el-button :icon="$icons.Refresh" :loading="loading" @click="loadList">刷新</el-button>
        </div>
        <span class="hint">一个标题包就是一批标题。粘贴时会去掉 #话题、按巨量 5 到 55 个字处理。投放时随机抽最多 30 条。</span>
      </div>
      <div class="page-table-box table-wrap">
        <el-table :data="visibleList" v-loading="loading" border height="100%">
          <el-table-column prop="name" label="标题包名称" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <el-button type="primary" link class="name-link" @click="openDetail(row)">{{ row.name }}</el-button>
            </template>
          </el-table-column>
          <el-table-column prop="titleCount" label="标题数" width="90" align="center" />
          <el-table-column prop="preview" label="预览" min-width="280" show-overflow-tooltip />
          <el-table-column prop="updatedAt" label="更新时间" width="170" align="center" />
          <el-table-column label="操作" width="180" align="center" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="openDetail(row)">详情</el-button>
              <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
              <el-button type="danger" link @click="removeRow(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <div class="empty-box">
              <p>还没有标题包</p>
              <el-button type="primary" @click="openCreate">先建一个</el-button>
            </div>
          </template>
        </el-table>
      </div>
    </template>

    <template v-else>
      <div class="editor-page">
        <div class="editor-head">
          <el-button @click="mode = 'list'">返回列表</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存标题包</el-button>
        </div>
        <div class="sheet">
          <section class="block">
            <h3>标题包</h3>
            <div class="grid">
              <label>名称</label>
              <el-input v-model="form.name" maxlength="40" placeholder="例如 小说通用 / 悬疑催读" />
              <label>标题</label>
              <div class="titles-field">
                <el-input
                  v-model="form.titlesText"
                  type="textarea"
                  :rows="16"
                  placeholder="一行一条。话题标签会自动去掉，超长会按巨量 5 到 55 个字裁一下。投放时从这个包里随机抽，最多 30 条。"
                />
                <p class="hint">{{ titleHint }}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <el-drawer v-model="detailVisible" :title="detailTitle" size="560px" destroy-on-close>
      <div class="detail-body" v-loading="detailLoading">
        <div class="detail-meta">
          <span>{{ detailCount }} 条标题</span>
          <span v-if="detail.updatedAt">更新于 {{ detail.updatedAt }}</span>
        </div>
        <el-input
          v-model="detailKeyword"
          placeholder="搜索标题"
          clearable
          clear-icon="Close"
          class="detail-search"
        />
        <el-table :data="visibleDetailTitles" border height="100%" empty-text="这个标题包里还没有标题">
          <el-table-column type="index" label="#" width="56" align="center" />
          <el-table-column prop="text" label="标题" min-width="240" />
          <el-table-column label="字数" width="70" align="center">
            <template #default="{ row }">{{ row.text.length }}</template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="editFromDetail">编辑这个包</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup name="novelOceanTitles">
import request from "@/request"

const emptyForm = () => ({ id: 0, name: "", titlesText: "" })

const emptyDetail = () => ({ id: 0, name: "", titles: [], updatedAt: "" })

const mode = ref("list")
const list = ref([])
const keyword = ref("")
const form = ref(emptyForm())
const loading = ref(false)
const saving = ref(false)
const detailVisible = ref(false)
const detailLoading = ref(false)
const detailKeyword = ref("")
const detail = ref(emptyDetail())

const visibleList = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  if (!key) return list.value
  return list.value.filter((item) => String(item.name || "").toLowerCase().includes(key))
})
const titleHint = computed(() => {
  const lines = String(form.value.titlesText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const ok = lines.filter((line) => {
    const text = line.replace(/#+\s*[^\s#]*/g, " ").replace(/\s+/g, " ").trim()
    return text.length >= 5
  })
  const bad = lines.length - ok.length
  if (!lines.length) return "还没有标题"
  return `约 ${ok.length} 条可用` + (bad ? `，${bad} 条太短会跳过` : "") + "。#话题会去掉，超长按巨量 55 字裁切，投放时随机抽最多 30 条。"
})
const detailTitle = computed(() => (detail.value.name ? `标题包 · ${detail.value.name}` : "标题包详情"))
const detailCount = computed(() => (detail.value.titles || []).length)
const visibleDetailTitles = computed(() => {
  const titles = (detail.value.titles || []).map((text) => ({ text }))
  const key = detailKeyword.value.trim().toLowerCase()
  if (!key) return titles
  return titles.filter((item) => item.text.toLowerCase().includes(key))
})

function noop() {}

async function loadList() {
  loading.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/title-libraries" })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取标题包失败")
      return
    }
    list.value = res.data || []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.value = emptyForm()
  mode.value = "edit"
}

async function fetchPack(id) {
  const res = await request({ url: `/admin-api/oceanengine/title-libraries/${id}` })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "读取标题包失败")
    return null
  }
  return res.data || null
}

function applyPack(pack) {
  form.value = {
    id: pack.id,
    name: pack.name || "",
    titlesText: (pack.titles || []).join("\n"),
  }
}

async function openDetail(row) {
  detailKeyword.value = ""
  detail.value = {
    id: row.id,
    name: row.name || "",
    titles: row.titles || [],
    updatedAt: row.updatedAt || "",
  }
  detailVisible.value = true
  detailLoading.value = true
  try {
    const pack = await fetchPack(row.id)
    if (!pack) return
    detail.value = {
      id: pack.id,
      name: pack.name || "",
      titles: pack.titles || [],
      updatedAt: pack.updatedAt || "",
    }
  } finally {
    detailLoading.value = false
  }
}

function editFromDetail() {
  const pack = detail.value
  detailVisible.value = false
  if (!pack.id) return
  applyPack(pack)
  mode.value = "edit"
}

async function openEdit(row) {
  const pack = await fetchPack(row.id)
  if (!pack) return
  applyPack(pack)
  mode.value = "edit"
}

async function save() {
  if (!String(form.value.name || "").trim()) {
    ElMessage.warning("请填写标题包名称")
    return
  }
  saving.value = true
  try {
    const creating = !form.value.id
    const res = await request({
      url: creating ? "/admin-api/oceanengine/title-libraries" : `/admin-api/oceanengine/title-libraries/${form.value.id}`,
      method: creating ? "POST" : "PUT",
      data: form.value,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "保存失败")
      return
    }
    const skipped = res.data && res.data.skipped
    ElMessage.success(skipped ? `已保存，跳过 ${skipped} 条不合格标题` : "标题包已保存")
    await loadList()
    mode.value = "list"
  } finally {
    saving.value = false
  }
}

async function removeRow(row) {
  try {
    await ElMessageBox.confirm(`删除标题包「${row.name}」以及里面的标题？`, "删除标题包", {
      type: "warning",
      confirmButtonText: "删除",
    })
  } catch {
    return
  }
  const res = await request({ url: `/admin-api/oceanengine/title-libraries/${row.id}`, method: "DELETE" })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "删除失败")
    return
  }
  ElMessage.success("已删除")
  loadList()
}

onMounted(loadList)
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.ocean-titles.page-container {
  overflow: hidden;
}

.page-table-header {
  align-items: center;
}

.page-table-header-left {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 12px;
}

.filter-input-keyword {
  width: 220px;
}

.empty-box {
  padding: 48px 0;
  color: var(--el-text-color-secondary);
}

.empty-box p {
  margin: 0 0 12px;
}

.editor-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 12px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.sheet {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 16px;
}

.block {
  margin-bottom: 12px;
  padding: 16px 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.block h3 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 650;
}

.hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.grid {
  display: grid;
  grid-template-columns: 88px minmax(280px, 720px);
  gap: 12px 16px;
  align-items: start;
}

.grid label {
  padding-top: 6px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.titles-field .hint {
  margin-top: 8px;
}

.name-link {
  padding: 0;
  height: auto;
  font-weight: 600;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100vh - 160px);
  min-height: 360px;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.detail-search {
  width: 100%;
}
</style>
