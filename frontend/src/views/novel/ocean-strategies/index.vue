<template>
  <div class="page-container novel-page has-toolbar has-copyright-tabs ocean-strategies">
    <template v-if="mode === 'list'">
      <el-tabs v-model="copyright" class="copyright-tabs" @tab-change="onCopyrightTab">
        <el-tab-pane v-for="item in copyrightTabs" :key="item.name" :name="item.name" :label="item.label" />
      </el-tabs>
      <div class="page-table-header">
        <div class="page-table-header-left">
          <el-button type="primary" :icon="$icons.Plus" @click="openCreate">新建策略</el-button>
          <el-button :icon="$icons.Refresh" :loading="loading" @click="loadList">刷新</el-button>
        </div>
          <span class="hint">一套策略对应一个小程序。先把模板配好，搭建计划时再选户、商品和链接。</span>
      </div>
      <div class="page-table-box table-wrap">
        <el-table :data="shown" v-loading="loading" border height="100%">
          <el-table-column prop="name" label="策略名称" min-width="160" show-overflow-tooltip />
          <el-table-column label="版权方" width="100" align="center">
            <template #default="{ row }">{{ row.copyrightOwner || "—" }}</template>
          </el-table-column>
          <el-table-column prop="summary" label="模板内容" min-width="280" show-overflow-tooltip />
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
              <p>还没有策略模板</p>
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
        <p v-if="copiedFrom" class="hint editor-hint">已带入「{{ copiedFrom }}」的配置，保存后新增一条，不会改原来的。</p>
      </div>
      <div class="sheet">
        <section v-for="section in STRATEGY_SECTIONS" :key="section.key" class="block">
          <h3>{{ section.title }}</h3>
          <p v-if="section.hint" class="locked">{{ section.hint }}</p>
          <div class="grid">
            <template v-for="field in section.fields" :key="field.key">
              <template v-if="fieldVisible(field)">
                <label>{{ field.label }}</label>
                <div>
                  <el-select
                    v-if="field.widget === 'miniApp'"
                    v-model="form.microAppId"
                    filterable
                    :loading="miniAppsLoading"
                    placeholder="选择线上已过审的小程序"
                    no-data-text="在投账户里还没有已过审小程序"
                    @change="onMiniAppChange"
                  >
                    <el-option
                      v-for="item in miniAppOptions"
                      :key="item.appId"
                      :label="miniAppLabel(item)"
                      :value="item.appId"
                    />
                  </el-select>
                  <p v-if="field.widget === 'miniApp' && form.microAppId && form.copyrightOwner" class="hint">版权方 {{ form.copyrightOwner }}，跟这个小程序走。</p>
                  <p v-else-if="field.widget === 'miniApp' && form.microAppId" class="hint">这个小程序还没设版权方。到「小程序」页补上后再选一次。</p>
                  <p v-else-if="field.widget === 'miniApp' && activeCopyright" class="hint">还没有版权方是{{ activeCopyright }}的小程序。到「小程序」页标好后再选。</p>
                  <el-select
                    v-else-if="field.widget === 'aweme'"
                    v-model="form.awemeId"
                    filterable
                    :loading="awemesLoading"
                    placeholder="选择已授权的抖音号"
                    no-data-text="这个户还没有已授权的抖音号"
                    @change="onAwemeChange"
                  >
                    <el-option
                      v-for="item in awemes"
                      :key="item.awemeId"
                      :label="item.awemeName || item.awemeId"
                      :value="item.awemeId"
                    />
                  </el-select>
                  <el-input
                    v-else-if="field.widget === 'name'"
                    v-model="form.name"
                    :maxlength="field.maxlength"
                    :placeholder="field.placeholder"
                    @input="nameTouched = true"
                  />
                  <div v-else-if="field.widget === 'namePattern'" class="name-field">
                    <el-input v-model="form.namePattern" :maxlength="field.maxlength" :placeholder="field.placeholder" />
                    <div class="token-row">
                      <button
                        v-for="token in field.tokens"
                        :key="token"
                        type="button"
                        class="token"
                        @click="insertToken(token)"
                      >
                        {{ token }}
                      </button>
                    </div>
                  </div>
                  <el-select
                    v-else-if="field.widget === 'bidStrategy'"
                    v-model="form.bidStrategyId"
                    placeholder="选择出价策略"
                  >
                    <el-option v-for="item in bidStrategies" :key="item.id" :label="item.name" :value="item.id" />
                  </el-select>
                  <el-select
                    v-else-if="field.widget === 'titleLibrary'"
                    v-model="form.titleLibraryId"
                    placeholder="选择标题包"
                    clearable
                    clear-icon="Close"
                  >
                    <el-option
                      v-for="item in titleLibraries"
                      :key="item.id"
                      :label="`${item.name}（${item.titleCount} 条）`"
                      :value="item.id"
                      :disabled="!item.titleCount"
                    />
                  </el-select>
                  <el-input
                    v-else-if="field.widget === 'text'"
                    v-model="form[field.key]"
                    :maxlength="field.maxlength"
                    :placeholder="field.placeholder"
                  />
                  <el-input
                    v-else-if="field.widget === 'textarea'"
                    v-model="form[field.key]"
                    type="textarea"
                    :rows="field.rows"
                    :placeholder="field.placeholder"
                  />
                  <el-input-number
                    v-else-if="field.widget === 'number'"
                    v-model="form[field.key]"
                    :min="field.min"
                    :max="field.max"
                    :step="field.step"
                    :precision="field.precision"
                    @focus="selectInput"
                  />
                  <el-select
                    v-else-if="field.widget === 'select' || field.widget === 'multi'"
                    v-model="form[field.key]"
                    :multiple="field.widget === 'multi'"
                    :collapse-tags="field.widget === 'multi'"
                    :placeholder="field.placeholder"
                  >
                    <el-option
                      v-for="opt in field.options"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                  </el-select>
                  <p v-if="field.widget === 'miniApp'" class="hint">
                    只显示在投账户里真实存在的小程序。导入新的后
                    <el-button type="primary" link :loading="miniAppsLoading" @click="loadMiniApps">重新拉取</el-button>
                  </p>
                  <p v-else-if="field.widget === 'aweme'" class="hint">
                    用{{ activeCopyright ? activeCopyright + "的" : "" }}投放户「{{ awemeAccountName || "—" }}」查授权。
                    <el-button type="primary" link :loading="awemesLoading" @click="loadAwemes">重新拉取</el-button>
                  </p>
                  <p v-else-if="field.widget === 'namePattern'" class="hint">搭建时替换花括号。版权方用这次选的版权，选番茄就是番茄。示例：{{ namePreview }}</p>
                  <div v-else-if="field.widget === 'bidStrategy' && bidStrategyTiers.length" class="bid-map">
                    <p class="hint">模板对应出价</p>
                    <div>
                      <span v-for="row in bidStrategyTiers" :key="row.tier">{{ row.tier }} → {{ row.bid }}</span>
                    </div>
                  </div>
                  <p v-else-if="field.widget === 'bidStrategy'" class="hint">{{ field.hint }}</p>
                  <p v-else-if="field.hint" class="hint">{{ field.hint }}</p>
                </div>
              </template>
            </template>
          </div>
          <p v-if="section.note" class="hint">{{ section.note }}</p>
        </section>
      </div>
      </div>
    </template>
  </div>
