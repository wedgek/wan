<template>
  <div class="nav-menu-search">
    <button
      type="button"
      class="search-trigger"
      :aria-label="ariaOpenLabel"
      @click="open"
    >
      <el-icon class="search-trigger__icon"><Search /></el-icon>
      <span class="search-trigger__placeholder">搜索功能、菜单…</span>
      <kbd v-if="kbdHint" class="search-trigger__kbd">{{ kbdHint }}</kbd>
    </button>

    <el-dialog
      v-model="visible"
      width="520px"
      align-center
      append-to-body
      :destroy-on-close="false"
      :show-close="false"
      class="cz-nav-menu-search-dialog"
      @opened="onDialogOpened"
      @closed="onDialogClosed"
    >
      <div ref="panelRef" class="search-panel">
        <div class="palette-toolbar">
          <el-input
            ref="inputRef"
            v-model="query"
            placeholder="搜索菜单…"
            clearable
            size="large"
            :prefix-icon="Search"
            class="palette-input"
            @keydown="onQueryKeydown"
          />
          <button type="button" class="palette-icon-btn" aria-label="关闭" @click="closePalette">
            <el-icon :size="18"><Close /></el-icon>
          </button>
        </div>

        <el-scrollbar class="search-results" max-height="340">
          <div class="results-inner">
            <div v-if="filteredItems.length === 0" class="search-empty">
              {{ query.trim() ? "暂无匹配项" : "输入关键字筛选，Enter 打开选中项" }}
            </div>
            <button
              v-for="(item, idx) in filteredItems"
              :key="`${item.fullPath}-${item.id}`"
              type="button"
              class="search-item"
              :class="{ 'is-active': idx === activeIndex }"
              :data-search-index="idx"
              @click="go(item)"
              @mouseenter="activeIndex = idx"
            >
              <el-icon class="search-item__icon" :size="18">
                <component :is="resolveItemIcon(item)" />
              </el-icon>
              <span class="search-item__name">{{ item.name }}</span>
              <span class="search-item__enter" aria-hidden="true">↵</span>
            </button>
          </div>
        </el-scrollbar>

        <div class="palette-footer" aria-hidden="true">
          <div class="palette-hint">
            <kbd class="palette-kbd">Enter</kbd>
            <span class="palette-hint__label">确认</span>
          </div>
          <div class="palette-hint">
            <kbd class="palette-kbd">↑</kbd>
            <kbd class="palette-kbd">↓</kbd>
            <span class="palette-hint__label">切换</span>
          </div>
          <div class="palette-hint">
            <kbd class="palette-kbd">Esc</kbd>
            <span class="palette-hint__label">关闭</span>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import * as ElementPlusIconsVue from "@element-plus/icons-vue"
import { Close, Search } from "@element-plus/icons-vue"
import { iconfontIcons } from "@/plugins/iconfont"
import { useMenuStore } from "@/stores/menu"
import {
  flattenSidebarMenusForSearch,
  mergeNavSearchItems,
  filterNavSearchItems,
} from "@/utils/menuSearch"

const router = useRouter()
const route = useRoute()
const menuStore = useMenuStore()

const visible = ref(false)
/** 须在 el-dialog @closed 之后再 router.push，避免路由守卫与关闭动画并行时拆掉 Teleport，损坏 Dialog 实例 */
const pendingNavigatePath = ref(null)
const query = ref("")
const activeIndex = ref(0)
const inputRef = ref(null)
const panelRef = ref(null)

const allItems = computed(() =>
  mergeNavSearchItems(flattenSidebarMenusForSearch(menuStore.sidebarMenus)),
)

const filteredItems = computed(() => filterNavSearchItems(allItems.value, query.value))

function resolveItemIcon(item) {
  const key = item.icon
  if (key && typeof key !== "string") return key
  if (!key) return ElementPlusIconsVue.Menu
  return ElementPlusIconsVue[key] || iconfontIcons[key] || ElementPlusIconsVue.Menu
}

watch(
  () => filteredItems.value.length,
  () => {
    if (activeIndex.value >= filteredItems.value.length) {
      activeIndex.value = Math.max(0, filteredItems.value.length - 1)
    }
  },
)

watch(query, () => {
  activeIndex.value = 0
})

watch([activeIndex, filteredItems], () => {
  nextTick(() => {
    const root = panelRef.value
    if (!root || !filteredItems.value.length) return
    const el = root.querySelector(`[data-search-index="${activeIndex.value}"]`)
    el?.scrollIntoView({ block: "nearest" })
  })
})

// 任意路由变化：关掉面板，并清空「待跳转」（避免侧栏已导航后 @closed 再 push 覆盖）
watch(
  () => route.fullPath,
  () => {
    if (visible.value) visible.value = false
    pendingNavigatePath.value = null
  },
)

const isApple = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || "")

const kbdHint = computed(() => (isApple() ? "⌘ K" : "Ctrl K"))

const ariaOpenLabel = computed(() => `打开菜单搜索，快捷键 ${kbdHint.value}`)

const open = () => {
  pendingNavigatePath.value = null
  visible.value = true
}

