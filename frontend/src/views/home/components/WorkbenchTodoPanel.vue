<template>
  <section class="wb-todo-panel" aria-label="待办与完成度">
    <div class="wb-todo-panel__head">
      <div>
        <h3 class="wb-todo-panel__title">待办与完成度</h3>
        <p class="wb-todo-panel__sub">待办在浏览器本地保存；完成比例由当前列表实时计算</p>
      </div>
      <span v-if="stats.total" class="wb-todo-panel__badge">{{ stats.done }}/{{ stats.total }}</span>
    </div>

    <div class="wb-todo-panel__body">
      <div class="wb-todo-panel__main">
        <div class="wb-todo-panel__add">
          <el-input
            v-model="draft"
            placeholder="添加一条待办，回车确认"
            clearable
            @keydown.enter.prevent="submit"
          />
          <el-button type="primary" @click="submit">添加</el-button>
        </div>
        <ul class="wb-todo-panel__list">
          <li v-for="row in todos" :key="row.id" class="wb-todo-panel__row" :class="{ 'is-done': row.done }">
            <el-checkbox v-model="row.done" />
            <span class="wb-todo-panel__text">{{ row.text }}</span>
            <button type="button" class="wb-todo-panel__del" aria-label="删除" @click="remove(row.id)">
              <el-icon><Close /></el-icon>
            </button>
          </li>
          <li v-if="!todos.length" class="wb-todo-panel__empty">暂无待办，试着加一条吧</li>
        </ul>
      </div>

      <aside class="wb-todo-panel__aside" aria-label="完成度">
        <div class="wb-todo-panel__ring" :style="{ '--pct': stats.rate }">
          <span class="wb-todo-panel__ring-val">{{ stats.rate }}%</span>
          <span class="wb-todo-panel__ring-lbl">待办完成</span>
        </div>
        <div class="wb-todo-panel__bars" aria-hidden="true">
          <div v-for="(h, i) in barPattern" :key="i" class="wb-todo-panel__bar" :style="{ height: h + '%' }" />
        </div>
        <p class="wb-todo-panel__foot">
          共 <strong>{{ stats.total }}</strong> 条，已完成 <strong>{{ stats.done }}</strong> 条
        </p>
      </aside>
    </div>
  </section>
</template>

<script setup>
import { Close } from "@element-plus/icons-vue"
import { computed, inject, ref } from "vue"

const ctx = inject("wbTodos")
if (!ctx) {
  throw new Error("WorkbenchTodoPanel requires provide wbTodos")
}

const { todos, add, remove, stats } = ctx

const draft = ref("")

const submit = () => {
  add(draft.value)
  draft.value = ""
}

const barPattern = computed(() => {
  const base = stats.value.rate
  const seed = base + 23
  return Array.from({ length: 12 }, (_, i) => {
    const v = ((seed + i * 11) % 55) + 18
    return Math.min(100, v)
  })
})
</script>

<style scoped lang="scss">
.wb-todo-panel {
  box-sizing: border-box;
  padding: 22px 24px;
  border-radius: var(--wb-radius, 20px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.wb-todo-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.wb-todo-panel__title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text);
}

.wb-todo-panel__sub {
  margin: 0;
  font-size: 12px;
  color: var(--app-muted);
  line-height: 1.45;
  max-width: 36rem;
}

.wb-todo-panel__badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  flex-shrink: 0;
}

html.dark .wb-todo-panel__badge {
  background: rgba(212, 255, 55, 0.15);
  color: var(--wb-accent, #d4ff37);
}

.wb-todo-panel__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 220px);
  gap: 24px 28px;
  align-items: start;
  flex: 1;
  min-height: 0;
}

@media (max-width: 720px) {
  .wb-todo-panel__body {
    grid-template-columns: 1fr;
  }

  .wb-todo-panel__aside {
    order: -1;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }
}

.wb-todo-panel__add {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;

  :deep(.el-input) {
    flex: 1;
  }
}

.wb-todo-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(42vh, 320px);
  overflow-y: auto;
}

.wb-todo-panel__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--el-fill-color-lighter);
  border: 1px solid transparent;
  transition: opacity 0.2s;

  &.is-done {
    opacity: 0.55;

    .wb-todo-panel__text {
      text-decoration: line-through;
    }
  }
}

html.dark .wb-todo-panel__row {
  background: rgba(255, 255, 255, 0.05);
}

.wb-todo-panel__text {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--app-text);
}

.wb-todo-panel__del {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--app-muted);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:hover {
    background: var(--el-fill-color-dark);
    color: var(--el-color-danger);
  }
}

.wb-todo-panel__empty {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--app-muted);
}

.wb-todo-panel__aside {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 8px 0 0;
}

.wb-todo-panel__ring {
  --pct: 0;
  width: 124px;
  height: 124px;
  border-radius: 50%;
  background: conic-gradient(
    var(--wb-accent, var(--el-color-primary)) calc(var(--pct) * 1%),
    var(--el-fill-color-light) 0
  );
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;

  &::before {
    content: "";
    position: absolute;
    inset: 11px;
    border-radius: 50%;
    background: var(--wb-card-bg, var(--el-bg-color-overlay));
  }
}

.wb-todo-panel__ring-val,
.wb-todo-panel__ring-lbl {
  position: relative;
  z-index: 1;
}

.wb-todo-panel__ring-val {
  font-size: 22px;
  font-weight: 700;
  font-family: $font-family-number;
  color: var(--app-text);
  line-height: 1.1;
}

.wb-todo-panel__ring-lbl {
  font-size: 11px;
  color: var(--app-muted);
  margin-top: 4px;
}

.wb-todo-panel__bars {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  width: 100%;
  max-width: 200px;
  height: 44px;
  padding: 6px 4px;
  border-radius: 12px;
  background: var(--el-fill-color-lighter);
}

.wb-todo-panel__bar {
  flex: 1;
  min-width: 4px;
  border-radius: 4px 4px 2px 2px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--wb-accent, var(--el-color-primary)) 80%, #000),
    var(--wb-accent, var(--el-color-primary))
  );
  opacity: 0.75;
}

.wb-todo-panel__foot {
  margin: 0;
  font-size: 12px;
  color: var(--app-muted);
  text-align: center;
  line-height: 1.5;

  strong {
    color: var(--app-text);
    font-weight: 600;
  }
}
</style>
