<template>
  <nav class="nav-bar">
    <!-- Logo 区域 -->
    <div class="nav-brand" @click="goToHome">
      <img src="@/assets/images/logo.svg" class="brand-logo" alt="LOGO">
        <span class="brand-name">万相AI管理系统</span>
    </div>

    <div v-show="!isMobile" class="nav-center">
      <NavMenuSearch />
    </div>

    <!-- 桌面端：主题 / 全屏 / 消息 / 用户；移动端：仅菜单入口 -->
    <div class="nav-tools">
      <template v-if="!isMobile">
        <ThemeSwitch />
        <el-tooltip :content="isFullscreen ? '退出全屏' : '全屏'" placement="bottom" :show-after="300">
          <div class="tool-btn" role="button" tabindex="0" @click="toggleFullscreen" @keydown.enter.prevent="toggleFullscreen">
            <el-icon><Notification /></el-icon>
          </div>
        </el-tooltip>
        <div class="tool-actions">
          <el-tooltip content="消息通知" placement="bottom" :show-after="300">
            <div class="tool-btn tool-bell" @click="handleMessageClick">
              <el-icon><Bell /></el-icon>
              <span class="tool-badge" v-if="unreadCount > 0">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
            </div>
          </el-tooltip>
        </div>

        <el-popover
          placement="bottom-end"
          :width="225"
          trigger="hover"
          :show-arrow="false"
          :offset="10"
          popper-class="cz-user-card-popper"
        >
          <template #reference>
            <div class="user-trigger">
              <el-avatar :size="36" :src="userAvatar">
                <el-icon :size="16"><UserFilled /></el-icon>
              </el-avatar>
            </div>
          </template>

          <div class="user-card">
            <div class="card-header">
              <div class="card-avatar" @click="avatarDialogVisible = true">
                <el-avatar :size="50" :src="userAvatar">
                  <el-icon :size="20"><UserFilled /></el-icon>
                </el-avatar>
                <div class="avatar-overlay">
                  <el-icon :size="14"><Camera /></el-icon>
                </div>
              </div>
              <div class="card-info">
                <div class="user-name">{{ userName }}</div>
                <div class="info-sub">
                  <span class="sub-account">{{ userAccount }}</span>
                  <span v-for="role in userRoles" :key="role" class="role-tag">{{ role }}</span>
                </div>
              </div>
            </div>

            <div class="card-menu">
              <div class="menu-item" @click="handleProfile">
                <el-icon class="menu-icon">
                  <component :is="$iconfont.User" />
                </el-icon>
                <span class="menu-text">个人中心</span>
                <el-icon class="menu-arrow"><ArrowRight /></el-icon>
              </div>
              <div class="menu-item menu-logout" @click="handleLogout">
                <el-icon class="menu-icon"><SwitchButton /></el-icon>
                <span class="menu-text">退出登录</span>
                <el-icon class="menu-arrow"><ArrowRight /></el-icon>
              </div>
            </div>
          </div>
        </el-popover>
      </template>

      <button
        v-else
        type="button"
        class="nav-mobile-menu-btn"
        aria-label="打开菜单"
        @click="openMobileNav"
      >
        <el-icon :size="22"><Menu /></el-icon>
      </button>
    </div>
  </nav>
  
  <!-- 上传裁剪组件 -->
  <CzImageCropperModal v-model="avatarDialogVisible" title="更换头像" @success="handleUploadSuccess" :aspectRatio="1" />
</template>

<script setup>
import { updateUserAvatarApi } from '@/api/system'
import { useAuthStore } from "@/stores/auth"
import { ElMessage } from "element-plus"
import { Menu } from "@element-plus/icons-vue"
import CzImageCropperModal from "@/components/cz-image-cropper-modal/index.vue"
import ThemeSwitch from "@/components/theme-switch/index.vue"
import NavMenuSearch from "@/components/nav-menu-search/index.vue"
import { isMobileViewport } from "@/composables/useIsMobile"
import { useMenuStore } from "@/stores/menu"

const router = useRouter()
const authStore = useAuthStore()
const menuStore = useMenuStore()

const isMobile = isMobileViewport

const openMobileNav = () => {
  menuStore.setSidebarCollapsed(false)
  menuStore.setMobileDrawerOpen(true)
}

const goToHome = () => {
  router.push('/home')
}

const handleLogout = () => {
  authStore.logout()
}

const handleProfile = () => {
  router.push("/profile")
}

const isFullscreen = ref(false)

const syncFullscreen = () => {
  isFullscreen.value = !!document.fullscreenElement
}

const toggleFullscreen = async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch {
    ElMessage.warning("当前浏览器或环境不支持全屏")
  }
}

onMounted(() => {
  document.addEventListener("fullscreenchange", syncFullscreen)
  syncFullscreen()
})

onUnmounted(() => {
  document.removeEventListener("fullscreenchange", syncFullscreen)
})

// 消息通知
const handleMessageClick = () => {
  ElMessage('消息通知功能开发中...')
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////
const userName = computed(() => authStore.user?.nickname || "未知用户")
const userAvatar = computed(() => authStore.user?.avatar || "")
const userRoles = computed(() => authStore.roleNames || [])
const userAccount = computed(() => authStore.user?.userName || "-")
const unreadCount = ref(0)

// 头像更新
const avatarDialogVisible = ref(false)

const handleUploadSuccess = async (url) => {
  if (!url) return
  try {
    const res = await updateUserAvatarApi(authStore.user.id, url)  
    if (res.code === 0) {
      ElMessage.success("头像已更新")
      authStore.getUserInfo()
    } else {
      ElMessage.error(res.msg || "保存头像失败")
    }
  } catch (e) {
    ElMessage.error("网络错误，请稍后重试")
  }
}

</script>

<style lang="scss" scoped>

.nav-bar {
  height: $header-height;
  background: var(--app-surface);
  display: flex;
  align-items: center;
  padding: 0 18px;
  position: relative;
  z-index: 1000;
  border-bottom: 1px solid var(--app-border);

  @media (max-width: 767.98px) {
    padding: 0 12px 0 14px;
  }
}

.nav-mobile-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--app-text);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:hover {
    background: var(--nav-tool-hover-bg);
    color: var(--nav-tool-icon-hover);
  }
}

