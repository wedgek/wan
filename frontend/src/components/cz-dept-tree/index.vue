<template>
    <div class="cz-dept-tree" v-loading="loading">
        <div class="cz-dept-tree__search" v-if="showSearch">
            <el-input 
                v-model="searchKey" 
                :placeholder="placeholder"
                :prefix-icon="$icons.Search" 
                clearable 
                clear-icon="Close"
            />
        </div>
        <div class="cz-dept-tree__body">
            <div 
                v-if="showAll"
                class="cz-dept-tree__all" 
                :class="{ 'is-active': isAllSelected }"
                @click="handleSelectAll"
            >
                <el-icon><Folder /></el-icon>
                <span>{{ allText }}</span>
            </div>
            <el-tree
                v-if="filteredData.length"
                ref="treeRef"
                :node-key="nodeKey"
                :data="filteredData"
                :props="treeProps"
                :default-expand-all="defaultExpandAll"
                :expand-on-click-node="expandOnClickNode"
                highlight-current
                @node-click="handleNodeClick"
            >
                <template #default="{ node }">
                    <div class="cz-dept-tree__node">
                        <el-icon><FolderOpened v-if="node.expanded" /><Folder v-else /></el-icon>
                        <span class="cz-dept-tree__label">{{ node.label }}</span>
                    </div>
                </template>
            </el-tree>
            <el-empty v-else-if="!loading" :image-size="60">
                <template #description>
                    <span class="cz-dept-tree__empty">{{ emptyText }}</span>
                </template>
            </el-empty>
        </div>
    </div>
</template>

<script setup>

defineOptions({ name: 'CzDeptTree' })

const props = defineProps({
    modelValue: { type: [String, Number], default: '' },
    data: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    showSearch: { type: Boolean, default: true },
    showAll: { type: Boolean, default: true },
    placeholder: { type: String, default: '搜索部门' },
    allText: { type: String, default: '全部部门' },
    emptyText: { type: String, default: '暂无数据' },
    nodeKey: { type: String, default: 'id' },
    props: { type: Object, default: () => ({ children: 'children', label: 'name' }) },
    defaultExpandAll: { type: Boolean, default: true },
    expandOnClickNode: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'change', 'node-click'])

const treeRef = ref()
const searchKey = ref('')

// 树配置
const treeProps = computed(() => props.props)

// 是否选中"全部"
const isAllSelected = computed(() => props.modelValue === '' || props.modelValue === null)

// 过滤树数据
const filteredData = computed(() => {
    if (!searchKey.value) return props.data
    const keyword = searchKey.value.toLowerCase()
    const labelKey = props.props.label || 'name'
    const childrenKey = props.props.children || 'children'
    
    const filterTree = (nodes) => {
        return nodes.reduce((acc, node) => {
            const children = node[childrenKey] ? filterTree(node[childrenKey]) : []
            const label = node[labelKey] || ''
            if (label.toLowerCase().includes(keyword) || children.length > 0) {
                acc.push({ ...node, [childrenKey]: children })
            }
            return acc
        }, [])
    }
    return filterTree(props.data)
})

// 选中"全部"
const handleSelectAll = () => {
    treeRef.value?.setCurrentKey(null)
    emit('update:modelValue', '')
    emit('change', '', null)
}

// 点击节点
const handleNodeClick = (data, node) => {
    const value = data[props.nodeKey]
    emit('update:modelValue', value)
    emit('change', value, data)
    emit('node-click', data, node)
}

// 暴露方法
defineExpose({
    setCurrentKey: (key) => treeRef.value?.setCurrentKey(key),
    getCurrentKey: () => treeRef.value?.getCurrentKey(),
    getCurrentNode: () => treeRef.value?.getCurrentNode(),
    getNode: (key) => treeRef.value?.getNode(key),
    clearCurrent: () => {
        treeRef.value?.setCurrentKey(null)
        emit('update:modelValue', '')
    }
})
</script>

