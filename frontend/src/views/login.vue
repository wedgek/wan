<template>
  <div class="login-frame">
    <section class="login-page">
    <header class="login-top">
      <div class="brand-row">
        <img src="@/assets/images/logo.svg" alt="万相AI中台" class="brand-logo" />
      </div>
      <div class="top-tools">
        <ThemeSwitch />
        <span class="login-tool-divider" aria-hidden="true" />
        <el-tooltip :content="isFullscreen ? '退出全屏' : '全屏'" placement="bottom" :show-after="300">
          <button
            type="button"
            class="login-tool-btn"
            :aria-label="isFullscreen ? '退出全屏' : '全屏'"
            @click="toggleFullscreen"
          >
            <el-icon><Notification /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </header>

    <main class="login-main">
      <div class="login-stack">
        <h1 class="headline-main">欢迎登录<span class="headline-brand">万相AI中台</span></h1>
        <p class="subhead">请使用管理员为您分配的账号与密码</p>

        <div class="section-label">
          <span class="section-label-line" />
          <span>使用账号密码登录</span>
          <span class="section-label-line" />
        </div>

        <form class="login-form" @submit.prevent="handleLogin">
          <div class="field">
            <el-input
              v-model="loginForm.username"
              size="large"
              placeholder="请输入用户名或账号"
              clearable
              clear-icon="Close"
              class="premium-input"
              autocomplete="username"
            >
              <template #prefix>
                <el-icon class="input-ico"><User /></el-icon>
              </template>
            </el-input>
          </div>

          <div class="field">
            <el-input
              v-model="loginForm.password"
              type="password"
              size="large"
              placeholder="请输入密码"
              show-password
              clearable
              clear-icon="Close"
              class="premium-input"
              autocomplete="current-password"
            >
              <template #prefix>
                <el-icon class="input-ico"><Lock /></el-icon>
              </template>
            </el-input>
          </div>

          <div class="form-row">
            <el-checkbox v-model="rememberPassword" class="remember-check">记住密码</el-checkbox>
            <a href="#" class="link-subtle" @click.prevent="onForgotPassword">忘记密码？</a>
          </div>

          <el-button
            type="primary"
            class="submit-premium"
            native-type="submit"
            size="large"
            :loading="loading"
          >
            登录
          </el-button>
        </form>

        <p class="extra-hint">
          没有账户？
          <a href="#" class="link-accent" @click.prevent="onRegister">申请开通</a>
        </p>
      </div>
    </main>

    <footer class="login-footer">
      <p class="copyright">&copy; {{ year }} wedgex · All rights reserved</p>
    </footer>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { Notification } from '@element-plus/icons-vue'
import ThemeSwitch from '@/components/theme-switch/index.vue'
import router, { addDynamicRoutes } from '@/router'
import { useAuthStore } from '@/stores/auth.js'
import { useMenuStore } from '@/stores/menu.js'
import { ElMessage } from 'element-plus'
import { getStorage, setStorage, removeStorage } from '@/utils/storage.js'
import { getTimeGreeting } from '@/utils/time.js'

const authStore = useAuthStore()
const menuStore = useMenuStore()

const year = computed(() => new Date().getFullYear())

const loading = ref(false)
const rememberPassword = ref(false)

const loginForm = reactive({
  username: '',
  password: '',
})

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
    ElMessage.warning('当前浏览器或环境不支持全屏')
  }
}

onMounted(() => {
  const savedUsername = getStorage('saved_username')
  const savedPassword = getStorage('saved_password')
  const savedRemember = getStorage('remember_password')

  if (savedRemember === 'true' && savedUsername && savedPassword) {
    loginForm.username = savedUsername
    loginForm.password = savedPassword
    rememberPassword.value = true
  }

  document.addEventListener('fullscreenchange', syncFullscreen)
  syncFullscreen()
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
})

const validateLoginForm = () => {
  if (!loginForm.username) {
    ElMessage.error('请输入用户名')
    return false
  }
  if (!loginForm.password) {
    ElMessage.error('请输入密码')
    return false
  }
  if (loginForm.password.length < 6) {
    ElMessage.error('密码长度不能小于6位')
    return false
  }
  return true
}

