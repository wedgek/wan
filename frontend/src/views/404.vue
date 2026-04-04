<template>
  <div class="page-not-found">
    <img src="@/assets/images/404.svg" alt="404" class="error-image">
    
    <div class="content ani-fade-in">
      <p class="message">
        抱歉，您访问的页面不存在或已被移动。<br>
        请检查URL是否正确，或点击下方按钮返回工作台。
      </p>
      
      <el-button 
        type="primary" 
        size="large"
        @click="goToHome"
        :icon="House"
      >
        返回工作台
      </el-button>
    </div>
  </div>
</template>

<script setup>
import router from "@/router"
import { House } from '@element-plus/icons-vue'

const goToHome = () => {
  router.replace('/home')
}
</script>

<style lang="scss" scoped>
.page-not-found {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 24px 20px;
  width: 100%;
  background: #ffffff;
  animation: fadeIn 0.3s ease-out;
}

.error-image {
  display: block;
  width: min(92vw, 440px);
  max-height: min(46vh, 380px);
  height: auto;
  object-fit: contain;
  flex-shrink: 0;
  animation: ani-fade-up 0.4s ease-out 0.1s both;
}

.content {
  text-align: center;
  max-width: 600px;
  width: 100%;
  flex-shrink: 0;
}

.message {
  font-size: 16px;
  line-height: 1.8;
  color: $text-secondary;
  margin-bottom: 20px;
  animation: ani-fade-up 0.4s ease-out 0.3s both; 
}

.el-button {
  animation: ani-fade-up 0.4s ease-out 0.4s both; 
  transition: all 0.2s ease; 
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(64, 158, 255, 0.3);
  }
}

</style>