<template>
    <el-dialog
        v-model="modalVisible"
        :title="modalMode === 'add' ? '新增提示词' : '编辑提示词'"
        width="720px"
        destroy-on-close
    >
        <el-form :model="formData" label-width="90px">
            <el-form-item label="名称" v-required-dot>
                <el-input v-model="formData.name" placeholder="如：客服开场白" clearable clear-icon="Close" />
            </el-form-item>
            <el-form-item label="场景编码">
                <el-input v-model="formData.scene" placeholder="可选，如 chat_reply / summary" clearable clear-icon="Close" />
            </el-form-item>
            <el-form-item label="提示词" v-required-dot>
                <el-input
                    v-model="formData.content"
                    type="textarea"
                    :rows="10"
                    placeholder="输入完整的系统提示词或模板内容"
                    maxlength="8000"
                    show-word-limit
                />
            </el-form-item>
            <el-form-item label="排序">
                <el-input-number v-model="formData.sort" :min="0" :max="9999" />
            </el-form-item>
            <el-form-item label="状态">
                <el-radio-group v-model="formData.status">
                    <el-radio :value="0" border>启用</el-radio>
                    <el-radio :value="1" border>停用</el-radio>
                </el-radio-group>
            </el-form-item>
            <el-form-item label="备注">
                <el-input v-model="formData.remark" placeholder="可选" clearable clear-icon="Close" />
            </el-form-item>
        </el-form>

        <template #footer>
            <el-button @click="modalVisible = false">取消</el-button>
            <el-button type="primary" @click="handleSubmit" :loading="modalLoading">确定</el-button>
        </template>
    </el-dialog>
</template>

<script setup>
import request from '@/request'
import { resetState, cloneDeep } from '@/utils/lodash'

const emit = defineEmits(['success'])

const modalVisible = ref(false)
const modalMode = ref('add')
const modalLoading = ref(false)

const defaultFormData = () => ({
    id: '',
    name: '',
    scene: '',
    content: '',
    sort: 0,
    status: 0,
    remark: '',
})
const formData = reactive(defaultFormData())

const showAdd = () => {
    modalMode.value = 'add'
    resetState(formData, defaultFormData())
    modalVisible.value = true
}

const showEdit = (row) => {
    modalMode.value = 'edit'
    resetState(formData, defaultFormData())
    modalVisible.value = true
    Object.keys(formData).forEach((k) => {
        if (row[k] !== undefined) formData[k] = row[k]
    })
}

const validateForm = () => {
    if (!formData.name?.trim()) {
        ElMessage('请填写名称')
        return false
    }
    if (!formData.content?.trim()) {
        ElMessage('请填写提示词内容')
        return false
    }
    return true
}

const handleSubmit = async () => {
    if (!validateForm()) return

    const isAdd = modalMode.value === 'add'
    const data = cloneDeep(formData)
    if (isAdd) delete data.id

    modalLoading.value = true
    try {
        const result = await request({
            url: isAdd ? '/admin-api/system/ai-prompt/create' : '/admin-api/system/ai-prompt/update',
            method: isAdd ? 'POST' : 'PUT',
            data,
        })
        if (result.code === 0) {
            ElMessage.success(isAdd ? '创建成功' : '更新成功')
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
