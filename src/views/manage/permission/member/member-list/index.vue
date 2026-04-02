<template>
    <div class="member-wrapper">
        <!-- 主内容区域 -->
        <div class="member-main-layout">
            <!-- 左侧部门树 -->
            <CzDeptTree
                ref="deptTreeRef"
                v-model="tableParams.deptId"
                :data="deptTreeData"
                :loading="deptLoading"
                class="dept-tree-panel"
                @change="tableSearch"
            />

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
                        <el-table-column label="操作" width="340" fixed="right" align="center">
                            <template #default="{ row }">
                                <el-button type="primary" link :icon="$icons.Edit" @click="memberModalRef?.showEdit(row)">编辑</el-button>
                                <el-button type="primary" link :icon="$iconfont.User" @click="memberRoleModalRef?.show(row)">角色</el-button>
                                <el-button type="primary" link :icon="$iconfont.Auth" @click="handleAuthCode(row)">授权</el-button>
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

        <!-- 授权二维码弹框 -->
        <el-dialog
            v-model="authCodeVisible"
            width="360"
            destroy-on-close
            align-center
        >
            <div class="auth-code-box" v-loading="authCodeLoading">
                <div class="qr-frame" v-if="authCodeData">
                    <span class="corner corner-tl"></span>
                    <span class="corner corner-tr"></span>
                    <span class="corner corner-bl"></span>
                    <span class="corner corner-br"></span>
                    <img :src="'data:image/png;base64,' + authCodeData" alt="授权二维码" />
                </div>
                <el-empty v-else-if="!authCodeLoading" description="获取失败" :image-size="60" />
                <div class="qr-tip" v-if="authCodeData">请扫码授权</div>
            </div>
        </el-dialog>
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

// ==================== 授权二维码 ====================
const authCodeVisible = ref(false)
const authCodeLoading = ref(false)
const authCodeData = ref('')

const handleAuthCode = async (row) => {
    authCodeData.value = ''
    authCodeVisible.value = true
    authCodeLoading.value = true
    
    try {
        const result = await request({
            url: '/admin-api/system/user/qcCode?username=' + row.username,
            method: 'GET',
        })
        if (result.code === 0) {
            authCodeData.value = result.data
        } else {
            ElMessage.error(result.msg || '获取二维码失败')
        }
    } catch (error) {
        ElMessage.error('请求失败: ' + (error.message || '未知错误'))
    } finally {
        authCodeLoading.value = false
    }
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
    .member-main-layout {
        display: flex;
        flex: 1;
        min-height: 0;
        gap: 14px;
    }
}

// 左侧部门树面板
.dept-tree-panel {
    width: 280px;
    flex-shrink: 0;
}

// 右侧内容面板
.member-content-panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background-color: var(--el-bg-color);
    border-radius: 4px;
    border: 1px solid var(--el-border-color-lighter);
    padding: 14px;
    
    .page-filter-box {
        margin-bottom: 16px;
    }
    .page-pagination-box {
        margin-top: 15px;
    }
}

// 授权二维码
.auth-code-box {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 300px;
    
    .qr-frame {
        position: relative;
        
        img {
            display: block;
            width: 230px;
            height: 230px;
        }
        
        .corner {
            position: absolute;
            width: 16px;
            height: 16px;
            border-color: $primary-color;
            border-style: solid;
            border-width: 0;
            
            &.corner-tl {
                top: 0;
                left: 0;
                border-top-width: 2px;
                border-left-width: 2px;
                border-top-left-radius: 2px;
            }
            &.corner-tr {
                top: 0;
                right: 0;
                border-top-width: 2px;
                border-right-width: 2px;
                border-top-right-radius: 2px;
            }
            &.corner-bl {
                bottom: 0;
                left: 0;
                border-bottom-width: 2px;
                border-left-width: 2px;
                border-bottom-left-radius: 2px;
            }
            &.corner-br {
                bottom: 0;
                right: 0;
                border-bottom-width: 2px;
                border-right-width: 2px;
                border-bottom-right-radius: 2px;
            }
        }
    }
    
    .qr-tip {
        margin-top: 16px;
        font-size: 12px;
        color: $text-secondary;
    }
}

</style>

