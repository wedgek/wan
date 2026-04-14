<template>
  <div class="layout-container" :class="{ 'layout-container--fullpage': isFullPage }">
    <Navbar v-if="!isFullPage && showNavbar" />

    <div class="layout-main" :class="{ 'layout-main--fullpage': isFullPage }">
      <Sidebar v-if="!isFullPage && showSidebar && !isMobile" />

      <el-drawer
        v-if="!isFullPage && showSidebar && isMobile"
        v-model="mobileDrawerOpen"
        direction="rtl"
        size="min(300px, 88vw)"
        :with-header="false"
        body-class="layout-mobile-drawer-body"
        append-to-body
        class="layout-mobile-nav-drawer"
      >
        <Sidebar in-drawer />
      </el-drawer>

      <div class="page-content" :class="{ 'page-content--fullpage': isFullPage }">
        <div
          class="content-wrapper"
          :class="{
            'no-padding': route.meta?.noPadding || isFullPage,
            'content-wrapper--fullpage': isFullPage,
            'content-wrapper--wide': route.meta?.wideContent && !isFullPage,
          }"
        >
          <router-view v-slot="{ Component, route: routeItem }">
            <keep-alive :include="keepAlivePages">
              <component v-if="Component" :is="Component" :key="routeItem.path" class="page-transition-wrapper" />
              <div v-else-if="routerReady" class="page-empty-box center">
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
import { ref, watch } from "vue"
import { storeToRefs } from "pinia"
import { useMenuStore } from "@/stores/menu"
import { isMobileViewport } from "@/composables/useIsMobile"
import Navbar from "./components/navbar/index.vue"
import Sidebar from "./components/sidebar/index.vue"

const route = useRoute()
const router = useRouter()
const menuStore = useMenuStore()

// 路由是否已就绪（动态路由注册完成）
const routerReady = ref(false)
router.isReady().then(() => {
  routerReady.value = true
})
const { mobileDrawerOpen } = storeToRefs(menuStore)

const isMobile = isMobileViewport

watch(isMobile, (m) => {
  if (!m) menuStore.setMobileDrawerOpen(false)
})

watch(
  () => route.fullPath,
  () => {
    if (isMobile.value) menuStore.setMobileDrawerOpen(false)
  },
)

// 登录/404 等整页：不显顶栏与侧栏，也不套内容区外壳（避免首屏闪现管理台骨架）
const isFullPage = computed(
  () => route.meta?.showNavbar === false && route.meta?.showSidebar === false,
)

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
  background-color: var(--app-bg);

  &.layout-container--fullpage {
    background-color: transparent;
  }

  .layout-main {
    display: flex;
    flex: 1;
    overflow: hidden;

    &.layout-main--fullpage {
      min-height: 0;
    }

    .page-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      &.page-content--fullpage {
        min-height: 0;
      }

      .content-wrapper {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        background-color: var(--app-bg);
        position: relative;
        padding: $content-outside-padding;
        &.no-padding {
          padding: 0;
        }

        &.content-wrapper--fullpage {
          background-color: transparent;
        }

        /* 工作台等：四边略小于常规页。与 no-padding 并存时以贴边为准（避免 wide 覆盖掉 0 内边距） */
        &.content-wrapper--wide:not(.no-padding) {
          padding: clamp(12px, 1.35vw, 22px);
          padding-bottom: clamp(8px, 1vw, 16px);
        }

        /* 与 .page-container（flex:1）撑满主内容区，保证 el-table height="100%" 能正确计算 */
        .page-transition-wrapper {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .page-empty-box {
          min-height: min(620px, 70vh);
          position: relative;
        }
      }
    }
  }
}
</style>

<style lang="scss">
/* 移动端导航抽屉：无内边距，侧栏铺满 */
.layout-mobile-drawer-body.el-drawer__body {
  padding: 0 !important;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
