<template>
  <div class="quick-bento" :class="{ 'quick-bento--compact': compact }" v-loading="loading">
    <div class="quick-bento__head">
      <div>
        <h3 class="quick-bento__title">快捷入口</h3>
        <p class="quick-bento__sub">从有权访问的菜单中添加入口，列表保存在服务器。</p>
      </div>
      <el-button type="primary" plain size="small" :disabled="loading" @click="openAdd">添加入口</el-button>
    </div>

    <el-alert
      v-if="entriesHint"
      class="quick-bento__hint"
      type="warning"
      :closable="false"
      show-icon
    >
      {{ entriesHint }}
    </el-alert>

    <div class="quick-bento__list">
      <div v-for="(item, idx) in displayItems" :key="item.menuId" class="quick-item">
        <button type="button" class="quick-item__main" @click="go(item.path)">
          <div class="quick-row__icon" :style="{ background: item.bg, color: item.color }">
            <el-icon><component :is="iconCmp(item.icon)" /></el-icon>
          </div>
          <div class="quick-row__body">
            <span class="quick-row__name">{{ item.name }}</span>
            <span class="quick-row__meta">{{ item.path }}</span>
          </div>
          <el-icon class="quick-row__arrow"><ArrowRight /></el-icon>
        </button>
        <button type="button" class="quick-item__del" aria-label="移除" @click.stop="removeAt(idx)">
          <el-icon><Close /></el-icon>
        </button>
      </div>

      <div v-if="!displayItems.length && !loading" class="quick-empty">暂无快捷入口，点击右上角「添加入口」从菜单中选择</div>
    </div>

    <el-dialog v-model="dialogVisible" title="添加快捷入口" width="min(460px, 92vw)" destroy-on-close @closed="toAdd = null">
      <p class="quick-dialog__tip">仅展示类型为「菜单」且有路由的路径；已达上限（24 个）时需先移除部分入口。</p>
      <el-select
        v-model="toAdd"
        filterable
        placeholder="搜索或选择页面"
        style="width: 100%"
        :loading="loading"
      >
        <el-option v-for="m in pickableMenus" :key="m.id" :label="`${m.name}  ${m.path}`" :value="m.id">
          <div class="quick-opt">
            <span class="quick-opt__name">{{ m.name }}</span>
            <span class="quick-opt__path">{{ m.path }}</span>
          </div>
        </el-option>
      </el-select>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!toAdd || saving" :loading="saving" @click="confirmAdd">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ArrowRight, Close } from "@element-plus/icons-vue"
import { ElMessage } from "element-plus"
import { getWorkbenchQuickEntriesApi, saveWorkbenchQuickEntriesApi } from "@/api/system"
import { useAuthStore } from "@/stores/auth"
import { useMenuStore } from "@/stores/menu"
import { computed, onMounted, ref } from "vue"

defineProps({
  compact: {
    type: Boolean,
    default: false,
  },
})

const router = useRouter()
const menuStore = useMenuStore()
const authStore = useAuthStore()

const userId = computed(() => authStore.user?.id ?? "guest")

const ACCENTS = [
  { color: "#4078fc", bg: "rgba(64, 120, 252, 0.15)" },
  { color: "#722ed1", bg: "rgba(114, 46, 209, 0.14)" },
  { color: "#52c41a", bg: "rgba(82, 196, 26, 0.14)" },
  { color: "#fa8c16", bg: "rgba(250, 140, 22, 0.14)" },
  { color: "#13c2c2", bg: "rgba(19, 194, 194, 0.14)" },
  { color: "#eb2f96", bg: "rgba(235, 47, 150, 0.12)" },
]

const loading = ref(false)
const saving = ref(false)
const entries = ref([])
const dialogVisible = ref(false)
const toAdd = ref(null)
/** 同步状态说明：只在本卡片内展示，避免整页 ElMessage */
const entriesHint = ref("")

/** 与动态路由注册一致：目录拼接子路径 */
function flattenLeafMenus(nodes, parentPath = "") {
  const out = []
  if (!nodes?.length) return out
  for (const m of nodes) {
    if (!m.path || m.status !== 0 || m.visible !== true) continue
    const fullPath = (m.path.startsWith("/") ? m.path : `${parentPath}/${m.path}`)
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || "/"
    if (Number(m.type) === 2) {
      out.push({
        id: m.id,
        name: m.name,
        path: fullPath.startsWith("/") ? fullPath : `/${fullPath}`,
        icon: m.icon || "Menu",
      })
    }
    if (m.children?.length) {
      out.push(...flattenLeafMenus(m.children, fullPath))
    }
  }
  return out
}

