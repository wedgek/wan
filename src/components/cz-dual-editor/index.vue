<template>
    <div class="cz-dual-editor-wrapper">
        <div class="cz-dual-editor" :style="{ height }">
            <div class="editor-left">
                <el-input 
                    v-model="textareaValue" 
                    type="textarea" 
                    class="el-textarea--plain-fill" 
                    :placeholder="placeholder" 
                    @input="syncFromTextarea" 
                />
            </div>
            <div class="editor-right">
                <div class="preview-list" v-if="internalList.length" ref="scrollContainerRef" @scroll="onScroll">
                    <!-- 可拖拽模式 -->
                    <draggable 
                        v-if="enableDrag"
                        v-model="internalList" 
                        item-key="id" 
                        handle=".item-index" 
                        animation="150" 
                        :scroll="true" 
                        :scrollSensitivity="100" 
                        @end="syncFromList"
                    >
                        <template #item="{ element, index }">
                            <div class="preview-item" :class="getItemClass(element.text, index)">
                                <span class="item-index">{{ index + 1 }}</span>
                                <span class="item-text" :title="element.text">{{ element.text }}</span>
                                <span v-if="getItemTag(element.text, index)" class="item-tag" :class="getTagClass(element.text, index)">
                                    {{ getItemTag(element.text, index) }}
                                </span>
                                <el-icon class="item-del" @click="removeItem(index)"><component :is="$icons.Close" /></el-icon>
                            </div>
                        </template>
                    </draggable>
                    <!-- 虚拟滚动模式 -->
                    <template v-else-if="useVirtual">
                        <div class="virtual-spacer" :style="{ height: `${totalHeight}px` }">
                            <div class="virtual-content" :style="{ transform: `translateY(${offsetY}px)` }">
                                <div 
                                    v-for="{ item, index } in visibleItems" 
                                    :key="item.id" 
                                    class="preview-item" 
                                    :class="getItemClass(item.text, index)"
                                >
                                    <span class="item-index no-drag">{{ index + 1 }}</span>
                                    <span class="item-text" :title="item.text">{{ item.text }}</span>
                                    <span v-if="getItemTag(item.text, index)" class="item-tag" :class="getTagClass(item.text, index)">
                                        {{ getItemTag(item.text, index) }}
                                    </span>
                                    <el-icon class="item-del" @click="removeItem(index)"><component :is="$icons.Close" /></el-icon>
                                </div>
                            </div>
                        </div>
                    </template>
                    <!-- 普通模式（无拖拽、无虚拟滚动） -->
                    <template v-else>
                        <div 
                            v-for="(element, index) in internalList" 
                            :key="element.id" 
                            class="preview-item" 
                            :class="getItemClass(element.text, index)"
                        >
                            <span class="item-index no-drag">{{ index + 1 }}</span>
                            <span class="item-text" :title="element.text">{{ element.text }}</span>
                            <span v-if="getItemTag(element.text, index)" class="item-tag" :class="getTagClass(element.text, index)">
                                {{ getItemTag(element.text, index) }}
                            </span>
                            <el-icon class="item-del" @click="removeItem(index)"><component :is="$icons.Close" /></el-icon>
                        </div>
                    </template>
                </div>
                <div v-else class="preview-empty">{{ emptyText }}</div>
            </div>
        </div>
        <!-- 默认 footer -->
        <div class="editor-footer" v-if="showFooter">
            <span>{{ tip }}</span>
            <span>
                已添加 <span class="num">{{ internalList.length }}</span> 条
                <template v-if="checkDuplicate && duplicateCount"><span class="dot">·</span>重复 <span class="num warning">{{ duplicateCount }}</span> 条</template>
                <template v-if="maxLength && overflowCount"><span class="dot">·</span>超长 <span class="num warning">{{ overflowCount }}</span> 条</template>
                <template v-if="internalList.length"><span class="divider"></span><el-button type="primary" link @click="clear"><el-icon><component :is="$icons.Delete" /></el-icon>清空</el-button></template>
            </span>
        </div>
        <!-- 自定义 footer -->
        <div class="editor-footer" v-else-if="$slots['footer-left'] || $slots['footer-right']">
            <span><slot name="footer-left"></slot></span>
            <span><slot name="footer-right" :stats="stats"></slot></span>
        </div>
    </div>
</template>

<script setup>
import draggable from 'vuedraggable'
import { debounce } from 'lodash-es'

defineOptions({ name: 'CzDualEditor' })

