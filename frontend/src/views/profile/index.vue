<template>
  <div class="page-container profile-page">
    <div class="profile-layout">
      <!-- 左侧：用户与导航 -->
      <aside class="profile-panel profile-panel--aside">
          <div class="user-card__hero">
            <button type="button" class="avatar-trigger" @click="avatarDialogVisible = true">
              <el-avatar :size="64" :src="userAvatar" class="avatar-trigger__img">
                <el-icon :size="28"><UserFilled /></el-icon>
              </el-avatar>
              <span class="avatar-trigger__edit">
                <el-icon><Camera /></el-icon>
                <span>更换头像</span>
              </span>
            </button>
            <h1 class="user-card__name">{{ nickname }}</h1>
            <div v-if="roleNames.length" class="user-card__roles">
              <span v-for="r in roleNames" :key="r" class="role-pill">{{ r }}</span>
            </div>
          </div>

          <div class="profile-panel__body">
            <ul class="profile-nav">
              <li
                v-for="item in menuList"
                :key="item.key"
                :class="['profile-nav__item', { 'is-active': activeTab === item.key }]"
                @click="activeTab = item.key"
              >
                <span class="profile-nav__icon">
                  <el-icon><component :is="item.icon" /></el-icon>
                </span>
                <span class="profile-nav__label">{{ item.label }}</span>
                <el-icon class="profile-nav__arrow"><ArrowRight /></el-icon>
              </li>
            </ul>
          </div>

          <div class="user-meta">
            <div class="user-meta__row">
              <span class="user-meta__label">登录账号</span>
              <span class="user-meta__value">{{ accountName }}</span>
            </div>
            <div class="user-meta__row">
              <span class="user-meta__label">所属部门</span>
              <span class="user-meta__value">{{ deptDisplay }}</span>
            </div>
          </div>
      </aside>

      <!-- 右侧：设置内容 -->
      <main class="profile-panel profile-panel--main">
        <header class="profile-panel__header">
          <div>
            <h2 class="profile-panel__title">{{ activeMenuLabel }}</h2>
            <p class="profile-panel__desc">{{ activeMenuDesc }}</p>
          </div>
        </header>

        <div class="profile-panel__body profile-panel__body--main">
          <section v-show="activeTab === 'security'" class="profile-section">
            <div class="security-tip">
              <el-icon class="security-tip__icon"><InfoFilled /></el-icon>
              <div>
                <p class="security-tip__title">账号安全提示</p>
                <p class="security-tip__text">建议定期更换密码；修改成功后将退出登录，请使用新密码重新进入系统。</p>
              </div>
            </div>

            <div class="setting-card">
              <div class="setting-card__head">
                <span class="setting-card__icon">
                  <el-icon><Lock /></el-icon>
                </span>
                <div>
                  <h3 class="setting-card__title">登录密码</h3>
                  <p class="setting-card__subtitle">密码长度 6–18 位，请勿与旧密码相同</p>
                </div>
              </div>

              <el-form
                :model="pwdForm"
                label-width="90px"
                label-position="right"
                class="pwd-form"
                @submit.prevent
              >
                <el-form-item label="新密码" v-required-dot>
                  <el-input
                    v-model="pwdForm.newPassword"
                    type="password"
                    show-password
                    placeholder="请输入新密码（6-18位）"
                    clearable
                    clear-icon="Close"
                  />
                </el-form-item>
                <el-form-item label="确认密码" v-required-dot>
                  <el-input
                    v-model="pwdForm.confirmPassword"
                    type="password"
                    show-password
                    placeholder="请再次输入新密码"
                    clearable
                    clear-icon="Close"
                  />
                </el-form-item>
                <el-form-item label=" " class="pwd-form__actions-item">
                  <div class="pwd-form__actions">
                    <el-button type="primary" :loading="pwdSubmitting" @click="submitPassword">
                      保存修改
                    </el-button>
                    <el-button @click="resetPasswordForm">重置</el-button>
                  </div>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section v-show="activeTab === 'profile'" class="profile-section">
            <div class="empty-panel">
              <el-empty description="个人信息设置即将开放" :image-size="140" />
            </div>
          </section>

          <section v-show="activeTab === 'notification'" class="profile-section">
            <div class="empty-panel">
              <el-empty description="通知偏好设置即将开放" :image-size="140" />
            </div>
          </section>
        </div>
      </main>
    </div>

    <CzImageCropperModal
      v-model="avatarDialogVisible"
      title="更换头像"
      @success="handleUploadSuccess"
      :aspectRatio="1"
    />
  </div>
</template>

<script setup>
import request from '@/request'
import { updateUserAvatarApi, getDepartmentApi } from '@/api/system'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import CzImageCropperModal from '@/components/cz-image-cropper-modal/index.vue'
import {
  Lock,
  User as UserIcon,
  Bell,
  UserFilled,
  Camera,
  ArrowRight,
  InfoFilled,
} from '@element-plus/icons-vue'

