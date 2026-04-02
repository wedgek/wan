<template>
    <el-dialog
        v-model="modalVisible"
        title="角色菜单权限"
        width="800px"
        top="5%"
        destroy-on-close
    >
        <el-form :model="formData" label-width="90px" v-loading="detailLoading">
            <el-form-item label="角色名称">
                <el-input v-model="formData.name" disabled />
            </el-form-item>

            <el-form-item label="角色标识">
                <el-input v-model="formData.code" disabled />
            </el-form-item>

            <el-form-item label="菜单权限">
                <div class="tree-wrapper">
                    <!-- 搜索框 -->
                    <div class="tree-search">
                        <el-input
                            v-model="searchKeyword"
                            placeholder="搜索菜单"
                            :prefix-icon="$icons.Search"
                            clearable
                            clear-icon="Close"
                        />
                    </div>
                    
                    <!-- 工具栏 -->
                    <div class="tree-toolbar">
                        <el-checkbox v-model="selectAll" @change="handleSelectAllChange">全选</el-checkbox>
                        <el-button link type="primary" @click="toggleExpandAll" :icon="expandAll ? $icons.FolderOpened : $icons.Folder">
                            {{ expandAll ? '收起全部' : '展开全部' }}
                        </el-button>
                    </div>
                    
                    <!-- 树形结构 -->
                    <div class="tree-container">
                        <el-tree
                            ref="treeRef"
                            node-key="id"
                            show-checkbox
                            :data="menuTreeData"
                            :props="{ children: 'children', label: 'name' }"
                            :default-checked-keys="formData.menuIds"
                            :filter-node-method="filterNode"
                            @check="handleCheckChange"
                        />
                    </div>
                </div>
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
import { getMenuApi } from "@/api/system.js"
import { createTree } from "@/utils/tree.js"

const emit = defineEmits(['success'])

// 弹框状态
const modalVisible = ref(false)
const modalLoading = ref(false)
const detailLoading = ref(false)

// 搜索关键词
const searchKeyword = ref('')

// 树相关
const treeRef = ref()
const menuListData = ref([])
const menuTreeData = ref([])
const selectAll = ref(false)
const expandAll = ref(false)
const checkedMenuIds = ref([])

// 表单数据
const formData = reactive({
    roleId: "",
    name: "",
    code: "",
    menuIds: [],
})

// 监听搜索关键词变化
watch(searchKeyword, (val) => {
    treeRef.value?.filter(val)
})

// 过滤节点
const filterNode = (value, data) => {
    if (!value) return true
    return data.name.toLowerCase().includes(value.toLowerCase())
}

// 显示弹框
const show = async (row) => {
    // 重置状态
    formData.roleId = row.id
    formData.name = row.name
    formData.code = row.code
    formData.menuIds = []
    selectAll.value = false
    expandAll.value = false
    checkedMenuIds.value = []
    searchKeyword.value = ''
    
    detailLoading.value = true
    modalVisible.value = true

    try {
        // 获取菜单列表
        const menuResult = await getMenuApi()
        if (menuResult.code === 0) {
            menuListData.value = menuResult.data
            menuTreeData.value = createTree(menuResult.data)
        } else {
            ElMessage.error(menuResult.msg)
        }

        // 获取角色已有菜单
        const roleMenuResult = await request({
            url: `/admin-api/system/permission/list-role-menus?roleId=${row.id}`,
            method: "GET",
        })
        if (roleMenuResult.code === 0) {
            checkedMenuIds.value = roleMenuResult.data
            formData.menuIds = roleMenuResult.data
            
            // 回显时需要过滤掉父节点，只设置叶子节点
            nextTick(() => {
                menuListData.value.forEach((item) => {
                    if (!formData.menuIds.includes(item.id)) {
                        treeRef.value?.setChecked(item.id, false)
                    }
                })
            })
            
            // 判断是否全选
            selectAll.value = formData.menuIds.length === menuListData.value.length
        } else {
            ElMessage.error(roleMenuResult.msg)
        }
    } finally {
        detailLoading.value = false
    }
}

// 全选切换
const handleSelectAllChange = (val) => {
    const nodes = treeRef.value?.store._getAllNodes()
    nodes?.forEach(node => node.checked = val)
    updateCheckedMenuIds()
}

// 展开/收起全部
const toggleExpandAll = () => {
    expandAll.value = !expandAll.value
    const nodes = treeRef.value?.store._getAllNodes()
    nodes?.forEach(node => node.expanded = expandAll.value)
}

// 选中改变
const handleCheckChange = () => {
    updateCheckedMenuIds()
    selectAll.value = formData.menuIds.length === menuListData.value.length
}

// 更新选中的菜单ID
const updateCheckedMenuIds = () => {
    formData.menuIds = treeRef.value?.getCheckedKeys() || []
    const checkedNodes = treeRef.value?.getCheckedNodes(false, true) || []
    checkedMenuIds.value = checkedNodes.map(item => item.id)
}

// 提交
const handleSubmit = async () => {
    modalLoading.value = true
    try {
        const result = await request({
            url: "/admin-api/system/permission/assign-role-menu",
            method: "POST",
            data: {
                roleId: formData.roleId,
                menuIds: checkedMenuIds.value,
            },
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
.tree-wrapper {
    width: 100%;
    border: 1px solid #e4e7ed;
    border-radius: 4px;
    overflow: hidden;
}

.tree-search {
    padding: 12px;
    border-bottom: 1px solid #e4e7ed;
    background-color: #fafafa;
}

.tree-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid #e4e7ed;
    background-color: #fafafa;
    
    .el-button {
        font-size: 13px;
    }
}

.tree-container {
    max-height: 350px;
    overflow-y: auto;
    padding: 8px 0;
    
    :deep(.el-tree-node__content) {
        height: 32px;
    }
    
    :deep(.el-tree-node__label) {
        font-size: 13px;
    }
}
</style>