const props = defineProps({
    modelValue: { type: Array, default: () => [] },
    placeholder: { type: String, default: '每行输入一条内容' },
    emptyText: { type: String, default: '在左侧输入内容' },
    height: { type: String, default: '380px' },
    // 内置校验
    maxLength: { type: Number, default: 0 },
    checkDuplicate: { type: Boolean, default: false },
    // 默认 footer
    showFooter: { type: Boolean, default: true },
    tip: { type: String, default: '' },
    // 自定义校验（优先级高于内置）
    itemStatus: { type: Function, default: null },
    itemTag: { type: Function, default: null },
    // 性能优化
    enableDrag: { type: Boolean, default: true },
    virtual: { type: Boolean, default: null }, // null 表示自动（关闭拖拽时启用）
    itemHeight: { type: Number, default: 34 }  // 单行高度，用于虚拟滚动计算
})

const emit = defineEmits(['update:modelValue'])

// 是否使用虚拟滚动
const useVirtual = computed(() => {
    if (props.enableDrag) return false // 拖拽模式不支持虚拟滚动
    return props.virtual === null ? true : props.virtual // 默认开启
})

const textareaValue = ref('')
const internalList = ref([])
let idCounter = 0

// ========== 虚拟滚动 ==========
const scrollContainerRef = ref(null)
const scrollTop = ref(0)
const containerHeight = ref(0)
const BUFFER = 5 // 缓冲区条数

const totalHeight = computed(() => internalList.value.length * props.itemHeight)

const visibleRange = computed(() => {
    if (!useVirtual.value) return { start: 0, end: internalList.value.length }
    const start = Math.max(0, Math.floor(scrollTop.value / props.itemHeight) - BUFFER)
    const visibleCount = Math.ceil(containerHeight.value / props.itemHeight) + BUFFER * 2
    const end = Math.min(internalList.value.length, start + visibleCount)
    return { start, end }
})

const offsetY = computed(() => visibleRange.value.start * props.itemHeight)

const visibleItems = computed(() => {
    const { start, end } = visibleRange.value
    return internalList.value.slice(start, end).map((item, i) => ({
        item,
        index: start + i
    }))
})

const onScroll = () => {
    if (!scrollContainerRef.value || !useVirtual.value) return
    scrollTop.value = scrollContainerRef.value.scrollTop
}

// 初始化容器高度
onMounted(() => {
    if (scrollContainerRef.value) {
        containerHeight.value = scrollContainerRef.value.clientHeight
    }
})

// 监听外部 modelValue 变化
watch(() => props.modelValue, (val) => {
    if (!val?.length) {
        internalList.value = []
        textareaValue.value = ''
        return
    }
    const currentTexts = internalList.value.map(i => i.text)
    if (JSON.stringify(val) !== JSON.stringify(currentTexts)) {
        internalList.value = val.map(text => ({ id: idCounter++, text }))
        textareaValue.value = val.join('\n')
    }
}, { immediate: true })

// 从 textarea 同步到列表（防抖优化）
const doSync = () => {
    const lines = textareaValue.value.split('\n').map(l => l.trim()).filter(Boolean)
    internalList.value = lines.map(text => ({ id: idCounter++, text }))
    emit('update:modelValue', lines)
}
const syncFromTextarea = debounce(doSync, 150)

// 从列表同步到 textarea
const syncFromList = () => {
    const texts = internalList.value.map(i => i.text)
    textareaValue.value = texts.join('\n')
    emit('update:modelValue', texts)
}

// 删除单项
const removeItem = (index) => {
    internalList.value.splice(index, 1)
    syncFromList()
}

// 清空
const clear = () => {
    internalList.value = []
    textareaValue.value = ''
    emit('update:modelValue', [])
}

// ========== 内置校验逻辑（性能优化：O(n) 预计算） ==========
const duplicateIndexSet = computed(() => {
    if (!props.checkDuplicate) return new Set()
    const textFirstIndex = new Map()
    const duplicates = new Set()
    internalList.value.forEach((item, index) => {
        if (textFirstIndex.has(item.text)) {
            duplicates.add(textFirstIndex.get(item.text))
            duplicates.add(index)
        } else {
            textFirstIndex.set(item.text, index)
        }
    })
    return duplicates
})

const isDuplicate = (index) => duplicateIndexSet.value.has(index)

const duplicateCount = computed(() => {
    if (!props.checkDuplicate) return 0
    const seen = new Set()
    let count = 0
    internalList.value.forEach(i => {
        if (seen.has(i.text)) count++
        else seen.add(i.text)
    })
    return count
})

