<template>
  <div class="vol-trend" role="img" aria-label="爆量趋势折线图">
    <div class="vol-trend__head">
      <span class="vol-trend__title">爆量趋势</span>
      <span class="vol-trend__hint">近端流量示意 · 可接 GMV/曝光时序</span>
    </div>
    <div class="vol-trend__svg-wrap">
      <svg
        class="vol-trend__svg"
        :viewBox="`0 0 ${VB.w} ${VB.h}`"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--wb-accent, var(--el-color-primary))" stop-opacity="0.26" />
            <stop offset="100%" stop-color="var(--wb-accent, var(--el-color-primary))" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line
          v-for="i in 3"
          :key="'g' + i"
          class="vol-trend__grid"
          :x1="VB.pad"
          :y1="gridY(i)"
          :x2="VB.w - VB.pad"
          :y2="gridY(i)"
        />
        <polygon v-if="areaPts" :points="areaPts" :fill="`url(#${gradId})`" />
        <polyline
          v-if="linePts"
          class="vol-trend__line"
          :points="linePts"
          fill="none"
          stroke="var(--wb-accent, var(--el-color-primary))"
          stroke-width="2.35"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  </div>
</template>

<script setup>
import { computed, useId } from "vue"

const gradId = `vol-${useId().replace(/[^a-zA-Z0-9_-]/g, "x")}`

const VB = Object.freeze({ w: 400, h: 136, pad: 8 })
const POINTS = 12

/** 与当前时间弱关联的演示曲线，呈波动上行感，便于后续换真实序列 */
const series = computed(() => {
  const d = new Date()
  const seed = d.getDate() * 11 + d.getHours() * 5
  let v = 32 + (seed % 22)
  return Array.from({ length: POINTS }, (_, i) => {
    const bump = ((seed + i * 19) % 23) - 7
    v += bump * 0.85
    v = Math.max(18, Math.min(96, v))
    return Math.round(v)
  })
})

const innerW = VB.w - VB.pad * 2
const innerH = VB.h - VB.pad * 2

function gridY(i) {
  return VB.pad + (innerH / 4) * i
}

const linePts = computed(() => {
  const vals = series.value
  const n = vals.length
  if (n < 2) return ""
  return vals
    .map((v, i) => {
      const x = VB.pad + (i / (n - 1)) * innerW
      const y = VB.pad + innerH - (v / 100) * innerH
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
})

const areaPts = computed(() => {
  const vals = series.value
  const n = vals.length
  if (n < 2) return ""
  const bottom = VB.pad + innerH
  const top = vals
    .map((v, i) => {
      const x = VB.pad + (i / (n - 1)) * innerW
      const y = VB.pad + innerH - (v / 100) * innerH
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
  return `${VB.pad},${bottom} ${top} ${VB.pad + innerW},${bottom}`
})
</script>

<style scoped lang="scss">
.vol-trend {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  padding: 14px 16px 12px;
  border-radius: var(--wb-radius, 22px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.vol-trend__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 12px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.vol-trend__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text);
  letter-spacing: 0.02em;
}

.vol-trend__hint {
  font-size: 11px;
  color: var(--app-muted);
}

.vol-trend__svg-wrap {
  flex: 1;
  min-height: 100px;
  display: flex;
  align-items: stretch;
}

.vol-trend__svg {
  width: 100%;
  height: 100%;
  display: block;
}

.vol-trend__grid {
  stroke: currentColor;
  stroke-opacity: 0.07;
  stroke-width: 1;
}

.vol-trend__line {
  filter: drop-shadow(0 1px 3px color-mix(in srgb, var(--el-color-primary) 30%, transparent));
}
</style>