const handleLogin = async () => {
  if (!validateLoginForm()) return

  loading.value = true
  try {
    await authStore.login(loginForm)

    if (rememberPassword.value) {
      setStorage('saved_username', loginForm.username)
      setStorage('saved_password', loginForm.password)
      setStorage('remember_password', 'true')
    } else {
      removeStorage('saved_username')
      removeStorage('saved_password')
      removeStorage('remember_password')
    }

    await authStore.getUserInfo()

    if (menuStore.menus?.length) {
      addDynamicRoutes(menuStore.menus, { force: true })
    }

    ElMessage.success(getTimeGreeting(authStore.user?.nickname))
    router.replace('/home')
  } catch (error) {
    console.log('handleLogin error:', error)
    ElMessage.error(error.message || '登录失败')
  } finally {
    loading.value = false
  }
}

const onForgotPassword = () => {
  ElMessage.info('请联系管理员重置密码')
}

const onRegister = () => {
  ElMessage.info('注册功能暂未开放，请联系管理员开通账号')
}
</script>

<style scoped lang="scss">
@use '@/styles/variables.scss' as *;

// 外层留白 + 四周边框画框（参考 Lobe 整页线框）；与 inner 的 min-height 联动
$login-frame-gutter: 10px;

.login-frame {
  box-sizing: border-box;
  min-height: 100vh;
  padding: $login-frame-gutter;
  background: var(--login-frame-bg);
}

.login-page {
  box-sizing: border-box;
  min-height: calc(100vh - #{$login-frame-gutter * 2});
  display: flex;
  flex-direction: column;
  background: var(--login-page-bg);
  color: var(--login-text-secondary);
  border: 1px solid var(--login-page-border);
  border-radius: 10px;
  overflow: hidden;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.login-top {
  flex-shrink: 0;
  padding: 16px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-row {
  display: inline-flex;
  align-items: center;
}

.brand-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.login-footer {
  flex-shrink: 0;
  padding: 8px 24px 22px;
  text-align: center;
}

.top-tools {
  display: flex;
  align-items: center;
  gap: 0;
  /* 与顶栏一致：默认灰、悬浮略深灰 + 浅底，不用主题色 */
  --theme-trigger-color: var(--app-muted);
  --theme-trigger-hover-bg: var(--nav-tool-hover-bg);
  --theme-trigger-hover-color: var(--nav-tool-icon-hover);
}

.login-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--theme-trigger-color, var(--app-muted));
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;

  .el-icon {
    font-size: 19px;
    color: inherit;
  }

  &:hover {
    background: var(--theme-trigger-hover-bg, var(--login-focus-ring));
    color: var(--theme-trigger-hover-color, var(--el-color-primary));
  }
}

.login-tool-divider {
  width: 1px;
  height: 14px;
  margin: 0 6px;
  flex-shrink: 0;
  align-self: center;
  background: var(--login-divider);
  opacity: 0.9;
}

.login-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 24px 32px;
}

.login-stack {
  width: 100%;
  max-width: 432px;
  font-family: $font-family;
  animation: stack-in 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.headline-main {
  --login-brand-font:
    'DingTalk JinBuTi',
    'PingFang SC',
    'Microsoft YaHei',
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-family: var(--login-brand-font);
  margin: 0 0 16px;
  font-size: clamp(24px, 4vw, 30px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.22;
  color: var(--login-text-primary);
}

.headline-brand {
  display: inline;
  color: var(--login-headline-brand);
}

.subhead {
  --login-brand-font:
    'PingFang SC',
    'Microsoft YaHei',
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-family: var(--login-brand-font);
  margin: 0 0 36px;
  font-size: 15px;
  font-weight: 400;
  color: var(--login-text-muted);
  line-height: 1.65;
  letter-spacing: 0.01em;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--login-text-faint);
  user-select: none;
}

.section-label-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--login-divider) 15%,
    var(--login-divider) 85%,
    transparent
  );
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.field {
  margin-bottom: 14px;
}

.input-ico {
  font-size: 18px;
  color: var(--login-icon-muted);
}

