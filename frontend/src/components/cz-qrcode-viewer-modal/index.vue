<template>
    <el-dialog
        v-model="visible"
        width="320"
        destroy-on-close
        align-center
        :show-close="false"
        class="cz-qrcode-viewer-modal"
    >
        <div class="qrcode-card">
            <div class="qrcode-card__header">
                <span>{{ title }}</span>
                <el-icon class="close-btn" @click="visible = false"><Close /></el-icon>
            </div>
            <div class="qrcode-card__body">
                <CzQrcode :value="qrcodeValue" :size="180" />
            </div>
            <div class="qrcode-card__footer">
                <div v-if="label" class="label-row">{{ label }}</div>
                <div class="copy-row">
                    <span class="copy-text">{{ copyValue }}</span>
                    <el-icon class="copy-btn" @click="handleCopy"><DocumentCopy /></el-icon>
                </div>
            </div>
        </div>
    </el-dialog>
</template>

<script setup>
import { ref } from 'vue'
import CzQrcode from '@/components/cz-qrcode/index.vue'
import { copyText } from '@/utils/public'

defineProps({
    title: { type: String, default: '扫码' }
})

const visible = ref(false)
const qrcodeValue = ref('')
const label = ref('')
const copyValue = ref('')

/**
 * 打开弹框
 * @param {Object} options
 * @param {string} options.value - 二维码内容（必填）
 * @param {string} options.label - 底部显示的文字（可选，默认等于 value）
 * @param {string} options.copyValue - 复制的内容（可选，默认等于 value）
 */
const open = (options) => {
    const { value, label: labelText, copyValue: copyVal } = typeof options === 'string' 
        ? { value: options } 
        : options
    
    qrcodeValue.value = value || ''
    label.value = labelText || ''
    copyValue.value = copyVal || value || ''
    visible.value = true
}

const close = () => {
    visible.value = false
}

const handleCopy = () => copyText(copyValue.value)

defineExpose({ open, close })
</script>

<style lang="scss">
.cz-qrcode-viewer-modal {
    .el-dialog__header { display: none; }
    .el-dialog__body { padding: 0; }
}
</style>

<style lang="scss" scoped>
.qrcode-card {
    background: #fff;

    &__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid #f0f0f0;
        font-size: 15px;
        font-weight: 500;
        color: #303133;

        .close-btn {
            font-size: 18px;
            color: #909399;
            cursor: pointer;
            transition: color 0.2s;
            &:hover { color: #303133; }
        }
    }

    &__body {
        display: flex;
        justify-content: center;
        padding: 16px 12px 12px;
    }

    &__footer {
        padding: 0 12px 12px;

        .label-row {
            text-align: center;
            font-size: 14px;
            font-weight: 500;
            color: #303133;
            margin-bottom: 8px;
        }

        .copy-row {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 8px 12px;
            background: #f5f7fa;
            border-radius: 6px;

            .copy-text {
                max-width: 100%;
                font-size: 14px;
                font-weight: 500;
                color: #595959;
                letter-spacing: 0.5px;
                font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .copy-btn {
                flex-shrink: 0;
                margin-left: 8px;
                font-size: 15px;
                color: #909399;
                cursor: pointer;
                transition: color 0.2s;
                &:hover { color: $primary-color; }
            }
        }
    }
}
</style>

