<template>
  <div class="profile-page">
    <!-- 左侧导航 -->
    <aside class="profile-sidebar">
      <!-- 用户信息 -->
      <div class="user-brief">
        <div class="avatar-box" @click="avatarDialogVisible = true">
          <el-avatar :size="64" :src="userAvatar">
            <el-icon size="24"><UserFilled /></el-icon>
          </el-avatar>
          <div class="avatar-mask">
            <el-icon><Camera /></el-icon>
          </div>
        </div>
        <h3 class="user-name">{{ nickname }}</h3>
        <div class="role-tags" v-if="roleNames.length">
          <span v-for="r in roleNames" :key="r" class="role-tag">{{ r }}</span>
        </div>
      </div>

      <!-- 导航菜单（可滚动区域） -->
      <div class="nav-scroll">
        <ul class="nav-menu">
          <li 
            v-for="item in menuList" 
            :key="item.key"
            :class="['nav-item', { active: activeTab === item.key }]"
            @click="activeTab = item.key"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </li>
        </ul>
      </div>

      <!-- 账号信息 -->
      <div class="account-info">
        <div class="info-row">
          <el-icon><User /></el-icon>
          <span class="label">账号</span>
          <span class="value">{{ userInfo.userName || "-" }}</span>
        </div>
        <div class="info-row">
          <el-icon><OfficeBuilding /></el-icon>
          <span class="label">部门</span>
          <span class="value">{{ userInfo.deptName || "-" }}</span>
        </div>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main class="profile-content">
      <!-- 安全设置 -->
      <section v-show="activeTab === 'security'" class="content-section">
        <div class="section-header">
          <h2>安全设置</h2>
          <p>管理您的账号密码和安全选项</p>
        </div>

        <div class="section-body">
          <div class="setting-block">
            <div class="block-header">
              <div class="block-title">
                <el-icon><Lock /></el-icon>
                <span>修改密码</span>
              </div>
              <p class="block-desc">定期修改密码可以保障账号安全</p>
            </div>

            <el-form
              :model="pwdForm"
              label-position="top"
              class="password-form"
            >
              <el-form-item label="新密码" prop="newPassword" v-required-dot>
                <el-input
                  v-model="pwdForm.newPassword"
                  type="password"
                  show-password
                  placeholder="请输入新密码（6-18位）"
                  clearable
                  clear-icon="Close"
                />
              </el-form-item>
              <el-form-item label="确认密码" prop="confirmPassword" v-required-dot>
                <el-input
                  v-model="pwdForm.confirmPassword"
                  type="password"
                  show-password
                  placeholder="请再次输入新密码"
                  clearable
                  clear-icon="Close"
                />
              </el-form-item>
              <div class="form-actions">
                <el-button type="primary" :loading="pwdSubmitting" @click="submitPassword">
                  保存修改
                </el-button>
                <el-button @click="resetPasswordForm">重置</el-button>
              </div>
            </el-form>
          </div>
        </div>
      </section>

      <!-- 个人信息（预留扩展） -->
      <section v-show="activeTab === 'profile'" class="content-section">
        <div class="section-header">
          <h2>个人信息</h2>
          <p>查看和编辑您的个人资料</p>
        </div>
        <div class="section-body">
          <el-empty description="暂无更多设置" :image-size="120" />
        </div>
      </section>

      <!-- 通知设置（预留扩展） -->
      <section v-show="activeTab === 'notification'" class="content-section">
        <div class="section-header">
          <h2>通知设置</h2>
          <p>管理您的消息通知偏好</p>
        </div>
        <div class="section-body">
          <el-empty description="暂无更多设置" :image-size="120" />
        </div>
      </section>
    </main>

    <!-- 头像上传组件 -->
    <CzImageCropperModal 
      v-model="avatarDialogVisible" 
      title="更换头像" 
      @success="handleUploadSuccess" 
      :aspectRatio="1" 
    />
  </div>
</template>

<script setup>
import request from "@/request"
import { updateUserAvatarApi } from '@/api/system'
import { ElMessage, ElMessageBox } from "element-plus"
import { useAuthStore } from "@/stores/auth"
import CzImageCropperModal from "@/components/cz-image-cropper-modal/index.vue"
import { Lock, User as UserIcon, Bell } from '@element-plus/icons-vue'

const authStore = useAuthStore()

const userInfo = computed(() => authStore.user || {})
const userAvatar = computed(() => authStore.user?.avatar || "")
const nickname = computed(() => authStore.user?.nickname || "-")
const roleNames = computed(() => authStore.roleNames || [])

