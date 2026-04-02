<template>
    <div 
        class="cz-tab-nav" 
        :class="[`cz-tab-nav--${type}`, `cz-tab-nav--${size}`, stretch && 'is-stretch']"
    >
        <div ref="wrapperRef" class="cz-tab-nav__wrapper">
            <div 
                v-for="(tab, index) in tabs" 
                :key="tab.value"
                :ref="el => tabRefs[index] = el"
                class="cz-tab-nav__item"
                :class="{ 'is-active': modelValue === tab.value, 'is-disabled': tab.disabled }"
                @click="handleClick(tab)"
            >
                <el-icon v-if="tab.icon" class="cz-tab-nav__icon">
                    <component :is="tab.icon" />
                </el-icon>
                <span>{{ tab.label }}</span>
                <span v-if="tab.badge" class="cz-tab-nav__badge">{{ tab.badge }}</span>
                <span v-else-if="tab.dot" class="cz-tab-nav__dot"></span>
            </div>
            <div v-if="type === 'line'" class="cz-tab-nav__indicator" :style="indicatorStyle"></div>
        </div>
    </div>
</template>

<script setup>
import { shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'

defineOptions({ name: 'CzTabs' })

const props = defineProps({
    modelValue: { type: [String, Number], default: '' },
    tabs: { type: Array, required: true },
    type: { type: String, default: 'line' },
    size: { type: String, default: 'default' },
    stretch: { type: Boolean, default: false },
    beforeLeave: { type: Function, default: null }
})

const emit = defineEmits(['update:modelValue', 'change', 'tab-click'])

const wrapperRef = shallowRef(null)
const tabRefs = []
const indicatorStyle = shallowRef({})

let rafId = null
let resizeObserver = null

const updateIndicator = () => {
    if (props.type !== 'line') return
    const idx = props.tabs.findIndex(t => t.value === props.modelValue)
    const el = tabRefs[idx]
    if (!el) return
    indicatorStyle.value = {
        width: `${el.offsetWidth}px`,
        transform: `translateX(${el.offsetLeft}px)`
    }
}

const handleResize = () => {
    if (rafId) return
    rafId = requestAnimationFrame(() => {
        updateIndicator()
        rafId = null
    })
}

onMounted(() => {
    if (props.type === 'line' && wrapperRef.value) {
        updateIndicator()
        resizeObserver = new ResizeObserver(handleResize)
        resizeObserver.observe(wrapperRef.value)
    }
})

onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    rafId && cancelAnimationFrame(rafId)
})

watch(() => props.modelValue, updateIndicator)

const handleClick = async (tab) => {
    if (tab.disabled || props.modelValue === tab.value) return
    emit('tab-click', tab)
    if (props.beforeLeave) {
        const ok = await props.beforeLeave(tab.value, props.modelValue)
        if (ok === false) return
    }
    emit('update:modelValue', tab.value)
    emit('change', tab.value)
}
</script>

