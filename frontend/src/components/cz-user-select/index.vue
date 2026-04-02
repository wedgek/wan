<template>
  <el-select
    v-model="selectedValue"
    remote
    filterable
    clearable
    clear-icon="Close"
    remote-show-suffix
    :placeholder=placeholder
    :remote-method="searchUser"
    :loading="loading"
  >
    <el-option
      v-for="item in userList"
      :key="item.id"
      :label="item.nickname"
      :value="item.id"
    />
  </el-select>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getUserApi } from '@/api/system'

const props = defineProps({
  // 双向绑定
  modelValue: [String, Number],
  // 占位符
  placeholder: {
    type: String,
    default: '请选择用户'
  },
  // 是否立即加载
  immediate: {
    type: Boolean,
    default: true
  },
  // 额外搜索参数
  extraParams: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

const userList = ref([])
const loading = ref(false)

const selectedValue = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
    emit('change', value)
  }
})

// 搜索账户
const searchUser = async (query = '') => {
  loading.value = true
  try {
    const params = { nickname: query, ...props.extraParams }
    const result = await getUserApi(params)
    userList.value = result.data || []
  } finally {
    loading.value = false
  }
}

// 刷新列表
const refresh = () => {
  searchUser()
}

// 暴露方法给父组件
defineExpose({ refresh })

// 初始化加载
onMounted(() => {
  if (props.immediate) {
    searchUser()
  }
})
</script>