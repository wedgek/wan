<template>
  <el-dialog
    :model-value="modelValue"
    title="从产品库选择"
    width="min(860px, 96vw)"
    append-to-body
    align-center
    destroy-on-close
    class="vc-product-lib-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
    @open="onOpen"
  >
    <div class="pl-picker-toolbar">
      <el-input
        v-model="keyword"
        placeholder="产品名称"
        clearable
        class="pl-picker-toolbar__input"
        :suffix-icon="$icons.Search"
        @keyup.enter="fetchList"
      />
      <el-button type="primary" @click="fetchList">查询</el-button>
    </div>
    <el-table
      :data="list"
      v-loading="loading"
      border
      height="380"
      highlight-current-row
      :header-cell-style="{ textAlign: 'center' }"
      @row-click="onRowClick"
    >
      <el-table-column prop="id" label="产品ID" width="92" align="center" />
      <el-table-column prop="name" label="产品名称" min-width="120" align="center" show-overflow-tooltip />
      <el-table-column label="预览" min-width="220" align="center">
        <template #default="{ row }">
          <div class="pl-picker-thumbs" @click.stop>
            <template v-if="rowThumbUrls(row).length">
              <el-image
                v-for="(u, i) in rowThumbUrls(row)"
                :key="i + u.slice(-16)"
                :src="u"
                class="pl-picker-thumb"
                fit="cover"
                :preview-src-list="rowImageUrls(row)"
                :initial-index="i"
                preview-teleported
                hide-on-click-modal
              />
            </template>
            <span v-else class="pl-picker-thumbs__empty">—</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="88" align="center">
        <template #default="{ row }">
          <el-button type="primary" link @click.stop="pick(row)">选择</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pl-picker-page">
      <el-pagination
        v-model:current-page="pageNo"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        teleported
        @current-change="fetchList"
        @size-change="onSizeChange"
      />
    </div>
  </el-dialog>
</template>

<script setup>
import { ref } from "vue"
import { ElMessage } from "element-plus"
import request from "@/request"

defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(["update:modelValue", "picked"])

const keyword = ref("")
const pageNo = ref(1)
const pageSize = ref(20)
const total = ref(0)
const list = ref([])
const loading = ref(false)

function rowImageUrls(row) {
  const arr = Array.isArray(row?.images) ? row.images : []
  return arr.filter((u) => u && String(u).trim().startsWith("http")).map((u) => String(u).trim())
}

function rowThumbUrls(row) {
  return rowImageUrls(row).slice(0, 8)
}

function onOpen() {
  keyword.value = ""
  pageNo.value = 1
  fetchList()
}

function onSizeChange() {
  pageNo.value = 1
  fetchList()
}

async function fetchList() {
  loading.value = true
  try {
    const res = await request({
      url: "/admin-api/product-library/page",
      method: "GET",
      params: {
        pageNo: pageNo.value,
        pageSize: pageSize.value,
        ...(keyword.value?.trim() ? { keyword: keyword.value.trim() } : {}),
      },
    })
    if (res.code === 0) {
      list.value = res.data?.list || []
      total.value = res.data?.total ?? 0
    } else {
      list.value = []
      total.value = 0
      ElMessage.error(res.msg || "加载失败")
    }
  } catch (e) {
    list.value = []
    total.value = 0
    ElMessage.error(e?.message || "加载失败")
  } finally {
    loading.value = false
  }
}

function pick(row) {
  const urls = rowImageUrls(row)
  if (!urls.length) {
    ElMessage.warning("该产品暂无图片")
    return
  }
  emit("picked", urls)
  emit("update:modelValue", false)
}

function onRowClick(row) {
  pick(row)
}
</script>

<style scoped>
.pl-picker-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.pl-picker-toolbar__input {
  width: 220px;
}
.pl-picker-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  align-items: center;
  min-height: 40px;
}
.pl-picker-thumbs__empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.pl-picker-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}
.pl-picker-thumb :deep(.el-image__inner) {
  width: 40px;
  height: 40px;
  object-fit: cover;
}
.pl-picker-page {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
