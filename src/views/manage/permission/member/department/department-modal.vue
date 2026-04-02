<template>
    <el-dialog
        v-model="modalVisible"
        :title="modalMode === 'add' ? '新增部门' : '编辑部门'"
        width="700"
        destroy-on-close
        @closed="handleClosed"
    >
        <el-form :model="formData" label-width="90px" v-loading="modalLoading">
            <el-form-item label="上级部门" v-required-dot>
                <el-tree-select
                    v-model="formData.parentId"
                    :data="deptTreeData"
                    :props="{ children: 'children', label: 'name', value: 'id' }"
                    check-strictly
                    default-expand-all
                    clearable
                    clear-icon="Close"
                    placeholder="请选择上级部门"
                />
            </el-form-item>

            <el-form-item label="部门名称" v-required-dot>
                <el-input v-model="formData.name" placeholder="请输入部门名称" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="显示排序" v-required-dot>
                <el-input-number v-model="formData.sort" :min="1" :max="9999" />
            </el-form-item>

            <el-form-item label="负责人">
                <CzUserSelect v-model="formData.leaderUserId" placeholder="请选择负责人" />
            </el-form-item>

            <el-form-item label="联系电话">
                <el-input v-model="formData.phone" maxlength="11" placeholder="请输入联系电话" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="邮箱">
                <el-input v-model="formData.email" maxlength="50" placeholder="请输入邮箱" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="状态">
                <el-select v-model="formData.status" placeholder="请选择状态" style="width: 100%" clear-icon="Close">
                    <el-option label="开启" :value="0" />
                    <el-option label="关闭" :value="1" />
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
import { resetState } from "@/utils/lodash.js"
import { getDepartmentApi } from "@/api/system.js"
import { createTree } from "@/utils/tree.js"
import CzUserSelect from '@/components/cz-user-select/index.vue'

const emit = defineEmits(['success'])

// 弹框状态
const modalVisible = ref(false)
const modalMode = ref('add')
const modalLoading = ref(false)
const submitLoading = ref(false)

// 部门树数据
const deptTreeData = ref([])

// 默认表单数据
const defaultFormData = () => ({
    id: "",
    name: "",
    parentId: "",
    sort: 0,
    leaderUserId: "",
    phone: "",
    email: "",
    status: 0,
})

const formData = reactive(defaultFormData())

// 获取部门树数据
const getDeptTreeData = async () => {
    try {
        const result = await getDepartmentApi()
        if (result.code === 0) {
            deptTreeData.value = [{ id: 0, name: "顶级部门", children: createTree(result.data || []) }]
        } else {
            ElMessage.error(result.msg)
        }
    } catch (error) {
        console.error('获取部门列表失败:', error)
    }
}

// 显示新增弹框
const showAdd = () => {
    modalMode.value = 'add'
    resetState(formData, defaultFormData())
    modalVisible.value = true
    getDeptTreeData()
}

// 显示编辑弹框
const showEdit = (row) => {
    modalMode.value = 'edit'
    resetState(formData, defaultFormData())
    modalVisible.value = true
    getDeptTreeData()
    
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
    if (formData.parentId === '' || formData.parentId === null || formData.parentId === undefined) {
        ElMessage('请选择上级部门')
        return false
    }
    if (!formData.name?.trim()) {
        ElMessage('请输入部门名称')
        return false
    }
    if (formData.sort === null || formData.sort === '') {
        ElMessage('请输入显示排序')
        return false
    }
    return true
}

// 提交表单
const handleSubmit = async () => {
    if (!validateForm()) return

    const isEdit = modalMode.value === 'edit'
    const url = isEdit ? '/admin-api/system/dept/update' : '/admin-api/system/dept/create'
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