// 导航菜单
const activeTab = ref('security')
const menuList = [
  { key: 'security', label: '安全设置', icon: Lock },
  { key: 'profile', label: '个人信息', icon: UserIcon },
  { key: 'notification', label: '通知设置', icon: Bell },
]

//////////////////////////////////////////////////////////////////////////////////////////////////////////

// 密码修改
const pwdSubmitting = ref(false)
const pwdForm = reactive({ newPassword: "", confirmPassword: "" })

const resetPasswordForm = () => {
  pwdForm.newPassword = ""
  pwdForm.confirmPassword = ""
}

const validateForm = () => {
  const { newPassword, confirmPassword } = pwdForm
  if (!newPassword || newPassword.trim() === '') {
    ElMessage('新密码不能为空')
    return false
  }
  if (newPassword.length < 6 || newPassword.length > 18) {
    ElMessage('密码长度为 6-18 个字符')
    return false
  }
  if (!confirmPassword || confirmPassword.trim() === '') {
    ElMessage('确认密码不能为空')
    return false
  }
  if (newPassword !== confirmPassword) {
    ElMessage('两次密码不一致')
    return false
  }
  return true
}

const submitPassword = async () => {
  try {
    if (!validateForm()) return

    await ElMessageBox.confirm(
      "确定要修改登录密码吗？修改成功后将自动退出，需要重新登录授权。",
      "修改确认",
      {
        confirmButtonText: "确定修改",
        cancelButtonText: "取消",
        type: "warning",
      }
    )

    pwdSubmitting.value = true
    const res = await request({
      url: "/admin-api/system/user/update-password",
      method: "PUT",
      data: { id: userInfo.value.id, password: pwdForm.newPassword }
    })

    if (res.code === 0) {
      resetPasswordForm()
      await ElMessageBox.alert("密码修改成功，请使用新密码重新登录。", "提示", {
        confirmButtonText: "我知道了",
        showClose: false,
        type: "success",
      })
      authStore.logout()
      return
    }

    ElMessage.error(res.msg || "修改失败")
  } catch (err) {} finally { pwdSubmitting.value = false }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////
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
    ElMessage.error("系统错误")
  }
}
</script>

<style lang="scss" scoped>
.profile-page {
  display: flex;
  align-items: stretch;
  gap: 16px;
  max-width: 960px;
  margin: 0 auto;
  min-height: calc(100vh - 120px);
}

// ==================== 左侧导航 ====================
.profile-sidebar {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: $bg-white;
  border-radius: 8px;
  border: 1px solid $border-lighter;
}

// 用户简介（固定顶部）
.user-brief {
  padding: 24px 20px 20px;
  text-align: center;
  border-bottom: 1px solid $border-lighter;
  flex-shrink: 0;

  .avatar-box {
    position: relative;
    width: 64px;
    height: 64px;
    margin: 0 auto 12px;
    cursor: pointer;
    border-radius: 50%;
    overflow: hidden;

    .el-avatar {
      display: block;
    }
    
    :deep(img) {
      transition: transform 0.1s ease;
    }
    
    &:hover :deep(img) {
      transform: scale(1.08);
    }

    .avatar-mask {
      position: absolute;
      top: 0;
      left: 0;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 18px;
      opacity: 0;
      transition: opacity 0.2s;
    }

    &:hover .avatar-mask {
      opacity: 1;
    }
  }

  .user-name {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 600;
    color: $text-primary;
    line-height: 1.4;
  }

  .role-tags {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;

    .role-tag {
      padding: 3px 10px;
      font-size: 11px;
      color: $primary-color;
      background: $primary-light;
      border-radius: 10px;
    }
  }
}

// 导航菜单滚动区域
.nav-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;

  // 自定义滚动条
  &::-webkit-scrollbar {
    width: 5px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: $border-color;
    border-radius: 3px;

    &:hover {
      background: $text-placeholder;
    }
  }
}

// 导航菜单
.nav-menu {
  list-style: none;
  margin: 0;
  padding: 12px 0;

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 20px;
    margin: 2px 8px;
    border-radius: 5px;
    font-size: 14px;
    color: $text-regular;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;

    // 右侧竖线指示器
    &::after {
      content: "";
      position: absolute;
      right: -8px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 0;
      background: $primary-color;
      border-radius: 3px 0 0 3px;
      transition: height 0.25s;
    }

    .el-icon {
      font-size: 16px;
    }

    &:hover {
      color: $primary-color;
      background: $bg-page;
      transform: translateX(2px);
    }

    &.active {
      color: $primary-color;
      background: $primary-bg;
      font-weight: 500;

      // 激活时竖线展开
      &::after {
        height: 20px;
      }
    }
  }
}

