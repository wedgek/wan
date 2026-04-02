<template>
    <el-dialog
        v-model="modalVisible"
        :title="modalMode === 'add' ? '新增角色' : '编辑角色'"
        width="700px"
        destroy-on-close
    >
        <el-form :model="formData" label-width="90px" v-loading="detailLoading">
            <el-form-item label="角色名称" v-required-dot>
                <el-input v-model="formData.name" placeholder="请输入角色名称" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="角色标识" v-required-dot>
                <el-input v-model="formData.code" placeholder="请输入角色标识" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="显示排序" v-required-dot>
                <el-input-number v-model="formData.sort" :min="1" :max="9999" />
            </el-form-item>

            <el-form-item label="角色状态">
                <el-radio-group v-model="formData.status">
                    <el-radio :value="0" border>开启</el-radio>
                    <el-radio :value="1" border>关闭</el-radio>
                </el-radio-group>
            </el-form-item>

            <el-form-item label="角色备注">
                <el-input v-model="formData.remark" placeholder="请输入角色备注" clearable clear-icon="Close" />
            </el-form-item>
        </el-form>

        <template #footer>
            <el-button @click="modalVisible = false">取消</el-button>
            <el-button type="primary" @click="handleSubmit" :loading="modalLoading">确定</el-button>
        </template>
    </el-dialog>
</template>

<script setup>
import request from "@/request"
import { resetState, cloneDeep } from "@/utils/lodash"

const emit = defineEmits(['success'])

// 弹框状态
const modalVisible = ref(false)
const modalMode = ref("add")
const modalLoading = ref(false)
const detailLoading = ref(false)

// 表单数据
const defaultFormData = () => ({
    id: "",
    name: "",
    code: "",
    sort: 0,
    status: 0,
    remark: "",
})
const formData = reactive(defaultFormData())

// 新增
const showAdd = () => {
    modalMode.value = "add"
    resetState(formData, defaultFormData())
    modalVisible.value = true
}

// 编辑
const showEdit = async (row) => {
    modalMode.value = "edit"
    resetState(formData, defaultFormData())
    modalVisible.value = true
    
    // 直接使用行数据
    Object.keys(formData).forEach(k => formData[k] = row[k])
}

// 表单验证
const validateForm = () => {
    if (!formData.name?.trim()) {
        ElMessage('请输入角色名称')
        return false
    }
    if (!formData.code?.trim()) {
        ElMessage('请输入角色标识')
        return false
    }
    if (formData.sort === null || formData.sort === '') {
        ElMessage('请输入显示排序')
        return false
    }
    return true
}

// 提交
const handleSubmit = async () => {
    if (!validateForm()) return

    const isAdd = modalMode.value === "add"
    const data = cloneDeep(formData)
    if (isAdd) delete data.id

    modalLoading.value = true
    try {
        const result = await request({
            url: isAdd ? "/admin-api/system/role/create" : "/admin-api/system/role/update",
            method: isAdd ? "POST" : "PUT",
            data
        })
        if (result.code === 0) {
            ElMessage.success(isAdd ? "创建成功" : "更新成功")
            modalVisible.value = false
            emit('success')
        } else {
            ElMessage.error(result.msg)
        }
    } finally {
        modalLoading.value = false
    }
}

defineExpose({ showAdd, showEdit })
</script>

