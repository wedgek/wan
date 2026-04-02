<template>
  <div class="section-card quick-card">
    <div class="card-header">
      <span class="card-title">快捷入口</span>
    </div>
    <div class="card-body">
      <el-scrollbar class="quick-scrollbar">
        <div class="quick-entry">
          <div
            v-for="item in entries"
            :key="item.name"
            class="entry-item"
            @click="handleClick(item)"
          >
            <div class="entry-icon" :style="{ background: item.bg, color: item.color }">
              <el-icon><component :is="item.icon" /></el-icon>
            </div>
            <span class="entry-name">{{ item.name }}</span>
          </div>
        </div>
      </el-scrollbar>
    </div>
  </div>
</template>

<script setup>
import { User, UserFilled, Menu, Key } from '@element-plus/icons-vue'

const router = useRouter()

const entries = ref([
  { name: '菜单管理', icon: Menu, path: '/manage/permission/menu', color: '#FA8C16', bg: '#FFF7E6' },
  { name: '角色管理', icon: Key, path: '/manage/permission/role', color: '#722ED1', bg: '#F9F0FF' },
  { name: '成员管理', icon: User, path: '/manage/permission/member', color: '#1890FF', bg: '#E6F7FF' },
  { name: '个人中心', icon: UserFilled, path: '/profile', color: '#52C41A', bg: '#F6FFED' },
])

const handleClick = (item) => {
  if (item.path) router.push(item.path)
}
</script>

<style lang="scss" scoped>
.section-card {
  background: $bg-white;
  border-radius: 8px;
  border: 1px solid $border-lighter;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid $border-lighter;

    .card-title {
      font-size: 14px;
      font-weight: 500;
      color: $text-primary;
    }
  }

  .card-body {
    flex: 1;
    padding: 12px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
}

.quick-scrollbar {
  height: auto;
  max-height: 220px;

  :deep(.el-scrollbar__wrap) {
    overflow-x: hidden;
  }
}

.quick-entry {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;

  .entry-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px 8px;
    cursor: pointer;
    border-radius: 10px;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 10px;
      background: transparent;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    &:hover {
      &::before {
        background: $bg-page;
      }

      .entry-icon {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      }

      .entry-name {
        color: $primary-color;
      }
    }

    &:active {
      transform: scale(0.98);

      .entry-icon {
        transform: translateY(0);
      }
    }

    .entry-icon {
      position: relative;
      z-index: 1;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      font-size: 20px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .entry-name {
      position: relative;
      z-index: 1;
      font-size: 12px;
      color: $text-secondary;
      white-space: nowrap;
      transition: color 0.2s;
    }
  }
}
</style>
