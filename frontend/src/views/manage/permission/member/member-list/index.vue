<template>
    <div class="member-wrapper">
        <!-- 主内容区域 -->
        <div class="member-main-layout">
            <!-- 左侧部门树：外层只保留右边框分隔，与 :deep(.cz-dept-tree) 选择器匹配 -->
            <div class="dept-tree-panel">
                <CzDeptTree
                    ref="deptTreeRef"
                    v-model="tableParams.deptId"
                    :data="deptTreeData"
                    :loading="deptLoading"
                    @change="tableSearch"
                />
            </div>

            <!-- 右侧内容 -->
            <div class="member-content-panel">
                <!-- 查询区域 -->
                <div class="page-filter-box">
                    <div class="page-filter-left">
                        <el-input v-model="tableParams.username" placeholder="搜索用户名/邮箱" :suffix-icon="$icons.Search" clearable clear-icon="Close" />
                        <el-select v-model="tableParams.status" placeholder="选择状态" clearable clear-icon="Close" style="width: 120px;">
                            <el-option label="激活" value="0" />
                            <el-option label="锁定" value="1" />
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
                        <el-button type="primary" @click="tableSearch">查询</el-button>
                        <el-button @click="handleReset">重置</el-button>
                    </div>
                </div>

                <!-- 操作区域 -->
                <div class="page-table-header">
                    <el-button type="primary" @click="memberModalRef?.showAdd()" :icon="$icons.Plus">新增成员</el-button>
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
                        <el-table-column prop="username" label="用户名" min-width="100" align="center" show-overflow-tooltip />
                        <el-table-column prop="nickname" label="昵称" min-width="100" align="center" show-overflow-tooltip />
                        <el-table-column prop="deptName" label="部门" min-width="100" align="center" show-overflow-tooltip />
                        <el-table-column prop="status" label="状态" width="70" align="center">
                            <template #default="{ row }">
                                <el-switch 
                                    v-model="row.status" 
                                    :active-value="0"
                                    :inactive-value="1"
                                    @change="handleStatusChange(row)"
                                />
                            </template>
                        </el-table-column>
                        <el-table-column prop="mobile" label="电话" min-width="100" align="center" />
                        <el-table-column prop="email" label="邮箱" min-width="120" align="center" show-overflow-tooltip />
                        <el-table-column prop="createTime" label="创建时间" width="160" align="center" />
                        <el-table-column label="操作" width="280" fixed="right" align="center">
                            <template #default="{ row }">
                                <el-button type="primary" link :icon="$icons.Edit" @click="memberModalRef?.showEdit(row)">编辑</el-button>
                                <el-button type="primary" link :icon="$iconfont.User" @click="memberRoleModalRef?.show(row)">角色</el-button>
                                <el-button type="primary" link :icon="$icons.Lock" @click="handlePassword(row)">密码</el-button>
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
            </div>
        </div>

        <!-- 新增/编辑弹框 -->
        <MemberModal ref="memberModalRef" :dept-tree-data="deptTreeData" @success="getTableData" />
        
        <!-- 设置角色弹框 -->
        <MemberRoleModal ref="memberRoleModalRef" @success="getTableData" />
    </div>
</template>

<script setup>
import request from "@/request"
import { useTable } from '@/hooks/useTable'
import { useDelete } from '@/hooks/useDelete'
import { shortcuts, urlEncode } from "@/utils/public.js"
import { getDepartmentApi } from "@/api/system.js"
import { createTree } from "@/utils/tree.js"
import download from "@/utils/download"
import CzPagination from '@/components/cz-pagination/index.vue'
import CzDeptTree from '@/components/cz-dept-tree/index.vue'
import MemberModal from './member-modal.vue'
import MemberRoleModal from './member-role-modal.vue'

onMounted(() => {
    getDeptTreeData()
    getTableData()
})

// ==================== 部门树 ====================
const deptTreeRef = ref()
const deptTreeData = ref([])
const deptLoading = ref(false)

const getDeptTreeData = async () => {
    deptLoading.value = true
    try {
        const result = await getDepartmentApi()
        if (result.code === 0) {
            deptTreeData.value = createTree(result.data || [])
        } else {
            ElMessage.error(result.msg || '获取部门列表失败')
        }
    } catch (error) {
        console.error('获取部门列表失败:', error)
    } finally {
        deptLoading.value = false
    }
}

