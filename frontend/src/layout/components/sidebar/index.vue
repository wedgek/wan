<template>
  <aside class="sidebar" :class="{ collapsed: isCollapsed && !inDrawer, 'sidebar--drawer': inDrawer }">
    <el-scrollbar class="sidebar-scrollbar">
      <el-menu
        :default-active="activeSideMenu"
        :default-openeds="defaultOpeneds"
        :collapse="inDrawer ? false : isCollapsed"
        :unique-opened="true"
        router
        class="sidebar-menu"
        popper-class="cz-sidebar-popup"
        @open="handleOpen"
        @close="handleClose"
      >
        <el-sub-menu index="console">
          <template #title>
            <el-icon class="menu-icon"><Monitor /></el-icon>
            <span>工作台</span>
          </template>
          <el-menu-item index="/home">
            <el-icon class="menu-icon menu-icon--nested"><Odometer /></el-icon>
            <span>控制面板</span>
          </el-menu-item>
        </el-sub-menu>
        <menu-item
          v-for="menu in sidebarMenus"
          :key="menu.id"
          :menu="menu"
          base-path=""
        />
      </el-menu>
    </el-scrollbar>

    <div v-if="!inDrawer" class="sidebar-footer">
      <div class="collapse-btn" @click="toggleCollapse">
        <el-icon class="collapse-icon" :class="{ 'is-collapsed': isCollapsed }">
          <ArrowLeft />
        </el-icon>
      </div>
    </div>

    <div v-if="inDrawer" class="sidebar-drawer-foot">
      <div class="sidebar-drawer-foot__theme">
        <span class="sidebar-drawer-foot__label">主题</span>
        <ThemeSwitch />
      </div>
      <button type="button" class="sidebar-drawer-foot__btn" @click="goProfile">个人中心</button>
      <button type="button" class="sidebar-drawer-foot__btn sidebar-drawer-foot__btn--danger" @click="handleLogout">
        退出登录
      </button>
    </div>
  </aside>
</template>

<script setup>
import { Monitor, Odometer } from "@element-plus/icons-vue"
import ThemeSwitch from "@/components/theme-switch/index.vue"
import { useAuthStore } from "@/stores/auth"
import { useMenuStore } from "@/stores/menu"
import MenuItem from "./menu-item.vue"

defineProps({
  /** 处于移动端抽屉内：隐藏折叠条，底部提供主题与个人操作 */
  inDrawer: {
    type: Boolean,
    default: false,
  },
})

const route = useRoute()
const router = useRouter()
const menuStore = useMenuStore()
const authStore = useAuthStore()

const isCollapsed = computed(() => menuStore.sidebarCollapsed)

const goProfile = () => {
  router.push("/profile")
}

const handleLogout = () => {
  authStore.logout()
}

const sidebarMenus = computed(() => menuStore.sidebarMenus)

// 当前激活菜单
const activeSideMenu = computed(() => route.path)

// 默认展开菜单
const defaultOpeneds = ref([])

// 计算默认展开菜单（根据当前路由）
const calculateDefaultOpeneds = () => {
  const openeds = []

  const findParentPaths = (menus, targetPath, basePath = '') => {
    for (const menu of menus) {
      const menuFullPath = menu.path.startsWith('/')
        ? menu.path
        : `${basePath}/${menu.path}`.replace(/\/+/g, '/')

      if (menu.children?.length) {
        if (findParentPaths(menu.children, targetPath, menuFullPath)) {
          openeds.push(menuFullPath)
          return true
        }
      }

      if (menuFullPath === targetPath) {
        return true
      }
    }
    return false
  }

  findParentPaths(sidebarMenus.value, route.path, '')
  if (route.path === '/home') {
    openeds.push('console')
  }
  defaultOpeneds.value = openeds
}

// 路由变化时更新默认展开
watch(
  () => route.path,
  () => {
    calculateDefaultOpeneds()
  },
  { immediate: true }
)

const handleOpen = (index) => {}
const handleClose = (index) => {}

const toggleCollapse = () => {
  menuStore.toggleSidebarCollapsed()
}
</script>



