<template>
  <div class="page-container novel-page ocean-sites">
    <section class="module list-module">
      <div class="page-filter-box filter-bar">
        <div class="page-filter-left filters-wrap">
          <el-input
            v-model="tableParams.keyword"
            placeholder="账户ID / 账户名称"
            class="filter-input-keyword"
            clearable
            clear-icon="Close"
            @keyup.enter="searchUsing"
          />
          <el-select v-model="tableParams.copyright" placeholder="版权方" class="filter-select-sm" clearable clear-icon="Close">
            <el-option v-for="item in copyrights" :key="item" :label="item" :value="item" />
          </el-select>
          <el-select v-model="tableParams.subject" placeholder="主体" class="filter-select-sm" clearable clear-icon="Close" filterable>
            <el-option v-for="item in subjects" :key="item" :label="item" :value="item" />
          </el-select>
          <el-button type="primary" @click="searchUsing">查询</el-button>
          <el-button @click="resetUsing">重置</el-button>
          <el-button @click="posterVisible = true">配置图片</el-button>
        </div>
        <div class="page-filter-right list-side">
          <el-checkbox v-model="onlyMissing" @change="onOnlyMissing">只看没有落地页</el-checkbox>
          <span v-if="selectedCount" class="hint inline">已选 {{ selectedCount }}</span>
          <el-button type="primary" :loading="siteBatching" @click="generateSelected">批量生成</el-button>
          <span v-if="siteProgress" class="hint inline">{{ siteProgress }}</span>
        </div>
      </div>
      <p v-if="authReady && !authorized" class="hint">请先在「授权」里完成巨量授权，才能创建落地页。</p>
      <div class="page-table-box">
        <el-table
          :data="displayRows"
          v-loading="tableLoading"
          border
          height="100%"
          :empty-text="emptyText"
          :span-method="spanAccount"
          :header-cell-style="{ 'text-align': 'center' }"
        >
          <el-table-column width="46" align="center" fixed="left">
            <template #header>
              <el-checkbox
                :model-value="pageAllChecked"
                :indeterminate="pagePartChecked"
                @click.stop
                @change="togglePage"
              />
            </template>
            <template #default="{ row }">
              <el-checkbox
                v-if="!row.spanIndex"
                :model-value="selectedIds.has(row.advertiserId)"
                @click.stop
                @change="(checked) => toggleAccount(row.advertiserId, checked)"
              />
            </template>
          </el-table-column>
          <el-table-column label="账户名称" min-width="220" fixed="left">
            <template #default="{ row }">
              <div class="name-cell">
                <img v-if="row.avatarUrl" class="account-avatar" :src="row.avatarUrl" referrerpolicy="no-referrer" alt="" @error="row.avatarUrl = ''" />
                <el-avatar v-else :size="32">{{ nameInitial(row.name) }}</el-avatar>
                <span class="name-text" :title="row.name">{{ row.name || "—" }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="版权方" width="100" align="center">
            <template #default="{ row }">{{ row.copyrightOwner || "—" }}</template>
          </el-table-column>
          <el-table-column label="主体" width="120" align="center" show-overflow-tooltip>
            <template #default="{ row }">{{ row.subject || "—" }}</template>
          </el-table-column>
          <el-table-column label="账户ID" width="180" align="center">
            <template #default="{ row }">
              <span class="copy-id" title="点击复制" @click="copyText(row.advertiserId)">{{ row.advertiserId }}</span>
            </template>
          </el-table-column>
          <el-table-column label="落地页名称" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <el-icon v-if="linkOf(row).loading" class="is-loading site-loading"><component :is="$icons.Loading" /></el-icon>
              <span v-else-if="linkOf(row).error" class="site-status">
                <span class="fail" :title="linkOf(row).error">{{ shortError(linkOf(row).error) }}</span>
                <el-button
                  class="site-refresh"
                  link
                  type="primary"
                  :icon="$icons.Refresh"
                  title="重新读取"
                  :loading="!!refreshing[row.advertiserId]"
                  @click="refreshSite(row)"
                />
              </span>
              <span v-else-if="row.site">{{ row.site.name || "—" }}</span>
              <span v-else class="site-empty">无落地页</span>
            </template>
          </el-table-column>
          <el-table-column label="落地页链接" min-width="260">
            <template #default="{ row }">
              <a v-if="row.site && row.site.pageUrl" class="page-url" :href="row.site.pageUrl" target="_blank" rel="noreferrer" :title="row.site.pageUrl">{{ row.site.pageUrl }}</a>
              <span v-else-if="!linkOf(row).loading && !linkOf(row).error" class="hint inline">—</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="center" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="canGenerate(row)"
                link
                type="primary"
                :loading="!!generating[row.advertiserId]"
                @click="generateOne(row)"
              >生成落地页</el-button>
              <template v-else-if="hasSite(row)">
                <el-button v-if="row.site && row.site.pageUrl" link type="primary" @click="copyText(row.site.pageUrl)">复制</el-button>
                <el-button link type="primary" @click="openSites(row)">查看</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-if="tableTotal" class="page-pagination-box">
        <CzPagination
          :total="tableTotal"
          v-model:page-no="pageNo"
          v-model:page-size="pageSize"
          @change="onPageChange"
        />
      </div>
    </section>

    <el-drawer v-model="sitesVisible" :title="sitesTitle" size="60%">
      <div class="sites-drawer">
        <div class="sites-bar">
          <el-input v-model="siteKeyword" placeholder="落地页名称 / 站点 ID" clearable clear-icon="Close" @keyup.enter="loadSites(1)" />
          <el-button type="primary" :loading="sitesLoading" @click="loadSites(1)">查询</el-button>
        </div>
        <el-table :data="siteRows" v-loading="sitesLoading" border height="100%" empty-text="这个账户下还没有落地页">
          <el-table-column label="落地页" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <div class="name-cell">
                <img v-if="row.thumbnail" class="site-thumb" :src="row.thumbnail" alt="" />
                <span class="name-text" :title="row.name">{{ row.name || "—" }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110" align="center">
            <template #default="{ row }">{{ row.statusLabel || "—" }}</template>
          </el-table-column>
          <el-table-column label="来源" width="110" align="center">
            <template #default="{ row }">{{ row.shareType === "SHARE" ? "共享" : "我创建的" }}</template>
          </el-table-column>
          <el-table-column label="链接" min-width="220">
            <template #default="{ row }">
              <el-button v-if="row.pageUrl" link type="primary" @click="copyText(row.pageUrl)">复制链接</el-button>
              <a v-if="row.pageUrl" class="page-link" :href="row.pageUrl" target="_blank" rel="noreferrer">打开</a>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <el-dialog v-model="posterVisible" title="配置图片" width="720px" align-center @open="loadPosters">
      <div class="poster-bar">
        <span>点一张设为默认。生成落地页时用默认图。</span>
        <el-button type="primary" @click="posterInput && posterInput.click()">上传图片</el-button>
        <input
          ref="posterInput"
          class="poster-file"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/bmp,.jpg,.jpeg,.png,.gif,.bmp"
          @change="savePoster"
        />
      </div>
      <div v-if="posters.length" class="poster-grid">
        <button
          v-for="item in posters"
          :key="item.id"
          type="button"
          class="poster-card"
          :class="{ active: item.active }"
          @click="usePoster(item)"
        >
          <img :src="item.url" alt="" />
          <span class="poster-card-name" :title="item.name">{{ item.name || "未命名" }}</span>
          <span class="poster-card-state">{{ item.active ? "默认使用" : "设为默认" }}</span>
        </button>
      </div>
      <p v-else class="poster-empty">还没有图片。上传后会作为默认图，生成落地页时直接使用。</p>
    </el-dialog>

    <el-dialog v-model="failVisible" title="生成失败" width="720px">
      <el-table :data="failRows" border size="small" max-height="420">
        <el-table-column prop="accountName" label="账户" min-width="220" show-overflow-tooltip />
        <el-table-column prop="assetName" label="落地页" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.assetName || "—" }}</template>
        </el-table-column>
        <el-table-column label="结果" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="fail">{{ row.message }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup name="novelOceanSites">
import request from "@/request"
import CzPagination from "@/components/cz-pagination/index.vue"

const authorized = ref(false)
const authReady = ref(false)
const tableLoading = ref(false)
const tableData = ref([])
const tableTotal = ref(0)
const pageNo = ref(1)
const pageSize = ref(20)
const subjects = ref([])
const copyrights = ref([])
const tableParams = reactive({ keyword: "", copyright: "", subject: "" })
const selectedIds = ref(new Set())
const onlyMissing = ref(false)
const siteStatus = ref({})
const posterReady = ref(false)
const posterVisible = ref(false)
const posterInput = ref(null)
const posters = ref([])
const generating = reactive({})
const refreshing = reactive({})
const siteBatching = ref(false)
const siteProgress = ref("")
const sitePercent = ref(0)
const failVisible = ref(false)
const failRows = ref([])
const sitesVisible = ref(false)
const sitesLoading = ref(false)
const sitesAccount = ref(null)
const siteKeyword = ref("")
const siteRows = ref([])

onMounted(() => {
  loadAuth()
  loadPoster()
  loadUsing()
})

async function loadAuth() {
  try {
    const res = await request({
      url: "/admin-api/oceanengine/settings",
      timeout: 30000,
      params: { scope: "auth" },
    })
    if (res.code === 0) authorized.value = !!(res.data && res.data.authorized)
  } finally {
    authReady.value = true
  }
}

function nameInitial(name) {
  const text = String(name || "").trim()
  return text ? text.slice(0, 1) : "账"
}

function copyText(value) {
  const text = String(value || "")
  if (!text) return
  navigator.clipboard.writeText(text).then(
    () => ElMessage.success("已复制"),
    () => ElMessage.error("复制失败"),
  )
}

const emptyText = computed(() => (onlyMissing.value ? "这一页没有未建落地页的账户" : "没有正在使用的账户"))
const selectedCount = computed(() => selectedIds.value.size)
const shownAccounts = computed(() => {
  if (!onlyMissing.value) return tableData.value
  return tableData.value.filter((account) => !accountHasSite(account))
})
const pageIds = computed(() => shownAccounts.value.map((row) => row.advertiserId).filter(Boolean))
const pageAllChecked = computed(() => pageIds.value.length > 0 && pageIds.value.every((id) => selectedIds.value.has(id)))
const pagePartChecked = computed(() => {
  const picked = pageIds.value.filter((id) => selectedIds.value.has(id)).length
  return picked > 0 && picked < pageIds.value.length
})
const displayRows = computed(() => {
  const out = []
  for (const account of shownAccounts.value) {
    const status = siteStatus.value[account.advertiserId]
    const sites = status && !status.loading && !status.error ? status.sites || [] : []
    if (!sites.length) {
      out.push({ ...account, site: null, span: 1, spanIndex: 0, rowKey: account.advertiserId })
      continue
    }
    sites.forEach((site, index) => {
      out.push({
        ...account,
        site,
        span: sites.length,
        spanIndex: index,
        rowKey: `${account.advertiserId}-${site.siteId || index}`,
      })
    })
  }
  return out
})

function accountHasSite(account) {
  const status = siteStatus.value[account.advertiserId]
  if (!status || status.loading || status.error) return false
  return status.total > 0 || (status.sites && status.sites.length > 0)
}

function clearSelected() {
  selectedIds.value = new Set()
}

function toggleAccount(id, checked) {
  if (!id) return
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

function togglePage(checked) {
  const next = new Set(selectedIds.value)
  for (const id of pageIds.value) {
    if (checked) next.add(id)
    else next.delete(id)
  }
  selectedIds.value = next
}

function spanAccount({ row, column, columnIndex }) {
  const merged = columnIndex === 0 || ["账户名称", "版权方", "主体", "账户ID"].includes(column.label)
  if (!merged) return [1, 1]
  if (row.spanIndex > 0) return [0, 0]
  return [row.span || 1, 1]
}

const sitesTitle = computed(() => {
  const row = sitesAccount.value
  if (!row) return "已有落地页"
  return row.name ? `${row.name} 的落地页` : row.advertiserId
})

function openSites(row) {
  sitesAccount.value = row
  siteKeyword.value = ""
  siteRows.value = []
  sitesVisible.value = true
  loadSites(1)
}

async function loadSites() {
  if (!sitesAccount.value) return
  sitesLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/sites",
      params: {
        advertiserId: sitesAccount.value.advertiserId,
        search: siteKeyword.value.trim(),
        page: 1,
        pageSize: 50,
      },
      timeout: 30000,
    })
    if (res.code !== 0) {
      siteRows.value = []
      ElMessage.error(res.msg || "读取落地页失败")
      return
    }
    siteRows.value = (res.data && res.data.list) || []
  } finally {
    sitesLoading.value = false
  }
}

