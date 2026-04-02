
<template>
    <el-pagination
      :teleported="false"
      v-model:current-page="currentPage"
      v-model:page-size="currentSize"
      :page-sizes="pageSizes"
      :layout="layout"
      :total="total"
      @size-change="onSizeChange"
      @current-change="onPageChange"
    />
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  total: { type: Number, default: 0 },
  pageNo: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 },
  pageSizes: { 
    type: Array, 
    default: () => [10, 20, 50, 100] 
  },
  layout: { 
    type: String, 
    default: 'total, sizes, prev, pager, next, jumper' 
  }
})

const emit = defineEmits(['update:pageNo', 'update:pageSize', 'change'])

const currentPage = ref(props.pageNo)
const currentSize = ref(props.pageSize)

// 监听外部变化
watch(() => props.pageNo, (val) => currentPage.value = val)
watch(() => props.pageSize, (val) => currentSize.value = val)

// 页码变化
const onPageChange = (page) => {
  currentPage.value = page
  emit('update:pageNo', page)
  emit('change')
}

// 页签大小变化
const onSizeChange = (size) => {
  currentSize.value = size
  currentPage.value = 1
  emit('update:pageNo', 1)
  emit('update:pageSize', size)
  emit('change')
}
</script>


<!-- 
 * ===========================================
 * CzPagination 分页组件 - 使用示例
 * ===========================================
 * import CzPagination from '@/components/cz-pagination'
 *
 * <CzPagination :total="tableTotal" v-model:pageNo="tableParams.pageNo" v-model:pageSize="tableParams.pageSize" @change="getTableData" />
 * 
 * const tableTotal = ref(0)
 * 
 -->