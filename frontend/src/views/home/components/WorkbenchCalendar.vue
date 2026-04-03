<template>
  <div
    class="wb-cal"
    :class="{ 'wb-cal--compact': compact && !embed, 'wb-cal--embed': embed }"
    aria-label="月历"
  >
    <div class="wb-cal__head">
      <div class="wb-cal__nav">
        <button type="button" class="wb-cal__nav-btn" aria-label="上一月" @click="prevMonth">
          <el-icon><ArrowLeft /></el-icon>
        </button>
        <span class="wb-cal__title">{{ yearMonth }}</span>
        <button type="button" class="wb-cal__nav-btn" aria-label="下一月" @click="nextMonth">
          <el-icon><ArrowRight /></el-icon>
        </button>
      </div>
      <div class="wb-cal__head-actions">
        <button v-if="!isViewingCurrentMonth" type="button" class="wb-cal__today" @click="goToday">今天</button>
        <span class="wb-cal__hint">{{ todayRealLabel }}</span>
      </div>
    </div>
    <div class="wb-cal__weekdays">
      <span v-for="w in weekLabels" :key="w">{{ w }}</span>
    </div>
    <div class="wb-cal__grid">
      <span v-for="n in leadingBlanks" :key="'b-' + n" class="wb-cal__day wb-cal__day--empty" />
      <button
        v-for="d in daysInMonth"
        :key="d"
        type="button"
        class="wb-cal__day"
        :class="{
          'wb-cal__day--today': isToday(d),
          'wb-cal__day--muted': isPastDay(d),
        }"
        :disabled="true"
      >
        <span class="wb-cal__num">{{ d }}</span>
        <span v-if="showDot(d)" class="wb-cal__dot" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { ArrowLeft, ArrowRight } from "@element-plus/icons-vue"
import { computed, ref } from "vue"

defineProps({
  compact: {
    type: Boolean,
    default: false,
  },
  /** 置于顶栏与问候并排：单层边框卡片、无重阴影 */
  embed: {
    type: Boolean,
    default: false,
  },
})

const realNow = new Date()
const todayReal = realNow.getDate()
const monthReal = realNow.getMonth()
const yearReal = realNow.getFullYear()

const viewYear = ref(yearReal)
const viewMonth = ref(monthReal)

const yearMonth = computed(() => `${viewYear.value}年${viewMonth.value + 1}月`)

const todayRealLabel = computed(() => {
  const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
  return weekDays[realNow.getDay()]
})

const isSameYearMonthAsReal = computed(
  () => viewYear.value === yearReal && viewMonth.value === monthReal,
)

const isViewingCurrentMonth = computed(
  () => viewYear.value === yearReal && viewMonth.value === monthReal,
)

const weekLabels = ["一", "二", "三", "四", "五", "六", "日"]

const firstWeekday = computed(() => {
  const w = new Date(viewYear.value, viewMonth.value, 1).getDay()
  return w === 0 ? 6 : w - 1
})

const daysInMonth = computed(() => new Date(viewYear.value, viewMonth.value + 1, 0).getDate())

const leadingBlanks = computed(() => firstWeekday.value)

function isToday(d) {
  return isSameYearMonthAsReal.value && d === todayReal
}

function isPastDay(d) {
  if (!isSameYearMonthAsReal.value) return false
  return d < todayReal && !isToday(d)
}

function showDot(d) {
  if (!isSameYearMonthAsReal.value) {
    return d % 4 === 1
  }
  if (d > todayReal) return false
  if (d === todayReal) return true
  return d % 3 === 1 || d % 5 === 0
}

function prevMonth() {
  if (viewMonth.value === 0) {
    viewMonth.value = 11
    viewYear.value -= 1
  } else {
    viewMonth.value -= 1
  }
}

function nextMonth() {
  if (viewMonth.value === 11) {
    viewMonth.value = 0
    viewYear.value += 1
  } else {
    viewMonth.value += 1
  }
}

function goToday() {
  viewYear.value = yearReal
  viewMonth.value = monthReal
}
</script>

<style scoped lang="scss">
.wb-cal {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 260px;
  padding: 18px 16px;
  border-radius: var(--wb-radius, 20px);
  background: var(--wb-card-bg, var(--el-bg-color-overlay));
  border: 1px solid var(--wb-card-border, var(--app-border));
  box-shadow: var(--wb-card-shadow, none);
}

.wb-cal__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.wb-cal__nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wb-cal__nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
  color: var(--app-text);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, color 0.2s;

  &:hover {
    border-color: var(--el-color-primary-light-5);
    color: var(--el-color-primary);
    background: var(--el-fill-color-lighter);
  }
}

.wb-cal__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text);
  letter-spacing: 0.02em;
  min-width: 7.5em;
  text-align: center;
}

.wb-cal__head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wb-cal__today {
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--app-border);
  background: var(--el-fill-color-blank);
  color: var(--app-muted);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background 0.2s;

  &:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
}

.wb-cal__hint {
  font-size:12px;
  color: var(--app-muted);
}

.wb-cal__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-bottom: 8px;
  text-align: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--app-muted);
}

.wb-cal__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px 4px;
  flex: 1;
  align-content: start;
}

.wb-cal__day {
  position: relative;
  aspect-ratio: 1;
  max-height: 36px;
  margin: 0 auto;
  width: 100%;
  max-width: 36px;
  border: none;
  background: transparent;
  cursor: default;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.wb-cal__day--empty {
  pointer-events: none;
}

.wb-cal__num {
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text);
  font-family: $font-family-number;
  line-height: 1;
}

.wb-cal__day--today .wb-cal__num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--wb-accent, var(--el-color-primary));
  color: #0a0a0a;
  font-weight: 700;
}

html.dark .wb-cal__day--today .wb-cal__num {
  background: var(--wb-accent, #d4ff37);
  color: #0a0a0a;
}

.wb-cal__day--muted:not(.wb-cal__day--today) .wb-cal__num {
  color: var(--app-muted);
}

.wb-cal__dot {
  position: absolute;
  bottom: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--el-color-primary);
  opacity: 0.85;
}

html.dark .wb-cal__dot {
  background: var(--wb-accent-secondary, #7acbfe);
}

.wb-cal--compact {
  min-height: 220px;
  padding: 16px 14px;

  .wb-cal__head {
    margin-bottom: 10px;
  }
}

.wb-cal--embed {
  min-height: 100%;
  height: 100%;
  width: 100%;
  max-width: none;
  padding: 14px clamp(14px, 1.5vw, 20px);
  box-shadow: var(--wb-card-shadow, none);
  flex: 1;
  display: flex;
  flex-direction: column;

  .wb-cal__head {
    margin-bottom: 10px;
    flex-shrink: 0;
  }

  .wb-cal__weekdays {
    flex-shrink: 0;
  }

  .wb-cal__grid {
    gap: 5px 4px;
    flex: 1;
    align-content: space-between;
    min-height: 200px;
  }

  .wb-cal__day {
    max-height: 36px;
    max-width: 38px;
  }

  .wb-cal__day--today .wb-cal__num {
    width: 28px;
    height: 28px;
  }
}

</style>
