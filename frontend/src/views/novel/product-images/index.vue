<template>
  <div class="page-container novel-page has-toolbar">
    <div class="page-table-header">
      <el-upload
        :auto-upload="false"
        :show-file-list="false"
        accept="image/jpeg,image/png,image/webp"
        multiple
        :on-change="onPick"
      >
        <el-button type="primary" :icon="$icons.Upload" :loading="uploading">上传图片</el-button>
      </el-upload>
      <span class="hint">搭建商品时从这里随机抽一张。点击图片可预览，支持 JPG、PNG、WebP。</span>
    </div>
    <div v-loading="loading" class="grid">
      <div v-for="(item, index) in list" :key="item.id" class="card">
        <el-image
          :src="item.url"
          fit="cover"
          :preview-src-list="urls"
          :initial-index="index"
          preview-teleported
          hide-on-click-modal
          :title="item.name || '产品图'"
        />
        <div class="card-foot">
          <el-button type="primary" link @click="openPreview(index)">预览</el-button>
          <el-button type="primary" link @click="download(item)">下载</el-button>
          <el-button type="danger" link @click="remove(item)">删除</el-button>
        </div>
      </div>
      <el-empty v-if="!loading && !list.length" description="还没有产品图" />
    </div>
    <el-image-viewer
      v-if="previewVisible"
      :url-list="urls"
      :initial-index="previewIndex"
      teleported
      hide-on-click-modal
      @close="previewVisible = false"
    />
  </div>
</template>

<script setup name="novelProductImages">
import request from "@/request"
import { uploadWithProgress } from "@/request/oss"

const list = ref([])
const loading = ref(false)
const uploading = ref(false)
const previewVisible = ref(false)
const previewIndex = ref(0)
const urls = computed(() => list.value.map((item) => item.url).filter(Boolean))

onMounted(load)

async function load() {
  loading.value = true
  try {
    const res = await request({ url: "/admin-api/oceanengine/covers" })
    list.value = res.code === 0 && Array.isArray(res.data) ? res.data : []
    if (res.code !== 0) ElMessage.error(res.msg || "读取失败")
  } finally {
    loading.value = false
  }
}

async function onPick(file) {
  const raw = file?.raw
  if (!raw) return
  uploading.value = true
  try {
    const uploaded = await uploadWithProgress(raw, { dir: "image/" })
    const res = await request({
      url: "/admin-api/oceanengine/covers",
      method: "POST",
      data: { url: uploaded.url, name: raw.name },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "保存失败")
      return
    }
    ElMessage.success("已上传")
    await load()
  } catch (e) {
    ElMessage.error(e.message || "上传失败")
  } finally {
    uploading.value = false
  }
}

function openPreview(index) {
  previewIndex.value = index
  previewVisible.value = true
}

function fileName(item) {
  const name = String(item.name || "").trim()
  if (/\.(jpe?g|png|webp)$/i.test(name)) return name
  const matched = String(item.url || "").match(/\.(jpe?g|png|webp)(?:\?|$)/i)
  const ext = matched ? matched[1].toLowerCase().replace("jpeg", "jpg") : "jpg"
  return `${name || "产品图"}.${ext}`
}

async function download(item) {
  const name = fileName(item)
  try {
    const res = await fetch(item.url)
    if (!res.ok) throw new Error("下载失败")
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = name
    link.click()
    URL.revokeObjectURL(href)
  } catch {
    const link = document.createElement("a")
    link.href = item.url
    link.target = "_blank"
    link.rel = "noopener"
    link.download = name
    link.click()
  }
}

async function remove(item) {
  try {
    await ElMessageBox.confirm("删除后，搭建商品时不会再抽到这张图。", "删除产品图", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    })
  } catch {
    return
  }
  const res = await request({ url: `/admin-api/oceanengine/covers/${item.id}`, method: "DELETE" })
  if (res.code !== 0) {
    ElMessage.error(res.msg || "删除失败")
    return
  }
  list.value = list.value.filter((row) => row.id !== item.id)
}
</script>

<style scoped lang="scss">
@use "../novel-page.scss";

.hint {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 180px;
}

.card {
  width: 180px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  overflow: hidden;

  :deep(.el-image) {
    display: block;
    width: 180px;
    height: 180px;
    cursor: zoom-in;
    background: var(--el-fill-color-light);
  }
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 4px;
  padding: 4px 4px 6px;

  :deep(.el-button) {
    margin: 0;
    padding: 0 2px;
    font-size: 13px;
  }
}
</style>
