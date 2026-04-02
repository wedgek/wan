<template>
  <div class="section-card">
    <div class="card-header">
      <span class="card-title">最近动态</span>
    </div>
    <div class="card-body">
      <div class="activity-list">
        <div v-for="(item, index) in activities" :key="index" class="activity-item">
          <div class="activity-dot"></div>
          <div class="activity-content">
            <p class="activity-text">{{ item.text }}</p>
            <span class="activity-time">{{ item.time }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 占位示例，可后续对接审计/通知接口
const activities = ref([
  { text: '可在「菜单管理」中配置系统导航与权限标识', time: '系统提示' },
  { text: '在「角色管理」中为岗位分配菜单与操作权限', time: '系统提示' },
  { text: '在「成员管理」中维护账号与部门、角色关系', time: '系统提示' },
  { text: '个人资料与头像可在「个人中心」修改', time: '系统提示' },
])
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
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.activity-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;

  .activity-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: $primary-color;
    margin-top: 6px;
    flex-shrink: 0;
  }

  .activity-content {
    flex: 1;
    min-width: 0;

    .activity-text {
      margin: 0;
      font-size: 13px;
      color: $text-primary;
      line-height: 1.5;
    }

    .activity-time {
      font-size: 12px;
      color: $text-placeholder;
      margin-top: 4px;
      display: inline-block;
    }
  }
}
</style>
