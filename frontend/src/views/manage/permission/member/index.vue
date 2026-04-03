<template>
    <div class="page-container">
        <!-- 顶栏：与内容区等宽底边，类似标签页下划线 -->
        <div class="member-tab-strip">
            <CzTabs v-model="activeName" :tabs="tabsConfig" type="line" size="default" />
        </div>

        <div class="member-subpage">
            <MemberTab v-if="activeName === 'member'" />
            <DepartmentTab v-if="activeName === 'department'" />
        </div>
    </div>
</template>

<script setup name="managePermissionMember">
import CzTabs from '@/components/cz-tabs/index.vue'
import MemberTab from "./member-list/index.vue"
import DepartmentTab from "./department/index.vue"

const activeName = ref("member")

const tabsConfig = [
    { label: '用户', value: 'member' },
    { label: '部门', value: 'department' },
]
</script>

<style lang="scss" scoped>
.member-tab-strip {
    flex-shrink: 0;
    width: 100%;
    padding-top: 2px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}

/* 承接全局 .page-container 的 flex 列布局，相当于表格区的伸展占位 */
.member-subpage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
</style>
