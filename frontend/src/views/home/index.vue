<template>
  <div class="workbench">
    <!-- 首行三栏等高：经营 KPI｜爆量趋势｜日历 -->
    <section class="workbench__top" aria-label="概览与日程">
      <div class="workbench__top-cell workbench__top-cell--kpi">
        <WorkbenchTopKpi :user-name="userName" />
      </div>
      <div class="workbench__top-cell workbench__top-cell--trend">
        <WorkbenchVolumeTrend />
      </div>
      <div class="workbench__top-cell workbench__top-cell--cal">
        <div class="workbench__cal-wrap">
          <WorkbenchCalendar embed />
        </div>
      </div>
    </section>

    <!-- 中部：待办与小工具 / 快捷入口，两栏顶对齐、拉伸同高 -->
    <div class="workbench__grid">
      <div class="workbench__col workbench__col--main">
        <WorkbenchTodoPanel class="workbench__card workbench__fill" />
      </div>

      <aside class="workbench__col workbench__col--side" aria-label="小工具与快捷入口">
        <WorkbenchToolkit class="workbench__card" />
        <QuickEntry class="workbench__card" compact />
      </aside>
    </div>

    <!-- 底栏：通知｜图表 -->
    <div class="workbench__bottom">
      <WorkbenchNotifications class="workbench__card workbench__fill" />
      <WorkbenchTrendChart class="workbench__card workbench__fill" />
    </div>
    <!-- 底部留白：放在工作台 flex 列末尾，不依赖布局 meta / 外层 padding，避免与其它页耦合 -->
    <div class="workbench__end-spacer" aria-hidden="true" />
  </div>
</template>

<script setup>
import { computed, provide } from "vue"
import { useAuthStore } from "@/stores/auth"
import { useWorkbenchTodos } from "./useWorkbenchTodos"
import WorkbenchCalendar from "./components/WorkbenchCalendar.vue"
import WorkbenchNotifications from "./components/WorkbenchNotifications.vue"
import WorkbenchTodoPanel from "./components/WorkbenchTodoPanel.vue"
import WorkbenchToolkit from "./components/WorkbenchToolkit.vue"
import WorkbenchTopKpi from "./components/WorkbenchTopKpi.vue"
import WorkbenchTrendChart from "./components/WorkbenchTrendChart.vue"
import WorkbenchVolumeTrend from "./components/WorkbenchVolumeTrend.vue"
import QuickEntry from "./components/QuickEntry.vue"

const authStore = useAuthStore()

const userId = computed(() => authStore.user?.id ?? "guest")
const wbTodos = useWorkbenchTodos(userId)
provide("wbTodos", wbTodos)

const userName = computed(() => authStore.user?.nickname || "用户")
</script>

<style scoped lang="scss">
.workbench {
  --wb-radius: 22px;
  --wb-top-row-h: minmax(268px, min(36vh, 380px));
  --wb-section-gap: clamp(16px, 1.5vw, 24px);
  /* 与首行共用三列，竖向分割线（趋势|日历、待办|侧栏）才能对齐 */
  --wb-cols: minmax(280px, 1.25fr) minmax(260px, 1.15fr) minmax(268px, min(26vw, 500px));
  --wb-col-gap: clamp(12px, 1.5vw, 20px);
  --wb-card-bg: var(--el-bg-color-overlay);
  --wb-card-border: var(--app-border);
  --wb-card-shadow: 0 24px 56px -32px rgba(15, 23, 42, 0.18);
  --wb-accent: var(--el-color-primary);
  --wb-accent-secondary: #7acbfe;
  box-sizing: border-box;
  width: 100%;
  max-width: none;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--wb-section-gap);
  padding: 0;
}

/* 独立占位块（非 margin/padding）：紧挨底栏卡片下方，高度肉眼可见 */
/* 与 layout 里 .content-wrapper--wide 左右 padding 同节奏，底边与两侧边距视觉一致 */
.workbench__end-spacer {
  flex-shrink: 0;
  flex-grow: 0;
  width: 100%;
  height: clamp(12px, 1vw, 12px);
  min-height: clamp(12px, 1vw, 12px);
}

html.dark .workbench {
  --wb-card-shadow: 0 28px 64px -36px rgba(0, 0, 0, 0.72);
  --wb-accent: #d4ff37;
}

/* 左 KPI | 爆量趋势折线 | 日历（整体靠右两格在宽屏上与左栏并排） */
.workbench__top {
  display: grid;
  grid-template-columns: var(--wb-cols);
  grid-template-rows: var(--wb-top-row-h);
  gap: var(--wb-col-gap);
  align-items: stretch;
  padding-bottom: clamp(10px, 1.2vw, 18px);
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 55%, transparent);
}

.workbench__top-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.workbench__top-cell--trend :deep(.vol-trend),
.workbench__top-cell--kpi :deep(.top-kpi),
.workbench__cal-wrap {
  flex: 1;
  min-height: 0;
}

.workbench__cal-wrap {
  display: flex;
  justify-content: stretch;
  align-items: stretch;
}

.workbench__grid {
  display: grid;
  grid-template-columns: var(--wb-cols);
  gap: var(--wb-col-gap);
  align-items: stretch;
}

.workbench__col {
  display: flex;
  flex-direction: column;
  gap: clamp(12px, 1.4vw, 18px);
  min-width: 0;
}

.workbench__card {
  min-width: 0;
}

.workbench__fill {
  flex: 1;
  min-height: 0;
}

.workbench__col--main {
  grid-column: 1 / span 2;
  min-height: 0;
}

.workbench__col--side {
  grid-column: 3;
}

/* 右侧小工具 + 快捷入口与左侧待办同高，底部留白由快捷入口卡片吃满 */
.workbench__col--side > :last-child {
  flex: 1;
  min-height: 0;
}

.workbench__bottom {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--wb-col-gap);
  align-items: stretch;
  min-width: 0;
}

@media (max-width: 1180px) {
  .workbench__top {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: var(--wb-top-row-h) var(--wb-top-row-h);
  }

  .workbench__top-cell--kpi {
    grid-column: 1;
    grid-row: 1;
  }

  .workbench__top-cell--trend {
    grid-column: 2;
    grid-row: 1;
  }

  .workbench__top-cell--cal {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  /* 首行改为 2+1 后，中间区不再沿用三列模板，避免窄屏第三轨过窄 */
  .workbench__grid {
    grid-template-columns: 1fr;
  }

  .workbench__col--main,
  .workbench__col--side {
    grid-column: auto;
  }
}

@media (max-width: 720px) {
  .workbench__top {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    grid-auto-rows: minmax(240px, auto);
  }

  .workbench__top-cell--kpi,
  .workbench__top-cell--trend,
  .workbench__top-cell--cal {
    grid-column: 1;
    grid-row: auto;
  }
}

@media (max-width: 1100px) {
  .workbench__bottom {
    grid-template-columns: 1fr;
  }
}
</style>