// ==================== 表格数据 ====================
const defaultTableParams = () => ({
    username: "",
    status: "",
    deptId: "",
    createTime: [],
    pageNo: 1,
    pageSize: 20,
})

const { tableParams, tableData, tableTotal, tableLoading, getTableData, tableSearch, resetTable } =
    useTable('/admin-api/system/user/page', defaultTableParams)

// 重置（包含部门筛选）
const handleReset = () => {
    deptTreeRef.value?.clearCurrent()
    resetTable()
}

// delete hook
const handleDelete = useDelete({
    url: '/admin-api/system/user/delete',
    refresh: getTableData
})

// ==================== 状态切换 ====================
const handleStatusChange = async (row) => {
    try {
        const result = await request({
            url: "/admin-api/system/user/update-status",
            method: 'PUT',
            data: { id: row.id, status: row.status }
        })
        if (result.code === 0) {
            ElMessage.success('修改成功')
        } else {
            ElMessage.error(result.msg)
            row.status = row.status === 0 ? 1 : 0
        }
    } catch {
        row.status = row.status === 0 ? 1 : 0
    }
}

// ==================== 设置密码 ====================
const handlePassword = (row) => {
    ElMessageBox.prompt(`请输入 ${row.username} 的密码：`, '设置密码', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputPattern: /^.{6,18}$/,
        inputErrorMessage: '密码长度为6-18位',
    }).then(async ({ value }) => {
        const result = await request({
            url: "/admin-api/system/user/update-password",
            method: 'PUT',
            data: { id: row.id, password: value }
        })
        if (result.code === 0) {
            ElMessage.success('设置成功')
        } else {
            ElMessage.error(result.msg)
        }
    }).catch(() => {})
}

// ==================== 导出 ====================
const exportTable = async () => {
    const params = { ...tableParams, pageSize: 100 }
    if (params.createTime?.length) {
        params.createTime = [
            params.createTime[0] + ' 00:00:00',
            params.createTime[1] + ' 23:59:59'
        ]
    }
    const data = await request({
        url: '/admin-api/system/user/export?' + urlEncode(params),
        responseType: 'blob'
    })
    download.excel(data, '用户数据.xls')
}

// 弹框组件引用
const memberModalRef = ref()
const memberRoleModalRef = ref()
</script>

<style lang="scss" scoped>
.member-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;

    .member-main-layout {
        display: flex;
        flex: 1;
        min-height: 0;
        gap: 0;
        align-items: stretch;
    }
}

/* 左侧部门树：无外框，与右侧仅一根竖线 */
.dept-tree-panel {
    width: 268px;
    flex-shrink: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding-right: 14px;
    border-right: 1px solid var(--el-border-color-lighter);

    :deep(.cz-dept-tree) {
        border: none !important;
        border-radius: 0 !important;
        background: transparent;
        height: 100%;
    }

    /* 与右侧 page-filter-box 同一顶线：顶 padding 为 0，底边距与右侧筛选区 margin 对齐 */
    :deep(.cz-dept-tree__search) {
        padding: 0 0 12px;
        margin: 0;
        box-sizing: border-box;
    }

    :deep(.cz-dept-tree__body) {
        padding: 0 0 8px;
    }
}

/* 右侧列表：与全局 page-container 内边距节奏一致（同角色/菜单等页） */
.member-content-panel {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding-left: $content-padding;
    border: none;
    border-radius: 0;
    background: transparent;
    box-sizing: border-box;

    /* 与下方表格、工具条同宽对齐，避免 flex 子项撑破视觉宽度 */
    .page-filter-box,
    .page-table-header,
    .page-table-box,
    .page-pagination-box {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
    }

    .page-filter-box .page-filter-left {
        min-width: 0;
        align-items: center;
    }

    .page-filter-box {
        flex-shrink: 0;
        padding-top: 0;
        margin-top: 0;
        margin-bottom: 12px;
    }

    .page-pagination-box {
        margin-top: 12px;
    }
}

</style>

