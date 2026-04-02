<template>
    <el-dialog
        v-model="modalVisible"
        :title="modalMode === 'add' ? '新增成员' : '编辑成员'"
        width="700"
        destroy-on-close
        @closed="handleClosed"
    >
        <el-form :model="formData" label-width="90px" v-loading="modalLoading">
            <el-form-item label="姓名" v-required-dot>
                <el-input v-model="formData.nickname" maxlength="30" placeholder="请输入姓名" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="归属部门" v-required-dot>
                <el-tree-select
                    v-model="formData.deptId"
                    :data="deptTreeData"
                    :props="{ children: 'children', label: 'name', value: 'id' }"
                    check-strictly
                    default-expand-all
                    placeholder="请选择归属部门"
                    clearable
                    clear-icon="Close"
                />
            </el-form-item>

            <el-form-item label="手机号码">
                <el-input v-model="formData.mobile" placeholder="请输入手机号码" maxlength="11" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="用户邮箱">
                <el-input v-model="formData.email" placeholder="请输入用户邮箱" maxlength="50" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item v-if="modalMode === 'add'" label="用户账号" v-required-dot>
                <el-input v-model="formData.username" maxlength="30" clearable placeholder="请输入用户账号" clear-icon="Close" />
            </el-form-item>

            <el-form-item v-if="modalMode === 'add'" label="用户密码" v-required-dot>
                <el-input v-model="formData.password" type="password" maxlength="16" clearable show-password placeholder="请输入用户密码" clear-icon="Close" />
            </el-form-item>

            <el-form-item label="用户性别">
                <el-select v-model="formData.sex" clearable placeholder="请选择用户性别" clear-icon="Close">
                    <el-option label="男" :value="1" />
                    <el-option label="女" :value="2" />
                    <el-option label="未知" :value="0" />
                </el-select>
            </el-form-item>

            <el-form-item label="成员备注">
                <el-input v-model="formData.remark" type="textarea" :rows="3" placeholder="请输入备注" />
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
import { resetState } from "@/utils/lodash.js"

const props = defineProps({
    deptTreeData: {
        type: Array,
        default: () => []
    }
})

const emit = defineEmits(['success'])

// 弹框状态
const modalVisible = ref(false)
const modalMode = ref('add')
const modalLoading = ref(false)
const submitLoading = ref(false)

// 默认表单数据
const defaultFormData = () => ({
    id: "",
    nickname: "",
    deptId: "",
    mobile: "",
    email: "",
    username: "",
    password: "",
    sex: "",
    remark: "",
})

const formData = reactive(defaultFormData())

// 显示新增弹框
const showAdd = () => {
    modalMode.value = 'add'
    resetState(formData, defaultFormData())
    modalVisible.value = true
}

// 显示编辑弹框
const showEdit = (row) => {
    modalMode.value = 'edit'
    resetState(formData, defaultFormData())
    modalVisible.value = true
    
    // 赋值表单
    Object.keys(formData).forEach(key => {
        if (row[key] !== undefined) {
            formData[key] = row[key]
        }
    })
}

// 弹框关闭回调
const handleClosed = () => {
    resetState(formData, defaultFormData())
}

// 表单验证
const validateForm = () => {
    if (!formData.nickname?.trim()) {
        ElMessage('请输入姓名')
        return false
    }
    if (!formData.deptId) {
        ElMessage('请选择归属部门')
        return false
    }
    if (modalMode.value === 'add') {
        if (!formData.username?.trim()) {
            ElMessage('请输入用户账号')
            return false
        }
        if (formData.username.length < 4 || formData.username.length > 30) {
            ElMessage('用户账号长度为4-30个字符')
            return false
        }
        if (!formData.password?.trim()) {
            ElMessage('请输入用户密码')
            return false
        }
        if (formData.password.length < 6 || formData.password.length > 16) {
            ElMessage('用户密码长度为6-16个字符')
            return false
        }
    }
    return true
}

// 提交表单
const handleSubmit = async () => {
    if (!validateForm()) return

    const isEdit = modalMode.value === 'edit'
    const url = isEdit ? '/admin-api/system/user/update' : '/admin-api/system/user/create'
    const method = isEdit ? 'PUT' : 'POST'

    const data = { ...formData }
    if (!isEdit) {
        delete data.id
    }

    submitLoading.value = true
    try {
        const result = await request({ url, method, data })
        if (result.code === 0) {
            ElMessage.success(isEdit ? '更新成功' : '创建成功')
            modalVisible.value = false
            emit('success')
        } else {
            ElMessage.error(result.msg)
        }
    } finally {
        submitLoading.value = false
    }
}

defineExpose({ showAdd, showEdit })
</script>