// Logo 区域
.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 8px 0;
  margin-right: 20px;
  margin-left: 4px;
  margin-right: 12px;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.85;
  }

  .brand-logo {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }

  .brand-name {
    font-family:
      'DingTalk JinBuTi',
      'PingFang SC',
      'Microsoft YaHei',
      ui-sans-serif,
      system-ui,
      sans-serif;
    font-size: 18px;
    font-weight: 400;
    color: var(--app-text);
    white-space: nowrap;
    letter-spacing: 0.02em;
  }

  @media (max-width: 767.98px) {
    margin-right: 8px;

    .brand-name {
      font-size: 16px;
      max-width: 42vw;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .brand-logo {
      width: 26px;
      height: 26px;
    }
  }
}

// 中央：菜单搜索（占据顶栏中间留白；略提高层级，减轻与相邻 flex 子项叠层时偶发点不到的情况）
.nav-center {
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 0;
  padding: 0 8px;
}

// 右侧工具区域（全屏 / 主题 / 消息：同一套默认色与 hover 主色）
.nav-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
  --theme-trigger-color: var(--app-muted);
  --theme-trigger-hover-bg: var(--nav-tool-hover-bg);
  --theme-trigger-hover-color: var(--nav-tool-icon-hover);
}

// 顶栏图标按钮（全屏、消息等）
.nav-tools .tool-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--app-muted);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

  .el-icon {
    font-size: 18px;
    color: inherit;
  }

  :deep(.el-icon svg) {
    opacity: 1;
  }

  &:hover {
    color: var(--nav-tool-icon-hover);
    background: var(--nav-tool-hover-bg);
  }

  &.tool-bell {
    .el-icon {
      transform-origin: top center;
    }

    &:hover .el-icon {
      animation: ani-bell-ring 0.9s ease-in-out;
    }

    &:active {
      transform: scale(0.85);
    }
  }

  .tool-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: $danger-color;
    color: #fff;
    border-radius: 8px;
    font-size: 10px;
    line-height: 16px;
    text-align: center;
    font-weight: 500;
    border: 2px solid var(--app-surface);
  }
}

.tool-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 8px;
}

// 用户触发器（只显示头像）
.user-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 50%;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

  :deep(.el-avatar) {
    background: $primary-light;
    color: $primary-color;
    transition: all 0.25s;
  }
  
  :deep(img) {
    transition: transform 0.1s ease;
  }

  &:hover {
    :deep(.el-avatar) {
      box-shadow: 0 0 0 3px rgba($primary-color, 0.2);
    }
    :deep(img) {
      transform: scale(1.08);
    }
  }
}
</style>

<style lang="scss">
// 用户个人卡片弹出层
.cz-user-card-popper {
  padding: 0 !important;
  border-radius: 16px !important;
  border: 1px solid rgba(0, 0, 0, 0.04) !important;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12) !important;
  overflow: hidden;

  .user-card {
    background: #fff;
    min-width: 220px;

    // 头部区域
    .card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 16px 10px 16px;

      .card-avatar {
        position: relative;
        width: 50px;
        height: 50px;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
        cursor: pointer;

        .el-avatar {
          background: $primary-light;
          color: $primary-color;
        }
        
        img {
          transition: transform 0.1s ease;
        }

        .avatar-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.4);
          color: #fff;
          opacity: 0;
          transition: opacity 0.2s;
        }

        &:hover {
          img {
            transform: scale(1.08);
          }
          .avatar-overlay {
            opacity: 1;
          }
        }
      }

      .card-info {
        flex: 1;
        min-width: 0;

        .user-name {
          font-size: 16px;
          font-weight: 600;
          color: $text-primary;
          margin-bottom: 6px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .info-sub {
          display: flex;
          align-items: center;
          gap: 8px;

          .sub-account {
            font-size: 13px;
            color: $text-secondary;
          }

          .role-tag {
            flex-shrink: 0;
            padding: 2px 8px;
            font-size: 10px;
            font-weight: 500;
            color: $primary-color;
            background: $primary-light;
            border-radius: 4px;
          }
        }
      }
    }

    // 操作菜单区域
    .card-menu {
      padding: 8px;

      .menu-item {
        display: flex;
        align-items: center;
        padding: 12px;
        font-size: 14px;
        color: $text-primary;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.2s;
        &:not(:last-child){
          border-bottom: 1px solid $border-lighter;
        }

        .menu-icon {
          font-size: 18px;
          color: $text-secondary;
          margin-right: 12px;
          transition: color 0.2s;
        }

        .menu-text {
          flex: 1;
        }

        .menu-arrow {
          font-size: 14px;
          color: $text-placeholder;
          transition: color 0.2s;
        }

        &:hover {
          background: $bg-page;

          .menu-icon,
          .menu-text,
          .menu-arrow {
            color: $primary-color;
          }
        }

        // 退出登录
        &.menu-logout:hover {
          background: $danger-light;

          .menu-icon,
          .menu-text,
          .menu-arrow {
            color: $danger-color;
          }
        }
      }
    }
  }
}

</style>
