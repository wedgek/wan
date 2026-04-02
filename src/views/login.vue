<template>
  <section class="login-page">
    <!-- 左侧插画区域 -->
    <div class="login-illustration">
      <div class="logo-text">
        <img src="@/assets/images/logo.png" alt="企微管理平台">
        <span>企微管理平台</span>
      </div>
      <div class="illustration-content">
        <!-- 可视化面板 -->
        <div class="data-panel panel-1">
          <div class="chart-bar"></div>
        </div>
        <div class="data-panel panel-2">
          <div class="chart-line"></div>
        </div>
        <div class="data-panel panel-3">
          <div class="chart-bars"></div>
        </div>
        <div class="data-panel panel-4">
          <div class="chart-donut"></div>
        </div>
        <div class="data-panel panel-5">
          <div class="chart-donut-small"></div>
        </div>
        <!-- 圆形平台 -->
        <div class="circular-platform"></div>
        <!-- 装饰元素 -->
        <div class="decorative-element element-1"></div>
        <div class="decorative-element element-2"></div>
        <div class="decorative-element element-3"></div>
      </div>
    </div>

    <!-- 登录表单 -->
    <div class="login-form-wrapper">
      <div class="login-form">
        <div class="title-block">
          <h1 class="login-title">欢迎登录</h1>
          <!-- <h2 class="login-subtitle">企微管理平台</h2> -->
          <h2 class="login-subtitle">使用管理员分配的账号登录</h2>
        </div>

        <div class="form-block">
          <form @submit.prevent="handleLogin">
            <div class="form-group">
              <label class="form-label">
                <el-icon class="label-icon"><User /></el-icon>
                用户名
              </label>
              <el-input 
                v-model="loginForm.username" 
                placeholder="请输入用户名" 
                size="large" 
                clearable
                clear-icon="Close"
                class="custom-input"
              />
            </div>

            <div class="form-group">
              <label class="form-label">
                <el-icon class="label-icon"><Lock /></el-icon>
                密码
              </label>
              <el-input 
                v-model="loginForm.password" 
                type="password" 
                placeholder="请输入登录密码" 
                size="large" 
                show-password 
                clearable
                clear-icon="Close"
                class="custom-input"
              />
            </div>

            <div class="form-group">
              <label class="form-label">
                <el-icon class="label-icon"><Finished /></el-icon>
                验证码
              </label>
              <el-input 
                v-model="loginForm.dynamicCode" 
                placeholder="请输入验证码" 
                size="large" 
                clearable
                clear-icon="Close"
                class="custom-input"
              />
            </div>

            <div class="form-options">
              <el-checkbox v-model="rememberPassword">记住密码</el-checkbox>
              <a href="#" class="forgot-password">忘记密码？</a>
            </div>

            <el-button 
              type="primary" 
              class="login-btn" 
              native-type="submit" 
              size="large" 
              :loading="loading"
            >
              <span>登录</span>
            </el-button>
          </form>
        </div>

        <div class="bottom-block">
          <hr class="divider" />

          <p class="register-text">
            没有账户？<a href="#" class="register-link">注册</a>
          </p>

          <p class="copyright">&copy; 2026 赤子网络 - All Rights Reserved</p>
        </div>
      </div>

    </div>
  </section>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import router, { addDynamicRoutes } from "@/router"
import { useAuthStore } from '@/stores/auth.js'
import { useMenuStore } from '@/stores/menu.js'
import { ElMessage } from 'element-plus'
import { getStorage, setStorage, removeStorage } from '@/utils/storage.js'
import { getTimeGreeting } from '@/utils/time.js'

const authStore = useAuthStore()
const menuStore = useMenuStore()

const loading = ref(false)
const rememberPassword = ref(false)

const loginForm = reactive({
  username: '',
  password: '',
  dynamicCode: ''
})

// 从本地存储读取记住的密码
onMounted(() => {
  const savedUsername = getStorage('saved_username')
  const savedPassword = getStorage('saved_password')
  const savedRemember = getStorage('remember_password')
  
  if (savedRemember === 'true' && savedUsername && savedPassword) {
    loginForm.username = savedUsername
    loginForm.password = savedPassword
    rememberPassword.value = true
  }
})

