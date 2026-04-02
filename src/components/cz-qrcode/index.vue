<template>
    <div class="cz-qrcode" :style="{ width: size + 'px', height: size + 'px' }">
        <canvas ref="canvasRef"></canvas>
        <div v-if="loading" class="cz-qrcode__loading">
            <el-icon class="is-loading"><Loading /></el-icon>
        </div>
        <div v-if="error" class="cz-qrcode__error" @click="generate">
            <el-icon><WarningFilled /></el-icon>
            <span>点击重试</span>
        </div>
    </div>
</template>

<script setup>
import { shallowRef, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import QRCode from 'qrcode'
import { Loading, WarningFilled } from '@element-plus/icons-vue'

const props = defineProps({
    value: { type: String, required: true },
    size: { type: Number, default: 200 },
    color: { type: String, default: '#1a1a2e' },
    margin: { type: Number, default: 2 }
})

const canvasRef = shallowRef(null)
const loading = ref(false)
const error = ref(false)

let timer = null

const generate = async () => {
    if (!props.value || !canvasRef.value) return
    
    loading.value = true
    error.value = false
    
    try {
        await QRCode.toCanvas(canvasRef.value, props.value, {
            width: props.size,
            margin: props.margin,
            color: { dark: props.color, light: '#ffffff' },
            errorCorrectionLevel: 'M'
        })
    } catch (e) {
        error.value = true
    } finally {
        loading.value = false
    }
}

// 防抖生成
const debouncedGenerate = () => {
    clearTimeout(timer)
    timer = setTimeout(generate, 16)
}

watch(() => [props.value, props.size], debouncedGenerate)

onMounted(generate)
onBeforeUnmount(() => clearTimeout(timer))

defineExpose({ refresh: generate })
</script>

<style lang="scss" scoped>
.cz-qrcode {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    border-radius: 8px;

    canvas { display: block; }

    &__loading,
    &__error {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.95);
        gap: 6px;
        
        .el-icon { font-size: 28px; }
        span { font-size: 12px; }
    }

    &__loading .el-icon { color: $primary-color; }
    
    &__error {
        cursor: pointer;
        .el-icon, span { color: var(--el-color-danger); }
    }
}
</style>
