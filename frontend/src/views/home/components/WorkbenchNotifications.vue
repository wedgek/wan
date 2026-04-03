<template>
  <section class="wb-notify" aria-label="任务与通知">
    <div class="wb-notify__head">
      <div>
        <h3 class="wb-notify__title">任务与通知</h3>
        <p class="wb-notify__sub">站内提醒与待办动态（演示数据，可接审批流）</p>
      </div>
      <el-button v-if="unreadCount" text type="primary" size="small" @click="markAllRead">
        全部已读
      </el-button>
    </div>
    <ul class="wb-notify__list">
      <li
        v-for="item in items"
        :key="item.id"
        class="wb-notify__item"
        :class="{ 'is-read': readIds.includes(item.id) }"
        role="button"
        tabindex="0"
        @click="toggleRead(item.id)"
        @keydown.enter.prevent="toggleRead(item.id)"
      >
        <span class="wb-notify__dot" :class="`wb-notify__dot--${item.level}`" aria-hidden="true" />
        <div class="wb-notify__body">
          <span class="wb-notify__item-title">{{ item.title }}</span>
          <span class="wb-notify__item-desc">{{ item.desc }}</span>
        </div>
        <time class="wb-notify__time">{{ item.time }}</time>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { getStorage, setStorage } from "@/utils/storage"
import { useAuthStore } from "@/stores/auth"

const authStore = useAuthStore()

const items = [
  {
    id: "n1",
    level: "primary",
    title: "欢迎使用中台工作台",
    desc: "在这里集中处理待办、查看日程与快捷入口",
    time: "今天",
  },
  {
    id: "n2",
    level: "warning",
    title: "安全提示",
    desc: "定期在「个人中心」更新密码，保护账号安全",
    time: "本周",
  },
  {
    id: "n3",
    level: "info",
    title: "快捷操作",
    desc: "按 Ctrl+K（Mac ⌘K）打开全局菜单搜索，快速跳转",
    time: "提示",
  },
]

const readKey = computed(() => {
  const id = authStore.user?.id
  return `workbench-notify-read-${id === undefined || id === null ? "guest" : String(id)}`
})

const readIds = ref([])

const loadRead = () => {
  const raw = getStorage(readKey.value)
  readIds.value = Array.isArray(raw) ? raw : []
}

watch(readKey, loadRead, { immediate: true })

const persistRead = () => setStorage(readKey.value, readIds.value)

const unreadCount = computed(() => items.filter((i) => !readIds.value.includes(i.id)).length)

const toggleRead = (id) => {
  const set = new Set(readIds.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  readIds.value = [...set]
  persistRead()
}

const markAllRead = () => {
  readIds.value = items.map((i) => i.id)
  persistRead()
}
</script>

<style scoped lang="scss">
.wb-notify {
  box-sizing: border-box;
  padding: 22px 24px;
  border-radius: var(--wb-radius, 20px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
  min-height: 280px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.wb-notify__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.wb-notify__title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text);
}

.wb-notify__sub {
  margin: 0;
  font-size: 13px;
  color: var(--app-muted);
  line-height: 1.45;
}

.wb-notify__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.wb-notify__item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--el-fill-color-lighter);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;

  &:hover {
    border-color: var(--el-color-primary-light-5);
    background: var(--el-fill-color-light);
  }

  &.is-read {
    opacity: 0.72;

    .wb-notify__item-title {
      font-weight: 500;
    }
  }
}

html.dark .wb-notify__item {
  background: rgba(255, 255, 255, 0.05);
}

.wb-notify__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);

  &--warning {
    background: var(--el-color-warning);
  }

  &--info {
    background: var(--el-color-info);
  }

  &--primary {
    background: var(--el-color-primary);
  }
}

.wb-notify__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wb-notify__item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}

.wb-notify__item-desc {
  font-size: 12px;
  color: var(--app-muted);
  line-height: 1.45;
}

.wb-notify__time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--app-muted);
  margin-top: 2px;
}
</style>
