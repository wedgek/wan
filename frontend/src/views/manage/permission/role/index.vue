<template>
    <div class="page-container">
        <!-- 查询区域 -->
        <div class="page-filter-box">
            <div class="page-filter-left">
                <el-input v-model="tableParams.name" placeholder="请输入角色名称" :suffix-icon="$icons.Search" clearable clear-icon="Close" />
                <el-input v-model="tableParams.code" placeholder="请输入角色标识" :suffix-icon="$icons.Search" clearable clear-icon="Close" />
                <el-select v-model="tableParams.status" placeholder="请选择状态" clearable clear-icon="Close" style="width: 120px;">
                    <el-option label="开启" value="0" />
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
                />
                <el-button type="primary" @click="tableSearch">查询</el-button>
                <el-button @click="resetTable">重置</el-button>
            </div>
        </div>

        <!-- 操作区域 -->
        <div class="page-table-header">
            <el-button type="primary" @click="roleModalRef?.showAdd()" :icon="$icons.Plus">新增</el-button>
            <el-button @click="exportTable" :icon="$iconfont.Upload">导出</el-button>
        </div>

        <!-- 表格区域 -->
        <div class="page-table-box">
            <el-table 
                :data="tableData" 
                v-loading="tableLoading" 
                border 
                height="100%"
                :header-cell-style="{ 'text-align': 'center' }"
            >
                <el-table-column prop="name" label="角色名称" min-width="120" fixed="left" align="center" />
                <el-table-column prop="id" label="角色编号" width="100" align="center" />
                <el-table-column prop="type" label="角色类型" width="100" align="center">
                    <template #default="{ row }">
                        <el-tag type="info" v-if="row.type === 1">内置</el-tag>
                        <el-tag type="primary" v-else-if="row.type === 2">自定义</el-tag>
                    </template>
                </el-table-column>
                <el-table-column prop="code" label="角色标识" min-width="120" align="center" />
                <el-table-column prop="sort" label="排序" width="80" align="center" />
                <el-table-column prop="status" label="状态" width="80" align="center">
                    <template #default="{ row }">
                        <el-tag type="success" v-if="row.status === 0">开启</el-tag>
                        <el-tag type="danger" v-else-if="row.status === 1">关闭</el-tag>
                    </template>
                </el-table-column>
                <el-table-column prop="createTime" label="创建时间" min-width="160" align="center" show-overflow-tooltip />
                <el-table-column prop="remark" label="备注" min-width="150" align="center" show-overflow-tooltip />
                <el-table-column label="操作" width="280" fixed="right" align="center">
                    <template #default="{ row }">
                        <el-button type="primary" link :icon="$icons.Edit" @click="roleModalRef?.showEdit(row)">编辑</el-button>
                        <el-button type="primary" link :icon="$iconfont.Menu" @click="roleMenuModalRef?.show(row)">菜单</el-button>
                        <el-button type="primary" link :icon="$icons.Coin" @click="roleDataModalRef?.show(row)">数据</el-button>
                        <el-button type="danger" link :icon="$icons.Delete" @click="handleDelete(row.id)">删除</el-button>
                    </template>
                </el-table-column>
            </el-table>
        </div>

        <!-- 分页区域 -->
        <div class="page-pagination-box">
            <CzPagination
                v-model:current-page="tableParams.pageNo"
                v-model:page-size="tableParams.pageSize"
                :total="tableTotal"
                @change="getTableData"
            />
        </div>

        <!-- 新增/编辑弹框 -->
        <RoleModal ref="roleModalRef" @success="getTableData" />
        
        <!-- 菜单权限弹框 -->
        <RoleMenuModal ref="roleMenuModalRef" @success="getTableData" />
        
        <!-- 数据权限弹框 -->
        <RoleDataModal ref="roleDataModalRef" @success="getTableData" />
    </div>
</template>

<script setup name="managePermissionRole">
import { useTable } from '@/hooks/useTable'
import { useDelete } from '@/hooks/useDelete'
import { shortcuts } from "@/utils/public.js"
import download from "@/utils/download"
import request from "@/request"
import { urlEncode } from "@/utils/public.js"
import CzPagination from '@/components/cz-pagination/index.vue'
import RoleModal from './role-modal.vue'
import RoleMenuModal from './role-menu-modal.vue'
import RoleDataModal from './role-data-modal.vue'

onMounted(() => {
    getTableData()
})

// 表格查询参数
const defaultTableParams = () => ({
    name: "",
    code: "",
    status: "",
    createTime: [],
    pageNo: 1,
    pageSize: 20,
})

// table hook
const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } =
    useTable('/admin-api/system/role/page', defaultTableParams)

// delete hook
const handleDelete = useDelete({
    url: '/admin-api/system/role/delete',
    refresh: getTableData
})

// 导出表格
const exportTable = async () => {
    const params = { ...tableParams, pageSize: 100 }
    if (params.createTime?.length) {
        params.createTime = [
            params.createTime[0] + ' 00:00:00',
            params.createTime[1] + ' 23:59:59'
        ]
    }
    
    const data = await request({
        url: "/admin-api/system/role/export-excel?" + urlEncode(params),
        responseType: "blob",
    })
    download.excel(data, "角色数据.xls")
}

// 弹框组件引用
const roleModalRef = ref()
const roleMenuModalRef = ref()
const roleDataModalRef = ref()
</script>

<style lang="scss" scoped>
.page-container {
    .page-filter-box {
        margin-bottom: 16px;
        
        .el-date-picker {
            width: 240px;
        }
    }
    .page-pagination-box {
        margin-top: 15px;
    }
}
</style>
