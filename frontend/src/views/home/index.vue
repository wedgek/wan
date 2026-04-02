<template>
  <div class="home-page">
    <div class="header-section">
      <div class="welcome-card">
        <div class="welcome-main">
          <h2 class="welcome-title">欢迎回来，{{ userName }}</h2>
          <p class="welcome-desc">{{ greetingText }}</p>
        </div>
        <div class="welcome-meta">
          <span class="meta-date">{{ currentDate }}</span>
          <span class="meta-time">{{ currentTime }}</span>
        </div>
      </div>
    </div>

    <div class="main-content">
      <QuickEntry class="main-quick" />
      <RecentActivity class="main-recent" />
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from "@/stores/auth"
import QuickEntry from './components/QuickEntry.vue'
import RecentActivity from './components/RecentActivity.vue'

const authStore = useAuthStore()

const userName = computed(() => authStore.user?.nickname || "用户")

const greetingText = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return "凌晨了，注意休息哦"
  if (hour < 9) return "早上好！新的一天开始了"
  if (hour < 12) return "上午好！祝你工作顺利"
  if (hour < 14) return "中午好！记得午休哦"
  if (hour < 18) return "下午好！继续加油"
  if (hour < 22) return "晚上好！记得休息哦"
  return "夜深了，早点休息吧"
})

const currentDate = ref('')
const currentTime = ref('')

const updateDateTime = () => {
  const now = new Date()
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  currentDate.value = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekDays[now.getDay()]}`
  currentTime.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

let timeInterval = null
onMounted(() => {
  updateDateTime()
  timeInterval = setInterval(updateDateTime, 60000)
})
onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval)
})
</script>

<style scoped lang="scss">
.home-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
}

.header-section {
  display: flex;
}

.welcome-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 20px 24px;
  background: $bg-white;
  border-radius: 8px;
  border: 1px solid $border-lighter;

  .welcome-main {
    .welcome-title {
      font-size: 18px;
      font-weight: 600;
      color: $text-primary;
      margin: 0 0 6px;
    }

    .welcome-desc {
      font-size: 13px;
      color: $text-secondary;
      margin: 0;
    }
  }

  .welcome-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid $border-lighter;

    .meta-date {
      font-size: 13px;
      color: $text-secondary;
    }

    .meta-time {
      font-size: 22px;
      font-weight: 600;
      color: $primary-color;
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
    }
  }
}

.main-content {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  min-height: 0;
  align-items: stretch;
}

@media (max-width: 960px) {
  .main-content {
    grid-template-columns: 1fr;
  }
}
</style>