.premium-input {
  :deep(.el-input__wrapper) {
    border-radius: 14px;
    padding: 4px 16px;
    min-height: 52px;
    background: var(--login-input-bg);
    box-shadow: none;
    border: 1px solid var(--login-input-border);
    transition:
      border-color 0.2s,
      background 0.2s,
      box-shadow 0.2s;

    &:hover {
      background: var(--login-input-bg-hover);
      border-color: var(--login-input-border-hover);
    }

    &.is-focus {
      background: var(--login-input-bg-hover);
      border-color: var(--login-input-focus);
      box-shadow: 0 0 0 3px var(--login-focus-ring);
    }
  }

  :deep(.el-input__inner) {
    font-size: 15px;
    font-weight: 400;
    letter-spacing: 0.01em;
    color: var(--login-input-text);

    &::placeholder {
      color: var(--login-placeholder);
      font-weight: 400;
    }
  }
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 6px 0 22px;
  gap: 12px;
}

.remember-check {
  :deep(.el-checkbox__label) {
    font-size: 13px;
    color: var(--login-check-label);
  }

  :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
    background-color: var(--login-check-checked);
    border-color: var(--login-check-checked);
  }
}

.link-subtle {
  font-size: 13px;
  color: var(--login-text-muted);
  text-decoration: none;
  transition: color 0.2s;

  &:hover {
    color: var(--login-link-accent);
  }
}

.submit-premium {
  width: 100%;
  height: 50px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.015em;
  font-family: $font-family;
  border-radius: 14px;
  border: none;
  background: var(--login-submit-bg) !important;
  color: var(--login-submit-color) !important;

  &:hover,
  &:focus {
    background: var(--login-submit-bg-hover) !important;
    color: var(--login-submit-color) !important;
  }

  &:active {
    background: var(--login-submit-bg-active) !important;
  }
}

.link-accent {
  color: var(--login-link-accent);
  text-decoration: none;
  font-weight: 500;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s;

  &:hover {
    border-bottom-color: var(--login-link-accent);
  }
}

.extra-hint {
  margin: 20px 0 0;
  text-align: center;
  font-size: 13px;
  font-weight: 400;
  color: var(--login-text-muted);
}

.copyright {
  --login-brand-font:
    'DingTalk JinBuTi',
    'PingFang SC',
    'Microsoft YaHei',
    ui-sans-serif,
    system-ui,
    sans-serif;
  font-family: var(--login-brand-font);
  margin: 0;
  font-size: 12px;
  font-weight: 400;
  color: var(--login-copyright);
  letter-spacing: 0.03em;
}

@keyframes stack-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 电脑端：整块略上移，大屏上不再「沉底」；标题略加大以匹配产品名 */
@media (min-width: 641px) {
  .login-main {
    padding: 16px 32px 48px;
    align-items: center;
    justify-content: center;
  }

  .login-stack {
    margin-top: min(-3vh, -24px);
  }

  .headline-main {
    font-size: clamp(28px, 2.4vw, 34px);
    margin-bottom: 14px;
  }

  .subhead {
    margin-bottom: 32px;
    font-size: 15px;
  }
}

/* 手机端：参考 Lobe 式层级 — 大标题偏上、副标略大、留白更松 */
@media (max-width: 640px) {
  .login-top {
    padding: 16px 18px;
  }

  .brand-logo {
    width: 34px;
    height: 34px;
  }

  .login-main {
    flex: 1;
    align-items: flex-start;
    justify-content: flex-start;
    padding: clamp(28px, 7vh, 48px) 20px 20px;
  }

  .login-stack {
    margin: 0 auto;
    width: 100%;
    max-width: 100%;
  }

  .headline-main {
    font-size: clamp(26px, 7.2vw, 30px);
    font-weight: 700;
    line-height: 1.22;
    letter-spacing: -0.028em;
    margin: 0 0 12px;
  }

  .subhead {
    font-size: 15px;
    font-weight: 400;
    line-height: 1.62;
    color: var(--login-text-muted);
    margin: 0 0 32px;
  }

  .section-label {
    margin-bottom: 20px;
    font-size: 12px;
    gap: 12px;
  }

  .field {
    margin-bottom: 12px;
  }

  .premium-input {
    :deep(.el-input__wrapper) {
      min-height: 50px;
    }

    :deep(.el-input__inner) {
      font-size: 16px;
    }
  }

  .form-row {
    margin: 4px 0 20px;
  }

  .submit-premium {
    height: 48px;
    font-size: 16px;
  }

  .extra-hint {
    margin-top: 24px;
    font-size: 14px;
  }

  .login-footer {
    padding: 16px 16px max(20px, env(safe-area-inset-bottom, 0px));
  }
}
</style>