</template>

<script setup name="novelOceanStrategies">
import request from "@/request"
import { readCopyright, writeCopyright } from "../shared"
import { STRATEGY_SECTIONS, strategyFieldDefaults } from "./schema"

const emptyForm = () => ({
  id: 0,
  name: "",
  ...strategyFieldDefaults(),
  bid: 1.28,
  productName: "2026高分小说",
  callToActionsText: ["立即阅读", "马上阅览", "一键阅读", "点开阅览", "点开全文", "观看全文", "阅读好文", "点开阅读"].join("\n"),
  titles: "",
  sellingPointsText: [
    "热门小说推荐",
    "优质网文推荐",
    "口碑好文推荐",
    "高分好书推荐",
    "人气好文推荐",
    "精品小说推荐",
    "高分人气好书推荐",
    "高评分热门好文推荐",
  ].join("\n"),
  source: "倾心书馆",
  awemeName: "",
  titleLibraryId: null,
  microAppId: "",
  microAppName: "",
  copyrightOwner: "",
})

const mode = ref("list")
const copyright = ref(readCopyright())
const list = ref([])
const titleLibraries = ref([])
const bidStrategies = ref([])
const miniApps = ref([])
const awemes = ref([])
const awemeAccountName = ref("")
let awemeTicket = 0
const form = ref(emptyForm())
const loading = ref(false)
const saving = ref(false)
const miniAppsLoading = ref(false)
const awemesLoading = ref(false)
const nameTouched = ref(false)
const copiedFrom = ref("")

