<template>
    <div class="department-wrapper">
        <!-- 内容面板 -->
        <div class="department-content-panel">
            <!-- 查询区域 -->
            <div class="page-filter-box">
                <div class="page-filter-left">
                    <el-input v-model="tableParams.name" placeholder="搜索部门名称" :suffix-icon="$icons.Search" clearable clear-icon="Close" />
                    <el-select v-model="tableParams.status" placeholder="选择状态" clearable clear-icon="Close" style="width: 120px;">
                        <el-option label="启用" value="0" />
                        <el-option label="关闭" value="1" />
                    </el-select>
                    <el-date-picker
                        v-model="tableParams.createTime"
                        type="daterange"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                        range-separator="-"
                        start-placeholder="开始日期"
                        end-placeholder="结束日期"
                        :shortcuts="shortcuts"
                        clear-icon="Close"
                    />
                    <el-button type="primary" @click="getTableData">查询</el-button>
                    <el-button @click="resetTable">重置</el-button>
                </div>
            </div>

            <!-- 操作区域 -->
            <div class="page-table-header">
                <div class="header-left">
                    <el-button type="primary" @click="deptModalRef?.showAdd()" :icon="$icons.Plus">新增部门</el-button>
                </div>
                <div class="header-right">
                    <el-button link type="primary" @click="toggleExpandAll" :icon="expandAll ? $icons.FolderOpened : $icons.Folder">
                        <span class="btn-text">{{ expandAll ? '收起全部' : '展开全部' }}</span>
                    </el-button>
                </div>
            </div>

            <!-- 表格区域 -->
            <div class="page-table-box">
                <el-table 
                    ref="tableRef"
                    :data="tableData" 
                    v-loading="tableLoading" 
                    row-key="id"
                    :default-expand-all="expandAll"
                    border 
                    height="100%"
                    :tree-props="{ children: 'children' }"
                    :header-cell-style="{ 'text-align': 'center' }"
                    @cell-click="handleCellClick"
                >
                    <el-table-column prop="name" label="部门名称" min-width="180" fixed="left" align="left" />
                    <el-table-column prop="id" label="部门ID" width="150" align="center" />
                    <el-table-column prop="leaderUserName" label="负责人" min-width="150" align="center" />
                    <el-table-column prop="status" label="状态" width="150" align="center">
                        <template #default="{ row }">
                            <el-tag type="success" v-if="row.status === 0">启用</el-tag>
                            <el-tag type="error" v-else-if="row.status === 1">关闭</el-tag>
                            <el-tag type="info" v-else>-</el-tag>
                        </template>
                    </el-table-column>
                    <el-table-column prop="sort" label="排序" width="150" align="center" />
                    <el-table-column prop="createTime" label="创建时间" min-width="180" align="center" />
                    <el-table-column label="操作" width="180" fixed="right" align="center">
                        <template #default="{ row }">
                        <el-button type="primary" link :icon="$icons.Edit" @click="deptModalRef?.showEdit(row)">编辑</el-button>
                        <el-button type="danger" link :icon="$icons.Delete" @click="handleDelete(row.id)">删除</el-button>
                        </template>
                    </el-table-column>
                </el-table>
            </div>
        </div>

        <!-- 新增/编辑弹框 -->
        <DepartmentModal ref="deptModalRef" @success="getTableData" />
    </div>
</template>

<script setup>
import { useTable } from '@/hooks/useTable'
import { useDelete } from '@/hooks/useDelete'
import { useCellClick } from '@/hooks/useCellClick'
import { shortcuts } from "@/utils/public.js"
import { createTree } from "@/utils/tree.js"
import DepartmentModal from './department-modal.vue'

onMounted(() => {
    getTableData()
})
// 表格查询参数
const defaultTableParams = () => ({
    name: "",
    status: "",
    createTime: [],
})
// table hook - 不分页
const { tableParams, tableData: originalData, tableLoading, getTableData, resetTable } =
    useTable('/admin-api/system/dept/list', defaultTableParams, { pagination: false })

// 转换为树形结构
const tableData = computed(() => createTree(originalData.value))

// delete hook
const handleDelete = useDelete({
    url: '/admin-api/system/dept/delete',
    refresh: getTableData
})

// 展开/收起控制
const tableRef = ref()
const expandAll = ref(true)

// cell click hook - 点击名称列展开/收起
const { handleCellClick } = useCellClick(tableRef, {
    columns: 'name',
    action: 'expand',
    condition: (row) => row.children?.length > 0
})

const toggleExpandAll = () => {
    expandAll.value = !expandAll.value
    toggleAllRows(tableData.value, expandAll.value)
}
const toggleAllRows = (rows, expanded) => {
    rows.forEach(row => {
        tableRef.value?.toggleRowExpansion(row, expanded)
        if (row.children?.length) {
            toggleAllRows(row.children, expanded)
        }
    })
}

// 弹框组件引用
const deptModalRef = ref()
</script>

<style lang="scss" scoped>
.department-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    .department-content-panel {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border-radius: 4px;
        border: 1px solid var(--el-border-color-lighter);
        padding: 14px;
        
        .page-filter-box {
            margin-bottom: 16px;
        }
        .header-right{
            .btn-text{
                font-size: 13px;
            }
        }
    }
}


</style>

