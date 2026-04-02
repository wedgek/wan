<template>
    <el-dialog
        v-model="modalVisible"
        title="角色数据权限"
        width="700px"
        destroy-on-close
    >
        <el-form :model="formData" label-width="90px" v-loading="detailLoading">
            <el-form-item label="角色名称">
                <el-input v-model="formData.name" disabled />
            </el-form-item>

            <el-form-item label="角色标识">
                <el-input v-model="formData.code" disabled />
            </el-form-item>

            <el-form-item label="权限范围">
                <el-select v-model="formData.dataScope" style="width: 100%">
                    <el-option label="全部数据权限" :value="1" />
                    <el-option label="指定部门数据权限" :value="2" />
                    <el-option label="部门数据权限" :value="3" />
                    <el-option label="部门及以下数据权限" :value="4" />
                    <el-option label="仅本人数据权限" :value="5" />
                </el-select>
            </el-form-item>

            <el-form-item label="选择部门" v-if="formData.dataScope === 2">
                <el-card style="width: 100%">
                    <template #header>
                        <div class="tree-header">
                            <span>
                                全选所有
                                <el-switch
                                    v-model="selectAll"
                                    @change="handleSelectAllChange"
                                    inline-prompt
                                    active-text="是"
                                    inactive-text="否"
                                />
                            </span>
                            <span>
                                展开菜单
                                <el-switch
                                    v-model="expandAll"
                                    @change="handleExpandAllChange"
                                    inline-prompt
                                    active-text="是"
                                    inactive-text="否"
                                />
                            </span>
                        </div>
                    </template>
                    <div class="tree-container">
                        <el-tree
                            ref="treeRef"
                            node-key="id"
                            show-checkbox
                            :data="departmentTreeData"
                            :props="{ children: 'children', label: 'name' }"
                            :default-checked-keys="formData.dataScopeDeptIds"
                            @check="handleCheckChange"
                        />
                    </div>
                </el-card>
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
import { getDepartmentApi } from "@/api/system.js"
import { createTree } from "@/utils/tree.js"

const emit = defineEmits(['success'])

// 弹框状态
const modalVisible = ref(false)
const modalLoading = ref(false)
const detailLoading = ref(false)

// 树相关
const treeRef = ref()
const departmentListData = ref([])
const departmentTreeData = ref([])
const selectAll = ref(false)
const expandAll = ref(false)

// 表单数据
const formData = reactive({
    roleId: "",
    name: "",
    code: "",
    dataScope: 1,
    dataScopeDeptIds: [],
})

// 显示弹框
const show = async (row) => {
    // 重置状态
    formData.roleId = row.id
    formData.name = row.name
    formData.code = row.code
    formData.dataScope = row.dataScope || 1
    formData.dataScopeDeptIds = row.dataScopeDeptIds || []
    selectAll.value = false
    expandAll.value = false
    
    detailLoading.value = true
    modalVisible.value = true

    try {
        // 获取部门列表
        const result = await getDepartmentApi()
        if (result.code === 0) {
            departmentListData.value = result.data
            departmentTreeData.value = createTree(result.data)
            
            // 判断是否全选
            selectAll.value = formData.dataScopeDeptIds.length === departmentListData.value.length
        } else {
            ElMessage.error(result.msg)
        }
    } finally {
        detailLoading.value = false
    }
}

// 全选切换
const handleSelectAllChange = (val) => {
    const nodes = treeRef.value?.store._getAllNodes()
    nodes?.forEach(node => node.checked = val)
    formData.dataScopeDeptIds = treeRef.value?.getCheckedKeys() || []
}

// 展开切换
const handleExpandAllChange = (val) => {
    const nodes = treeRef.value?.store._getAllNodes()
    nodes?.forEach(node => node.expanded = val)
}

// 选中改变
const handleCheckChange = () => {
    formData.dataScopeDeptIds = treeRef.value?.getCheckedKeys() || []
    selectAll.value = formData.dataScopeDeptIds.length === departmentListData.value.length
}

// 提交
const handleSubmit = async () => {
    const data = {
        roleId: formData.roleId,
        dataScope: formData.dataScope,
    }
    
    if (formData.dataScope === 2) {
        data.dataScopeDeptIds = formData.dataScopeDeptIds
    }

    modalLoading.value = true
    try {
        const result = await request({
            url: "/admin-api/system/permission/assign-role-data-scope",
            method: "POST",
            data,
        })
        if (result.code === 0) {
            ElMessage.success("更新成功")
            modalVisible.value = false
            emit('success')
        } else {
            ElMessage.error(result.msg)
        }
    } finally {
        modalLoading.value = false
    }
}

defineExpose({ show })
</script>

<style lang="scss" scoped>
.tree-header {
    display: flex;
    gap: 20px;
}

.tree-container {
    max-height: 350px;
    overflow-y: auto;
}
</style>