function searchUsing() {
  pageNo.value = 1
  clearSelected()
  loadUsing()
}

function onOnlyMissing() {
  clearSelected()
}

function resetUsing() {
  tableParams.keyword = ""
  tableParams.copyright = ""
  tableParams.subject = ""
  onlyMissing.value = false
  searchUsing()
}

function onPageChange() {
  loadUsing()
}

async function loadUsing() {
  tableLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/accounts/page",
      params: {
        keyword: tableParams.keyword,
        copyright: tableParams.copyright,
        subject: tableParams.subject,
        pageNo: pageNo.value,
        pageSize: pageSize.value,
      },
      timeout: 30000,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取账户失败")
      return
    }
    const data = res.data || {}
    tableData.value = data.list || []
    tableTotal.value = data.total || 0
    if (Array.isArray(data.subjects)) subjects.value = data.subjects
    if (Array.isArray(data.copyrights)) copyrights.value = data.copyrights
    loadSiteSummary(tableData.value)
  } finally {
    tableLoading.value = false
  }
}

function linkOf(row) {
  return siteStatus.value[row.advertiserId] || { loading: true, total: 0, sites: [], error: "" }
}

let summarySeq = 0

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimit(message) {
  return /频率超限|请求频率|限频|40100/.test(String(message || ""))
}

