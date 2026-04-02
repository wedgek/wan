<template>
  <el-popover
    placement="bottom"
    :width="240"
    trigger="hover"
    :show-arrow="false"
    :offset="10"
    popper-class="cz-apk-popover"
    @show="loadLatest"
  >
    <template #reference>
      <slot />
    </template>
    
    <!-- 最新版卡片 -->
    <div class="latest-card" v-loading="latestLoading">
      <template v-if="latest">
        <div class="latest-header">
          <el-icon class="latest-icon"><Iphone /></el-icon>
          <span class="latest-version">{{ latest.version }}</span>
          <el-icon 
            class="refresh-btn" 
            :class="{ 'is-loading': refreshing }" 
            @click.stop="handleRefresh"
          >
            <Refresh />
          </el-icon>
        </div>
        
        <div class="latest-qrcode">
          <CzQrcode :value="latest.downloadUrl || ''" :size="140" />
        </div>
        
        <div class="latest-actions">
          <el-button type="primary" size="small" :icon="Download" @click="handleDownload(latest)">
            下载安装包
          </el-button>
        </div>
        
        <div class="latest-more"  @click="openHistory">
          更多版本
          <el-icon><ArrowRight /></el-icon>
        </div>
      </template>
      
      <div v-else-if="!latestLoading" class="latest-empty">
        <el-icon :size="36" color="#dcdfe6"><Box /></el-icon>
        <span>无可用APK</span>
      </div>
    </div>
  </el-popover>

  <!-- 完整历史列表 -->
  <el-dialog
    v-model="historyVisible"
    title="版本历史"
    width="600"
    destroy-on-close
    align-center
    class="cz-apk-history-modal"
  >
    <!-- 搜索栏 -->
    <div class="history-search">
      <el-input
        v-model="tableParams.version"
        placeholder="搜索版本号"
        clearable
        clear-icon="Close"
        :prefix-icon="Search"
        @keyup.enter="handleSearch"
        @clear="handleSearch"
      />
    </div>

    <div class="history-list-wrapper" v-loading="tableLoading">
      <div v-if="tableData.length === 0 && !tableLoading" class="history-empty">
        <el-icon :size="48" color="#dcdfe6"><Box /></el-icon>
        <span>暂无版本记录</span>
      </div>
      <div v-else class="history-list">
        <div 
          v-for="item in tableData" 
          :key="item.id" 
          class="history-item"
        >
          <div class="history-info">
            <el-icon class="info-icon"><Box /></el-icon>
            <span class="info-version">{{ item.version }}</span>
            <span class="info-time">{{ item.createTime?.slice(0, 10) }}</span>
          </div>
          <div class="history-actions">
            <span class="action-link" @click="handleQrcode(item)">
              <el-icon><Iphone /></el-icon>二维码
            </span>
            <span class="action-link primary" @click="handleDownload(item)">
              <el-icon><Download /></el-icon>下载
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页器 -->
    <div class="history-footer">
      <CzPagination 
        :total="tableTotal" 
        v-model:pageNo="tableParams.pageNo" 
        v-model:pageSize="tableParams.pageSize" 
        @change="getTableData"
        layout="total, prev, pager, next"
      />
    </div>
  </el-dialog>

  <!-- 二维码弹框 -->
  <CzQrcodeViewerModal ref="qrcodeRef" title="扫码下载" />
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Iphone, ArrowRight, Refresh, Box, Search } from '@element-plus/icons-vue'
import { useTable } from '@/hooks/useTable'
import CzQrcode from '@/components/cz-qrcode/index.vue'
import CzQrcodeViewerModal from '@/components/cz-qrcode-viewer-modal/index.vue'
import CzPagination from '@/components/cz-pagination/index.vue'
import request from '@/request'

// ========== 最新版本（Popover） ==========
const latest = ref(null)
const latestLoading = ref(false)
const latestLoaded = ref(false)
const refreshing = ref(false)

const loadLatest = async () => {
  if (latestLoaded.value) return
  latestLoading.value = true
  try {
    const res = await request({
      url: '/admin-api/qiwei/app-sdk/page',
      method: 'GET',
      params: { pageNo: 1, pageSize: 1 }
    })
    if (res.code === 0 && res.data?.list?.length) {
      latest.value = res.data.list[0]
      latestLoaded.value = true
    }
  } finally {
    latestLoading.value = false
  }
}

