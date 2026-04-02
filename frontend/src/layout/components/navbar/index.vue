<template>
  <nav class="nav-bar">
    <!-- Logo 区域 -->
    <div class="nav-brand" @click="goToHome">
      <img src="@/assets/images/logo.png" class="brand-logo" alt="LOGO">
      <span class="brand-name">万相中台</span>
    </div>

    <!-- 分隔线 -->
    <div class="nav-divider"></div>

    <!-- 导航菜单区域 -->
    <div class="nav-menus">
      <div 
        class="nav-menu-item" 
        :class="{ 'is-active': isHomeActive }" 
        @click="goToHome"
      >
        <el-icon class="menu-icon"><HomeFilled /></el-icon>
        <span class="menu-label">首页</span>
      </div>
      <div
        v-for="menu in topMenus"
        :key="menu.id"
        class="nav-menu-item"
        :class="{ 'is-active': isTopMenuActive(menu) }"
        @click="handleTopMenuClick(menu)"
      >
        <el-icon v-if="menu.icon" class="menu-icon">
          <component :is="menu.icon" />
        </el-icon>
        <span class="menu-label">{{ menu.name }}</span>
      </div>
    </div>

    <!-- 右侧工具区域 -->
    <div class="nav-tools">
      <!-- 快捷操作 -->
      <div class="tool-actions">
        <el-tooltip content="使用文档" placement="bottom" :show-after="300">
          <div class="tool-btn" @click="handleDocumentClick">
            <el-icon><Notification /></el-icon>
          </div>
        </el-tooltip>
        <el-tooltip content="消息通知" placement="bottom" :show-after="300">
          <div class="tool-btn tool-bell" @click="handleMessageClick">
            <el-icon><Bell /></el-icon>
            <span class="tool-badge" v-if="unreadCount > 0">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
          </div>
        </el-tooltip>
        
        <!-- APP下载 -->
        <ApkModal>
          <div class="tool-btn">
            <el-icon><Download /></el-icon>
          </div>
        </ApkModal>
      </div>

      <!-- 用户区域 -->
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
        
        <!-- 个人卡片内容 -->
        <div class="user-card">
          <!-- 头部：头像 + 用户信息 -->
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
          
          <!-- 操作菜单 -->
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
    </div>
  </nav>
  
  <!-- 上传裁剪组件 -->
  <CzImageCropperModal v-model="avatarDialogVisible" title="更换头像" @success="handleUploadSuccess" :aspectRatio="1" />
</template>

<script setup>
import { updateUserAvatarApi } from '@/api/system'
import { useAuthStore } from "@/stores/auth"
import { useMenuStore } from "@/stores/menu"
import { ElMessage } from "element-plus"
import CzImageCropperModal from "@/components/cz-image-cropper-modal/index.vue"
import ApkModal from "./apk-modal.vue"

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const menuStore = useMenuStore()

const topMenus = computed(() => menuStore.topMenus)
const activeTopMenu = computed(() => menuStore.activeTopMenu)

// 是否选中首页
const isHomeActive = computed(() => route.path === '/home')

// 选中其他导航
const isTopMenuActive = (menu) => activeTopMenu.value?.id === menu.id

const handleTopMenuClick = async (menu) => {
  menuStore.setActiveTopMenu(menu)

  // 使用 store 中的方法获取第一个可见菜单路径
  const targetPath = menuStore.getFirstVisiblePath(menu)
  
  if (targetPath) {
    return router.push(targetPath)
  }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////

const goToHome = () => {
  menuStore.setActiveTopMenu(null)
  router.push('/home')
}

const handleLogout = () => {
  authStore.logout()
}

const handleProfile = () => {
  router.push("/profile")
}

// 使用文档
const handleDocumentClick = () => {
  window.open('https://docs.qq.com/doc/DZUJmTXVDdkNQQ1Z1', '_blank')
}

// 消息通知
const handleMessageClick = () => {
  ElMessage('消息通知功能开发中...')
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////
const userName = computed(() => authStore.user?.nickname || "未知用户")
const userAvatar = computed(() => authStore.user?.avatar || "")
const userRoles = computed(() => authStore.roleNames || [])
const userAccount = computed(() => authStore.user?.userName || "-")
const userDept = computed(() => authStore.user?.deptName || "-")
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
  background: $navbar-bg;
  display: flex;
  align-items: center;
  padding: 0 20px;
  position: relative;
  z-index: 1000;
  border-bottom: 1px solid $border-light;
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
    font-size: 17px;
    font-weight: 600;
    color: $text-primary;
    white-space: nowrap;
    letter-spacing: 0.5px;
  }
}

// 分隔线
.nav-divider {
  width: 1px;
  height: 24px;
  background: $border-light;
  margin: 0 20px;
  flex-shrink: 0;
}

// 导航菜单区域
.nav-menus {
  display: flex;
  align-items: center;
  height: 100%;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none; // Firefox
  -ms-overflow-style: none; // IE/Edge

  &::-webkit-scrollbar {
    display: none;
  }

  .nav-menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 20px;
    cursor: pointer;
    white-space: nowrap;
    color: $text-regular;
    font-size: 14px;
    font-weight: 400;
    transition: all 0.2s;
    position: relative;

    .menu-icon {
      font-size: 16px;
      transition: color 0.2s;
    }

    .menu-label {
      transition: color 0.2s;
    }

    // 底部下划线（默认隐藏）
    &::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 50%;
      width: 28px;
      height: 3px;
      background: $primary-color;
      border-radius: 3px;
      transform: translateX(-50%) scaleX(0);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    &:hover {
      color: $primary-color;
      background: $bg-page;
    }

    &.is-active {
      color: $primary-color;
      font-weight: 500;
      background: transparent;

      .menu-icon {
        color: $primary-color;
      }

      // 激活时下划线展开
      &::after {
        transform: translateX(-50%) scaleX(1);
      }
    }
  }
}

// 右侧工具区域
.nav-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

// 快捷操作按钮
.tool-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 8px;

  .tool-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    cursor: pointer;
    color: $text-secondary;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

    .el-icon {
      font-size: 18px;
    }

    &:hover {
      color: $primary-color;
      background: $bg-page;
    }

    // 铃铛摇晃效果
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
      border: 2px solid $navbar-bg;
    }
  }
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
