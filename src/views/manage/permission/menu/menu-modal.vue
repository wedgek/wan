<template>
    <el-dialog
        v-model="modalVisible"
        :title="modalMode === 'add' ? '新增菜单' : '编辑菜单'"
        width="800px"
        top="5%"
        destroy-on-close
    >
        <el-form :model="formData" label-width="90px" v-loading="detailLoading">
            <!-- 基础信息 -->
            <el-form-item label="上级菜单">
                <el-tree-select
                    style="width: 100%"
                    :default-expanded-keys="defaultExpandedKeys"
                    v-model="formData.parentId"
                    :data="menuTreeData"
                    :props="{ children: 'children', label: 'name', value: 'id' }"
                    check-strictly
                    placeholder="请选择上级菜单"
                    value-key="id"
                />
            </el-form-item>

            <el-form-item label="菜单类型">
                <CzCardSelect v-model="formData.type" :options="menuTypeOptions" />
            </el-form-item>

            <el-form-item label="菜单名称" v-required-dot>
                <el-input v-model="formData.name" placeholder="请输入菜单名称" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="菜单图标" v-if="formData.type !== 3">
                <el-popover :width="520" trigger="click" placement="bottom-start" :show-arrow="false">
                    <template #reference>
                        <div class="icon-selector-trigger">
                            <template v-if="formData.icon">
                                <el-icon :size="18" class="selected-icon">
                                    <component :is="ElementPlusIconsVue[formData.icon]" />
                                </el-icon>
                                <span class="icon-name">{{ formData.icon }}</span>
                                <el-icon class="clear-icon" @click.stop="formData.icon = ''">
                                    <Close />
                                </el-icon>
                            </template>
                            <span v-else class="placeholder">点击选择图标</span>
                        </div>
                    </template>
                    <div class="icon-picker">
                        <el-input v-model="iconSearch" placeholder="搜索图标" :prefix-icon="$icons.Search" clearable clear-icon="Close" class="icon-search" />
                        <div class="icon-grid">
                            <div 
                                v-for="item in filteredIcons" 
                                :key="item" 
                                class="icon-grid-item"
                                :class="{ active: formData.icon === item }"
                                @click="formData.icon = item"
                                :title="item"
                            >
                                <el-icon :size="22">
                                    <component :is="ElementPlusIconsVue[item]" />
                                </el-icon>
                            </div>
                        </div>
                    </div>
                </el-popover>
            </el-form-item>

            <!-- 路由配置 -->
            <el-form-item label="路由地址" v-if="formData.type !== 3" v-required-dot>
                <el-input v-model="formData.path" placeholder="请输入路由地址（导航和菜单必填，导航路由必须以 / 开头）" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="组件名字" v-if="formData.type === 2">
                <el-input v-model="formData.componentName" placeholder="请输入组件名称（有页面的子菜单必填，与前端页面路由导出命名一致）" clearable clear-icon="Close" />
            </el-form-item>

            <el-form-item label="权限标识" v-if="formData.type !== 1">
                <el-input v-model="formData.permission" placeholder="请输入权限标识（后端填写）" clearable clear-icon="Close" />
            </el-form-item>

            <!-- 状态配置 -->
            <el-form-item label="显示排序" v-required-dot>
                <el-input-number v-model="formData.sort" :min="1" :max="9999" />
            </el-form-item>

            <el-form-item label="菜单状态">
                <el-radio-group v-model="formData.status">
                    <el-radio :value="0" border>开启</el-radio>
                    <el-radio :value="1" border>关闭</el-radio>
                </el-radio-group>
            </el-form-item>

            <el-form-item label="是否显示">
                <el-radio-group v-model="formData.visible">
                    <el-radio :value="true" border>显示</el-radio>
                    <el-radio :value="false" border>不显示</el-radio>
                </el-radio-group>
            </el-form-item>
        </el-form>

        <template #footer>
            <el-button @click="modalVisible = false">取消</el-button>
            <el-button type="primary" @click="handleSubmit" :loading="modalLoading">确定</el-button>
        </template>
    </el-dialog>
</template>

<script setup>
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { iconfontIcons } from '@/plugins/iconfont'
import { Compass, Postcard, Pointer } from '@element-plus/icons-vue'
import request from "@/request"
import { resetState, cloneDeep } from "@/utils/lodash"
import CzCardSelect from '@/components/cz-card-select/index.vue'

