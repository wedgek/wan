<template>
  <div class="layout-container">
    <!-- 导航栏 -->
    <Navbar v-if="showNavbar" />

    <div class="layout-main">
      <!-- 侧边栏 -->
      <Sidebar v-if="showSidebar" />

      <!-- 页面内容 -->
      <div class="page-content">
        <div class="content-wrapper" :class="{ 'no-padding': route.meta?.noPadding }">
          <router-view v-slot="{ Component, route: routeItem }">
            <keep-alive :include="keepAlivePages">
              <component v-if="Component" :is="Component" :key="routeItem.path" class="page-transition-wrapper" />
              <div v-else class="page-empty-box center">
                <el-empty description="抱歉，当前路径没有匹配到页面" />
              </div>
            </keep-alive>
          </router-view>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import Navbar from "./components/navbar/index.vue"
import Sidebar from "./components/sidebar/index.vue"

const route = useRoute()

// 控制显示导航栏和侧边栏
const showNavbar = computed(() => route.meta?.showNavbar ?? true)
const showSidebar = computed(() => route.meta?.showSidebar ?? true)

// 页面缓存 - meta.keepAlive
const keepAlivePages = computed(() => {
  return []
})
</script>

<style lang="scss" scoped>
.layout-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background-color: $bg-page;
  .layout-main {
    display: flex;
    flex: 1;
    overflow: hidden;
    .page-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      .content-wrapper {
        flex: 1;
        overflow-y: auto;
        background-color: $bg-page;
        position: relative;
        padding: $content-outside-padding;
        &.no-padding {
          padding: 0;
        }
        .page-transition-wrapper,
        .page-empty-box {
          height: 100%;
          position: relative;
        }
      }
    }
  }
}
</style>