// 手动刷新
const handleRefresh = async () => {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const res = await request({
      url: '/admin-api/qiwei/app-sdk/page',
      method: 'GET',
      params: { pageNo: 1, pageSize: 1 }
    })
    if (res.code === 0 && res.data?.list?.length) {
      latest.value = res.data.list[0]
      ElMessage.success('已获取最新版本')
    }
  } catch {
    ElMessage.error('刷新失败')
  } finally {
    refreshing.value = false
  }
}

// ========== 历史版本（Dialog） ==========
const historyVisible = ref(false)
const qrcodeRef = ref(null)

const defaultTableParams = () => ({
  version: '',
  pageNo: 1,
  pageSize: 10
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch } = 
  useTable('/admin-api/qiwei/app-sdk/page', defaultTableParams)

const openHistory = () => {
  historyVisible.value = true
  tableParams.version = ''
  tableParams.pageNo = 1
  getTableData()
}

const handleSearch = () => {
  tableSearch()
}

// ========== 通用操作 ==========
const handleDownload = (item) => {
  if (item?.downloadUrl) {
    window.open(item.downloadUrl, '_blank')
  } else {
    ElMessage('下载链接不存在')
  }
}

const handleQrcode = (item) => {
  qrcodeRef.value?.open({
    value: item.downloadUrl,
    label: item.version,
    copyValue: item.downloadUrl
  })
}
</script>

<style lang="scss">
// Popover 样式
.cz-apk-popover {
  padding: 0 !important;
  border-radius: 12px !important;
  border: 1px solid rgba(0, 0, 0, 0.04) !important;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12) !important;
  overflow: hidden;
}

// Dialog 样式
.cz-apk-history-modal {
  .el-dialog {
    border-radius: 12px;
  }
  .el-dialog__header {
    padding: 16px 20px;
    margin: 0;
    
    .el-dialog__title {
      font-size: 16px;
      font-weight: 600;
      color: #303133;
    }
  }
  .el-dialog__body {
    padding: 0;
  }
}
</style>

<style lang="scss" scoped>
.latest-card {
  padding: 18px 14px 12px 14px;
  min-height: 250px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.latest-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;

  .latest-icon {
    font-size: 18px;
    color: $primary-color;
  }

  .latest-version {
    font-size: 16px;
    font-weight: 600;
    color: #303133;
  }

  .refresh-btn {
    color: $primary-color;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    &.is-loading {
      animation: spin 1s linear infinite;
    }
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.latest-qrcode {
  padding: 8px;
  background: #f5f7fa;
  border-radius: 8px;
  margin-bottom: 10px;
}

.latest-actions {
  margin-bottom: 12px;
  
  .el-button {
    width: 160px;
  }
}

.latest-more {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: $primary-color;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;

  &:hover {
    background: var(--el-color-primary-light-9);
  }

  .el-icon {
    font-size: 12px;
  }
}

.latest-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 220px;
  gap: 10px;

  span {
    font-size: 12px;
    color: #909399;
  }
}

// ========== 历史列表 ==========
.history-search {
  padding: 12px 16px;

  .el-input {
    :deep(.el-input__wrapper) {
      background: #f5f7fa;
      box-shadow: none;
      
      &:hover, &.is-focus {
        background: #fff;
        box-shadow: 0 0 0 1px $primary-color inset;
      }
    }
  }
}

.history-list-wrapper {
  min-height: 340px;
  max-height: 450px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: #e4e7ed;
    border-radius: 3px;
    &:hover {
      background: #c0c4cc;
    }
  }
}

.history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 340px;
  gap: 16px;
  color: #909399;
  font-size: 14px;
}

.history-list {
  display: flex;
  flex-direction: column;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid #f5f5f5;
  transition: background 0.2s;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: #fafbfc;
  }

  .history-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
    margin-right: 16px;

    .info-icon {
      font-size: 16px;
      color: $primary-color;
      flex-shrink: 0;
    }

    .info-version {
      font-size: 14px;
      font-weight: 600;
      color: #303133;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .info-time {
      font-size: 12px;
      color: #909399;
      flex-shrink: 0;
    }
  }

  .history-actions {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;

    .action-link {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 13px;
      color: $primary-color;
      cursor: pointer;
      transition: opacity 0.2s;

      .el-icon {
        font-size: 14px;
      }

      &:hover {
        opacity: 0.7;
      }
    }
  }
}

.history-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 12px 16px 0 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