const leafMenus = computed(() => flattenLeafMenus(menuStore.sidebarMenus))

function iconCmp(name) {
  const n = name && String(name).trim()
  return n || "Menu"
}

const displayItems = computed(() =>
  entries.value.map((e, i) => ({
    ...e,
    ...(ACCENTS[i % ACCENTS.length] || ACCENTS[0]),
  })),
)

const pickableMenus = computed(() => {
  const used = new Set(entries.value.map((e) => e.menuId))
  return leafMenus.value.filter((m) => !used.has(m.id))
})

function localStorageKey() {
  return `wb-quick-entries:${userId.value}`
}

function hintApiBaseShort() {
  const base = String(import.meta.env.VITE_API_BASE_URL || "").trim()
  if (!base) {
    return "请在项目根目录执行 npm run dev（会先起后端再起前端）。若 3000 被占用，后端会自动改用 3001 等端口并写入 backend/.dev-port，由 Vite 代理自动对齐。"
  }
  return `请确认 API「${base}」已部署快捷入口接口并已重启后端。`
}

/** 按菜单 id 顺序还原展示列表（与后端列表结构一致） */
function buildEntriesFromMenuIds(menuIds) {
  const byId = new Map(leafMenus.value.map((m) => [m.id, m]))
  const out = []
  for (const id of menuIds) {
    const m = byId.get(Number(id))
    if (m) {
      out.push({
        menuId: m.id,
        name: m.name,
        path: m.path,
        icon: m.icon || "Menu",
      })
    }
  }
  return out
}

function readLocalMenuIds() {
  try {
    const raw = localStorage.getItem(localStorageKey())
    if (!raw) return null
    const ids = JSON.parse(raw)
    return Array.isArray(ids) ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : null
  } catch {
    return null
  }
}

function writeLocalMenuIds(menuIds) {
  try {
    localStorage.setItem(localStorageKey(), JSON.stringify(menuIds))
  } catch (_) {
    /* 隐私模式等 */
  }
}

function applyOfflineFallback(_kind) {
  const ids = readLocalMenuIds()
  if (ids?.length) {
    entries.value = buildEntriesFromMenuIds(ids)
    entriesHint.value =
      "当前为「本机暂存的快捷入口」，与账号同步需后端可用后刷新本页。" + hintApiBaseShort()
    return true
  }
  return false
}

async function loadEntries() {
  loading.value = true
  try {
    const res = await getWorkbenchQuickEntriesApi()
    if (res?.code === 0) {
      entries.value = Array.isArray(res.data) ? res.data : []
      const ids = entries.value.map((e) => e.menuId)
      writeLocalMenuIds(ids)
      entriesHint.value = ""
      return
    }
    throw new Error(res?.msg || "加载失败")
  } catch (e) {
    const status = e?.response?.status
    const msg = e?.response?.data?.msg
    const net = e?.code === "ERR_NETWORK" || e?.message === "Network Error"

    console.warn("[QuickEntry] loadEntries failed", status || e?.code, e?.message)

    if (status === 404 || net) {
      if (!applyOfflineFallback(status === 404 ? "404" : "net")) {
        entries.value = []
        entriesHint.value =
          (status === 404 ? "快捷入口接口未连通（404）。" : "无法连接后端。") +
          hintApiBaseShort() +
          "在此之前，添加的入口将仅保存在本浏览器。"
      }
    } else if (status && status >= 500) {
      ElMessage.error(msg || `服务器错误 ${status}，请查看后端日志`)
      entries.value = []
      entriesHint.value = ""
    } else if (e?.message && typeof e.message === "string" && !e.response) {
      ElMessage.error(e.message)
      entries.value = []
      entriesHint.value = ""
    } else {
      ElMessage.error(msg || e?.message || "快捷入口加载失败")
      entries.value = []
      entriesHint.value = ""
    }
  } finally {
    loading.value = false
  }
}

/**
 * @returns {Promise<{ mode: 'remote' }|{ mode: 'local' }|void>} remote 成功；local 为仅本机保存；失败则 throw
 */
async function persist(menuIds) {
  saving.value = true
  try {
    const res = await saveWorkbenchQuickEntriesApi(menuIds)
    if (res?.code !== 0) throw new Error(res?.msg || "保存失败")
    writeLocalMenuIds(menuIds)
    await loadEntries()
    return { mode: "remote" }
  } catch (e) {
    const status = e?.response?.status
    const net = e?.code === "ERR_NETWORK" || e?.message === "Network Error"
    if (status === 404 || net) {
      writeLocalMenuIds(menuIds)
      entries.value = buildEntriesFromMenuIds(menuIds)
      entriesHint.value =
        `未能写入服务器（${status === 404 ? "404" : "网络异常"}），已保存到本浏览器。` +
        hintApiBaseShort()
      return { mode: "local" }
    }
    const msg =
      e?.response?.data?.msg ||
      (typeof e?.response?.data === "string" ? e.response.data.slice(0, 120) : null) ||
      e?.message ||
      "保存失败"
    console.error("[QuickEntry] persist failed", e)
    ElMessage.error(msg)
    throw e
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadEntries()
})

