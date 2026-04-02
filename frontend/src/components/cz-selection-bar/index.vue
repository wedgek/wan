<template>
    <div v-if="count > 0" class="cz-selection-bar">
        <el-icon>
            <component :is="$iconfont.Check" />
        </el-icon>
        <!-- <el-icon><Select /></el-icon> -->
        已选择 {{ count }} 项
        <span class="divider"></span>
        <el-button type="primary" link @click="$emit('clear')">清空</el-button>
    </div>
</template>

<script setup>

defineProps({
    count: { type: Number, default: 0 }
})

defineEmits(['clear'])
</script>

<style lang="scss" scoped>
.cz-selection-bar {
    display: flex;
    align-items: center;
    padding: 0 12px;
    height: 32px;
    font-size: 13px;
    color: $text-regular;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 4px;
    
    .el-icon {
        color: $primary-color;
        font-size: 14px;
        margin-right: 8px;
        font-weight: bold;
    }
    
    .divider {
        width: 1px;
        height: 14px;
        background: $border-color;
        margin: 0 8px;
    }
}
</style>

<!-- 
 * ===========================================
 * CzSelectionBar 选中状态栏组件 - 使用示例
 * ===========================================
 * import CzSelectionBar from '@/components/cz-selection-bar/index.vue'
 *
 * <CzSelectionBar :count="selectedIds.length" @clear="clearSelection" />
 * 
 -->