function writeSiteStatus(id, patch) {
  siteStatus.value = { ...siteStatus.value, [id]: patch }
}

async function loadSiteSummary(rows) {
  const seq = ++summarySeq
  const ids = (rows || []).map((row) => row.advertiserId).filter(Boolean)
  if (!ids.length) return
  const pending = { ...siteStatus.value }
  for (const id of ids) pending[id] = { ...(pending[id] || {}), loading: true, error: "" }
  siteStatus.value = pending
  let cursor = 0
  async function pullOne() {
    while (seq === summarySeq) {
      const index = cursor
      cursor += 1
      if (index >= ids.length) return
      const id = ids[index]
      let lastError = ""
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (seq !== summarySeq) return
        try {
          const res = await request({
            url: "/admin-api/oceanengine/sites/summary",
            method: "POST",
            timeout: 60000,
            data: { advertiserIds: [id] },
          })
          if (seq !== summarySeq) return
          if (res.code !== 0) {
            lastError = res.msg || "读取失败"
            if (isRateLimit(lastError) && attempt < 2) {
              await sleep(800)
              continue
            }
            break
          }
          const item = ((res.data && res.data.list) || [])[0] || { advertiserId: id, total: 0, sites: [], error: "" }
          if (isRateLimit(item.error) && attempt < 2) {
            lastError = item.error
            await sleep(800)
            continue
          }
          writeSiteStatus(id, {
            loading: false,
            total: item.total || 0,
            sites: item.sites || [],
            error: item.error || "",
          })
          lastError = ""
          break
        } catch (e) {
          if (seq !== summarySeq) return
          lastError = e?.response?.data?.msg || e?.message || "读取失败"
          if (attempt < 2) {
            await sleep(800)
            continue
          }
        }
      }
      if (lastError && seq === summarySeq) {
        writeSiteStatus(id, {
          loading: false,
          total: 0,
          sites: [],
          error: isRateLimit(lastError) ? "接口繁忙，请稍后再查" : lastError,
        })
      }
    }
  }
  const width = Math.min(4, ids.length)
  await Promise.all(Array.from({ length: width }, () => pullOne()))
}