function suggestedName(row) {
  return String((row && row.microAppName) || "").trim().slice(0, 40) || "智擎付费ROI"
}

function joinPhrases(list, fallback) {
  if (Array.isArray(list) && list.length) return list.join("\n")
  return String(fallback || "").trim()
}

function splitPhrases(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isGenericName(name, miniName) {
  const text = String(name || "").trim()
  const mini = String(miniName || "").trim()
  return !text || text === "智擎付费ROI" || text === "未命名策略" || (mini && text === mini)
}

function syncName() {
  if (nameTouched.value) return
  form.value.name = suggestedName(form.value)
}

const bidStrategyTiers = computed(() => {
  const plan = bidStrategies.value.find((item) => item.id === form.value.bidStrategyId)
  return (plan && plan.tiers) || []
})

function bindBidStrategy() {
  if (form.value.bidStrategyId && bidStrategies.value.some((item) => item.id === form.value.bidStrategyId)) return
  const wanted = form.value.goal === "付费" ? "付费" : "付费ROI"
  const match = bidStrategies.value.find((item) => item.name === wanted) || bidStrategies.value[0]
  if (match) form.value.bidStrategyId = match.id
}

function fieldVisible(field) {
  if (typeof field.when === "function") return field.when(form.value)
  return true
}

const namePreview = computed(() => {
  const today = new Date()
  const date = `${today.getMonth() + 1}.${today.getDate()}`
  return String(form.value.namePattern || "{档位}{版权方}-{书名}-{日期}")
    .replaceAll("{日期}", date)
    .replaceAll("{版权方}", form.value.copyrightOwner || "版权方")
    .replaceAll("{书名}", "书名")
    .replaceAll("{档位}", "9.9")
})

function selectInput(event) {
  const target = event && event.target
  if (target && typeof target.select === "function") target.select()
}

function insertToken(token) {
  form.value.namePattern = `${form.value.namePattern || ""}${token}`
}

async function loadTitleLibraries() {
  const res = await request({ url: "/admin-api/oceanengine/title-libraries" })
  if (res.code === 0) titleLibraries.value = res.data || []
}

async function loadBidStrategies() {
  const res = await request({ url: "/admin-api/oceanengine/bid-strategies" })
  if (res.code === 0) bidStrategies.value = res.data || []
  bindBidStrategy()
}

async function loadMiniApps() {
  miniAppsLoading.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/launch/mini-apps" })
    if (res.code === 0) {
      const data = res.data
      miniApps.value = Array.isArray(data) ? data : data?.list || []
    }
  } finally {
    miniAppsLoading.value = false
    bindMiniApp()
    if (!form.value.id) syncName()
  }
}

function miniAppLabel(item) {
  const name = item && item.name ? item.name : item.appId
  const copyright = item && item.copyrightOwner ? ` · ${item.copyrightOwner}` : ""
  const same = miniApps.value.filter((row) => row.name === name).length > 1
  return same ? `字节小程序 · ${name}${copyright}（${item.appId}）` : `字节小程序 · ${name}${copyright}`
}

const activeCopyright = computed(() => {
  if (form.value.copyrightOwner) return form.value.copyrightOwner
  if (copyright.value && copyright.value !== "__unset__") return copyright.value
  return ""
})

const miniAppOptions = computed(() => {
  const owner = activeCopyright.value
  if (!owner) return miniApps.value
  const matched = miniApps.value.filter((item) => item.copyrightOwner === owner)
  if (!form.value.microAppId || matched.some((item) => item.appId === form.value.microAppId)) return matched
  const current = miniApps.value.find((item) => item.appId === form.value.microAppId)
  return current ? [current, ...matched] : matched
})