<style lang="scss" scoped>
.sidebar {
  width: $sidebar-width;
  height: 100%;
  background-color: var(--app-surface);
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;

  &.collapsed {
    width: $sidebar-collapsed;
  }

  .sidebar-scrollbar {
    flex: 1;
    overflow: hidden;

    :deep(.el-scrollbar__wrap) {
      overflow-x: hidden !important;
    }

    :deep(.el-scrollbar__bar.is-horizontal) {
      display: none !important;
    }

    .sidebar-menu {
      border: none;
      height: 100%;
      background-color: transparent !important;
      --el-menu-text-color: var(--sidebar-item-color);
      --el-menu-hover-text-color: var(--sidebar-item-hover-color);
      --el-menu-active-color: var(--sidebar-item-active-color);
      --el-menu-bg-color: transparent;

      /* 与 menu-item.vue 一致：顶级图标间距。写死项不在 MenuItem 内，scoped 未生效 */
      :deep(.el-sub-menu__title > .el-icon.menu-icon:not(.menu-icon--nested)),
      :deep(.el-menu-item > .el-icon.menu-icon:not(.menu-icon--nested)) {
        margin-right: 10px !important;
        font-size: 18px;
        vertical-align: middle;
      }

      :deep(.el-menu-item) {
        height: 50px;
        line-height: 50px;
        border-radius: 5px;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        color: var(--sidebar-item-color);
        position: relative;

        &::after {
          content: "";
          position: absolute;
          right: 0;
          top: 50%;
          width: 3px;
          height: 24px;
          background: var(--sidebar-accent-line);
          border-radius: 3px 0 0 3px;
          transform: translateY(-50%) scaleY(0);
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }

        &:hover:not(.is-active) {
          background-color: var(--sidebar-item-hover-bg) !important;
          color: var(--sidebar-item-hover-color) !important;
          transform: translateX(2px);
        }

        &.is-active {
          background-color: var(--sidebar-item-active-bg) !important;
          color: var(--sidebar-item-active-color) !important;
          font-weight: 500;
          &::after {
            transform: translateY(-50%) scaleY(1);
          }
        }
      }

      // 折叠状态下图标居中
      &.el-menu--collapse {
        :deep(.el-menu-item) {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 0 !important;
          margin: 4px auto;
          width: 44px;
          height: 44px;

          .menu-icon {
            margin-right: 0 !important;
          }

          span {
            display: none;
          }

          &::after {
            display: none;
          }
        }

        :deep(.el-sub-menu) {
          .el-sub-menu__title {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 0 !important;
            margin: 4px auto;
            width: 44px;
            height: 44px;

            .menu-icon {
              margin-right: 0 !important;
            }

            span {
              display: none;
            }
          }
        }
      }

      :deep(.el-sub-menu) {
        .el-sub-menu__title {
          height: 50px;
          line-height: 50px;
          color: var(--sidebar-item-color);

          &:hover {
            background-color: var(--sidebar-item-hover-bg) !important;
            color: var(--sidebar-item-hover-color) !important;
          }
        }

        .el-menu {
          background-color: transparent !important;

          .el-menu-item,
          .el-sub-menu__title {
            padding-left: 40px !important;
            margin: 4px 12px;
          }

          .menu-icon--nested {
            margin-right: 8px !important;
            font-size: 15px;
          }
        }

        &.is-active {
          > .el-sub-menu__title {
            color: var(--sidebar-sub-active-title-color) !important;
            font-weight: 600;
          }
        }
      }
    }
    }

  &.sidebar--drawer {
    width: 100% !important;
    max-width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;

    &.collapsed {
      width: 100% !important;
    }

    .sidebar-scrollbar {
      flex: 1;
      min-height: 0;
    }
  }

  .sidebar-drawer-foot {
    flex-shrink: 0;
    padding: 12px 14px calc(12px + env(safe-area-inset-bottom, 0));
    border-top: 1px solid var(--app-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--app-surface);
  }

  .sidebar-drawer-foot__theme {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0 4px;
  }

  .sidebar-drawer-foot__label {
    font-size: 13px;
    color: var(--app-muted);
  }

  .sidebar-drawer-foot__btn {
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--app-border);
    background: var(--el-fill-color-blank);
    color: var(--app-text);
    font-size: 14px;
    text-align: center;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;

    &:hover {
      background: var(--el-fill-color-light);
      border-color: var(--el-color-primary-light-5);
    }

    &--danger:hover {
      border-color: var(--el-color-danger-light-5);
      color: var(--el-color-danger);
      background: var(--el-color-danger-light-9);
    }
  }

  .sidebar-footer {
    padding: 6px 10px;
    background-color: transparent;
    display: flex;
    justify-content: flex-start;

    .collapse-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      margin: 0;
      border-radius: 5px;
      cursor: pointer;
      background: transparent;

      &:hover {
        background-color: var(--sidebar-collapse-hover-bg);
        .collapse-icon {
          color: var(--sidebar-item-hover-color);
        }
      }

      &:active {
        transform: scale(0.9);
      }

      .collapse-icon {
        font-size: 18px;
        color: var(--sidebar-collapse-icon);
        transform: translateZ(0);
        transition:
          transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
          color 0.2s ease;
        &.is-collapsed {
          transform: translateZ(0) rotate(-180deg);
        }
      }
    }
  }
}
</style>

<style lang="scss">
// 折叠菜单弹出层样式
.cz-sidebar-popup {
  &.el-menu--popup {
    min-width: 160px;
    padding: 6px;
    background-color: var(--sidebar-popup-bg);
    border: 1px solid var(--sidebar-popup-border);
    border-radius: 8px;
    box-shadow: var(--sidebar-popup-shadow);

    .el-menu-item {
      height: 40px;
      line-height: 40px;
      margin: 2px 0;
      padding: 0 16px !important;
      border-radius: 6px;
      color: var(--sidebar-item-color);
      background-color: transparent;

      &:hover:not(.is-active) {
        background-color: var(--sidebar-item-hover-bg);
        color: var(--sidebar-item-hover-color);
      }

      &.is-active {
        background-color: var(--sidebar-item-active-bg);
        color: var(--sidebar-item-active-color);
        font-weight: 500;
      }
    }

    .el-sub-menu {
      .el-sub-menu__title {
        height: 40px;
        line-height: 40px;
        margin: 2px 0;
        padding: 0 16px !important;
        border-radius: 6px;
        color: var(--sidebar-item-color);

        &:hover {
          background-color: var(--sidebar-item-hover-bg);
          color: var(--sidebar-item-hover-color);
        }
      }

      &.is-active > .el-sub-menu__title {
        color: var(--sidebar-sub-active-title-color);
        font-weight: 500;
      }
    }
  }
}
</style>
