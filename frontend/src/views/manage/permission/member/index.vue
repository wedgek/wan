<template>
    <div class="page-container">
        <!-- Tab 切换导航 -->
        <div class="page-filter-box">
            <CzTabs v-model="activeName" :tabs="tabsConfig" type="card" size="small" />
        </div>
        
        <!-- 内容区域 -->
        <div class="page-content">
            <MemberTab v-if="activeName === 'member'" />
            <DepartmentTab v-if="activeName === 'department'" />
        </div>
    </div>
</template>

<script setup name="managePermissionMember">
import { User, OfficeBuilding } from '@element-plus/icons-vue'
import { iconfontIcons } from '@/plugins/iconfont'
import { markRaw } from 'vue'
import CzTabs from '@/components/cz-tabs/index.vue'
import MemberTab from "./member-list/index.vue"
import DepartmentTab from "./department/index.vue"

const activeName = ref("member")

const tabsConfig = [
    { label: '成员列表', value: 'member', icon: markRaw(iconfontIcons.User) },
    { label: '部门列表', value: 'department', icon: markRaw(OfficeBuilding) },
]
</script>

<style lang="scss" scoped>
.page-container {
    .page-filter-box {
        margin-bottom: 14px;
    }
    
    .page-content {
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }
}
</style>