async function refreshSite(row) {
  const id = row && row.advertiserId
  if (!id || refreshing[id]) return
  refreshing[id] = true
  writeSiteStatus(id, { ...(siteStatus.value[id] || {}), loading: true, error: "" })
  try {
    const res = await request({
      url: "/admin-api/oceanengine/sites/summary",
      method: "POST",
      timeout: 60000,
      data: { advertiserIds: [id] },
    })
    if (res.code !== 0) {
      writeSiteStatus(id, { loading: false, total: 0, sites: [], error: res.msg || "读取失败" })
      return
    }
    const item = ((res.data && res.data.list) || [])[0] || {}
    writeSiteStatus(id, {
      loading: false,
      total: item.total || 0,
      sites: item.sites || [],
      error: item.error || "",
    })
  } catch (e) {
    writeSiteStatus(id, {
      loading: false,
      total: 0,
      sites: [],
      error: e?.response?.data?.msg || e?.message || "读取失败",
    })
  } finally {
    refreshing[id] = false
  }
}

function shortError(message) {
  const text = String(message || "")
  if (text.includes("白名单")) return "开发者 IP 未加白名单"
  return text
}

function hasSite(row) {
  const status = linkOf(row)
  return !status.loading && !status.error && (status.total > 0 || (status.sites && status.sites.length > 0))
}

