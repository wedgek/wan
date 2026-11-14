<template>
  <div class="page-container novel-page ocean-launch">
    <el-tabs v-model="tab" class="launch-tabs">
      <el-tab-pane label="新建任务" name="task">
        <div class="task-pane">
          <div class="task-split">
            <div class="setup-col">
              <section class="step">
                <header class="step-head"><em>1</em><h3>策略模板</h3></header>
                <div class="pick-row">
                  <el-select
                    v-model="strategyId"
                    class="full-select"
                    fit-input-width
                    teleported
                    placeholder="先选一个策略模板"
                    popper-class="ocean-launch-select-popper"
                    @change="onStrategyChange"
                  >
                    <el-option v-for="item in strategies" :key="item.id" :label="item.name" :value="item.id" />
                  </el-select>
                  <el-button link type="primary" @click="goStrategies">去配置</el-button>
                </div>
                <p class="hint">{{ strategyHint }}</p>
              </section>

              <section class="step">
                <header class="step-head"><em>2</em><h3>版权</h3></header>
                <div class="chip-row">
                  <button
                    v-for="item in copyrights"
                    :key="item"
                    type="button"
                    class="chip"
                    :class="{ on: copyrightFilter === item }"
                    @click="setCopyright(item)"
                  >
                    {{ item }}
                  </button>
                </div>
                <p class="hint">先选版权。书名可远程搜索，书籍库里的书都能找，打过链接的就能投。</p>
              </section>

              <section class="step">
                <header class="step-head"><em>3</em><h3>书和档位</h3></header>
                <el-select
                  v-model="bookName"
                  class="full-select"
                  filterable
                  remote
                  remote-show-suffix
                  reserve-keyword
                  default-first-option
                  fit-input-width
                  teleported
                  clearable
                  clear-icon="Close"
                  placeholder="搜索书名或书籍 ID"
                  popper-class="ocean-launch-select-popper ocean-book-select-popper"
                  :disabled="!copyrightFilter"
                  :loading="bookLoading"
                  :remote-method="searchRemoteBooks"
                  @visible-change="onBookSelectVisible"
                  @change="onBookChange"
                >
                  <el-option
                    v-for="item in visibleBooks"
                    :key="item.id"
                    :label="item.bookName"
                    :value="item.bookName"
                  >
                    <span class="book-option">
                      <span>{{ item.bookName }}</span>
                      <em v-if="item.externalBookId">{{ item.externalBookId }}</em>
                    </span>
                  </el-option>
                </el-select>
                <div class="tier-grid">
                  <button
                    v-for="item in tierCards"
                    :key="item.tier"
                    type="button"
                    class="tier-card"
                    :class="{ on: item.on }"
                    :disabled="!item.hasPromo"
                    @click="toggleTier(item.tier)"
                  >
                    <strong>{{ item.tier }}</strong>
                    <em>出价 {{ item.bid }}</em>
                    <span>{{ item.accountCount }} 个户</span>
                  </button>
                </div>
                <p class="hint">有推广链接的档位才能勾，没链接的点不了。</p>
              </section>

              <section class="step">
                <header class="step-head">
                  <em>4</em>
                  <h3>投放账户</h3>
                  <span class="muted">选用 {{ liveAccountCount }} / {{ livePoolCount }} · 将建 {{ liveJobs }} 条</span>
                  <div class="head-actions">
                    <el-button link @click="selectSuggestedAccounts">全部选用</el-button>
                    <el-button link type="primary" @click="openAccountDrawer">新增</el-button>
                  </div>
                </header>
                <p class="hint">一户一条计划，默认带上同档全部在投户。点标签上的叉去掉，点新增从同档位池里加回来。</p>
                <article v-for="row in tierViews" :key="row.tier" class="tier-panel" :class="row.state.status">
                  <header class="tier-head">
                    <div class="tier-id">
                      <strong>{{ row.tier }}</strong>
                      <span>出价 {{ row.bid || "—" }}</span>
                    </div>
                    <div class="tier-counts">
                      <em>将建 {{ row.state.jobs }} 条</em>
                      <span>选用 {{ row.state.picked }} / {{ row.state.pool }} 户</span>
                      <el-tag :type="statusType(row.state.status)" size="small" effect="plain">{{ statusLabel(row.state.status) }}</el-tag>
                    </div>
                  </header>
                  <div class="tier-facts">
                    <div><label>项目名</label><span :title="row.projectName">{{ row.projectName || "—" }}</span></div>
                    <div><label>推广链接</label><span>{{ row.promo ? row.promo.referralId || row.promo.path : "—" }}</span></div>
                  </div>
                  <p v-if="row.state.messages.length" class="tier-msg">{{ row.state.messages.join("；") }}</p>
                  <div class="account-chips">
                    <button
                      v-for="item in visibleAccounts(row)"
                      :key="item.advertiserId"
                      type="button"
                      class="account-chip on"
                      :class="{ miss: !item.ready }"
                      :title="item.name"
                    >
                      <img v-if="item.avatarUrl" :src="item.avatarUrl" alt="" referrerpolicy="no-referrer" @error="item.avatarUrl = ''" />
                      <i v-else>{{ accountInitial(item.name) }}</i>
                      <span>{{ item.name }}</span>
                      <b @click.stop="removeAccount(item)">×</b>
                    </button>
                    <button type="button" class="add-chip" @click="openAccountDrawer(row.tier)">+ 新增</button>
                    <span v-if="!visibleAccounts(row).length" class="muted">这一档还没勾户</span>
                  </div>
                </article>
                <p v-if="!tierViews.length" class="hint">选版权和书之后，会按档位带上在投户。</p>
              </section>

              <section class="step">
                <header class="step-head"><em>5</em><h3>商品库</h3></header>
                <div class="library-grid">
                  <button
                    v-for="item in libraries"
                    :key="item.id"
                    type="button"
                    class="library-card"
                    :class="{ on: platformId === item.id, preferred: item.preferred }"
                    @click="setLibrary(item.id)"
                  >
                    <strong>{{ item.name }}</strong>
                    <span>{{ item.industry || "商品库" }}</span>
                    <em v-if="platformId === item.id && productPlan.count">{{ libraryActionText }}</em>
                    <em v-else>按书名编号，用多少备多少</em>
                  </button>
                </div>
                <div v-if="showProductMode" class="product-mode">
                  <button type="button" class="mode-card" :class="{ on: productMode === 'reuse' }" @click="setProductMode('reuse')">
                    <strong>复用已有编号</strong>
                    <span>{{ reuseOptionText }}</span>
                  </button>
                  <button type="button" class="mode-card" :class="{ on: productMode === 'fresh' }" @click="setProductMode('fresh')">
                    <strong>往后新建</strong>
                    <span>{{ freshOptionText }}</span>
                  </button>
                </div>
                <p v-if="!libraries.length" class="hint">还没有放进批量基建的商品库。到商品库页打开「批量基建」开关。</p>
                <p v-else class="hint">{{ libraryHint }}</p>
              </section>

              <section class="step">
                <header class="step-head">
                  <em>6</em>
                  <h3>素材</h3>
                  <span class="muted">选用 {{ pickedVideoIds.length }} / {{ videoList.length }}</span>
                  <div v-if="videoList.length" class="head-actions">
                    <el-button link @click="selectAllVideos">全选</el-button>
                    <el-button link @click="clearVideos">清空</el-button>
                  </div>
                </header>
                <p v-if="previewing && !videoList.length" class="hint">正在按书名拉取巨量线上素材…</p>
                <p v-else-if="!bookName" class="hint">选书后会按书名自动匹配线上视频，点掉不要的即可。</p>
                <p v-else-if="!videoList.length" class="block-line">{{ videoEmptyText }}</p>
                <div v-else class="video-grid">
                  <figure
                    v-for="item in videoList"
                    :key="videoKey(item)"
                    :class="{ off: !isPickedVideo(item), on: isPickedVideo(item) }"
                    @click="toggleVideo(item)"
                  >
                    <img v-if="item.posterUrl" :src="item.posterUrl" :alt="item.filename" draggable="false" />
                    <div v-else class="video-fallback">无封面</div>
                    <i class="video-check" :class="{ on: isPickedVideo(item) }" />
                    <figcaption :title="item.filename">{{ item.filename }}</figcaption>
                  </figure>
                </div>
              </section>

            </div>

            <aside class="preview-col">
              <div class="preview-card">
                <div class="block-head">
                  <h3>预览</h3>
                  <div class="stat-pills">
                    <span class="pill ok">将建 {{ liveJobs }} 条</span>
                    <span class="pill" :class="{ warn: liveAccountCount >= accountLimit }">{{ liveAccountCount }} 户</span>
                    <span class="pill" :class="{ bad: videoList.length && !pickedVideoIds.length }">{{ pickedVideoIds.length }} 条视频</span>
                  </div>
                </div>
                <p v-if="previewing" class="hint">正在刷新…</p>
                <div class="confirm-grid">
                  <div class="fact">
                    <label>优化目标</label>
                    <span>{{ goalText }}</span>
                  </div>
                  <div class="fact">
                    <label>投放载体</label>
                    <span>{{ (currentStrategy && currentStrategy.microAppName) || confirm.microAppName || "—" }}</span>
                  </div>
                  <div class="fact">
                    <label>投放身份</label>
                    <span>{{ nativeIdentityText }}</span>
                  </div>
                  <div class="fact">
                    <label>版权 / 书名</label>
                    <strong>{{ copyrightFilter || "—" }} · {{ bookName || "未选书" }}</strong>
                  </div>
                  <div class="fact">
                    <label>商品库</label>
                    <span>{{ confirm.libraryName || currentLibraryName || "未选库" }}</span>
                  </div>
                  <div class="fact">
                    <label>商品编号</label>
                    <span>{{ productRangeText }}</span>
                  </div>
                  <div class="fact wide">
                    <label>出价</label>
                    <span>{{ selectedBidText }}</span>
                  </div>
                  <div class="fact">
                    <label>日预算</label>
                    <span>{{ confirm.budget || "—" }}</span>
                  </div>
                  <div class="fact">
                    <label>ROI 系数</label>
                    <span>{{ roiText }}</span>
                  </div>
                  <div class="fact wide">
                    <label>项目命名</label>
                    <span>{{ (currentStrategy && currentStrategy.namePattern) || confirm.namePattern || "—" }}</span>
                  </div>
                  <div class="fact">
                    <label>抖音号昵称</label>
                    <span>{{ confirm.source || "—" }}</span>
                  </div>
                  <div class="fact">
                    <label>标题包</label>
                    <el-tooltip
                      v-if="currentTitlePack && currentTitlePack.titles && currentTitlePack.titles.length"
                      placement="left-start"
                      :show-after="200"
                    >
                      <template #content>
                        <div class="title-tip">
                          <p v-for="(text, index) in currentTitlePack.titles" :key="index">{{ index + 1 }}. {{ text }}</p>
                        </div>
                      </template>
                      <span class="title-hover">{{ currentTitlePack.name }} · {{ currentTitlePack.titles.length }} 条</span>
                    </el-tooltip>
                    <span v-else>{{ confirm.titleLibraryName || "—" }}</span>
                  </div>
                  <div class="fact">
                    <label>产品名称</label>
                    <span>{{ confirm.productName || "—" }}</span>
                  </div>
                  <div class="fact wide">
                    <label>产品卖点</label>
                    <span>{{ (confirm.sellingPoints || []).join("、") || "—" }}</span>
                  </div>
                  <div class="fact wide">
                    <label>行动号召</label>
                    <span>{{ (confirm.callToActions || []).join("、") || "—" }}</span>
                  </div>
                </div>
                <p v-for="text in notices" :key="text" class="block-note">{{ text }}</p>
                <p v-for="text in templateMessages" :key="text" class="block-line">{{ text }}</p>
                <div v-if="pickedVideoPreview.length" class="preview-videos">
                  <img v-for="item in pickedVideoPreview" :key="videoKey(item)" :src="item.posterUrl" :alt="item.filename" />
                  <span v-if="pickedVideoIds.length > pickedVideoPreview.length" class="muted">+{{ pickedVideoIds.length - pickedVideoPreview.length }}</span>
                </div>
              </div>
            </aside>
          </div>

          <div class="task-foot">
            <div class="foot-copy">
              <strong>{{ footTitle }}</strong>
              <span>{{ footHint }}</span>
            </div>
            <div class="foot-actions">
              <el-button :loading="previewing" @click="buildPreview">刷新</el-button>
              <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submitLaunch">确认搭建</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="records">
        <template #label>
          <span>任务记录</span>
          <i v-if="liveActive" class="tab-dot" />
        </template>
        <div class="task-pane">
          <div class="task-body records-body">
            <div v-if="liveActive" class="live-banner">
              <div class="live-copy">
                <strong>{{ liveBannerTitle }}</strong>
                <span>{{ liveBannerDetail }}</span>
                <el-button type="danger" plain :loading="stopping" @click="stopRunning(liveTask)">停止</el-button>
              </div>
              <el-progress :percentage="liveProgress" :stroke-width="8" />
            </div>
            <div class="page-filter-box">
              <div class="page-filter-left filters-wrap">
                <el-input
                  v-model="taskKeyword"
                  class="filter-input-keyword"
                  placeholder="书名 / 提交时间 / 编号"
                  :suffix-icon="$icons.Search"
                  clearable
                  clear-icon="Close"
                  @keyup.enter="searchTasks"
                  @clear="searchTasks"
                />
                <el-button type="primary" @click="searchTasks">查询</el-button>
                <el-button @click="resetTaskSearch">重置</el-button>
                <el-button :icon="$icons.Refresh" :loading="tasksLoading" @click="loadTasks()">刷新</el-button>
              </div>
            </div>
            <div class="records-table-wrap">
            <el-table :data="tasks" border size="small" height="100%" :header-cell-style="{ 'text-align': 'center' }" @row-click="openTask">
              <el-table-column prop="name" label="书名" min-width="220" show-overflow-tooltip />
              <el-table-column prop="createdAt" label="提交时间" width="170" align="center" />
              <el-table-column prop="id" label="编号" width="72" align="center" />
              <el-table-column prop="strategyName" label="策略" min-width="150" show-overflow-tooltip />
              <el-table-column label="商品" min-width="220" show-overflow-tooltip>
                <template #default="{ row }">
                  <div v-if="row.productLibrary || row.productSpan" class="product-cell">
                    <strong>{{ row.productLibrary || "未记录商品库" }}</strong>
                    <span>{{ row.productSpan || "—" }}</span>
                  </div>
                  <span v-else>—</span>
                </template>
              </el-table-column>
              <el-table-column label="计划" width="88" align="center">
                <template #default="{ row }">{{ planCount(row) }}</template>
              </el-table-column>
              <el-table-column label="进度" min-width="160">
                <template #default="{ row }">
                  <el-progress
                    v-if="row.status === 'running' || row.status === 'preparing'"
                    :percentage="taskProgress(row)"
                    :stroke-width="6"
                    :show-text="false"
                  />
                  <span v-else-if="row.status === 'ready'">商品已齐</span>
                  <span v-else-if="row.status === 'queued'">排队建商品</span>
                  <span v-else>成功 {{ row.added }} · 失败 {{ row.failed }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="118" align="center">
                <template #default="{ row }">
                  <el-tag :type="taskType(row.status)" size="small" effect="plain">{{ taskLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="" width="210" align="center">
                <template #default="{ row }">
                  <el-button v-if="['running', 'preparing', 'ready', 'queued'].includes(row.status)" link type="danger" :loading="stopping" @click.stop="stopRunning(row)">停止</el-button>
                  <el-button link type="primary" @click.stop="reuseTask(row)">再搭一次</el-button>
                  <el-button link type="primary" @click.stop="openTask(row)">详情</el-button>
                </template>
              </el-table-column>
            </el-table>
            </div>
            <div class="page-pagination-box">
              <CzPagination
                :total="taskTotal"
                v-model:pageNo="taskPage"
                v-model:pageSize="taskPageSize"
                @change="loadTasks()"
              />
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-drawer v-model="accountDrawer" :title="accountDrawerTitle" size="480px" append-to-body>
      <p class="hint">同版权、同档位、尚未勾上的户。点一下加回来。</p>
      <el-input v-model="accountKeyword" placeholder="搜户名" clearable clear-icon="Close" class="drawer-search" />
      <div v-for="row in addableTiers" :key="row.tier" class="add-tier">
        <header>
          <strong>{{ row.tier }}</strong>
          <span>还可加 {{ row.rest.length }}</span>
        </header>
        <div class="account-chips">
          <button
            v-for="item in row.rest"
            :key="item.advertiserId"
            type="button"
            class="account-chip"
            @click="addAccount(item)"
          >
            <img v-if="item.avatarUrl" :src="item.avatarUrl" alt="" referrerpolicy="no-referrer" @error="item.avatarUrl = ''" />
            <i v-else>{{ accountInitial(item.name) }}</i>
            <span>{{ item.name }}</span>
          </button>
        </div>
      </div>
      <p v-if="!addableTiers.length" class="hint">这一档没有还能加的户。</p>
    </el-drawer>

    <el-dialog v-model="detailVisible" :title="detailTitle" width="1080px" append-to-body class="detail-dialog" align-center>
      <p v-if="failSummary" class="fail-summary">{{ failSummary }}</p>
      <div class="detail-toolbar">
        <div class="chip-row">
          <button type="button" class="chip" :class="{ on: detailFilter === 'all' }" @click="detailFilter = 'all'">全部 {{ detailItems.length }}</button>
          <button type="button" class="chip" :class="{ on: detailFilter === 'added' }" @click="detailFilter = 'added'">成功 {{ detailAdded }}</button>
          <button type="button" class="chip" :class="{ on: detailFilter === 'fail' }" @click="detailFilter = 'fail'">失败 {{ detailFailed }}</button>
          <button type="button" class="chip" :class="{ on: detailFilter === 'rate_limit' }" @click="detailFilter = 'rate_limit'">限频 {{ kindCount('rate_limit') }}</button>
          <button type="button" class="chip" :class="{ on: detailFilter === 'rejected' }" @click="detailFilter = 'rejected'">官方拒绝 {{ kindCount('rejected') }}</button>
        </div>
        <div class="pick-row">
          <el-button type="primary" plain :disabled="!detailSelected.length || retrying" @click="retrySelected(false)">
            重试选中 {{ detailSelected.length || "" }}
          </el-button>
          <el-button type="primary" :disabled="!detailFailed || retrying" @click="retrySelected(true)">重试全部失败</el-button>
        </div>
      </div>
      <el-table
        ref="detailTable"
        :data="visibleDetailItems"
        border
        size="small"
        max-height="520"
        row-key="id"
        @selection-change="onDetailSelect"
      >
        <el-table-column type="selection" width="46" :selectable="canRetryRow" />
        <el-table-column prop="accountName" label="户" min-width="140" show-overflow-tooltip />
        <el-table-column prop="bookName" label="书名" min-width="130" show-overflow-tooltip />
        <el-table-column prop="productName" label="商品" min-width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="88" align="center">
          <template #default="{ row }">
            <el-tag :type="itemStatusType(row.status)" size="small" effect="plain">{{ itemStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="108" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.errorKindLabel" :type="kindType(row.errorKind)" size="small" effect="plain">{{ row.errorKindLabel }}</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="projectId" label="项目 ID" width="170" align="center" show-overflow-tooltip />
        <el-table-column label="原因" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">{{ row.reason || row.message || "没有返回原因" }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup name="novelOceanLaunch">
import { useRouter } from "vue-router"
import request from "@/request"
import CzPagination from "@/components/cz-pagination/index.vue"

const router = useRouter()
const DEFAULT_TIERS = ["1.9", "2.9", "3.9", "9.9", "29.9", "39.9"]
const BID_OF = { "1.9": "2.1", "2.9": "3.1", "3.9": "4.1", "9.9": "13", "29.9": "32", "39.9": "43" }
const ACCOUNT_LIMIT = 500
const tab = ref("task")
const accounts = ref([])
const strategies = ref([])
const bidStrategies = ref([])
const titleLibraries = ref([])
const books = ref([])
const libraries = ref([])
const launchTiers = ref(DEFAULT_TIERS.slice())
const strategyId = ref(null)
const bookName = ref("")
const copyrightFilter = ref("点众")
const platformId = ref("")
const productMode = ref("reuse")
const selectedTiers = ref([])
const plan = ref(null)
const pickedVideoIds = ref([])
const pickedAdvertiserIds = ref([])
const accountDrawer = ref(false)
const accountDrawerTier = ref("")
const accountKeyword = ref("")
const tasks = ref([])
const taskKeyword = ref("")
const taskPage = ref(1)
const taskPageSize = ref(20)
const taskTotal = ref(0)
const liveTask = ref(null)
const detailVisible = ref(false)
const detailItems = ref([])
const detailTitle = ref("任务详情")
const detailFilter = ref("all")
const detailSelected = ref([])
const detailTaskId = ref(0)
const previewing = ref(false)
const submitting = ref(false)
const stopping = ref(false)
const retrying = ref(false)
const tasksLoading = ref(false)
const bookLoading = ref(false)
const detailTable = ref(null)
let previewSeq = 0
let pollTimer = 0
let previewTimer = 0
let bookSearchTimer = 0
let bookSearchSeq = 0
let loadedBookKey = ""

const templateMessages = computed(() => (plan.value && plan.value.templateMessages) || [])
const notices = computed(() => (plan.value && plan.value.notices) || [])
const confirm = computed(() => (plan.value && plan.value.confirm) || {})
const productPlan = computed(() => (plan.value && plan.value.productPlan) || {})
const videoEmptyText = computed(() => {
  const first = ((plan.value && plan.value.tiers) || []).find((row) => row.messages && row.messages.length)
  return (first && first.messages[0]) || "巨量线上素材库里没有对上这本书的视频"
})
const liveActive = computed(() =>
  ["running", "preparing", "ready"].includes(liveTask.value && liveTask.value.status),
)
const videoList = computed(() => (plan.value && plan.value.videos) || [])
const pickedVideoPreview = computed(() =>
  videoList.value.filter((item) => isPickedVideo(item) && item.posterUrl).slice(0, 8),
)
const accountLimit = computed(() => Number((plan.value && plan.value.accountLimit) || ACCOUNT_LIMIT) || ACCOUNT_LIMIT)
const bookBlocked = computed(() => {
  const book = plan.value && plan.value.books && plan.value.books[0]
  return Boolean(book && book.status === "block")
})
const tierViews = computed(() => ((plan.value && plan.value.tiers) || []).map((row) => ({ ...row, state: tierState(row) })))
const liveJobs = computed(() => tierViews.value.reduce((sum, row) => sum + row.state.jobs, 0))
const liveFail = computed(() => tierViews.value.reduce((sum, row) => sum + Math.max(0, row.state.picked - row.state.jobs), 0))
const liveAccountCount = computed(() => pickedAdvertiserIds.value.length)
const livePoolCount = computed(() =>
  (plan.value && plan.value.accountTotal) ||
  tierViews.value.reduce((sum, row) => sum + ((row.accounts && row.accounts.length) || 0), 0),
)
const canSubmit = computed(() =>
  Boolean(plan.value) &&
  Boolean(strategyId.value) &&
  Boolean(platformId.value) &&
  !templateMessages.value.filter((text) => text !== "还没选策略模板").length &&
  !bookBlocked.value &&
  pickedVideoIds.value.length > 0 &&
  liveJobs.value > 0 &&
  !submitting.value,
)
const optionCopyrights = ref([])
const accountsTouched = ref(false)
const copyrights = computed(() => {
  const rows = optionCopyrights.value.length
    ? optionCopyrights.value
    : [...new Set(accounts.value.map((item) => item.copyrightOwner).filter(Boolean))]
  return rows.length ? rows : ["点众", "番茄"]
})
const visibleBooks = computed(() => books.value)
const currentStrategy = computed(() => strategies.value.find((item) => item.id === strategyId.value) || null)
const currentTitlePack = computed(() => {
  const id = (currentStrategy.value && currentStrategy.value.titleLibraryId) || confirm.value.titleLibraryId
  return titleLibraries.value.find((item) => item.id === id) || null
})
const goalText = computed(() => {
  const goal = currentStrategy.value && currentStrategy.value.goal
  if (!goal) return "—"
  return goal === "付费" ? "付费" : "付费 + 付费ROI"
})
const nativeIdentityText = computed(() => {
  const row = currentStrategy.value
  if (!row) return "—"
  if (row.nativeType === "ACCOUNT") return "账户信息"
  const name = row.awemeName || ""
  return name ? `抖音号 · ${name}` : "抖音号 · 该户已授权的号"
})
const roiText = computed(() => {
  if (!currentStrategy.value) return "—"
  if (currentStrategy.value.goal === "付费") return "不使用"
  return confirm.value.roiGoal || currentStrategy.value.roiGoal || "—"
})
const currentBook = computed(() => books.value.find((item) => item.bookName === bookName.value) || null)
const currentLibrary = computed(() => libraries.value.find((item) => item.id === platformId.value) || null)
const currentLibraryName = computed(() => (currentLibrary.value && currentLibrary.value.name) || "")
const strategyHint = computed(() => {
  const row = currentStrategy.value
  if (!row) return "复用的智擎参数放在策略模板里，最后套上即可。"
  const pack = titleLibraries.value.find((item) => item.id === row.titleLibraryId)
  const bits = [row.summary || row.name]
  if (pack) bits.push(`标题包 ${pack.name}`)
  return bits.join(" · ")
})
const libraryHint = computed(() => {
  const current = productPlan.value
  if (!current.count) return "商品名按「书名-编号」准备。库里已经有的编号可以直接复用。"
  if (current.mode === "reuse" && current.reuseCount && !current.createCount) {
    return `库里已有 ${current.existingCount} 个编号。这次 ${current.count} 条计划全部套用 ${planRange(current)}。`
  }
  if (current.mode === "reuse" && current.reuseCount) {
    return `先套用 ${current.reuseCount} 个已有编号，不够的 ${current.createCount} 个从 -${current.from} 继续建。`
  }
  if (current.existingCount) return `已有编号留着。这次从 -${current.from} 新建到 -${current.to}。`
  return `这次新建 ${current.count} 个商品：${planRange(current)}`
})
const libraryActionText = computed(() => {
  const current = productPlan.value
  if (!current.count) return ""
  if (current.mode === "reuse" && current.reuseCount && !current.createCount) return `复用已有 ${current.reuseCount} 个`
  if (current.mode === "reuse" && current.reuseCount) return `复用 ${current.reuseCount} 个，新建 ${current.createCount} 个`
  if (current.from && current.to) return `新建 ${current.from}–${current.to}`
  return `新建 ${current.count} 个`
})
const productOptions = computed(() => (plan.value && plan.value.productOptions) || [])
const showProductMode = computed(() => productOptions.value.length > 0)
const reuseOptionText = computed(() => productOptionText(productOptions.value.find((item) => item.mode === "reuse")))
const freshOptionText = computed(() => productOptionText(productOptions.value.find((item) => item.mode === "fresh")))
const productRangeText = computed(() => {
  if (!platformId.value) return "未选库"
  const current = productPlan.value
  if (!current.count) return liveJobs.value ? "对照后显示编号" : "—"
  const range = planRange(current)
  if (current.mode === "reuse" && current.reuseCount && !current.createCount) return `${range} · 复用已有`
  if (current.mode === "reuse" && current.reuseCount) return `${range} · 复用 ${current.reuseCount}，新建 ${current.createCount}`
  return `${range} · 新建`
})
const selectedBidText = computed(() => {
  const picked = tierCards.value.filter((item) => item.on && item.bid && item.bid !== "—")
  if (!picked.length) return "未选档位"
  return picked.map((item) => `${item.tier} → ${item.bid}`).join("，")
})
function bidOfTier(tier) {
  const strategy = strategies.value.find((item) => item.id === strategyId.value)
  const plan = bidStrategies.value.find((item) => item.id === (strategy && strategy.bidStrategyId)) || bidStrategies.value[0]
  const row = plan && (plan.tiers || []).find((item) => item.tier === tier)
  if (row) return row.bid != null ? row.bid : row.roiBid
  return BID_OF[tier] || "—"
}
const tierCards = computed(() =>
  launchTiers.value.map((tier) => {
    const hasPromo = Boolean(currentBook.value && (currentBook.value.tiers || []).includes(tier))
    const accountCount = accounts.value.filter((item) => {
      if (copyrightFilter.value && item.copyrightOwner !== copyrightFilter.value) return false
      return item.tier === tier
    }).length
    return {
      tier,
      bid: bidOfTier(tier),
      accountCount,
      hasPromo,
      on: selectedTiers.value.includes(tier),
    }
  }),
)
const liveProgress = computed(() => taskProgress(liveTask.value))
const liveBannerTitle = computed(() => {
  const row = liveTask.value
  if (!row) return "正在创建"
  if (row.status === "preparing" || row.preparingProducts) return "正在创建商品"
  if (row.status === "ready") return "等待搭建"
  if (row.status === "running") return "正在搭建计划"
  if ((row.added || 0) + (row.failed || 0) > 0) return "正在提交巨量"
  return "正在搭建计划"
})
const liveBannerDetail = computed(() => {
  const row = liveTask.value || {}
  if (row.status === "preparing" || row.preparingProducts || row.phase === "products") {
    if (row.phase === "products" && row.phaseTotal) return `已创建商品 ${row.phaseDone || 0}/${row.phaseTotal}。其他书可以同时建商品，搭计划会按顺序接上`
    return "多本书同时建商品。商品齐了，等前面的计划搭完就自动开始"
  }
  if (row.status === "ready") return "商品已经齐了，上一本计划搭完就自动开始这一本"
  const counts = `成功 ${row.added || 0} · 失败 ${row.failed || 0} · 排队 ${row.pending || 0}`
  if (row.phase === "prepare" && row.phaseTotal) return `已核对 ${row.phaseDone || 0}/${row.phaseTotal} 个户 · ${counts}`
  return counts
})
const detailAdded = computed(() => detailItems.value.filter((row) => row.status === "added").length)
const detailFailed = computed(() => detailItems.value.filter((row) => row.status === "fail").length)
const failSummary = computed(() => {
  const rows = detailItems.value.filter((row) => row.status === "fail")
  if (!rows.length) {
    const pending = detailItems.value.length && detailItems.value.every((row) => !row.status || row.status === "pending")
    if (!pending) return ""
    const creating = detailItems.value.some((row) => String(row.message || "").includes("正在创建商品"))
    const active = liveTask.value && ["running", "preparing", "ready"].includes(liveTask.value.status)
    if (creating || active) return "正在创建商品。编号齐了才搭计划，所以现在还没有成功或失败。"
    return "这批在拿到巨量结果前就中断了，所以每条记录都还没有原因。"
  }
  const counts = new Map()
  for (const row of rows) {
    const text = row.reason || row.message || "没有返回原因"
    counts.set(text, (counts.get(text) || 0) + 1)
  }
  return [...counts.entries()].map(([text, count]) => `${count} 条：${text}`).join("；")
})
const visibleDetailItems = computed(() => {
  const rows = detailItems.value
  if (detailFilter.value === "added") return rows.filter((row) => row.status === "added")
  if (detailFilter.value === "fail") return rows.filter((row) => row.status === "fail")
  if (detailFilter.value === "rate_limit" || detailFilter.value === "rejected") {
    return rows.filter((row) => row.errorKind === detailFilter.value)
  }
  return rows
})
const addableTiers = computed(() => {
  const keyword = accountKeyword.value.trim()
  const room = Math.max(0, accountLimit.value - pickedAdvertiserIds.value.length)
  if (!room) return []
  return tierViews.value
    .filter((row) => !accountDrawerTier.value || row.tier === accountDrawerTier.value)
    .map((row) => ({
      tier: row.tier,
      rest: sortAccountRows((row.accounts || []).filter((item) => {
        if (isPickedAccount(item)) return false
        if (!keyword) return true
        return String(item.name || "").includes(keyword)
      })),
    }))
    .filter((row) => row.rest.length)
})
const accountDrawerTitle = computed(() => accountDrawerTier.value ? `新增 ${accountDrawerTier.value} 档账户` : "新增投放账户")
const footTitle = computed(() => {
  if (plan.value) {
    const fail = liveFail.value
    return `选用 ${liveAccountCount.value} 个户，将建 ${liveJobs.value} 条计划`
      + (fail ? `，其中 ${fail} 条对不上` : "")
  }
  if (!strategyId.value) return "先选一个策略模板"
  if (!copyrightFilter.value) return "先选版权，再选书"
  if (!bookName.value) return "选一本书，勾要投的档位"
  return `${copyrightFilter.value} · ${bookName.value} · ${selectedTiers.value.join(" / ") || "未选档位"}`
})
const footHint = computed(() => {
  if (liveActive.value) return "这一本会先建商品。搭计划等前面的书结束，商品齐了自动接上。"
  if (!strategyId.value) return "先选一个策略模板。"
  if (!copyrightFilter.value) return "先选点众或番茄。"
  if (!bookName.value) return "再选要投的书。"
  if (!selectedTiers.value.length) return "至少勾一个档位。"
  if (!platformId.value) return "选一个已加入批量基建的商品库。"
  if (plan.value && !pickedVideoIds.value.length) return "至少留一条要投的线上视频。"
  if (plan.value && !liveAccountCount.value) return "至少留一个要投的户。"
  if (plan.value && !liveJobs.value) return "勾上的户还对不上链接。"
  if (plan.value && templateMessages.value.filter((text) => text !== "还没选策略模板").length) {
    return templateMessages.value[0]
  }
  const current = productPlan.value
  if (current.mode === "reuse" && current.reuseCount && !current.createCount) {
    return "确认后直接套用库里已有编号，页面会切到任务记录看进度。"
  }
  if (current.createCount) return "确认后先补齐缺的商品编号，再创建计划。页面会立刻切到任务记录。"
  return "确认无误后开始搭建。一户一条智擎计划。"
})

function statusType(status) {
  if (status === "ready") return "success"
  if (status === "warn") return "warning"
  return "danger"
}
function statusLabel(status) {
  if (status === "ready") return "可创建"
  if (status === "warn") return "需确认"
  return "不能创建"
}
function taskType(status) {
  if (status === "done") return "success"
  if (status === "partial" || status === "running" || status === "preparing") return "warning"
  if (status === "queued" || status === "ready" || status === "stopped") return "info"
  return "danger"
}
function taskHeading(row) {
  if (!row) return "任务详情"
  return `${row.name || "任务 " + row.id} · ${taskLabel(row.status)}`
}
function taskLabel(status) {
  if (status === "preparing") return "创建商品"
  if (status === "ready") return "等待搭建"
  if (status === "running") return "搭建计划"
  if (status === "queued") return "排队中"
  if (status === "done") return "全部成功"
  if (status === "partial") return "部分成功"
  if (status === "pending") return "排队中"
  if (status === "stopped") return "已停止"
  return "失败"
}
function itemStatusType(status) {
  if (status === "added") return "success"
  if (status === "pending") return "warning"
  return "danger"
}
function itemStatusLabel(status) {
  if (status === "added") return "成功"
  if (status === "pending") return "排队"
  return "失败"
}
function kindType(kind) {
  if (kind === "rate_limit" || kind === "network") return "warning"
  if (kind === "account") return "info"
  return "danger"
}
function kindCount(kind) {
  return detailItems.value.filter((row) => row.errorKind === kind).length
}
function canRetryRow(row) {
  return row.status === "fail" && Boolean(row.id)
}
function planRange(current) {
  const names = (current && current.names) || []
  const first = (current && current.firstName) || names[0] || ""
  const last = (current && current.lastName) || names[names.length - 1] || ""
  if (!first) return "—"
  return first === last ? first : `${first} ～ ${last}`
}
function productOptionText(option) {
  if (!option) return "对照后显示编号"
  if (option.mode === "reuse" && option.reuseCount && !option.createCount) return planRange(option)
  if (option.mode === "reuse" && option.reuseCount) return `已有 ${option.reuseCount} 个，再新建 ${option.createCount} 个`
  if (option.from && option.to) return `新建 -${option.from} ～ -${option.to}`
  return planRange(option)
}
function accountId(item) {
  return String((item && item.advertiserId) || "").trim()
}
function accountInitial(name) {
  const text = String(name || "").trim()
  return text ? text.slice(0, 1) : "?"
}
function isPickedAccount(item) {
  return pickedAdvertiserIds.value.includes(accountId(item))
}
function setProductMode(mode) {
  if (productMode.value === mode) return
  productMode.value = mode
  markDirty()
}
function compareAccountName(a, b) {
  return String(a || "").localeCompare(String(b || ""), "zh", { numeric: true, sensitivity: "base" })
}
function sortAccountRows(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const tierA = Number(a && a.tier) || 0
    const tierB = Number(b && b.tier) || 0
    if (tierA !== tierB) return tierA - tierB
    return compareAccountName(a && a.name, b && b.name)
  })
}
function matchingAccounts() {
  return sortAccountRows(accounts.value.filter((item) => {
    if (copyrightFilter.value && item.copyrightOwner !== copyrightFilter.value) return false
    return selectedTiers.value.includes(item.tier)
  }))
}
function resetSuggestedAccounts() {
  accountsTouched.value = false
  pickedAdvertiserIds.value = matchingAccounts().slice(0, accountLimit.value).map(accountId).filter(Boolean)
}
function tierState(row) {
  const list = (row && row.accounts) || []
  const picked = list.filter((item) => isPickedAccount(item))
  const ready = picked.filter((item) => item.ready)
  const messages = []
  let status = "ready"
  if (bookBlocked.value) {
    status = "block"
    const book = plan.value && plan.value.books && plan.value.books[0]
    for (const text of (book && book.messages) || []) messages.push(text)
  } else if (!row.promo) {
    status = "block"
    messages.push("没有这一档的推广链接")
  } else if (!list.length) {
    status = "block"
    messages.push("没有这一档的在投账户")
  } else if (!picked.length) {
    status = "warn"
    messages.push("这一档还没勾选账户")
  } else if (!ready.length) {
    status = "block"
    messages.push("勾选的户对不上推广链接")
  } else if (ready.length < picked.length) {
    status = "warn"
    messages.push(`${picked.length - ready.length} 个户对不上推广链接`)
  }
  return {
    jobs: status === "block" && bookBlocked.value ? 0 : ready.length,
    picked: picked.length,
    pool: list.length,
    status: bookBlocked.value ? "block" : status,
    messages,
  }
}
function visibleAccounts(row) {
  return sortAccountRows(((row && row.accounts) || []).filter((item) => isPickedAccount(item)))
}
function syncPickedAccounts(data) {
  const incoming = []
  for (const row of (data && data.tiers) || []) {
    for (const item of row.accounts || []) {
      const id = accountId(item)
      if (id && !incoming.includes(id)) incoming.push(id)
    }
  }
  const keep = pickedAdvertiserIds.value.filter((id) => incoming.includes(id))
  if (accountsTouched.value) {
    pickedAdvertiserIds.value = keep
    return
  }
  const suggested = ((data && data.suggestedAccountIds) || []).filter((id) => incoming.includes(id))
  pickedAdvertiserIds.value = keep.length ? keep : suggested
}
function removeAccount(item) {
  const id = accountId(item)
  accountsTouched.value = true
  pickedAdvertiserIds.value = pickedAdvertiserIds.value.filter((value) => value !== id)
  schedulePreview()
}
function addAccount(item) {
  const id = accountId(item)
  if (!id || pickedAdvertiserIds.value.includes(id)) return
  if (pickedAdvertiserIds.value.length >= accountLimit.value) {
    ElMessage.warning(`一次最多 ${accountLimit.value} 个户`)
    return
  }
  accountsTouched.value = true
  pickedAdvertiserIds.value = [...pickedAdvertiserIds.value, id]
  schedulePreview()
}
function selectSuggestedAccounts() {
  accountsTouched.value = false
  const suggested = ((plan.value && plan.value.suggestedAccountIds) || []).slice(0, accountLimit.value)
  pickedAdvertiserIds.value = suggested.length ? suggested : matchingAccounts().slice(0, accountLimit.value).map(accountId).filter(Boolean)
  schedulePreview()
}
function openAccountDrawer(tier) {
  accountDrawerTier.value = tier || ""
  accountKeyword.value = ""
  accountDrawer.value = true
}
function taskProgress(row) {
  if (!row) return 0
  if (row.status === "preparing") {
    const total = Number(row.phaseTotal) || 0
    if (!total) return 0
    return Math.min(100, Math.round((Number(row.phaseDone || 0) / total) * 100))
  }
  const total = Number(row.total) || Number(row.added || 0) + Number(row.failed || 0) + Number(row.pending || 0)
  const done = Number(row.added || 0) + Number(row.failed || 0)
  if (!done && row.phase === "prepare" && row.phaseTotal) {
    return Math.min(70, 40 + Math.round((Number(row.phaseDone || 0) / Number(row.phaseTotal)) * 30))
  }
  if (!total) return 0
  return Math.min(100, Math.round((done / total) * 100))
}
function videoKey(item) {
  return String((item && (item.videoId || item.filename)) || "").trim()
}
function isPickedVideo(item) {
  return pickedVideoIds.value.includes(videoKey(item))
}
let keepVideoPick = false
function syncPickedVideos(videos) {
  const incoming = (videos || []).map(videoKey).filter(Boolean)
  const keep = pickedVideoIds.value.filter((id) => incoming.includes(id))
  if (keepVideoPick) {
    pickedVideoIds.value = keep
    keepVideoPick = false
    return
  }
  pickedVideoIds.value = keep.length ? keep : incoming
}
function toggleVideo(item) {
  const key = videoKey(item)
  if (!key) return
  pickedVideoIds.value = pickedVideoIds.value.includes(key)
    ? pickedVideoIds.value.filter((id) => id !== key)
    : [...pickedVideoIds.value, key]
}
function selectAllVideos() {
  pickedVideoIds.value = videoList.value.map(videoKey).filter(Boolean)
}
function clearVideos() {
  pickedVideoIds.value = []
}
function pickDefaultLibrary() {
  if (platformId.value && libraries.value.some((item) => item.id === platformId.value)) return
  const preferred = libraries.value.find((item) => /自动搭建-小说/.test(item.name))
    || libraries.value.find((item) => item.preferred)
    || libraries.value[0]
  platformId.value = preferred ? preferred.id : ""
}
function markDirty() {
  schedulePreview()
}
function syncLaunchTiers() {
  const strategy = strategies.value.find((item) => item.id === strategyId.value)
  const plan = bidStrategies.value.find((item) => item.id === (strategy && strategy.bidStrategyId)) || bidStrategies.value[0]
  const tiers = ((plan && plan.tiers) || []).map((item) => item.tier)
  if (!tiers.length) return
  launchTiers.value = tiers
  selectedTiers.value = selectedTiers.value.filter((tier) => tiers.includes(tier))
}
function onStrategyChange() {
  syncLaunchTiers()
  markDirty()
}
function goStrategies() {
  router.push("/novel/ocean-strategies")
}
function setCopyright(value) {
  if (copyrightFilter.value === value) return
  copyrightFilter.value = value
  loadedBookKey = ""
  const keepName = bookName.value
  fetchBooks("").then(() => {
    if (keepName && !books.value.some((item) => item.bookName === keepName)) {
      bookName.value = ""
      pickedVideoIds.value = []
      pickedAdvertiserIds.value = []
      selectedTiers.value = []
      plan.value = null
      markDirty()
      return
    }
    if (keepName) {
      onBookChange(keepName)
      return
    }
    resetSuggestedAccounts()
    markDirty()
  })
}
function setLibrary(id) {
  platformId.value = id
  markDirty()
}
function planCount(row) {
  return Number(row && (row.total || row.accountCount)) || 0
}
let restoringTask = false
function toggleTier(tier) {
  const card = tierCards.value.find((item) => item.tier === tier)
  if (!card || !card.hasPromo) return
  const current = selectedTiers.value.includes(tier)
  selectedTiers.value = current ? selectedTiers.value.filter((item) => item !== tier) : [...selectedTiers.value, tier]
  resetSuggestedAccounts()
  markDirty()
}
function onBookChange(name) {
  if (restoringTask) return
  bookName.value = name || ""
  pickedVideoIds.value = []
  const row = books.value.find((item) => item.bookName === bookName.value)
  const tiers = row && row.tiers && row.tiers.length ? row.tiers.slice() : []
  selectedTiers.value = tiers.filter((tier) => tier !== "1.9")
  resetSuggestedAccounts()
  plan.value = null
  markDirty()
}
function schedulePreview() {
  clearTimeout(previewTimer)
  if (!bookName.value || !selectedTiers.value.length) return
  previewTimer = setTimeout(() => buildPreview(), 280)
}

async function loadOptions() {
  const res = await request({ url: "/admin-api/oceanengine/launch/options" })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "读取失败")
    return
  }
  accounts.value = res.data.accounts || []
  strategies.value = res.data.strategies || []
  bidStrategies.value = res.data.bidStrategies || []
  titleLibraries.value = res.data.titleLibraries || []
  books.value = res.data.books || []
  libraries.value = res.data.libraries || []
  optionCopyrights.value = res.data.copyrights || []
  launchTiers.value = (res.data.tiers && res.data.tiers.length ? res.data.tiers : DEFAULT_TIERS).slice()
  tasks.value = res.data.tasks || []
  taskTotal.value = Number(res.data.taskTotal) || tasks.value.length
  pickDefaultLibrary()
  if (!strategyId.value && strategies.value.length) strategyId.value = strategies.value[0].id
  syncLaunchTiers()
  if (copyrights.value.length && !copyrights.value.includes(copyrightFilter.value)) {
    copyrightFilter.value = copyrights.value[0]
  }
  await fetchBooks("")
  const active = tasks.value.find((item) => item.status === "running")
    || tasks.value.find((item) => item.status === "preparing")
    || tasks.value.find((item) => item.status === "ready")
  if (active) pollTask(active.id)
}
function mergeBookOptions(rows) {
  const list = Array.isArray(rows) ? rows : []
  const current = books.value.find((item) => item.bookName === bookName.value)
  if (current && !list.some((item) => item.bookName === current.bookName)) return [current, ...list]
  return list
}
async function fetchBooks(keyword) {
  if (!copyrightFilter.value) {
    books.value = []
    loadedBookKey = ""
    return
  }
  const text = String(keyword || "").trim()
  const key = `${copyrightFilter.value}\n${text}`
  if (key === loadedBookKey && books.value.length) return
  const seq = ++bookSearchSeq
  const showLoading = !books.value.length
  if (showLoading) bookLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/launch/books",
      params: { keyword: text, copyright: copyrightFilter.value },
    })
    if (seq !== bookSearchSeq) return
    if (res.code !== 0) {
      ElMessage.error(res.msg || "搜书失败")
      return
    }
    books.value = mergeBookOptions(res.data || [])
    loadedBookKey = key
  } finally {
    if (seq === bookSearchSeq) bookLoading.value = false
  }
}
function searchRemoteBooks(keyword) {
  clearTimeout(bookSearchTimer)
  bookSearchTimer = setTimeout(() => fetchBooks(keyword), 220)
}
function onBookSelectVisible(open) {
  if (open && !books.value.length && copyrightFilter.value) fetchBooks("")
}
function payload() {
  const data = {
    strategyId: strategyId.value,
    bookName: bookName.value,
    tiers: selectedTiers.value.slice(),
    copyrightOwner: copyrightFilter.value || "",
    platformId: platformId.value || "",
    productMode: productMode.value === "fresh" ? "fresh" : "reuse",
    advertiserIds: pickedAdvertiserIds.value.slice(),
  }
  if (pickedVideoIds.value.length) data.videoIds = pickedVideoIds.value.slice()
  return data
}
async function buildPreview() {
  if (!bookName.value || !selectedTiers.value.length) return
  const seq = ++previewSeq
  previewing.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/launch/preview", method: "POST", data: payload(), timeout: 60000 })
    if (seq !== previewSeq) return
    if (res.code !== 0) {
      plan.value = null
      ElMessage.error(res.msg || "预览失败")
      return
    }
    plan.value = res.data
    syncPickedVideos(res.data.videos || [])
    syncPickedAccounts(res.data)
  } finally {
    if (seq === previewSeq) previewing.value = false
  }
}
function stopPoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = 0
}
function applyTask(res) {
  const row = res.data
  const active = ["running", "preparing", "ready"].includes(row.status)
  if (active || (liveTask.value && liveTask.value.id === row.id)) liveTask.value = row
  const index = tasks.value.findIndex((item) => item.id === res.data.id)
  const summary = {
    id: res.data.id,
    name: res.data.name || "",
    status: res.data.status,
    added: res.data.added,
    failed: res.data.failed,
    total: res.data.total,
    pending: res.data.pending,
    bookCount: res.data.bookCount,
    accountCount: res.data.accountCount,
    strategyName: res.data.strategyName,
    productLibrary: res.data.productLibrary || "",
    productSpan: res.data.productSpan || "",
    phase: res.data.phase || "",
    phaseDone: res.data.phaseDone || 0,
    phaseTotal: res.data.phaseTotal || 0,
    createdAt: res.data.createdAt,
  }
  if (index >= 0) tasks.value.splice(index, 1, summary)
  else tasks.value.unshift(summary)
  if (detailVisible.value && detailTaskId.value === res.data.id) {
    detailItems.value = res.data.items || []
    detailTitle.value = taskHeading(res.data)
  }
}
function activeTaskRow(list) {
  const rows = list || []
  return rows.find((item) => item.status === "running")
    || rows.find((item) => item.status === "preparing")
    || rows.find((item) => item.status === "ready")
}
async function refreshBoard() {
  await loadTasks(true)
  if (detailVisible.value && detailTaskId.value) {
    const res = await request({ url: `/admin-api/oceanengine/launch/tasks/${detailTaskId.value}` })
    if (res.code === 0) {
      detailItems.value = res.data.items || []
      detailTitle.value = taskHeading(res.data)
      applyTask(res)
    }
  }
  if (!liveTask.value || !["running", "preparing", "ready"].includes(liveTask.value.status)) stopPoll()
}
function pollTask() {
  stopPoll()
  refreshBoard()
  pollTimer = setInterval(() => {
    refreshBoard()
  }, 1500)
}
async function loadTasks(quiet) {
  if (!quiet) tasksLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/launch/tasks",
      params: {
        keyword: taskKeyword.value.trim(),
        page: taskPage.value,
        pageSize: taskPageSize.value,
      },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "读取任务失败")
      return
    }
    const data = res.data || {}
    const list = Array.isArray(data) ? data : data.list || []
    tasks.value = list
    taskTotal.value = Array.isArray(data) ? list.length : Number(data.total) || 0
    if (data.active) liveTask.value = data.active
    else if (!activeTaskRow(list)) liveTask.value = null
  } finally {
    tasksLoading.value = false
  }
}
function searchTasks() {
  taskPage.value = 1
  loadTasks()
}
function resetTaskSearch() {
  taskKeyword.value = ""
  taskPage.value = 1
  loadTasks()
}
async function reuseTask(row) {
  const res = await request({ url: `/admin-api/oceanengine/launch/tasks/${row.id}/draft` })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "读取这批搭建信息失败")
    return
  }
  const draft = res.data || {}
  const missing = []
  tab.value = "task"
  restoringTask = true
  const strategy = strategies.value.find((item) => item.id === draft.strategyId)
    || strategies.value.find((item) => item.name && item.name === draft.strategyName)
  if (strategy) strategyId.value = strategy.id
  else missing.push("策略模板")
  if (draft.copyright) copyrightFilter.value = draft.copyright
  loadedBookKey = ""
  await fetchBooks(draft.bookName || "")
  if (draft.bookName && !books.value.some((item) => item.bookName === draft.bookName)) {
    books.value = [{ id: `draft-${row.id}`, bookName: draft.bookName, externalBookId: "", tiers: draft.tiers || [] }, ...books.value]
    missing.push("这本书已不在当前书单，已按原书名填上")
  }
  bookName.value = draft.bookName || ""
  selectedTiers.value = Array.isArray(draft.tiers) ? draft.tiers.slice() : []
  if (draft.productMode === "fresh" || draft.productMode === "reuse") productMode.value = draft.productMode
  if (draft.platformId) {
    platformId.value = String(draft.platformId)
    if (!libraries.value.some((item) => item.id === platformId.value)) {
      libraries.value = [...libraries.value, { id: platformId.value, name: draft.platformName || "原商品库", industry: "商品库" }]
    }
  } else missing.push("商品库")
  accountsTouched.value = true
  pickedAdvertiserIds.value = Array.isArray(draft.advertiserIds) ? draft.advertiserIds.slice() : []
  keepVideoPick = true
  pickedVideoIds.value = Array.isArray(draft.videoIds) ? draft.videoIds.slice() : []
  plan.value = null
  await nextTick()
  restoringTask = false
  const bits = [
    strategy ? strategy.name : "未匹配到策略",
    draft.bookName || "未找到书名",
    `${selectedTiers.value.length} 个档位`,
    `${pickedAdvertiserIds.value.length} 个户`,
    `${pickedVideoIds.value.length} 条视频`,
    draft.platformName || "商品库",
  ]
  ElMessage.success(`已填到新建任务：${bits.join("，")}`)
  if (missing.length) ElMessage.warning(missing.join("；"))
  markDirty()
}
async function stopRunning(row) {
  const id = row && row.id
  if (!id) return
  try {
    await ElMessageBox.confirm("停掉这一本。后面排队的书会接着搭建。已经建好的商品编号会留着。", "停止搭建", {
      type: "warning",
      confirmButtonText: "停止这一本",
      cancelButtonText: "继续",
    })
  } catch {
    return
  }
  stopping.value = true
  try {
    const res = await request({ url: `/admin-api/oceanengine/launch/tasks/${id}/stop`, method: "POST" })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "停止失败")
      return
    }
    if (row) row.status = "stopped"
    if (liveTask.value && liveTask.value.id === id) liveTask.value = { ...liveTask.value, status: "stopped" }
    ElMessage.success(res.data && res.data.released ? "已停止这一本，后面排队的书会接着搭建" : "已停止这一本")
    pollTask(id)
  } finally {
    stopping.value = false
  }
}
async function openTask(row) {
  const res = await request({ url: `/admin-api/oceanengine/launch/tasks/${row.id}` })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "读取详情失败")
    return
  }
  detailTaskId.value = row.id
  detailFilter.value = res.data.failed ? "fail" : "all"
  detailItems.value = res.data.items || []
  detailTitle.value = taskHeading(res.data)
  detailVisible.value = true
  applyTask(res)
  if (["running", "preparing", "ready"].includes(res.data.status)) pollTask(row.id)
}
function onDetailSelect(rows) {
  detailSelected.value = rows.filter((row) => row.status === "fail")
}
async function retrySelected(allFail) {
  const ids = (allFail ? detailItems.value.filter((row) => row.status === "fail") : detailSelected.value)
    .map((row) => row.id)
    .filter(Boolean)
  if (!ids.length) {
    ElMessage.warning("请先勾选失败记录")
    return
  }
  retrying.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/launch/retry",
      method: "POST",
      data: { taskId: detailTaskId.value, itemIds: ids },
      timeout: 60000,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "重试失败")
      return
    }
    const retryStatus = res.data && res.data.status
    if (retryStatus === "ready") ElMessage.success(`商品已齐，上一本搭完就重试 ${ids.length} 条`)
    else if (retryStatus === "preparing" || retryStatus === "queued") ElMessage.success(`已开始补商品，齐了再重试 ${ids.length} 条`)
    else ElMessage.success(`已开始重试 ${ids.length} 条`)
    tab.value = "records"
    if (res.data && ["running", "preparing", "ready", "queued"].includes(res.data.status)) pollTask(res.data.id)
    else await loadTasks()
  } finally {
    retrying.value = false
  }
}
async function submitLaunch() {
  const jobs = liveJobs.value
  const fail = liveFail.value
  const extra = fail ? `其中 ${fail} 条会记失败，其余继续。` : "创建后会直接开启。"
  const current = productPlan.value
  const range = planRange(current)
  let productText = ""
  if (current.count && current.mode === "reuse" && current.reuseCount && !current.createCount) {
    productText = `商品直接复用已有编号（${range}）。`
  } else if (current.reuseCount && current.createCount) {
    productText = `复用 ${current.reuseCount} 个已有商品，并新建 ${current.createCount} 个。`
  } else if (current.count) {
    productText = `新建 ${current.count} 个商品（${range}）。`
  }
  const queueNote = liveActive.value ? "这一本会先建商品。搭计划等前面的书结束，商品齐了自动接上。" : ""
  try {
    await ElMessageBox.confirm(`将按勾选的 ${liveAccountCount.value} 个户创建 ${jobs} 条计划。${productText}带上 ${pickedVideoIds.value.length} 条线上视频。${extra}${queueNote}`, "确认搭建", {
      type: "warning",
      confirmButtonText: "开始创建",
      cancelButtonText: "取消",
    })
  } catch {
    return
  }
  submitting.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/launch/submit",
      method: "POST",
      data: payload(),
      timeout: 60000,
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "创建失败")
      return
    }
    tab.value = "records"
    const status = res.data && res.data.status
    if (status === "preparing") ElMessage.success(res.data.preparingProducts ? "已开始创建商品，搭计划会在前面结束后接上" : "已开始创建")
    else if (status === "ready") ElMessage.success("商品已齐，上一本搭完就自动开始")
    else if (status === "queued") ElMessage.success("已排队创建商品，前面的空出来就建")
    else if (status === "running") ElMessage.success("已开始搭建计划")
    else ElMessage.success("已开始创建")
    const activeId = res.data && ["running", "preparing", "ready", "queued"].includes(res.data.status) ? res.data.id : ""
    if (activeId) pollTask(activeId)
    else await loadTasks()
  } finally {
    submitting.value = false
  }
}