<style lang="scss" scoped>
.cz-tab-nav {
    display: inline-flex;
    
    &.is-stretch {
        display: flex;
        width: 100%;
        .cz-tab-nav__wrapper { width: 100%; }
        .cz-tab-nav__item { flex: 1; justify-content: center; }
    }
    
    &__wrapper {
        display: flex;
        align-items: center;
        position: relative;
    }
    
    &__item {
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        white-space: nowrap;
        user-select: none;
        transition: color .15s, background-color .15s;
        
        &.is-disabled { opacity: .4; cursor: not-allowed; pointer-events: none; }
    }
    
    &__badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 5px;
        margin-left: 4px;
        font-size: 11px;
        font-weight: 500;
        color: #fff;
        background: $danger-color;
        border-radius: 8px;
    }
    
    &__dot {
        width: 6px;
        height: 6px;
        margin-left: 4px;
        background: $danger-color;
        border-radius: 50%;
    }
    
    // ==================== 尺寸 ====================
    &--large .cz-tab-nav__item { font-size: 14px; gap: 6px; }
    &--large .cz-tab-nav__icon { font-size: 16px; }
    
    &--default .cz-tab-nav__item { font-size: 13px; gap: 5px; }
    &--default .cz-tab-nav__icon { font-size: 15px; }
    
    &--small .cz-tab-nav__item { font-size: 12px; gap: 4px; }
    &--small .cz-tab-nav__icon { font-size: 14px; }
    
    // ==================== Line 模式 ====================
    &--line .cz-tab-nav__item {
        color: $text-regular;
        &:hover { color: $primary-color; }
        &.is-active { color: $primary-color; font-weight: 500; }
    }
    
    &--line .cz-tab-nav__indicator {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 2px;
        background: $primary-color;
        border-radius: 1px;
        transition: transform .2s, width .2s;
        will-change: transform, width;
    }
    
    &--line.cz-tab-nav--large .cz-tab-nav__wrapper { gap: 32px; }
    &--line.cz-tab-nav--large .cz-tab-nav__item { padding-bottom: 10px; }
    
    &--line.cz-tab-nav--default .cz-tab-nav__wrapper { gap: 28px; }
    &--line.cz-tab-nav--default .cz-tab-nav__item { padding-bottom: 7px; }
    
    &--line.cz-tab-nav--small .cz-tab-nav__wrapper { gap: 24px; }
    &--line.cz-tab-nav--small .cz-tab-nav__item { padding-bottom: 5px; }
    
    // ==================== Card 模式 ====================
    &--card .cz-tab-nav__wrapper { gap: 0; }
    
    &--card .cz-tab-nav__item {
        color: $text-regular;
        background: $bg-white;
        border: 1px solid $border-color;
        margin-left: -1px;
        
        &:first-child { margin-left: 0; }
        &:hover:not(.is-active) { color: $primary-color; z-index: 1; }
        &.is-active {
            color: $primary-color;
            background: $primary-bg;
            border-color: $primary-color;
            z-index: 2;
            font-weight: 500;
        }
    }
    
    &--card.cz-tab-nav--large .cz-tab-nav__item {
        padding: 10px 16px;
        &:first-child { border-radius: 5px 0 0 5px; }
        &:last-child { border-radius: 0 5px 5px 0; }
    }
    
    &--card.cz-tab-nav--default .cz-tab-nav__item {
        padding: 7px 14px;
        &:first-child { border-radius: 4px 0 0 4px; }
        &:last-child { border-radius: 0 4px 4px 0; }
    }
    
    &--card.cz-tab-nav--small .cz-tab-nav__item {
        padding: 5px 12px;
        &:first-child { border-radius: 4px 0 0 4px; }
        &:last-child { border-radius: 0 4px 4px 0; }
    }
    
    // ==================== Capsule 模式 ====================
    &--capsule .cz-tab-nav__wrapper {
        gap: 4px;
        background: $bg-light;
    }
    
    &--capsule .cz-tab-nav__item {
        color: $text-primary;
        &:hover:not(.is-active) { color: $primary-color; }
        &.is-active {
            background: $bg-white;
            color: $primary-color;
            font-weight: 500;
            box-shadow: 0 1px 2px rgba(0, 0, 0, .05);
        }
    }
    
    &--capsule.cz-tab-nav--large .cz-tab-nav__wrapper { padding: 4px; border-radius: 8px; }
    &--capsule.cz-tab-nav--large .cz-tab-nav__item { padding: 10px 16px; border-radius: 5px; }
    
    &--capsule.cz-tab-nav--default .cz-tab-nav__wrapper { padding: 3px; border-radius: 6px; }
    &--capsule.cz-tab-nav--default .cz-tab-nav__item { padding: 7px 14px; border-radius: 4px; }
    
    // small 尺寸（胶囊标签）
    &--capsule.cz-tab-nav--small .cz-tab-nav__wrapper { padding: 3px; border-radius: 6px; }
    &--capsule.cz-tab-nav--small .cz-tab-nav__item { padding: 5px 12px; border-radius: 4px; }
}
</style>