const authStore = useAuthStore()

const userInfo = computed(() => authStore.user || {})
const userAvatar = computed(() => authStore.user?.avatar || '')
const nickname = computed(() => authStore.user?.nickname || '未设置昵称')
const roleNames = computed(() => authStore.roleNames || [])
const accountName = computed(
  () => userInfo.value.username || userInfo.value.userName || '-',
)

const deptNameMap = ref({})
const deptDisplay = computed(() => {
  const id = Number(userInfo.value.deptId)
  if (id > 0 && deptNameMap.value[id]) return deptNameMap.value[id]
  return userInfo.value.deptName || '-'
})

const menuList = [
  { key: 'security', label: '安全设置', desc: '管理登录密码与账号安全', icon: Lock },
  { key: 'profile', label: '个人信息', desc: '查看和编辑个人资料', icon: UserIcon },
  { key: 'notification', label: '通知设置', desc: '管理消息与提醒偏好', icon: Bell },
]

const activeTab = ref('security')
const activeMenu = computed(() => menuList.find((m) => m.key === activeTab.value) || menuList[0])
const activeMenuLabel = computed(() => activeMenu.value.label)
const activeMenuDesc = computed(() => activeMenu.value.desc)

async function loadDeptNames() {
  try {
    const res = await getDepartmentApi()
    if (res?.code !== 0 || !Array.isArray(res.data)) return
    const map = {}
    for (const d of res.data) {
      if (d?.id != null) map[Number(d.id)] = d.name || ''
    }
    deptNameMap.value = map
  } catch {
    /* ignore */
  }
}

onMounted(() => {
  loadDeptNames()
})

const pwdSubmitting = ref(false)
const pwdForm = reactive({ newPassword: '', confirmPassword: '' })

const resetPasswordForm = () => {
  pwdForm.newPassword = ''
  pwdForm.confirmPassword = ''
}

const validateForm = () => {
  const { newPassword, confirmPassword } = pwdForm
  if (!newPassword?.trim()) {
    ElMessage.warning('新密码不能为空')
    return false
  }
  if (newPassword.length < 6 || newPassword.length > 18) {
    ElMessage.warning('密码长度为 6–18 位')
    return false
  }
  if (!confirmPassword?.trim()) {
    ElMessage.warning('请确认新密码')
    return false
  }
  if (newPassword !== confirmPassword) {
    ElMessage.warning('两次输入的密码不一致')
    return false
  }
  return true
}

const submitPassword = async () => {
  try {
    if (!validateForm()) return

    await ElMessageBox.confirm(
      '修改成功后将自动退出，需使用新密码重新登录。',
      '确认修改密码',
      { confirmButtonText: '确定修改', cancelButtonText: '取消', type: 'warning' },
    )

    pwdSubmitting.value = true
    const res = await request({
      url: '/admin-api/system/user/update-password',
      method: 'PUT',
      data: { id: userInfo.value.id, password: pwdForm.newPassword },
    })

    if (res.code === 0) {
      resetPasswordForm()
      await ElMessageBox.alert('密码已更新，请使用新密码重新登录。', '修改成功', {
        confirmButtonText: '去登录',
        showClose: false,
        type: 'success',
      })
      authStore.logout()
      return
    }
    ElMessage.error(res.msg || '修改失败')
  } catch {
    /* 用户取消 */
  } finally {
    pwdSubmitting.value = false
  }
}

const avatarDialogVisible = ref(false)

const handleUploadSuccess = async (url) => {
  if (!url) return
  try {
    const res = await updateUserAvatarApi(authStore.user.id, url)
    if (res.code === 0) {
      ElMessage.success('头像已更新')
      authStore.getUserInfo()
    } else {
      ElMessage.error(res.msg || '保存头像失败')
    }
  } catch {
    ElMessage.error('系统错误')
  }
}
</script>

<style lang="scss" scoped>
.profile-layout {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  align-items: stretch;
  gap: 16px;
  box-sizing: border-box;
}

.profile-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--app-border);
  border-radius: $border-radius-lg;
  overflow: hidden;
}

.profile-panel--aside {
  width: 260px;
  flex-shrink: 0;
}

.profile-panel--main {
  flex: 1;
  min-width: 0;
}

.profile-panel__header {
  flex-shrink: 0;
  padding: 16px 20px;
  border-bottom: 1px solid var(--app-border);
}

.profile-panel__title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text);
}

.profile-panel__desc {
  margin: 0;
  font-size: 13px;
  color: var(--app-muted);
  line-height: 1.5;
}

.profile-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.profile-panel__body--main {
  padding: 20px;
}