watch(tab, (value) => {
  if (value === "records") loadTasks()
})

onMounted(() => {
  loadOptions()
})
onBeforeUnmount(() => {
  stopPoll()
  clearTimeout(previewTimer)
  clearTimeout(bookSearchTimer)
})
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.ocean-launch.page-container {
  overflow: hidden;
  padding: 8px 8px 0;
}

.launch-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;

  :deep(.el-tabs__header) {
    flex-shrink: 0;
    margin: 0 8px;
  }

  :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
  }

  :deep(.el-tabs__item) {
    height: 40px;
    font-size: 14px;
  }

  :deep(.el-tabs__content) {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  :deep(.el-tab-pane) {
    height: 100%;
  }
}

.task-pane {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.task-split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
}

.setup-col,
.preview-col,
.task-body {
  min-height: 0;
  overflow: auto;
}

.setup-col {
  padding: 8px 10px 10px;
}

.preview-col {
  padding: 8px 8px 10px;
  border-left: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-blank);
}

.records-body {
  flex: 1;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 8px 0;
  overflow: hidden;
}

.records-body .page-filter-box {
  flex-shrink: 0;
  margin-bottom: 12px;
}

.records-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.records-table-wrap :deep(.el-table) {
  flex: 1;
  min-height: 0;
}

