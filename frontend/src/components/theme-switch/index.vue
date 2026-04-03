<template>
  <div ref="rootRef" class="theme-switch" :class="{ 'is-open': open }">
    <button
      type="button"
      class="theme-trigger"
      :aria-expanded="open"
      aria-haspopup="menu"
      aria-label="外观与主题"
      @click.stop="toggle"
    >
      <ThemeGlyph :name="triggerGlyph" :size="19" />
    </button>

    <Transition name="theme-panel-fade">
      <div
        v-show="open"
        class="theme-panel"
        role="menu"
        aria-orientation="vertical"
        @click.stop
      >
        <button
          v-for="opt in options"
          :key="opt.command"
          type="button"
          class="theme-panel__item"
          :class="{ 'is-active': themeStore.appearance === opt.command }"
          role="menuitemradio"
          :aria-checked="themeStore.appearance === opt.command"
          @click="select(opt.command)"
        >
          <span class="theme-panel__icon" aria-hidden="true">
            <ThemeGlyph :name="opt.glyph" :size="17" />
          </span>
          <span class="theme-panel__label">{{ opt.label }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import ThemeGlyph from "./ThemeGlyph.vue"
import { useThemeStore } from "@/stores/theme"

const themeStore = useThemeStore()

const options = [
  { command: "auto", label: "自动", glyph: "monitor" },
  { command: "light", label: "浅色", glyph: "sun" },
  { command: "dark", label: "深色", glyph: "moon" },
]

const open = ref(false)
const rootRef = ref(null)

const triggerGlyph = computed(() => {
  if (themeStore.appearance === "light") return "sun"
  if (themeStore.appearance === "dark") return "moon"
  return "monitor"
})

function toggle() {
  open.value = !open.value
}

function select(cmd) {
  themeStore.setAppearance(cmd)
  open.value = false
}

function onDocClick(e) {
  if (!open.value) return
  const el = rootRef.value
  if (el && !el.contains(e.target)) open.value = false
}

function onKeydown(e) {
  if (e.key === "Escape") open.value = false
}

onMounted(() => {
  document.addEventListener("click", onDocClick, true)
  document.addEventListener("keydown", onKeydown)
})

onUnmounted(() => {
  document.removeEventListener("click", onDocClick, true)
  document.removeEventListener("keydown", onKeydown)
})
</script>

<style scoped lang="scss">
.theme-switch {
  position: relative;
  display: inline-flex;
  z-index: 1;
}

.theme-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--theme-trigger-color, var(--app-muted, #8c8c8c));
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    transform 0.15s ease;

  &:hover {
    background: var(--theme-trigger-hover-bg, rgba(0, 0, 0, 0.05));
    color: var(--theme-trigger-hover-color, var(--el-color-primary));
  }

  .is-open & {
    background: var(--theme-trigger-hover-bg, rgba(0, 0, 0, 0.05));
    color: var(--theme-trigger-hover-color, var(--el-color-primary));
  }
}

.theme-panel {
  position: absolute;
  top: calc(100% + 9px);
  right: 0;
  min-width: 188px;
  padding: 5px;
  box-sizing: border-box;
  background: var(--theme-panel-bg);
  border: 1px solid var(--theme-panel-border);
  border-radius: var(--theme-panel-radius, 12px);
  box-shadow: var(--theme-panel-shadow);
  z-index: 2100;
}

.theme-panel__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 9px 12px;
  border: none;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--theme-panel-item-muted);
  text-align: left;
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: var(--theme-panel-item-hover-bg);
    color: var(--theme-panel-item-color);
  }

  /* 选中：仅字色/图标色加深，无背景；悬浮再铺底 */
  &.is-active {
    background: transparent;
    color: var(--theme-panel-item-active-color);

    .theme-panel__icon {
      color: var(--theme-panel-item-active-color);
    }

    &:hover {
      background: var(--theme-panel-item-hover-bg);
    }
  }
}

.theme-panel__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: currentColor;
  opacity: 0.95;
}

.theme-panel__label {
  flex: 1;
  line-height: 1.35;
}

.theme-panel-fade-enter-active,
.theme-panel-fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}

.theme-panel-fade-enter-from,
.theme-panel-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
</style>
