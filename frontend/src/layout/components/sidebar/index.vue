<template>
  <aside class="sidebar" :class="{ collapsed: isCollapsed }">
    <el-scrollbar class="sidebar-scrollbar">
      <el-menu
        :default-active="activeSideMenu"
        :default-openeds="defaultOpeneds"
        :collapse="isCollapsed"
        :unique-opened="true"
        router
        class="sidebar-menu"
        popper-class="cz-sidebar-popup"
        @open="handleOpen"
        @close="handleClose"
      >
        <menu-item
          v-for="menu in sidebarMenus"
          :key="menu.id"
          :menu="menu"
          :base-path="currentNavPath"
        />
      </el-menu>
    </el-scrollbar>

    <div class="sidebar-footer">
      <div class="collapse-btn" @click="toggleCollapse">
        <el-icon class="collapse-icon" :class="{ 'is-collapsed': isCollapsed }">
          <ArrowLeft />
        </el-icon>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { useMenuStore } from "@/stores/menu"
import MenuItem from "./menu-item.vue"

const route = useRoute()
const menuStore = useMenuStore()

// 使用 store 中的折叠状态（自动持久化）
const isCollapsed = computed(() => menuStore.sidebarCollapsed)

const sidebarMenus = computed(() => menuStore.sidebarMenus)

// 当前导航路径
const currentNavPath = computed(() => {
  return menuStore.activeTopMenu?.path || ''
})

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

  findParentPaths(sidebarMenus.value, route.path, currentNavPath.value)
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
  background-color: $sidebar-bg;
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

        :deep(.el-menu-item) {
          height: 50px;
          line-height: 50px;
          // margin: 4px 12px;
          border-radius: 5px;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          color: $sidebar-text;
          position: relative;

          // 右侧竖线指示器（默认隐藏）
          &::after {
            content: "";
            position: absolute;
            right: 0;
            top: 50%;
            width: 3px;
            height: 24px;
            background: $sidebar-active;
            border-radius: 3px 0 0 3px;
            transform: translateY(-50%) scaleY(0);
            transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          }

          &:hover {
            background-color: $bg-page !important;
            color: $sidebar-active !important;
            transform: translateX(2px);
          }

          &.is-active {
            background-color: $primary-bg !important;
            color: $sidebar-active !important;
            font-weight: 500;
            &::after { transform: translateY(-50%) scaleY(1); }
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
          // margin: 4px 12px;
          // border-radius: 6px;
          // transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          color: $sidebar-text;

          &:hover {
            background-color: $bg-page !important;
            color: $sidebar-active !important;
            // transform: translateX(2px);
          }
        }

        .el-menu {
          background-color: transparent !important;
          
          // 子菜单项缩进
          .el-menu-item,
          .el-sub-menu__title {
            padding-left: 40px !important;
            margin: 4px 12px;
          }
        }

        &.is-active {
          > .el-sub-menu__title {
            color: $sidebar-active !important;
            font-weight: 600;
          }
        }
      }
    }
    }

  .sidebar-footer {
    padding: 6px 10px;
    background-color: transparent;

    .collapse-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      margin: 0 auto;
      border-radius: 5px;
      cursor: pointer;

      &:hover {
        background-color: $bg-page;
        .collapse-icon { color: $primary-color; }
      }

      &:active { transform: scale(0.9); }

      .collapse-icon {
        font-size: 18px;
        color: $text-secondary;
        transform: translateZ(0);
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        &.is-collapsed { transform: translateZ(0) rotate(-180deg); }
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
    background-color: $bg-white;
    border: 1px solid $border-lighter;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);

    .el-menu-item {
      height: 40px;
      line-height: 40px;
      margin: 2px 0;
      padding: 0 16px !important;
      border-radius: 6px;
      color: $sidebar-text;
      background-color: transparent;

      &:hover {
        background-color: $bg-page;
        color: $primary-color;
      }

      &.is-active {
        background-color: $primary-bg;
        color: $primary-color;
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
        color: $sidebar-text;

        &:hover {
          background-color: $bg-page;
          color: $primary-color;
        }
      }

      &.is-active > .el-sub-menu__title {
        color: $primary-color;
        font-weight: 500;
      }
    }
  }
}
</style>