.records-body .page-pagination-box {
  flex-shrink: 0;
  margin-top: auto;
  padding: 12px 0 8px;
}

.step {
  margin-bottom: 12px;
  padding: 16px 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
}

.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.step-head em {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
}

.step-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

.step-head .muted {
  margin-left: auto;
}

.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.block-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

.hint {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.pick-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 999px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 13px;
  cursor: pointer;
}

.chip.on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.full-select {
  width: 100%;
}

.tier-grid,
.library-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.tier-card,
.library-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
  text-align: left;
  cursor: pointer;
}

.tier-card strong,
.library-card strong {
  font-size: 15px;
  font-weight: 700;
}

.tier-card em,
.tier-card span,
.library-card em,
.library-card span {
  font-style: normal;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.tier-card.on,
.library-card.on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 3px var(--el-color-primary-light-8);
}

.tier-card:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  box-shadow: none;
}

.library-card.used em {
  color: var(--el-color-warning-dark-2);
}

.library-card.preferred strong {
  color: var(--el-color-primary);
}

.product-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}

.mode-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
  text-align: left;
  cursor: pointer;
}

.mode-card strong {
  font-size: 14px;
  font-weight: 650;
}

.mode-card span {
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}

.mode-card.on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 3px var(--el-color-primary-light-8);
}