.user-card__hero {
  flex-shrink: 0;
  padding: 24px 20px 20px;
  text-align: center;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, $primary-color 8%, var(--el-bg-color-overlay)) 0%,
    var(--el-bg-color-overlay) 55%
  );
  border-bottom: 1px solid var(--app-border);
}

.avatar-trigger {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 0 auto 14px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;

  &__img {
    box-shadow: 0 4px 14px rgba(64, 120, 252, 0.2);
    border: 3px solid var(--el-bg-color-overlay);
  }

  &__edit {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--el-color-primary);
    opacity: 0.85;
    transition: opacity 0.2s;
  }

  &:hover .avatar-trigger__edit {
    opacity: 1;
  }
}

.user-card__name {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1.35;
}

.user-card__roles {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.role-pill {
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  border-radius: 999px;
}

.profile-nav {
  list-style: none;
  margin: 0;
  padding: 10px 12px;
}

.profile-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: $border-radius-lg;
  font-size: 14px;
  color: var(--app-muted);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:last-child {
    margin-bottom: 0;
  }

  &:hover {
    color: var(--app-text);
    background: var(--el-fill-color-light);
  }

  &.is-active {
    color: var(--el-color-primary);
    background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
    font-weight: 500;

    .profile-nav__icon {
      background: var(--el-color-primary);
      color: #fff;
    }

    .profile-nav__arrow {
      opacity: 1;
      color: var(--el-color-primary);
    }
  }
}

.profile-nav__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: $border-radius-lg;
  background: var(--el-fill-color-light);
  font-size: 16px;
  flex-shrink: 0;
  transition: background 0.2s, color 0.2s;
}

.profile-nav__label {
  flex: 1;
  min-width: 0;
}

.profile-nav__arrow {
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.2s;
}

.user-meta {
  flex-shrink: 0;
  padding: 14px 16px 16px;
  border-top: 1px solid var(--app-border);
  background: var(--el-fill-color-lighter, #fafafa);
}

.user-meta__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-size: 13px;

  &:not(:last-child) {
    border-bottom: 1px dashed var(--app-border);
  }
}

.user-meta__label {
  color: var(--app-muted);
  flex-shrink: 0;
}

.user-meta__value {
  color: var(--app-text);
  font-weight: 500;
  text-align: right;
  word-break: break-all;
}

.profile-section {
  animation: profile-fade 0.25s ease;
}

@keyframes profile-fade {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.security-tip {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 16px;
  border-radius: $border-radius-lg;
  background: $primary-bg;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 12%, var(--app-border));

  &__icon {
    flex-shrink: 0;
    font-size: 20px;
    color: var(--el-color-primary);
    margin-top: 2px;
  }

  &__title {
    margin: 0 0 2px;
    font-size: 13px;
    font-weight: 500;
    color: var(--app-text);
  }

  &__text {
    margin: 0;
    font-size: 12px;
    color: var(--app-muted);
    line-height: 1.5;
  }
}

.setting-card {
  padding: 16px 16px 4px;
  border-radius: $border-radius-lg;
  border: 1px solid var(--app-border);
  background: var(--el-bg-color-overlay);

  &__head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--app-border);
  }

  &__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: $border-radius-lg;
    background: $primary-light;
    color: var(--el-color-primary);
    font-size: 16px;
    flex-shrink: 0;
  }

  &__title {
    margin: 0 0 2px;
    font-size: 14px;
    font-weight: 600;
    color: var(--app-text);
  }

  &__subtitle {
    margin: 0;
    font-size: 12px;
    color: var(--app-muted);
  }
}

.pwd-form {
  max-width: 480px;

  :deep(.el-form-item) {
    margin-bottom: 16px;
  }

  :deep(.el-form-item__label) {
    font-size: 14px;
    color: var(--app-text);
  }

  :deep(.el-input__wrapper) {
    border-radius: $border-radius;
  }

  &__actions-item {
    margin-bottom: 0;

    :deep(.el-form-item__label) {
      visibility: hidden;
    }
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;

    .el-button + .el-button {
      margin-left: 0;
    }
  }
}

.empty-panel {
  padding: 48px 0;
  display: flex;
  justify-content: center;
}

@media (max-width: 900px) {
  .profile-layout {
    flex-direction: column;
    gap: 12px;
  }

  .profile-panel--aside {
    width: 100%;
    flex: none;
  }

  .profile-panel--main {
    flex: 1;
    min-height: 320px;
  }

  .profile-nav {
    display: flex;
    gap: 4px;
    padding: 8px 12px 12px;
    overflow-x: auto;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .profile-nav__item {
    flex-shrink: 0;
    margin-bottom: 0;
    padding: 8px 14px;

    .profile-nav__arrow {
      display: none;
    }
  }

  .user-meta {
    display: none;
  }

  .user-card__hero {
    padding: 20px 16px 16px;
  }

  .profile-panel__header,
  .profile-panel__body--main {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
