<template>
    <div class="page-container">
        <!-- 查询区域 -->
        <div class="page-filter-box">
            <div class="page-filter-left">
                <el-input v-model="tableParams.name" placeholder="请输入菜单名称" :suffix-icon="$icons.Search" clearable clear-icon="Close" />
                <el-select v-model="tableParams.status" placeholder="请选择状态" clearable clear-icon="Close">
                    <el-option label="开启" value="0" />
                    <el-option label="关闭" value="1" />
                </el-select>
                <el-button type="primary" @click="getTableData">查询</el-button>
                <el-button @click="resetTable">重置</el-button>
            </div>
        </div>

        <!-- 操作区域 -->
        <div class="page-table-header">
            <el-button type="primary" @click="menuModalRef?.showAdd(0)" :icon="$icons.Plus">新增</el-button>
        </div>

        <!-- 表格区域 -->
        <div class="page-table-box">
            <el-table 
                ref="tableRef"
                :data="tableData" 
                v-loading="tableLoading" 
                row-key="id" 
                border 
                height="100%" 
                default-expand-all
                :tree-props="{ children: 'children' }"
                :header-cell-style="{ 'text-align': 'center' }" 
                @cell-click="handleCellClick"
            >
                <el-table-column prop="name" label="菜单名称" min-width="160" fixed="left" align="left" />
                <el-table-column prop="icon" label="图标" width="80" align="center">
                    <template #default="{ row }">
                        <div class="icon-cell">
                            <el-icon v-if="row.icon" :size="18">
                                <component :is="ElementPlusIconsVue[row.icon]" />
                            </el-icon>
                            <span v-else>-</span>
                        </div>
                    </template>
                </el-table-column>
                <el-table-column prop="sort" label="排序" width="80" align="center" />
                <el-table-column prop="permission" label="权限标识" min-width="250" show-overflow-tooltip />
                <el-table-column prop="componentName" label="组件名称" min-width="180" show-overflow-tooltip />
                <el-table-column prop="status" label="状态" width="80" align="center">
                    <template #default="{ row }">
                        <el-tag type="danger" v-if="row.status === 1">关闭</el-tag>
                        <el-tag type="success" v-else-if="row.status === 0">开启</el-tag>
                    </template>
                </el-table-column>
                <el-table-column label="操作" width="200" fixed="right" align="center">
                    <template #default="{ row }">
                        <el-button type="primary" link :icon="$icons.FolderAdd" @click="menuModalRef?.showAdd(row.id)">新增</el-button>
                        <el-button type="primary" link :icon="$icons.Edit" @click="menuModalRef?.showEdit(row.id)">编辑</el-button>
                        <el-button type="danger" link :icon="$icons.Delete" @click="handleDelete(row.id)">删除</el-button>
                    </template>
                </el-table-column>
            </el-table>
        </div>

        <!-- 新增/编辑弹框 -->
        <MenuModal ref="menuModalRef" :menu-tree-data="menuTreeData" @success="handleModalSuccess" />
    </div>
</template>

<script setup name="managePermissionMenu">
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { useTable } from '@/hooks/useTable'
import { useDelete } from '@/hooks/useDelete'
import { useCellClick } from '@/hooks/useCellClick'
import { initPermission } from '@/router/permission'
import { createTree } from "@/utils/tree.js"
import MenuModal from './menu-modal.vue'

onMounted(() => {
    getTableData()
})

// 表格查询参数
const defaultTableParams = () => ({
    name: "",
    status: "",
})

// table hook - 不分页
const { tableParams, tableData: originalData, tableLoading, getTableData, resetTable } =
    useTable('/admin-api/system/menu/list', defaultTableParams, { pagination: false })

// 转换为树形结构
const tableData = computed(() => createTree(originalData.value))
const menuTreeData = computed(() => [{ id: 0, name: "主类目", children: tableData.value }])

// delete hook
const handleDelete = useDelete({
    url: '/admin-api/system/menu/delete',
    refresh: [getTableData, () => initPermission({ force: true })]
})

const tableRef = ref()

/** 树形数据异步到达后仍默认全部展开（单靠 default-expand-all 在首屏为空时可能不生效） */
const expandAllMenuRows = () => {
    nextTick(() => {
        const t = tableRef.value
        if (!t) return
        const walk = (rows) => {
            rows?.forEach((row) => {
                if (row.children?.length) {
                    t.toggleRowExpansion(row, true)
                    walk(row.children)
                }
            })
        }
        walk(tableData.value)
    })
}

watch(tableData, (rows) => {
    if (rows?.length) expandAllMenuRows()
}, { flush: 'post' })

// cell click hook - 点击名称列展开/收起
const { handleCellClick } = useCellClick(tableRef, {
    columns: 'name',
    action: 'expand',
    condition: (row) => row.children?.length > 0
})

// 弹框组件引用
const menuModalRef = ref()

// 弹框提交成功回调
const handleModalSuccess = () => {
    getTableData()
    initPermission({ force: true })
}
</script>

<style lang="scss" scoped>
.page-container {
    .page-filter-box {
        margin-bottom: 16px;
    }
}

// 图标单元格对齐
.icon-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
}
</style>
