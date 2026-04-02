<template>
    <div class="cz-card-select" :class="[`cz-card-select--${size}`]">
        <div 
            v-for="item in options"
            :key="item.value"
            class="cz-card-select-item"
            :class="{ active: modelValue === item.value }"
            @click="handleSelect(item.value)"
        >
            <el-icon v-if="item.icon" :size="computedIconSize">
                <component :is="item.icon" />
            </el-icon>
            <span>{{ item.label }}</span>
        </div>
    </div>
</template>

<script setup name="CzCardSelect">
defineOptions({ name: 'CzCardSelect' })

const props = defineProps({
    modelValue: {
        type: [String, Number],
        default: ''
    },
    options: {
        type: Array,
        default: () => []
        // 格式: [{ value: '1', label: '选项1', icon: Edit }]  // 默认导入 Element Plus 图标
        // 支持 Element Plus 图标: icon: $icons.Edit
        // 支持 iconfont 图标: icon: $iconfont.Edit
    },
    size: {
        type: String,
        default: 'default',
        validator: (val) => ['small', 'default', 'large'].includes(val)
    },
    iconSize: {
        type: Number,
        default: null // 为 null 时根据 size 自动计算
    }
})

const emit = defineEmits(['update:modelValue', 'change'])

// 根据 size 计算图标大小
const sizeIconMap = { small: 14, default: 18, large: 24 }
const computedIconSize = computed(() => props.iconSize ?? sizeIconMap[props.size])

const handleSelect = (value) => {
    if (props.modelValue === value) return
    emit('update:modelValue', value)
    emit('change', value)
}
</script>

<style lang="scss" scoped>
.cz-card-select {
    display: flex;
    gap: 12px;

    .cz-card-select-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 1px solid #dcdfe6;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        color: #606266;

        .el-icon {
            transition: transform 0.2s;
            
            // iconfont 图标兼容
            .cz-iconfont {
                width: 1em;
                height: 1em;
            }
        }

        &:hover {
            border-color: #409eff;
            color: #409eff;

            .el-icon {
                transform: scale(1.1);
            }
        }

        &.active {
            border-color: #409eff;
            background-color: #ecf5ff;
            color: #409eff;
        }
    }

    // 小尺寸
    &--small {
        gap: 8px;

        .cz-card-select-item {
            width: 60px;
            height: 52px;
            padding-top: 6px;

            .el-icon {
                margin-bottom: 2px;
            }

            span {
                font-size: 11px;
            }
        }
    }

    // 默认尺寸
    &--default {
        .cz-card-select-item {
            width: 75px;
            height: 68px;
            padding-top: 8px;

            .el-icon {
                margin-bottom: 4px;
            }

            span {
                font-size: 12px;
            }
        }
    }

    // 大尺寸
    &--large {
        gap: 16px;

        .cz-card-select-item {
            width: 100px;
            height: 88px;
            padding-top: 10px;
            border-radius: 6px;

            .el-icon {
                margin-bottom: 8px;
            }

            span {
                font-size: 14px;
            }
        }
    }
}
</style>