const copyrightTabs = computed(() => {
  const names = []
  const seen = new Set()
  for (const name of ["点众", "番茄", ...list.value.map((item) => item.copyrightOwner)]) {
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  const tabs = names.map((name) => ({ name, label: name }))
  if (list.value.some((item) => !item.copyrightOwner)) tabs.push({ name: "__unset__", label: "未设置" })
  return tabs
})
const shown = computed(() =>
  list.value.filter((item) => (copyright.value === "__unset__" ? !item.copyrightOwner : item.copyrightOwner === copyright.value)),
)

function onCopyrightTab() {
  writeCopyright(copyright.value)
}

function applyMiniCopyright(item) {
  form.value.copyrightOwner = (item && item.copyrightOwner) || ""
}

function bindMiniApp() {
  const pool = activeCopyright.value ? miniAppOptions.value : miniApps.value
  const current = miniApps.value.find((item) => item.appId === form.value.microAppId)
  if (current && (form.value.id || pool.some((item) => item.appId === current.appId))) {
    form.value.microAppName = current.name
    applyMiniCopyright(current)
    return
  }
  const byName = pool.find((item) => form.value.microAppName && item.name === form.value.microAppName)
  const next = byName || (form.value.id ? null : pool[0])
  if (!next) return
  form.value.microAppId = next.appId
  form.value.microAppName = next.name
  applyMiniCopyright(next)
}

function onMiniAppChange(appId) {
  const item = miniApps.value.find((row) => row.appId === appId)
  form.value.microAppId = appId || ""
  form.value.microAppName = item ? item.name : ""
  applyMiniCopyright(item)
  syncName()
  loadAwemes()
}

async function loadAwemes() {
  const ticket = ++awemeTicket
  awemesLoading.value = true
  const owner = activeCopyright.value
  try {
    const res = await request({
      url: "/admin-api/oceanengine/launch/awemes",
      params: owner ? { copyright: owner } : {},
    })
    if (ticket !== awemeTicket) return
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取抖音号失败")
      return
    }
    const data = res.data || {}
    awemes.value = Array.isArray(data.list) ? data.list : []
    awemeAccountName.value = data.accountName || ""
    if (data.error && !awemes.value.length) ElMessage.warning(data.error)
    bindAweme()
  } finally {
    if (ticket === awemeTicket) awemesLoading.value = false
  }
}

function bindAweme() {
  const list = awemes.value
  const current = list.find((item) => item.awemeId === form.value.awemeId)
  const byName = list.find((item) => form.value.awemeName && item.awemeName === form.value.awemeName)
  const next = current || byName || (list.length === 1 ? list[0] : null)
  if (!next) return
  form.value.awemeId = next.awemeId
  form.value.awemeName = next.awemeName || ""
}

function onAwemeChange(awemeId) {
  const item = awemes.value.find((row) => row.awemeId === awemeId)
  form.value.awemeId = awemeId || ""
  form.value.awemeName = item ? item.awemeName || "" : ""
}

async function loadList() {
  loading.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/launch/strategies" })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取策略失败")
      return
    }
    list.value = res.data || []
    await Promise.all([loadTitleLibraries(), loadBidStrategies()])
  } finally {
    loading.value = false
  }
}

function fillForm(row) {
  form.value = {
    ...emptyForm(),
    ...row,
    age: Array.isArray(row.age) ? row.age.slice() : [],
    roiGoal: row.roiGoal != null ? row.roiGoal : row.bid,
    namePattern: row.namePattern || emptyForm().namePattern,
    titleLibraryId: row.titleLibraryId || null,
    bidStrategyId: row.bidStrategyId || null,
    comment: row.comment === "ON" ? "ON" : "OFF",
    microAppId: row.microAppId || "",
    microAppName: row.microAppName || "",
    productName: row.productName || emptyForm().productName,
    callToActionsText: joinPhrases(row.callToActions, row.callToAction) || emptyForm().callToActionsText,
    sellingPointsText: joinPhrases(row.sellingPoints, row.sellingPoint) || emptyForm().sellingPointsText,
    source: row.source || emptyForm().source,
    nativeType: row.nativeType === "ACCOUNT" ? "ACCOUNT" : "AWEME",
    awemeId: row.awemeId || "",
    awemeName: row.awemeName && row.awemeName !== row.source ? row.awemeName : "",
  }
  bindBidStrategy()
}

