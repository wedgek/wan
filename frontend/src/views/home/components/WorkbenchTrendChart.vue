<template>
  <section class="wb-trend" aria-label="本周节奏">
    <div class="wb-trend__head">
      <div>
        <h3 class="wb-trend__title">本周节奏</h3>
        <p class="wb-trend__sub">结合当前待办完成度生成的示意趋势，便于扫一眼本周松紧；后续可替换为真实报表接口</p>
      </div>
      <span class="wb-trend__badge">{{ stats.rate }}% 完成</span>
    </div>

    <div class="wb-trend__body">
      <svg class="wb-trend__svg" viewBox="0 0 640 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="wbTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--wb-accent, var(--el-color-primary))" stop-opacity="0.22" />
            <stop offset="100%" stop-color="var(--wb-accent, var(--el-color-primary))" stop-opacity="0" />
          </linearGradient>
        </defs>
        <!-- 底格 -->
        <g v-for="i in 4" :key="'g-' + i" class="wb-trend__gridline">
          <line
            x1="48"
            :y1="40 + (i - 1) * 44"
            x2="608"
            :y2="40 + (i - 1) * 44"
            stroke="currentColor"
            stroke-opacity="0.08"
          />
        </g>
        <!-- 面积 -->
        <polygon v-if="areaPoints" class="wb-trend__area" :points="areaPoints" fill="url(#wbTrendFill)" />
        <!-- 柱 -->
        <g v-for="(b, i) in bars" :key="'b-' + i">
          <rect
            :x="b.x"
            :y="b.y"
            :width="b.w"
            :height="b.h"
            rx="5"
            class="wb-trend__bar"
            :style="{ opacity: b.opacity }"
          />
        </g>
        <!-- 折线 -->
        <polyline
          v-if="linePoints"
          class="wb-trend__line"
          :points="linePoints"
          fill="none"
          stroke="var(--wb-accent, var(--el-color-primary))"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <div class="wb-trend__labels">
        <span v-for="(lb, i) in labels" :key="i" class="wb-trend__lab">{{ lb }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, inject } from "vue"

const ctx = inject("wbTodos")
if (!ctx) throw new Error("WorkbenchTrendChart requires provide wbTodos")

const { stats } = ctx

const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

const series = computed(() => {
  const base = stats.value.rate
  const n = stats.value.total || 1
  const seed = base * 13 + n * 7
  return labels.map((_, i) => {
    const wobble = ((seed + i * 17) % 37) - 18
    let v = base + wobble * 0.35
    v = Math.max(12, Math.min(100, v))
    return Math.round(v)
  })
})

const chartW = 560
const chartH = 132
const padL = 48
const padR = 32
const padT = 36
const padB = 12

function barGeometry(vals) {
  const gap = 10
  const n = vals.length
  const w = (chartW - padL - padR - gap * Math.max(0, n - 1)) / Math.max(1, n)
  return { gap, n, w }
}

const bars = computed(() => {
  const vals = series.value
  const { gap, n, w } = barGeometry(vals)
  return vals.map((v, i) => {
    const h = (v / 100) * chartH
    const x = padL + i * (w + gap)
    const y = padT + chartH - h
    return { x, y, w, h, opacity: 0.35 + (v / 100) * 0.45 }
  })
})

const linePoints = computed(() => {
  const vals = series.value
  const { gap, w } = barGeometry(vals)
  return vals
    .map((v, i) => {
      const cx = padL + i * (w + gap) + w / 2
      const cy = padT + chartH - (v / 100) * chartH
      return `${cx},${cy}`
    })
    .join(" ")
})

const areaPoints = computed(() => {
  const vals = series.value
  if (!vals.length) return ""
  const { gap, n, w } = barGeometry(vals)
  const bottomY = padT + chartH
  const firstX = padL + w / 2
  const lastX = padL + Math.max(0, n - 1) * (w + gap) + w / 2
  const topPts = vals
    .map((v, i) => {
      const cx = padL + i * (w + gap) + w / 2
      const cy = padT + chartH - (v / 100) * chartH
      return `${cx},${cy}`
    })
    .join(" ")
  return `${firstX},${bottomY} ${topPts} ${lastX},${bottomY}`
})
</script>

<style scoped lang="scss">
.wb-trend {
  box-sizing: border-box;
  padding: 22px 24px 26px;
  border-radius: var(--wb-radius, 20px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
  min-height: 280px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.wb-trend__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.wb-trend__title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text);
}

.wb-trend__sub {
  margin: 0;
  font-size: 12px;
  color: var(--app-muted);
  line-height: 1.5;
  max-width: 42rem;
}

.wb-trend__badge {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

html.dark .wb-trend__badge {
  background: rgba(212, 255, 55, 0.15);
  color: var(--wb-accent, #d4ff37);
}

.wb-trend__body {
  margin-top: 12px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.wb-trend__svg {
  width: 100%;
  height: auto;
  display: block;
  color: var(--app-text);
}

.wb-trend__bar {
  fill: var(--wb-accent, var(--el-color-primary));
}

.wb-trend__line {
  filter: drop-shadow(0 2px 6px color-mix(in srgb, var(--el-color-primary) 35%, transparent));
}

.wb-trend__labels {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-top: 6px;
  padding: 0 12px 0 20px;
  text-align: center;
}

.wb-trend__lab {
  font-size: 11px;
  font-weight: 500;
  color: var(--app-muted);
}
</style>
