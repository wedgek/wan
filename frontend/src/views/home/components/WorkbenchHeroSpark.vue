<template>
  <div class="hero-spark" role="img" aria-label="完成进度折线示意">
    <div class="hero-spark__head">
      <span class="hero-spark__title">完成节奏</span>
      <span class="hero-spark__hint">近端示意 · 与待办完成率相关</span>
    </div>
    <div class="hero-spark__svg-wrap">
      <svg
        class="hero-spark__svg"
        :viewBox="`0 0 ${VB.w} ${VB.h}`"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--wb-accent, var(--el-color-primary))" stop-opacity="0.24" />
            <stop offset="100%" stop-color="var(--wb-accent, var(--el-color-primary))" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line
          v-for="i in 3"
          :key="'g' + i"
          class="hero-spark__grid"
          :x1="VB.pad"
          :y1="gridY(i)"
          :x2="VB.w - VB.pad"
          :y2="gridY(i)"
        />
        <polygon v-if="areaPts" :points="areaPts" :fill="`url(#${gradId})`" />
        <polyline
          v-if="linePts"
          class="hero-spark__line"
          :points="linePts"
          fill="none"
          stroke="var(--wb-accent, var(--el-color-primary))"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, useId } from "vue"

const gradId = `hsk-${useId().replace(/[^a-zA-Z0-9_-]/g, "x")}`

const ctx = inject("wbTodos")
if (!ctx) throw new Error("WorkbenchHeroSpark requires provide wbTodos")

const { stats } = ctx

const VB = Object.freeze({ w: 400, h: 132, pad: 8 })

const POINTS = 9

const series = computed(() => {
  const base = stats.value.rate
  const t = stats.value.total || 1
  const seed = base * 17 + t * 11
  return Array.from({ length: POINTS }, (_, i) => {
    const w = ((seed + i * 23) % 41) - 20
    let v = base + w * 0.22
    return Math.max(6, Math.min(100, Math.round(v)))
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
.hero-spark {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  padding: 14px 16px 12px;
  border-radius: var(--wb-radius, 20px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
  display: flex;
  flex-direction: column;
  min-width: 0;

  &__svg-wrap {
    flex: 1;
    min-height: 100px;
    display: flex;
    align-items: stretch;
  }

  &__svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  &__grid {
    stroke: currentColor;
    stroke-opacity: 0.07;
    stroke-width: 1;
  }

  &__line {
    filter: drop-shadow(0 1px 3px color-mix(in srgb, var(--el-color-primary) 28%, transparent));
  }
}

.hero-spark__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 12px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.hero-spark__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}

.hero-spark__hint {
  font-size: 11px;
  color: var(--app-muted);
}
</style>