function copyName(name) {
  const base = String(name || "").trim() || "未命名策略"
  const used = new Set(list.value.map((item) => item.name))
  const make = (n) => {
    const suffix = n === 1 ? " 副本" : ` 副本${n}`
    return `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`
  }
  for (let n = 1; n <= 99; n += 1) {
    const next = make(n)
    if (!used.has(next)) return next
  }
  return make(99)
}

async function openCreate() {
  form.value = emptyForm()
  if (copyright.value && copyright.value !== "__unset__") form.value.copyrightOwner = copyright.value
  nameTouched.value = false
  copiedFrom.value = ""
  bindBidStrategy()
  mode.value = "edit"
  await Promise.all([loadMiniApps(), loadAwemes()])
}

async function openEdit(row) {
  fillForm(row)
  nameTouched.value = !isGenericName(row.name, row.microAppName)
  copiedFrom.value = ""
  mode.value = "edit"
  await Promise.all([loadMiniApps(), loadAwemes()])
}

async function openCopy(row) {
  fillForm(row)
  form.value.id = 0
  form.value.name = copyName(row.name)
  nameTouched.value = true
  copiedFrom.value = row.name
  mode.value = "edit"
  await Promise.all([loadMiniApps(), loadAwemes()])
}

async function save() {
  if (!form.value.microAppId) {
    ElMessage.error("请选择投放载体")
    return
  }
  if (isGenericName(form.value.name)) form.value.name = suggestedName(form.value)
  if (!String(form.value.name || "").trim()) form.value.name = suggestedName(form.value)
  if (!String(form.value.name || "").trim()) {
    ElMessage.error("请填写策略名称")
    return
  }
  saving.value = true
  try {
    const creating = !form.value.id
    const res = await request({
      url: creating ? "/admin-api/oceanengine/launch/strategies" : `/admin-api/oceanengine/launch/strategies/${form.value.id}`,
      method: creating ? "POST" : "PUT",
      data: {
        ...form.value,
        goal: form.value.goal === "付费" ? "付费" : "付费ROI",
        titleLibraryId: form.value.titleLibraryId || 0,
        callToActions: splitPhrases(form.value.callToActionsText),
        sellingPoints: splitPhrases(form.value.sellingPointsText),
      },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "保存失败")
      return
    }
    ElMessage.success(creating ? "已新增策略" : "策略已保存")
    copiedFrom.value = ""
    await loadList()
    mode.value = "list"
  } finally {
    saving.value = false
  }
}

async function removeRow(row) {
  try {
    await ElMessageBox.confirm(`删除策略「${row.name}」？已经跑过的任务还在。`, "删除策略", {
      type: "warning",
      confirmButtonText: "删除",
    })
  } catch {
    return
  }
  const res = await request({ url: `/admin-api/oceanengine/launch/strategies/${row.id}`, method: "DELETE" })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "删除失败")
    return
  }
  ElMessage.success("策略已删除")
  loadList()
}

onMounted(loadList)
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.ocean-strategies.page-container {
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

.ops {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
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

.editor-hint {
  margin: 0;
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

.locked,
.hint {
  margin: 0 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.grid {
  display: grid;
  grid-template-columns: 108px minmax(220px, 520px);
  gap: 12px 16px;
  align-items: start;
}

.grid label {
  padding-top: 6px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.name-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grid .hint {
  margin: 8px 0 0;
}

.grid :deep(.el-select) {
  width: 100%;
}

.grid :deep(.el-textarea__inner) {
  line-height: 1.6;
}

.grid .hint :deep(.el-button) {
  padding: 0 4px;
  height: auto;
  vertical-align: baseline;
}

.name-field .hint {
  margin: 0;
}

.token-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.token {
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}

.token:hover {
  border-color: var(--el-color-primary-light-5);
}

.bid-map .hint {
  margin-bottom: 4px;
}

.bid-map div {
  display: grid;
  grid-template-columns: repeat(3, max-content);
  gap: 2px 18px;
}

.bid-map span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