const allIcons = Object.keys(ElementPlusIconsVue)
const menuTypeOptions = [
    { value: 1, label: '导航', icon: Compass },
    { value: 2, label: '菜单', icon: iconfontIcons.Menu },
    { value: 3, label: '按钮', icon: Pointer }
]

const props = defineProps({
    menuTreeData: {
        type: Array,
        default: () => []
    }
})

const emit = defineEmits(['success'])

// 图标搜索
const iconSearch = ref('')
const filteredIcons = computed(() => {
    if (!iconSearch.value) return allIcons
    const keyword = iconSearch.value.toLowerCase()
    return allIcons.filter(name => name.toLowerCase().includes(keyword))
})

// 弹框状态
const modalVisible = ref(false)
const modalMode = ref("add")
const modalLoading = ref(false)
const detailLoading = ref(false)
const defaultExpandedKeys = ref([])

// 表单数据
const defaultFormData = () => ({
    id: "",
    parentId: 0,
    type: 1,
    name: "",
    icon: "",
    path: "",
    componentName: "",
    permission: "",
    sort: 0,
    status: 0,
    visible: true,
})
const formData = reactive(defaultFormData())

// 新增
const showAdd = (parentId) => {
    modalMode.value = "add"
    resetState(formData, defaultFormData())
    formData.parentId = parentId
    defaultExpandedKeys.value = parentId ? [parentId] : [0]
    iconSearch.value = ''
    modalVisible.value = true
}

// 编辑
const showEdit = async (id) => {
    modalMode.value = "edit"
    resetState(formData, defaultFormData())
    iconSearch.value = ''
    modalVisible.value = true
    
    detailLoading.value = true
    try {
        const result = await request({ url: `/admin-api/system/menu/get?id=${id}`, method: "GET" })
        if (result.code === 0) {
            Object.keys(formData).forEach(k => formData[k] = result.data[k])
            defaultExpandedKeys.value = [formData.parentId]
        } else {
            ElMessage.error(result.msg)
        }
    } finally {
        detailLoading.value = false
    }
}

// 表单验证
const validateForm = () => {
    if (!formData.name?.trim()) {
        ElMessage('请输入菜单名称')
        return false
    }
    if (formData.type === 1) {
        if (!formData.path?.trim()) {
            ElMessage('请输入路由地址')
            return false
        }
        if (!formData.path.startsWith('/')) {
            ElMessage('导航路由必须以 / 开头')
            return false
        }
    }
    if (formData.type === 2 && !formData.path?.trim()) {
        ElMessage('请输入路由地址')
        return false
    }
    if (formData.sort === null) {
        ElMessage('请输入显示顺序')
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
            url: isAdd ? "/admin-api/system/menu/create" : "/admin-api/system/menu/update",
            method: isAdd ? "POST" : "PUT",
            data
        })
        if (result.code === 0) {
            ElMessage.success(isAdd ? "添加成功" : "修改成功")
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

<style lang="scss" scoped>
// 图标选择触发器
.icon-selector-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 200px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid #dcdfe6;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
        border-color: #409eff;
    }

    .selected-icon {
        color: #409eff;
    }

    .icon-name {
        flex: 1;
        color: #606266;
        font-size: 12px;
    }

    .placeholder {
        flex: 1;
        color: #a8abb2;
        font-size: 12px;
    }

    .clear-icon {
        color: #c0c4cc;
        font-size: 14px;
        transition: color 0.2s;
        
        &:hover {
            color: #909399;
        }
    }
}

// 图标选择面板
.icon-picker {
    .icon-search {
        margin-bottom: 12px;
    }

    .icon-grid {
        display: grid;
        grid-template-columns: repeat(10, 1fr);
        gap: 8px;
        max-height: 320px;
        overflow-y: auto;
        padding: 4px;

        .icon-grid-item {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border: 1px solid #ebeef5;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
            color: #606266;

            &:hover {
                border-color: #409eff;
                color: #409eff;
                background-color: #ecf5ff;
            }

            &.active {
                border-color: #409eff;
                color: #fff;
                background-color: #409eff;
            }
        }
    }
}
</style>
