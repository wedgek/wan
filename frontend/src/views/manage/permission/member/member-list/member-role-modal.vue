<template>
    <el-dialog
        v-model="modalVisible"
        title="设置角色"
        width="600px"
        destroy-on-close
    >
        <el-form :model="formData" label-width="90px" v-loading="detailLoading">
            <el-form-item label="用户名称">
                <el-input v-model="formData.username" disabled />
            </el-form-item>

            <el-form-item label="用户昵称">
                <el-input v-model="formData.nickname" disabled />
            </el-form-item>

            <el-form-item label="用户角色" v-required-dot>
                <el-select
                    v-model="formData.roleIds"
                    multiple
                    clearable
                    placeholder="请选择用户角色"
                    style="width: 100%"
                    clear-icon="Close"
                >
                    <el-option 
                        v-for="item in roleList" 
                        :key="item.id" 
                        :label="item.name" 
                        :value="item.id" 
                    />
                </el-select>
            </el-form-item>
        </el-form>

        <template #footer>
            <el-button @click="modalVisible = false">取消</el-button>
            <el-button type="primary" @click="handleSubmit" :loading="submitLoading">确定</el-button>
        </template>
    </el-dialog>
</template>

<script setup>
import request from "@/request"
import { getRoleApi } from "@/api/system.js"

const emit = defineEmits(['success'])

// 弹框状态
const modalVisible = ref(false)
const detailLoading = ref(false)
const submitLoading = ref(false)

// 角色列表
const roleList = ref([])

// 表单数据
const formData = reactive({
    userId: "",
    username: "",
    nickname: "",
    roleIds: [],
})

// 显示弹框
const show = async (row) => {
    formData.userId = row.id
    formData.username = row.username
    formData.nickname = row.nickname
    formData.roleIds = []
    
    detailLoading.value = true
    modalVisible.value = true

    try {
        // 获取用户已有角色
        const userRoleResult = await request({
            url: '/admin-api/system/permission/list-user-roles?userId=' + row.id,
            method: 'GET',
        })
        if (userRoleResult.code === 0) {
            formData.roleIds = userRoleResult.data || []
        } else {
            ElMessage.error(userRoleResult.msg)
        }

        // 获取角色列表
        const roleResult = await getRoleApi()
        if (roleResult.code === 0) {
            roleList.value = roleResult.data || []
        } else {
            ElMessage.error(roleResult.msg)
        }
    } finally {
        detailLoading.value = false
    }
}

// 提交
const handleSubmit = async () => {
    if (!formData.roleIds.length) {
        ElMessage('请选择用户角色')
        return
    }

    submitLoading.value = true
    try {
        const result = await request({
            url: "/admin-api/system/permission/assign-user-role",
            method: "POST",
            data: {
                userId: formData.userId,
                roleIds: formData.roleIds,
            },
        })
        if (result.code === 0) {
            ElMessage.success('设置角色成功')
            modalVisible.value = false
            emit('success')
        } else {
            ElMessage.error(result.msg)
        }
    } finally {
        submitLoading.value = false
    }
}

defineExpose({ show })
</script>

