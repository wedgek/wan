<template>
    <el-dialog
        v-model="visible"
        width="320"
        destroy-on-close
        align-center
        :show-close="false"
        class="cz-image-viewer-modal"
    >
        <div class="preview-card">
            <div class="preview-card__header">
                <span>{{ title }}</span>
                <el-icon class="close-btn" @click="visible = false"><Close /></el-icon>
            </div>
            <div class="preview-card__body">
                <!-- loading 状态 -->
                <div v-if="status === 'loading'" class="status-box">
                    <el-icon class="is-loading"><Loading /></el-icon>
                </div>
                <!-- error 状态 -->
                <div v-else-if="status === 'error'" class="status-box">
                    <el-icon class="error-icon"><PictureFilled /></el-icon>
                    <span class="error-text">图片加载失败</span>
                </div>
                <!-- 正常显示 -->
                <img 
                    v-show="status === 'success'" 
                    :src="imageUrl" 
                    @load="status = 'success'"
                    @error="status = 'error'"
                    @click="showFullPreview" 
                />
            </div>
            <div v-if="label" class="preview-card__footer">
                <span class="label">{{ label }}</span>
            </div>
        </div>
    </el-dialog>

    <!-- 全屏预览 -->
    <el-image-viewer 
        v-if="fullPreviewVisible" 
        :url-list="[imageUrl]" 
        @close="fullPreviewVisible = false"
        teleported
    />
</template>

<script setup>
import { Loading, PictureFilled, Close } from '@element-plus/icons-vue'

defineProps({
    title: { type: String, default: '图片预览' }
})

const visible = ref(false)
const imageUrl = ref('')
const label = ref('')
const fullPreviewVisible = ref(false)
const status = ref('loading') // loading | success | error

const open = (options) => {
    const { url, label: labelText } = typeof options === 'string' ? { url: options } : options
    status.value = 'loading' // 重置状态
    imageUrl.value = url || ''
    label.value = labelText || ''
    visible.value = true
}

const close = () => visible.value = false

const showFullPreview = () => fullPreviewVisible.value = true

defineExpose({ open, close })
</script>

<style lang="scss">
.cz-image-viewer-modal {
    .el-dialog__header { display: none; }
    .el-dialog__body { padding: 0; }
}
</style>

<style lang="scss" scoped>
.preview-card {
    background: #fff;
    border-radius: 8px;
    overflow: hidden;

    &__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        font-size: 14px;
        font-weight: 500;
        color: #303133;

        .close-btn {
            font-size: 18px;
            color: #909399;
            cursor: pointer;
            &:hover { color: #303133; }
        }
    }

    &__body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        min-height: 288px;
        
        img {
            max-width: 260px;
            max-height: 260px;
            cursor: zoom-in;
        }
        
        .status-box {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .is-loading {
            font-size: 28px;
            color: #c0c4cc;
            animation: spin 1s linear infinite;
        }
        
        .error-icon {
            font-size: 48px;
            color: #dcdfe6;
        }
        
        .error-text {
            font-size: 12px;
            color: #909399;
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    }

    &__footer {
        padding: 8px 12px 12px;
        text-align: center;

        .label {
            font-size: 12px;
            color: #909399;
            word-break: break-all;
        }
    }
}
</style>

