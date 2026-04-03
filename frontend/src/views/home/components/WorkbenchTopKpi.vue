<template>
  <section class="top-kpi" aria-label="经营概览">
    <header class="top-kpi__head">
      <h1 class="top-kpi__hello">你好，{{ userName }}</h1>
      <p class="top-kpi__lead">今日经营速览 · 关键指标一览</p>
    </header>

    <div class="top-kpi__grid">
      <div v-for="row in kpis" :key="row.key" class="top-kpi__cell">
        <span class="top-kpi__label">{{ row.label }}</span>
        <span class="top-kpi__value">{{ row.value }}</span>
        <span class="top-kpi__trend" :class="row.up ? 'is-up' : 'is-down'">{{ row.trend }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
defineProps({
  userName: {
    type: String,
    default: "用户",
  },
})

/** 电商 / 投放场景常见指标占位，便于后续接真接口 */
const kpis = [
  { key: "orders", label: "今日订单", value: "1,286", trend: "↑ 8.2%", up: true },
  { key: "pay", label: "支付金额(万)", value: "48.6", trend: "↑ 12.4%", up: true },
  { key: "exp", label: "曝光(万)", value: "92.3", trend: "↑ 3.1%", up: true },
  { key: "cvr", label: "转化率", value: "4.12%", trend: "↓ 0.3%", up: false },
]
</script>

<style scoped lang="scss">
.top-kpi {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  padding: clamp(16px, 1.6vw, 22px) clamp(16px, 1.8vw, 24px);
  border-radius: var(--wb-radius, 22px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.top-kpi__head {
  margin-bottom: 14px;
  flex-shrink: 0;
}

.top-kpi__hello {
  margin: 0 0 6px;
  font-size: clamp(20px, 2.2vw, 26px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--app-text);
}

.top-kpi__lead {
  margin: 0;
  font-size: 13px;
  color: var(--app-muted);
  line-height: 1.5;
}

.top-kpi__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
  flex: 1;
  align-content: start;
  min-height: 0;
}

.top-kpi__cell {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--el-fill-color-lighter);
  border: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

html.dark .top-kpi__cell {
  background: rgba(255, 255, 255, 0.05);
}

.top-kpi__label {
  font-size: 11px;
  font-weight: 500;
  color: var(--app-muted);
  letter-spacing: 0.02em;
}

.top-kpi__value {
  font-size: clamp(17px, 1.85vw, 20px);
  font-weight: 700;
  font-family: $font-family-number;
  color: var(--app-text);
  line-height: 1.2;
}

.top-kpi__trend {
  font-size: 11px;
  font-weight: 600;
  font-family: $font-family-number;

  &.is-up {
    color: var(--el-color-success);
  }

  &.is-down {
    color: var(--el-color-warning);
  }
}
</style>