// 校验登录表单函数
const validateLoginForm = () => {
  if (!loginForm.username) {
    ElMessage.error('请输入用户名')
    return false
  }
  if (!loginForm.password) {
    ElMessage.error('请输入密码')
    return false
  }
  if (!loginForm.dynamicCode) {
    ElMessage.error('请输入验证码')
    return false
  }
  if (loginForm.password.length < 6) {
    ElMessage.error('密码长度不能小于6位')
    return false
  }
  return true
}

const handleLogin = async () => {
  // 表单校验
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
    
    // 获取用户信息
    await authStore.getUserInfo()
    
    // 强制注册动态路由，确保切换账号时路由正确更新
    if (menuStore.menus?.length) {
      addDynamicRoutes(menuStore.menus, { force: true })
    }
    
    ElMessage.success(getTimeGreeting(authStore.user?.nickname))
    router.replace("/home")
  } catch (error) {
    console.log("🚀 ~ handleLogin ~ error:", error)
    ElMessage.error(error.message || '登录失败')
  } finally {
    loading.value = false
  }
}

</script>

<style scoped lang="scss">
.login-page {
  display: flex;
  height: 100vh;
  overflow: hidden;

  // 左侧插画区域
  .login-illustration {
    display: none;
    position: relative;
    flex: 1.4;
    background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 50%, #90caf9 100%);
    overflow: hidden;

    @media (min-width: 1024px) {
      display: block;
    }

    .logo-text {
      position: absolute;
      top: 40px;
      left: 40px;
      font-size: 18px;
      font-weight: bold;
      color: #000;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 15px;
      img{
        height: 30px;
      }
    }

    .illustration-content {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    // 数据面板
    .data-panel {
      position: absolute;
      background: rgba(255, 255, 255, 0.9);
      border-radius: 8px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      padding: 20px;
      z-index: 2;
      animation: ani-float 6s ease-in-out infinite;
    }

    .panel-1 {
      width: 180px;
      height: 120px;
      top: 20%;
      left: 15%;
      animation-delay: 0s;
    }

    .panel-2 {
      width: 160px;
      height: 100px;
      top: 15%;
      right: 20%;
      animation-delay: 1s;
    }

    .panel-3 {
      width: 140px;
      height: 140px;
      bottom: 35%;
      left: 10%;
      animation-delay: 2s;
    }

    .panel-4 {
      width: 120px;
      height: 120px;
      bottom: 25%;
      left: 25%;
      animation-delay: 1.5s;
    }

    .panel-5 {
      width: 100px;
      height: 100px;
      bottom: 20%;
      right: 15%;
      animation-delay: 2.5s;
    }

    // 图表样式
    .chart-bar {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      gap: 8px;
      
      &::before,
      &::after {
        content: '';
        background: #64b5f6;
        border-radius: 2px;
      }
      
      &::before {
        width: 20%;
        height: 60%;
      }
      
      &::after {
        width: 20%;
        height: 80%;
      }
    }

    .chart-line {
      width: 100%;
      height: 100%;
      position: relative;
      background: linear-gradient(to top, 
        transparent 0%, 
        transparent 30%,
        #64b5f6 30%,
        #64b5f6 35%,
        transparent 35%,
        transparent 50%,
        #64b5f6 50%,
        #64b5f6 65%,
        transparent 65%,
        transparent 80%,
        #64b5f6 80%,
        #64b5f6 100%
      );
      border-radius: 4px;
    }

    .chart-bars {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      gap: 6px;
      
      &::before,
      &::after {
        content: '';
        background: #64b5f6;
        border-radius: 2px;
      }
      
      &::before {
        width: 25%;
        height: 40%;
      }
      
      &::after {
        width: 25%;
        height: 70%;
      }
    }

    .chart-donut {
      width: 100%;
      height: 100%;
      position: relative;
      border-radius: 50%;
      background: conic-gradient(
        #64b5f6 0deg 120deg,
        #90caf9 120deg 240deg,
        #bbdefb 240deg 360deg
      );
      mask: radial-gradient(circle at center, transparent 40%, black 40%);
    }

    .chart-donut-small {
      width: 100%;
      height: 100%;
      position: relative;
      border-radius: 50%;
      background: conic-gradient(
        #90caf9 0deg 180deg,
        #bbdefb 180deg 360deg
      );
      mask: radial-gradient(circle at center, transparent 35%, black 35%);
    }

    // 圆形平台
    .circular-platform {
      position: absolute;
      bottom: 15%;
      left: 50%;
      transform: translateX(-50%);
      width: 300px;
      height: 300px;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.8) 100%);
      border-radius: 50%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      z-index: 1;
      
      &::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 250px;
        height: 250px;
        background: radial-gradient(circle, rgba(187, 222, 251, 0.3) 0%, transparent 70%);
        border-radius: 50%;
      }
    }

    // 装饰元素
    .decorative-element {
      position: absolute;
      background: rgba(144, 202, 249, 0.3);
      border-radius: 50%;
      backdrop-filter: blur(5px);
    }

    .element-1 {
      width: 200px;
      height: 200px;
      top: 10%;
      right: 10%;
      border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%;
      animation: ani-float 8s ease-in-out infinite;
    }

    .element-2 {
      width: 150px;
      height: 150px;
      bottom: 10%;
      right: 20%;
      border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
      animation: ani-float 7s ease-in-out infinite reverse;
    }

    .element-3 {
      width: 100px;
      height: 100px;
      top: 50%;
      left: 5%;
      border-radius: 40% 60% 60% 40% / 60% 30% 70% 40%;
      animation: ani-float 9s ease-in-out infinite;
    }

  }

  // 右侧登录表单
  .login-form-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #ffffff;
    padding: 0 3rem;
    min-width: 0;

    .login-form {
      width: 100%;
      max-width: 420px;
      animation: ani-fade-up 0.6s ease-out;

      .login-title {
        font-size: 32px;
        font-weight: 700;
        color: #000;
        margin-bottom: 12px;
        line-height: 1.2;
      }

      .login-subtitle {
        // font-size: 14px;
        // color: $text-secondary;
        font-size: 25px;
        color: $primary-color;
        margin-bottom: 40px;
        line-height: 1.5;
        cursor: pointer;
      }

      .form-group {
        margin-bottom: 24px;

        .form-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 500;
          color: #262626;
          margin-bottom: 8px;

          .label-icon {
            font-size: 16px;
            color: #1890ff;
          }
        }

        .custom-input {
          :deep(.el-input__wrapper) {
            border-radius: 4px;
            box-shadow: 0 0 0 1px #d9d9d9 inset;

            &:hover {
              box-shadow: 0 0 0 1px #40a9ff inset;
            }

            &.is-focus {
              box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2) inset, 0 0 0 1px #1890ff inset;
            }
          }
        }
      }

      .form-options {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;

        .forgot-password {
          font-size: 14px;
          color: #8c8c8c;
          text-decoration: none;
          transition: color 0.3s;

          &:hover {
            color: #1890ff;
          }
        }
      }

      .login-btn {
        width: 100%;
        height: 40px;
        font-size: 16px;
        font-weight: 500;
        border-radius: 4px;
        background: #1890ff;
        transition: all 0.3s ease;

        span {
          display: inline-block;
          position: relative;
          transition: padding 0.3s ease;

          &::after {
            content: '»';
            position: absolute;
            top: 0;
            right: -15px;
            opacity: 0;
            transition: all 0.3s ease;
          }
        }

        &:hover {
          background: #40a9ff;
          border-color: #40a9ff;
          span {
            padding-right: 18px;

            &::after {
              opacity: 1;
              right: 0;
            }
          }
        }
        &:active {
          background: #096dd9;
          border-color: #096dd9;
        }
      }
      .divider {
        margin: 2rem 0;
        border: none;
        border-top: 1px solid #ddd;
      }

      .register-text {
        text-align: center;
        margin-bottom: 2rem;
        color: #6b7280;

        .register-link {
          color: #1890ff;
          font-weight: 600;
          text-decoration: none;
          &:hover {
            text-decoration: underline;
          }
        }
      }

      .copyright {
        text-align: center;
        font-size: 0.8125rem;
        color: #9ca3af;
      }

      .title-block {
        opacity: 0;
        transform: translateY(20px);
        animation: ani-fade-up-spring 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55) forwards;
        animation-delay: 0.05s;
      }

      .form-block {
        opacity: 0;
        transform: translateY(20px);
        animation: ani-fade-up-spring 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55) forwards;
        animation-delay: 0.2s;
      }

      .bottom-block {
        opacity: 0;
        transform: translateY(20px);
        animation: ani-fade-up-spring 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55) forwards;
        animation-delay: 0.35s;
      }
    }
  }
}
</style>