const overflowCount = computed(() => {
    if (!props.maxLength) return 0
    return internalList.value.filter(i => i.text.length > props.maxLength).length
})

// 暴露给 slot 的统计信息
const stats = computed(() => ({
    total: internalList.value.length,
    duplicateCount: duplicateCount.value,
    overflowCount: overflowCount.value
}))

// ========== 行状态判断 ==========
const getItemClass = (text, index) => {
    if (props.itemStatus) {
        const status = props.itemStatus(text, index)
        return { error: status === 'error', warning: status === 'warning' }
    }
    const isOverflow = props.maxLength && text.length > props.maxLength
    const isDup = props.checkDuplicate && isDuplicate(index)
    return { error: isDup || isOverflow }
}

const getItemTag = (text, index) => {
    if (props.itemTag) return props.itemTag(text, index)
    if (props.checkDuplicate && isDuplicate(index)) return '重复'
    if (props.maxLength && text.length > props.maxLength) return '超长'
    return null
}

const getTagClass = (text, index) => {
    if (props.itemStatus) {
        const status = props.itemStatus(text, index)
        return status === 'error' ? 'danger' : 'warning'
    }
    return 'danger'
}

defineExpose({ clear, stats })
</script>

<style lang="scss" scoped>
.cz-dual-editor-wrapper {
    width: 100%;
}

.cz-dual-editor {
    display: flex;
    border: 1px solid #dcdfe6;
    border-radius: 4px;
    overflow: hidden;
}

.editor-left {
    flex: 1;
    border-right: 1px solid #ebeef5;
    :deep(.el-textarea__inner) {
        padding: 14px 16px;
        line-height: 1.8;
        color: #303133;
    }
}

.editor-right {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.preview-list {
    flex: 1;
    overflow-y: auto;
}

.virtual-spacer {
    position: relative;
}

.virtual-content {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
}

.preview-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px;
    font-size: 12px;
    &.error { background: #fef0f0; }
    &.warning { background: #fdf6ec; }
}

.item-index {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    line-height: 22px;
    text-align: center;
    font-size: 12px;
    color: #606266;
    background: #f4f4f5;
    border-radius: 4px;
    cursor: grab;
    &:active { cursor: grabbing; }
    &.no-drag { cursor: default; }
}

.item-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #303133;
}

.item-tag {
    flex-shrink: 0;
    padding: 0 6px;
    font-size: 12px;
    line-height: 18px;
    border-radius: 2px;
    &.danger { color: #f56c6c; background: #fef0f0; }
    &.warning { color: #e6a23c; background: #fdf6ec; }
}

.item-del {
    flex-shrink: 0;
    font-size: 14px;
    color: #c0c4cc;
    cursor: pointer;
    &:hover { color: #909399; }
}

.preview-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: #a8abb2;
}

.editor-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
    font-size: 13px;
    color: #606266;
    .num { color: #409eff; margin: 0 4px; }
    .num.warning { color: #e6a23c; }
    .dot { margin: 0 6px; color: #c0c4cc; }
    > span:last-child {
        display: flex;
        align-items: center;
    }
    .divider {
        width: 1px;
        height: 12px;
        background: #dcdfe6;
        margin: 0 8px;
    }
    :deep(.el-button) {
        font-size: 13px;
        padding: 0;
        height: auto;
        .el-icon { margin-right: 4px; }
    }
}
</style>

<!-- 
 * ===========================================
 * CzDualEditor 双栏编辑器组件 - 使用示例
 * ===========================================
 * import CzDualEditor from '@/components/cz-dual-editor/index.vue'
 *
 * // 最简用法（内置校验 + 默认 footer）
 * <CzDualEditor
 *   v-model="list"
 *   :max-length="50"
 *   check-duplicate
 *   tip="每行一个标题，最多50字"
 * />
 *
 * // 自定义 footer
 * <CzDualEditor v-model="list" :show-footer="false">
 *   <template #footer-left>自定义提示</template>
 *   <template #footer-right="{ stats }">
 *     已添加 {{ stats.total }} 条
 *   </template>
 * </CzDualEditor>
 *
 * // 大数据量（关闭拖拽，自动开启虚拟滚动）
 * <CzDualEditor v-model="list" :enable-drag="false" />
 *
 * // 关闭拖拽但不使用虚拟滚动
 * <CzDualEditor v-model="list" :enable-drag="false" :virtual="false" />
 * 
 -->