function openAdd() {
  if (entries.value.length >= 24) {
    ElMessage.warning("已达 24 个上限，请先移除部分入口")
    return
  }
  if (!pickableMenus.value.length) {
    ElMessage.info("没有可添加的菜单，或已全部加入快捷入口")
    return
  }
  toAdd.value = null
  dialogVisible.value = true
}

async function confirmAdd() {
  if (!toAdd.value) return
  const ids = [...entries.value.map((e) => e.menuId), toAdd.value]
  try {
    const r = await persist(ids)
    dialogVisible.value = false
    toAdd.value = null
    ElMessage.success(r?.mode === "local" ? "已添加到本机，后端可用后将自动同步" : "已添加")
  } catch {
    /* persist 已提示 */
  }
}

async function removeAt(index) {
  const ids = entries.value.map((e) => e.menuId)
  ids.splice(index, 1)
  try {
    const r = await persist(ids)
    ElMessage.success(r?.mode === "local" ? "已更新本机列表" : "已移除")
  } catch {
    /* persist 已提示 */
  }
}

const go = (path) => {
  if (path) router.push(path)
}
</script>

<style scoped lang="scss">
.quick-bento {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 240px;
  padding: 22px 24px;
  border-radius: var(--wb-radius, 20px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
}

.quick-bento__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 18px;
}

.quick-bento__title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text);
}

.quick-bento__sub {
  margin: 0;
  font-size: 12px;
  color: var(--app-muted);
  line-height: 1.55;
  max-width: 42rem;
}

.quick-bento__hint {
  margin: -6px 0 14px;

  :deep(.el-alert__description) {
    margin: 0;
  }

  :deep(.el-alert__content) {
    font-size: 12px;
    line-height: 1.55;
  }
}

.quick-kbd {
  display: inline-block;
  padding: 1px 6px;
  margin: 0 2px;
  font-size: 11px;
  font-family: inherit;
  border-radius: 5px;
  border: 1px solid var(--app-border);
  background: var(--el-fill-color-light);
  vertical-align: baseline;
}

.quick-kbd-plus {
  margin: 0 2px;
  font-size: 11px;
  color: var(--app-muted);
}

.quick-bento__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.quick-item {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.quick-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--app-border);
  background: var(--el-fill-color-lighter);
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    border-color: var(--el-color-primary-light-5);
    box-shadow: 0 10px 24px -18px rgba(0, 0, 0, 0.35);
  }
}

html.dark .quick-item__main {
  background: rgba(255, 255, 255, 0.05);
}

.quick-item__del {
  flex-shrink: 0;
  width: 44px;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--el-fill-color-blank);
  color: var(--app-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s, border-color 0.2s, background 0.2s;

  &:hover {
    color: var(--el-color-danger);
    border-color: var(--el-color-danger-light-5);
    background: var(--el-color-danger-light-9);
  }
}

.quick-row__icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  font-size: 22px;
}

.quick-row__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quick-row__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}

.quick-row__meta {
  font-size: 12px;
  color: var(--app-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-row__arrow {
  flex-shrink: 0;
  font-size: 18px;
  color: var(--app-muted);
  transition: transform 0.2s ease, color 0.2s ease;
}

.quick-item__main:hover .quick-row__arrow {
  transform: translateX(4px);
  color: var(--el-color-primary);
}

.quick-empty {
  padding: 28px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--app-muted);
  border-radius: 16px;
  border: 1px dashed var(--app-border);
  background: transparent;
}

.quick-dialog__tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--app-muted);
  line-height: 1.5;
}

.quick-opt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.3;
}

.quick-opt__name {
  font-size: 14px;
  color: var(--app-text);
}

.quick-opt__path {
  font-size: 12px;
  color: var(--app-muted);
}

.quick-bento--compact {
  min-height: 0;
  padding: 18px 20px;

  .quick-bento__head {
    margin-bottom: 14px;
  }

  .quick-item__main {
    padding: 12px 14px;
  }

  .quick-row__icon {
    width: 40px;
    height: 40px;
    font-size: 20px;
  }

  .quick-item__del {
    width: 40px;
  }
}
</style>