function canGenerate(row) {
  const status = linkOf(row)
  return !status.loading && !status.error && !hasSite(row)
}

async function loadPoster() {
  const info = await request({ url: "/admin-api/oceanengine/sites/poster" })
  posterReady.value = info.code === 0 && !!(info.data && info.data.ready)
}

async function loadPosters() {
  const info = await request({ url: "/admin-api/oceanengine/sites/poster" })
  if (info.code !== 0) {
    ElMessage.error(info.msg || "读取图片失败")
    return
  }
  const data = info.data || {}
  posterReady.value = !!data.ready
  const items = Array.isArray(data.items) ? data.items : []
  const next = []
  for (const item of items) {
    const blob = await request({
      url: "/admin-api/oceanengine/sites/poster/file",
      params: { id: item.id },
      responseType: "blob",
    })
    if (!(blob instanceof Blob)) continue
    next.push({ ...item, url: URL.createObjectURL(blob) })
  }
  posters.value.forEach((item) => item.url && URL.revokeObjectURL(item.url))
  posters.value = next
}

async function usePoster(item) {
  if (!item || item.active) return
  const res = await request({
    url: "/admin-api/oceanengine/sites/poster/active",
    method: "POST",
    data: { id: item.id },
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "切换失败")
    return
  }
  posters.value = posters.value.map((row) => ({ ...row, active: row.id === item.id }))
  posterReady.value = true
  ElMessage.success("已切换默认图片")
}

async function savePoster(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ""
  if (!file) return
  if (!/^image\/(jpeg|png|gif|bmp)$/.test(file.type)) {
    ElMessage.warning("请上传 jpg、png、gif 或 bmp")
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning("图片不能超过 2MB")
    return
  }
  const form = new FormData()
  form.append("file", file)
  const res = await request({
    url: "/admin-api/oceanengine/sites/poster",
    method: "POST",
    timeout: 30000,
    data: form,
  })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "保存图片失败")
    return
  }
  ElMessage.success("已上传，并设为默认图片")
  await loadPosters()
}

function applyGenerated(results) {
  const next = { ...siteStatus.value }
  for (const row of results || []) {
    if (!row.advertiserId) continue
    if (row.status === "fail") {
      next[row.advertiserId] = { loading: false, total: 0, sites: [], error: row.message || "生成失败" }
      continue
    }
    const pageUrl = row.pageUrl || ""
    const sites = pageUrl ? [{ pageUrl, name: row.assetName || "" }] : next[row.advertiserId]?.sites || []
    next[row.advertiserId] = { loading: false, total: Math.max(sites.length, 1), sites, error: "" }
  }
  siteStatus.value = next
}