const closePalette = () => {
  pendingNavigatePath.value = null
  visible.value = false
}

const onDialogOpened = () => {
  activeIndex.value = 0
  nextTick(() => {
    inputRef.value?.focus?.()
  })
}

const onDialogClosed = () => {
  query.value = ""
  activeIndex.value = 0
  const path = pendingNavigatePath.value
  pendingNavigatePath.value = null
  if (!path) return
  if (route.path === path || route.fullPath === path) return
  router.push(path)
}

const go = (item) => {
  if (!item?.fullPath) return
  const path = item.fullPath.startsWith("/") ? item.fullPath : `/${item.fullPath}`
  if (route.path === path || route.fullPath === path) {
    visible.value = false
    return
  }
  pendingNavigatePath.value = path
  visible.value = false
}

const onQueryKeydown = (e) => {
  const list = filteredItems.value
  if (e.key === "Escape") {
    e.preventDefault()
    closePalette()
    return
  }
  if (!list.length) return

  if (e.key === "ArrowDown") {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % list.length
  } else if (e.key === "ArrowUp") {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + list.length) % list.length
  } else if (e.key === "Enter") {
    e.preventDefault()
    const item = list[activeIndex.value]
    if (item) go(item)
  }
}

const onGlobalKey = (e) => {
  if (e.key !== "k" && e.key !== "K") return
  if (!(e.metaKey || e.ctrlKey)) return
  const t = e.target
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
    return
  }
  e.preventDefault()
  if (visible.value) {
    closePalette()
  } else {
    open()
  }
}

onMounted(() => {
  window.addEventListener("keydown", onGlobalKey)
})

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKey)
})
</script>

<style lang="scss" scoped>
.nav-menu-search {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 400px;
  min-width: 200px;
  pointer-events: auto;
}

.search-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  margin: 0;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  color: var(--app-muted);
  background: var(--app-bg-soft, var(--el-fill-color-light));
  border: 1px solid var(--app-border);
  font: inherit;
  text-align: left;
  appearance: none;
  -webkit-appearance: none;
  transition:
    border-color 0.2s,
    background 0.2s,
    color 0.2s;

  &:hover {
    border-color: rgba($primary-color, 0.35);
    color: var(--app-text);
  }

  &:focus-visible {
    outline: 2px solid rgba($primary-color, 0.45);
    outline-offset: 1px;
  }

  & > * {
    pointer-events: none;
  }
}

.search-trigger__icon {
  flex-shrink: 0;
  font-size: 16px;
}

.search-trigger__placeholder {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-trigger__kbd {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  font-family: inherit;
  color: var(--app-muted);
  background: var(--app-surface);
  border: 1px solid var(--app-border);
}

.search-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: -8px;
}

.palette-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.palette-input {
  flex: 1;
  min-width: 0;
}

.palette-icon-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--app-muted);
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;

  &:hover {
    background: var(--el-fill-color-light);
    color: var(--app-text);
  }
}

.search-results {
  margin: 0 -6px;
}

.results-inner {
  padding: 0 6px 4px;
}

.search-empty {
  padding: 32px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--app-muted);
  line-height: 1.5;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 0 0 6px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  background: var(--el-fill-color-blank);
  color: var(--app-text);
  border: 1px solid transparent;
  transition:
    background 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    color 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  &:last-child {
    margin-bottom: 0;
  }

  &:not(.is-active):hover {
    background: var(--el-fill-color-light);
  }

  &.is-active {
    background: $primary-color;
    color: #fff;
    border-color: rgba(255, 255, 255, 0.12);
    box-shadow: 0 4px 12px rgba($primary-color, 0.28);

    .search-item__icon {
      color: #fff;
    }

    .search-item__enter {
      color: rgba(255, 255, 255, 0.9);
    }
  }
}

.search-item__icon {
  flex-shrink: 0;
  color: var(--app-muted);
  transition: color 0.12s ease;
}

.search-item__name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-item__enter {
  flex-shrink: 0;
  font-size: 15px;
  line-height: 1;
  color: var(--app-muted);
  opacity: 0.65;
  font-family: ui-monospace, monospace;
}

.palette-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px 20px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--app-border);
}

.palette-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-muted);
}

.palette-hint__label {
  margin-left: 2px;
}

.palette-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5em;
  padding: 2px 7px;
  margin: 0;
  font-size: 11px;
  font-family: inherit;
  line-height: 1.35;
  color: var(--app-text);
  background: var(--el-fill-color-light);
  border: 1px solid var(--app-border);
  border-radius: 4px;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}
</style>

<style lang="scss">
.cz-nav-menu-search-dialog.el-dialog {
  padding: 0;
  border-radius: 14px;
  overflow: hidden;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.18),
    0 0 0 1px rgba(0, 0, 0, 0.04);
}

.cz-nav-menu-search-dialog .el-dialog__header {
  display: none;
}

.cz-nav-menu-search-dialog .el-dialog__body {
  position: relative;
  z-index: 1;
  padding: 20px 20px 16px;
}
</style>
