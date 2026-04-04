<template>
  <!-- 有子菜单 -->
  <el-sub-menu
    v-if="hasVisibleChildren"
    :index="fullPath"
  >
    <template #title>
      <el-icon v-if="menu.icon" :class="menuIconClass">
        <component :is="menu.icon" />
      </el-icon>
      <span>{{ menu.name }}</span>
    </template>

    <!-- 递归渲染子菜单 -->
    <menu-item
      v-for="child in visibleChildren"
      :key="child.id"
      :menu="child"
      :base-path="fullPath"
    />
  </el-sub-menu>

  <!-- 无子菜单或只有一个子菜单（已被扁平化处理） -->
  <el-menu-item
    v-else
    :index="fullPath"
    @click="onMenuItemClick"
  >
    <el-icon v-if="menu.icon" :class="menuIconClass">
      <component :is="menu.icon" />
    </el-icon>
    <span>{{ menu.name }}</span>
  </el-menu-item>
</template>

<script setup>
import { useRouter } from "vue-router"

const router = useRouter()

const props = defineProps({
  menu: { type: Object, required: true },
  basePath: { type: String, default: '' }
})

/** 有 basePath 时为展开菜单下的子项（含多级子菜单标题），图标略小于顶级 */
const menuIconClass = computed(() => [
  'menu-icon',
  props.basePath ? 'menu-icon--nested' : null,
])

// 过滤可见的子菜单（status === 0 且 visible === true）
const visibleChildren = computed(() => {
  if (!props.menu.children?.length) return []
  return props.menu.children.filter(child => 
    child.status === 0 && child.visible === true
  )
})

// 是否有可见的子菜单
const hasVisibleChildren = computed(() => {
  return visibleChildren.value.length > 0
})

// 完整路径：相对 path 与父级 basePath 拼接；兼容后台误填为「/prompts」一类未带 /ai 前缀的绝对路径
const fullPath = computed(() => {
  const rawPath = props.menu.path != null && String(props.menu.path).trim() !== ""
    ? String(props.menu.path).trim()
    : ""
  const fallback = String(props.menu.id ?? "")
  let path = rawPath || fallback
  if (!path.startsWith("/")) {
    path = `${props.basePath}/${path}`.replace(/\/+/g, "/")
  } else if (
    props.basePath === "/ai" &&
    path !== props.basePath &&
    !path.startsWith(props.basePath + "/")
  ) {
    const segments = path.split("/").filter(Boolean)
    if (segments.length === 1) {
      path = `${props.basePath}/${segments[0]}`.replace(/\/+/g, "/")
    }
  }
  return path
})

function onMenuItemClick() {
  const path = fullPath.value
  if (!path.startsWith("/")) return
  router.push(path).catch((err) => {
    if (err?.name !== "NavigationDuplicated") console.warn("[sidebar] 菜单跳转失败:", path, err)
  })
}

</script>

<style scoped lang="scss">
.menu-icon {
  margin-right: 10px !important;
  font-size: 18px;
  vertical-align: middle;

  &--nested {
    margin-right: 8px !important;
    font-size: 15px;

    :deep(svg) {
      width: 1em;
      height: 1em;
    }
  }
}
</style>