async function generateIds(ids) {
  if (!posterReady.value) {
    ElMessage.warning("请先配置落地页图片")
    return null
  }
  if (authReady.value && !authorized.value) {
    ElMessage.warning("请先在「授权」里完成巨量授权")
    return null
  }
  const pending = ids.filter((id) => {
    const status = siteStatus.value[id]
    return status && !status.loading && !status.error && !(status.total > 0 || (status.sites && status.sites.length))
  })
  if (!pending.length) {
    ElMessage.info("选中的账户都已经有落地页")
    return null
  }
  siteBatching.value = true
  sitePercent.value = 0
  siteProgress.value = `正在生成 0/${pending.length}`
  const failed = []
  const doneRows = []
  let added = 0
  try {
    const groups = chunkList(pending, 5)
    let done = 0
    for (const group of groups) {
      for (const id of group) generating[id] = true
      const res = await request({
        url: "/admin-api/oceanengine/sites/generate",
        method: "POST",
        timeout: 300000,
        data: { advertiserIds: group },
      })
      done += group.length
      sitePercent.value = Math.round((done / pending.length) * 100)
      siteProgress.value = `正在生成 ${done}/${pending.length}`
      for (const id of group) generating[id] = false
      if (res.code !== 0) {
        failed.push({ accountName: "本批", assetName: "—", message: res.msg || "生成失败" })
        break
      }
      const data = res.data || {}
      const results = data.results || []
      doneRows.push(...results)
      added += data.added || 0
      failed.push(...results.filter((row) => row.status === "fail"))
      if (data.stopped) break
    }
    applyGenerated(doneRows)
    if (failed.length) {
      failRows.value = failed
      failVisible.value = true
    } else if (added) {
      ElMessage.success(`已生成 ${added} 个落地页`)
    } else {
      ElMessage.info("这些账户都已经有落地页")
    }
    return doneRows
  } finally {
    siteBatching.value = false
    siteProgress.value = ""
    sitePercent.value = 0
    for (const id of pending) generating[id] = false
  }
}

function chunkList(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function generateOne(row) {
  return generateIds([row.advertiserId])
}

function generateSelected() {
  const ids = [...selectedIds.value]
  if (!ids.length) {
    ElMessage.warning("请先勾选账户")
    return
  }
  return generateIds(ids)
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.ocean-sites {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.module {
  flex-shrink: 0;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.list-module {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.list-side {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.poster-file {
  display: none;
}

.poster-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.poster-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  max-height: 520px;
  overflow: auto;
}

.poster-card {
  display: flex;
  flex-direction: column;
  width: 148px;
  padding: 0;
  overflow: hidden;
  color: var(--el-text-color-regular);
  background: #fff;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  cursor: pointer;
}

.poster-card.active {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary);
}

.poster-card img {
  width: 100%;
  height: 220px;
  object-fit: contain;
  background: var(--el-fill-color-light);
}

.poster-card-name,
.poster-card-state {
  display: block;
  width: 100%;
  padding: 0 8px;
  overflow: hidden;
  font-size: 12px;
  line-height: 28px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poster-card-name {
  color: var(--el-text-color-regular);
}

.poster-empty {
  margin: 48px 0;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.page-url {
  display: inline-block;
  max-width: 280px;
  overflow: hidden;
  color: var(--el-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.side-progress {
  width: 120px;
}

.hint {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.hint.inline {
  margin: 0;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.account-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
  background: var(--el-fill-color-light);
}

.name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-id {
  cursor: pointer;
}

.copy-id:hover {
  color: var(--el-color-primary);
}

.fail {
  color: var(--el-color-danger);
}

.site-loading {
  color: var(--el-text-color-secondary);
  font-size: 16px;
  vertical-align: middle;
}

.site-empty {
  color: var(--el-text-color-regular);
}

.site-status {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  vertical-align: middle;
}

.site-refresh {
  height: auto;
  padding: 0;
  font-size: 14px;
}

.sites-drawer {
  height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sites-bar {
  display: flex;
  gap: 12px;
}

.sites-bar .el-input {
  width: 280px;
}

.site-thumb {
  width: 36px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  flex: none;
  background: var(--el-fill-color-light);
}

.page-link {
  margin-left: 8px;
  color: var(--el-color-primary);
}
</style>
