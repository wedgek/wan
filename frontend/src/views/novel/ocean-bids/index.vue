<template>
  <div class="page-container novel-page has-toolbar ocean-bids">
    <template v-if="mode === 'list'">
      <div class="page-table-header">
        <div class="page-table-header-left">
          <el-button type="primary" :icon="$icons.Plus" @click="openCreate">新建出价策略</el-button>
          <el-button :icon="$icons.Refresh" :loading="loading" @click="loadList">刷新</el-button>
        </div>
        <span class="hint">一套策略就是一张档位出价表。用名字区分，策略模板里选其中一套。</span>
      </div>
      <div class="page-table-box table-wrap">
        <el-table :data="list" v-loading="loading" border height="100%">
          <el-table-column prop="name" label="策略名称" min-width="160" show-overflow-tooltip />
          <el-table-column prop="summary" label="档位出价" min-width="360" show-overflow-tooltip />
          <el-table-column prop="updatedAt" label="更新时间" width="170" align="center" />
          <el-table-column label="操作" width="196" align="center" fixed="right">
            <template #default="{ row }">
              <div class="ops">
                <el-button type="primary" link @click="openCopy(row)">复制</el-button>
                <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
                <el-button type="danger" link @click="removeRow(row)">删除</el-button>
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <div class="empty-box">
              <p>还没有出价策略</p>
              <el-button type="primary" @click="openCreate">先建一套</el-button>
            </div>
          </template>
        </el-table>
      </div>
    </template>

    <template v-else>
      <div class="editor-page">
        <div class="editor-head">
          <el-button @click="mode = 'list'">返回列表</el-button>
          <el-button type="primary" :loading="saving" @click="save">{{ form.id ? "保存策略" : "保存为新策略" }}</el-button>
          <p v-if="copiedFrom" class="hint">已带入「{{ copiedFrom }}」，保存后新增一条。</p>
        </div>
        <div class="sheet">
          <section class="block">
            <h3>出价策略</h3>
            <p class="hint intro">每套只保留档位和出价。名字用来区分，比如「付费ROI」和「付费」，策略模板里选一套。</p>
            <div class="name-row">
              <label>名称</label>
              <el-input v-model="form.name" maxlength="40" placeholder="例如 付费ROI" />
            </div>
            <div class="tiers">
              <div class="tier-head">
                <span>档位</span>
                <span>出价</span>
                <span></span>
              </div>
              <div v-for="(row, index) in form.tiers" :key="index" class="tier-row">
                <el-input v-model="row.tier" placeholder="1.9" />
                <el-input-number v-model="row.bid" :min="0.01" :max="9999" :step="0.01" :precision="2" @focus="selectInput" />
                <el-button type="danger" link :disabled="form.tiers.length <= 1" @click="form.tiers.splice(index, 1)">删除</el-button>
              </div>
            </div>
            <el-button class="add" @click="addTier">加一档</el-button>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup name="novelOceanBids">
import request from "@/request"

const defaultTiers = () => [
  { tier: "1.9", bid: 2.1 },
  { tier: "2.9", bid: 3.1 },
  { tier: "3.9", bid: 4.1 },
  { tier: "9.9", bid: 13 },
  { tier: "29.9", bid: 32 },
  { tier: "39.9", bid: 43 },
]

const emptyForm = () => ({ id: 0, name: "", tiers: defaultTiers() })

const mode = ref("list")
const list = ref([])
const form = ref(emptyForm())
const loading = ref(false)
const saving = ref(false)
const copiedFrom = ref("")

function selectInput(event) {
  const target = event && event.target
  if (target && typeof target.select === "function") target.select()
}

function copyTiers(rows) {
  return (Array.isArray(rows) && rows.length ? rows : defaultTiers()).map((item) => ({
    tier: String(item.tier || ""),
    bid: Number(item.bid != null ? item.bid : item.roiBid) || 0,
  }))
}

function addTier() {
  form.value.tiers.push({ tier: "", bid: 1 })
}

async function loadList() {
  loading.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/bid-strategies" })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取出价策略失败")
      return
    }
    list.value = res.data || []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.value = emptyForm()
  copiedFrom.value = ""
  mode.value = "edit"
}

function openEdit(row) {
  form.value = { id: row.id, name: row.name, tiers: copyTiers(row.tiers) }
  copiedFrom.value = ""
  mode.value = "edit"
}

function copyName(name) {
  const base = String(name || "").trim() || "出价策略"
  const used = new Set(list.value.map((item) => item.name))
  for (let n = 1; n <= 99; n += 1) {
    const suffix = n === 1 ? " 副本" : ` 副本${n}`
    const next = `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`
    if (!used.has(next)) return next
  }
  return `${base.slice(0, 36)} 副本`
}

function openCopy(row) {
  form.value = { id: 0, name: copyName(row.name), tiers: copyTiers(row.tiers) }
  copiedFrom.value = row.name
  mode.value = "edit"
}

async function save() {
  const name = String(form.value.name || "").trim()
  if (!name) {
    ElMessage.error("请填写策略名称")
    return
  }
  const tiers = form.value.tiers
    .map((item) => ({
      tier: String(item.tier || "").trim(),
      bid: Number(item.bid),
    }))
    .filter((item) => item.tier)
  if (!tiers.length) {
    ElMessage.error("至少留一档")
    return
  }
  saving.value = true
  try {
    const creating = !form.value.id
    const res = await request({
      url: creating ? "/admin-api/oceanengine/bid-strategies" : `/admin-api/oceanengine/bid-strategies/${form.value.id}`,
      method: creating ? "POST" : "PUT",
      data: { name, tiers },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "保存失败")
      return
    }
    ElMessage.success(creating ? "已新增出价策略" : "出价策略已保存")
    copiedFrom.value = ""
    await loadList()
    mode.value = "list"
  } finally {
    saving.value = false
  }
}

async function removeRow(row) {
  try {
    await ElMessageBox.confirm(`删除出价策略「${row.name}」？引用它的策略模板会回到剩下的默认一套。`, "删除出价策略", {
      type: "warning",
      confirmButtonText: "删除",
    })
  } catch {
    return
  }
  const res = await request({ url: `/admin-api/oceanengine/bid-strategies/${row.id}`, method: "DELETE" })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "删除失败")
    return
  }
  ElMessage.success("出价策略已删除")
  loadList()
}

onMounted(loadList)
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.ocean-bids.page-container {
  overflow: hidden;
}

.page-table-header {
  align-items: center;
}

.page-table-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.empty-box {
  padding: 48px 0;
  color: var(--el-text-color-secondary);
}

.empty-box p {
  margin: 0 0 12px;
}

.ops {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
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

.editor-head .hint {
  margin: 0;
}

.sheet {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 16px;
}

.block {
  padding: 16px 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.block h3 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 650;
}

.intro {
  margin: 0 0 14px;
}

.hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.name-row {
  display: grid;
  grid-template-columns: 72px minmax(220px, 360px);
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
}

.name-row label {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.tiers {
  max-width: 460px;
}

.tier-head,
.tier-row {
  display: grid;
  grid-template-columns: 120px 180px 52px;
  gap: 8px;
  align-items: center;
}

.tier-head {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.tier-row + .tier-row {
  margin-top: 8px;
}

.tier-row :deep(.el-input-number) {
  width: 100%;
}

.add {
  margin-top: 12px;
}
</style>