<style lang="scss" scoped>
.cz-dept-tree {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--el-bg-color);
    border-radius: 4px;
    border: 1px solid var(--el-border-color-lighter);
    overflow: hidden;

    &__search {
        padding: 14px;
        flex-shrink: 0;
    }
    
    &__body {
        flex: 1;
        overflow-y: auto;
        padding: 0 14px 14px;
    }
    
    &__all {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px 8px 12px;
        margin-bottom: 2px;
        border-radius: 4px;
        cursor: pointer;
        color: var(--el-text-color-regular);
        font-size: 13px;
        position: relative;
        
        .el-icon { font-size: 14px; color: var(--el-text-color-secondary); }
        
        &:hover:not(.is-active) {
            background-color: var(--el-fill-color-light);
            color: var(--el-color-primary);
            .el-icon { color: var(--el-color-primary); }
        }
        
        &.is-active {
            background-color: transparent !important;
            color: var(--el-color-primary);
            font-weight: 500;
            .el-icon { color: var(--el-color-primary); }

            &::before {
                content: '';
                position: absolute;
                left: 2px;
                top: 50%;
                transform: translateY(-50%);
                width: 3px;
                height: 16px;
                background-color: var(--el-color-primary);
                border-radius: 2px;
            }
        }
    }
    
    :deep(.el-tree) {
        background-color: transparent;
        --el-tree-node-content-height: 34px;
        font-size: 13px;
        
        .el-tree-node__content {
            position: relative;
            border-radius: 4px;
            
            &:hover {
                background-color: var(--el-fill-color-light);
                .cz-dept-tree__node .el-icon,
                .cz-dept-tree__node .cz-dept-tree__label { color: var(--el-color-primary); }
            }
        }
        
        .el-tree-node.is-current > .el-tree-node__content,
        .el-tree-node.is-current:focus > .el-tree-node__content {
            background-color: transparent !important;
            box-shadow: none !important;
            .cz-dept-tree__node .el-icon,
            .cz-dept-tree__node .cz-dept-tree__label { color: var(--el-color-primary); }
            .cz-dept-tree__node .cz-dept-tree__label { font-weight: 500; }

            &::before {
                content: '';
                position: absolute;
                left: 0;
                top: 50%;
                transform: translateY(-50%);
                width: 3px;
                height: 16px;
                background-color: var(--el-color-primary);
                border-radius: 2px;
            }
        }

        .el-tree-node.is-current > .el-tree-node__content:hover {
            background-color: transparent !important;
        }
    }
    
    &__node {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        position: relative;
        .el-icon { font-size: 14px; color: var(--el-text-color-secondary); }
    }
    
    &__label {
        font-size: 13px;
        color: var(--el-text-color-regular);
    }
    
    &__empty {
        font-size: 12px;
        color: var(--el-text-color-placeholder);
    }
}
</style>

<!--
================================================================================
使用示例
================================================================================

1. 基础用法
<CzDeptTree
    v-model="deptId"
    :data="deptTreeData"
    :loading="deptLoading"
    @change="handleDeptChange"
/>

2. 自定义配置
<CzDeptTree
    v-model="deptId"
    :data="deptTreeData"
    :loading="deptLoading"
    :props="{ children: 'children', label: 'deptName' }"
    node-key="deptId"
    placeholder="请输入部门名称"
    all-text="全部"
    empty-text="暂无部门"
    :show-search="true"
    :show-all="true"
    :default-expand-all="false"
    @change="handleDeptChange"
    @node-click="handleNodeClick"
/>

3. 控制宽高（在使用方控制）
<CzDeptTree
    v-model="deptId"
    :data="deptTreeData"
    class="my-tree"
/>

<style>
.my-tree {
    width: 280px;
    height: 100%;
}
</style>

4. 调用组件方法
<CzDeptTree ref="treeRef" v-model="deptId" :data="deptTreeData" />

<script setup>
const treeRef = ref()

// 清空选中
treeRef.value?.clearCurrent()

// 设置选中
treeRef.value?.setCurrentKey(123)

// 获取当前选中的 key
const currentKey = treeRef.value?.getCurrentKey()

// 获取当前选中的节点数据
const currentNode = treeRef.value?.getCurrentNode()
</script>

================================================================================
Props 说明
================================================================================
| 属性              | 类型           | 默认值                              | 说明             |
|------------------|----------------|-------------------------------------|------------------|
| v-model          | String/Number  | ''                                  | 选中的节点 ID     |
| data             | Array          | []                                  | 树数据           |
| loading          | Boolean        | false                               | 加载状态         |
| showSearch       | Boolean        | true                                | 显示搜索框       |
| showAll          | Boolean        | true                                | 显示"全部"选项   |
| placeholder      | String         | '搜索部门'                           | 搜索框占位符     |
| allText          | String         | '全部部门'                           | "全部"选项文字   |
| emptyText        | String         | '暂无数据'                           | 空状态文字       |
| nodeKey          | String         | 'id'                                | 节点唯一标识字段  |
| props            | Object         | { children: 'children', label: 'name' } | 树节点配置  |
| defaultExpandAll | Boolean        | true                                | 默认展开全部     |
| expandOnClickNode| Boolean        | false                               | 点击节点时展开   |

================================================================================
Events 说明
================================================================================
| 事件名      | 参数                  | 说明                    |
|------------|----------------------|------------------------|
| change     | (value, data)        | 选中值变化时触发         |
| node-click | (data, node)         | 节点被点击时触发         |

================================================================================
Methods 说明
================================================================================
| 方法名         | 参数    | 返回值  | 说明               |
|---------------|--------|--------|-------------------|
| setCurrentKey | (key)  | -      | 设置当前选中的节点   |
| getCurrentKey | -      | key    | 获取当前选中的 key  |
| getCurrentNode| -      | object | 获取当前选中的节点数据|
| getNode       | (key)  | node   | 根据 key 获取节点   |
| clearCurrent  | -      | -      | 清空选中状态        |
-->