// 账号信息（固定底部）
.account-info {
  padding: 14px 20px 16px;
  border-top: 1px solid $border-lighter;
  flex-shrink: 0;

  .info-row {
    display: flex;
    align-items: center;
    padding: 12px 0;
    font-size: 13px;
    color: $text-secondary;
    border-bottom: 1px dashed $border-lighter;

    &:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    &:first-child {
      padding-top: 0;
    }

    .el-icon {
      font-size: 16px;
      margin-right: 8px;
      color: $text-placeholder;
    }

    .label {
      width: 36px;
    }

    .value {
      flex: 1;
      text-align: right;
      color: $text-primary;
    }
  }
}

// ==================== 右侧内容区 ====================
.profile-content {
  flex: 1;
  min-width: 0;
  background: $bg-white;
  border-radius: 8px;
  border: 1px solid $border-lighter;
}

.content-section {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.section-header {
  padding: 20px 24px;
  border-bottom: 1px solid $border-lighter;

  h2 {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 600;
    color: $text-primary;
  }

  p {
    margin: 0;
    font-size: 13px;
    color: $text-secondary;
  }
}

.section-body {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

// 设置块
.setting-block {
  .block-header {
    margin-bottom: 20px;

    .block-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 500;
      color: $text-primary;

      .el-icon {
        color: $primary-color;
      }
    }

    .block-desc {
      margin: 6px 0 0;
      font-size: 12px;
      color: $text-secondary;
      padding-left: 24px;
    }
  }
}

// 密码表单
.password-form {
  max-width: 360px;

  :deep(.el-form-item) {
    margin-bottom: 18px;

    .el-form-item__label {
      font-size: 13px;
      font-weight: 500;
      color: $text-primary;
      padding-bottom: 6px;
    }
  }

  :deep(.el-input) {
    --el-input-height: 36px;
  }

  :deep(.el-input__wrapper) {
    border-radius: 6px;
  }

  .form-actions {
    display: flex;
    gap: 10px;
    margin-top: 24px;

    .el-button {
      border-radius: 6px;
    }
  }
}

// ==================== 响应式 ====================
@media (max-width: 768px) {
  .profile-page {
    flex-direction: column;
    min-height: auto;
    gap: 12px;
  }

  .profile-sidebar {
    width: 100%;
    max-height: none;
    padding: 0;
  }

  .user-brief {
    padding: 20px 16px 12px;
    border-bottom: none;

    .avatar-box {
      margin-bottom: 10px;
    }

    .user-name {
      margin-bottom: 6px;
    }
  }

  // 小屏幕下滚动区域不需要滚动
  .nav-scroll {
    overflow: visible;
    border-top: 1px solid $border-lighter;
  }

  // 手机端导航菜单 - 下划线风格
  .nav-menu {
    display: flex;
    gap: 0;
    padding: 0;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;

    // 隐藏横向滚动条
    &::-webkit-scrollbar {
      display: none;
    }
    -ms-overflow-style: none;
    scrollbar-width: none;

    .nav-item {
      flex-shrink: 0;
      margin: 0;
      padding: 12px 18px;
      border-radius: 0;
      background: transparent !important;
      position: relative;
      font-size: 14px;

      // 隐藏图标
      .el-icon {
        display: none;
      }

      // 底部下划线指示器
      &::after {
        content: "";
        position: absolute;
        top: auto;
        right: auto;
        left: 50%;
        bottom: 0;
        transform: translateX(-50%);
        width: 0;
        height: 2px;
        background: $primary-color;
        border-radius: 1px;
        transition: width 0.2s;
      }

      &:hover {
        transform: none;
        background: transparent !important;
      }

      &.active {
        color: $primary-color;
        background: transparent !important;

        &::after {
          width: 20px;
          height: 2px;
        }
      }
    }
  }

  // 手机端隐藏账号信息
  .account-info {
    display: none;
  }

  .section-header {
    padding: 16px 20px;
  }

  .section-body {
    padding: 20px;
  }

  .password-form {
    max-width: 100%;
  }

  .form-actions {
    flex-wrap: wrap;

    .el-button {
      flex: 1;
      min-width: 100px;
    }
  }
}
</style>