.mode-card.on strong {
  color: var(--el-color-primary);
}

.head-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.head-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.video-grid figure {
  position: relative;
  margin: 0;
  border: 2px solid transparent;
  border-radius: 12px;
  overflow: hidden;
  background: var(--el-fill-color-blank);
  cursor: pointer;
}

.video-grid figure.on {
  border-color: var(--el-color-primary);
}

.video-grid figure.off {
  opacity: 0.45;
}

.video-grid figure.off img,
.video-grid figure.off .video-fallback {
  filter: grayscale(1);
}

.video-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.25);
}

.video-check.on {
  border-color: #fff;
  background: var(--el-color-primary);
}

.video-check.on::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 9px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.video-grid img,
.video-fallback {
  width: 100%;
  height: 148px;
  object-fit: cover;
  background: var(--el-fill-color);
}

.video-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.video-grid figcaption {
  padding: 7px 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-pills {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.pill {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.pill.ok {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

.pill.warn {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
}

.pill.bad {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.preview-card {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: var(--el-bg-color);
}

.confirm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.confirm-grid .fact {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 12px;
  background: var(--el-fill-color-lighter);
}

.confirm-grid .fact.wide {
  grid-column: 1 / -1;
}

.confirm-grid label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.confirm-grid strong,
.confirm-grid span {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}

.title-hover {
  cursor: help;
  border-bottom: 1px dashed var(--el-text-color-secondary);
}

.preview-videos {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.preview-videos img {
  width: 42px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
}

.tier-panel {
  margin-top: 10px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: var(--el-fill-color-blank);
}

.tier-panel.warn {
  border-color: var(--el-color-warning-light-5);
}

.tier-panel.block {
  border-color: var(--el-color-danger-light-5);
}

.tier-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.tier-id {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.tier-id strong {
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.tier-id span,
.tier-counts span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.tier-counts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.tier-counts em {
  font-style: normal;
  font-size: 13px;
  font-weight: 650;
  color: var(--el-color-primary);
}

.tier-facts {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 8px 16px;
  margin-bottom: 10px;
}

.tier-facts div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tier-facts label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.tier-facts span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.tier-msg {
  margin: 0 0 10px;
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
}

.tier-panel.block .tier-msg {
  color: var(--el-color-danger);
}

.account-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.account-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  height: 32px;
  padding: 0 6px 0 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.account-chip img,
.account-chip i {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

.account-chip i {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
  font-style: normal;
  font-size: 11px;
}

.account-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-chip.on {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.account-chip.miss {
  border-style: dashed;
}

.account-chip b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.account-chip b:hover {
  background: var(--el-fill-color);
  color: var(--el-color-danger);
}

.add-chip {
  height: 32px;
  padding: 0 12px;
  border: 1px dashed var(--el-color-primary-light-5);
  border-radius: 999px;
  background: transparent;
  color: var(--el-color-primary);
  font-size: 12px;
  cursor: pointer;
}

.add-tier {
  margin-bottom: 16px;
}

.add-tier header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
}

.drawer-search {
  margin-bottom: 16px;
}

.block-line {
  margin: 8px 0 0;
  color: var(--el-color-danger);
  font-size: 13px;
}

.block-note {
  margin: 0 0 8px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.task-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}

.foot-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.foot-copy strong {
  font-size: 14px;
}

.foot-copy span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.foot-actions {
  display: flex;
  gap: 8px;
}

.live-banner {
  margin-bottom: 12px;
  padding: 12px 14px;
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: 10px;
  background: var(--el-color-primary-light-9);
}

.live-copy {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 13px;
}

.records-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.product-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  line-height: 1.4;
}

.product-cell strong {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.product-cell span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--el-color-danger);
  vertical-align: middle;
}

.fail-summary {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: 13px;
  line-height: 1.5;
}

.detail-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.pick-row :deep(.el-button + .el-button),
.foot-actions :deep(.el-button + .el-button),
.detail-toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 1100px) {
  .task-split {
    grid-template-columns: 1fr;
  }

  .preview-col {
    border-left: 0;
    border-top: 1px solid var(--el-border-color-lighter);
    padding-left: 16px;
  }

  .tier-grid,
  .library-grid,
  .confirm-grid,
  .tier-facts {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

<style lang="scss">
.title-tip {
  max-width: 360px;
  max-height: 280px;
  overflow: auto;
}

.title-tip p {
  margin: 0;
  line-height: 1.6;
  white-space: normal;
  word-break: break-all;
}

.el-popper.ocean-launch-select-popper {
  z-index: 4000 !important;
  max-width: none !important;
  word-break: normal !important;
  line-height: normal !important;
  background: var(--el-bg-color-overlay, #fff) !important;
  box-shadow: var(--el-box-shadow-light);

  .el-select-dropdown__item {
    display: flex;
    align-items: center;
    height: 34px;
    line-height: 34px;
    white-space: nowrap;
    word-break: normal;
    background: var(--el-bg-color-overlay, #fff);
  }

  .el-select-dropdown__item.is-hovering,
  .el-select-dropdown__item:hover {
    background: var(--el-fill-color, #f5f7fa) !important;
  }
}

.el-popper.ocean-book-select-popper {
  .book-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    min-width: 0;
  }

  .book-option span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .book-option em {
    flex: none;
    font-style: normal;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
}
</style>
