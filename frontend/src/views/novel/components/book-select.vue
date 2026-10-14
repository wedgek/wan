<template>
  <el-select
    :model-value="modelValue"
    :placeholder="placeholder"
    filterable
    remote
    remote-show-suffix
    reserve-keyword
    clearable
    clear-icon="Close"
    :suffix-icon="$icons.ArrowDown"
    :remote-method="remoteSearch"
    :loading="loading"
    :disabled="disabled"
    @update:model-value="onChange"
  >
    <el-option v-for="b in options" :key="b.id" :label="b.label" :value="b.id" />
  </el-select>
</template>

<script setup>
import request from "@/request"

const props = defineProps({
  modelValue: { type: [Number, String], default: "" },
  placeholder: { type: String, default: "选择书籍" },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(["update:modelValue", "change"])

const loading = ref(false)
const options = ref([])

async function remoteSearch(q) {
  loading.value = true
  try {
    const res = await request({
      url: "/admin-api/novel/books/options",
      method: "GET",
      params: { keyword: q || "" },
    })
    if (res.code === 0) options.value = res.data || []
  } finally {
    loading.value = false
  }
}

function onChange(val) {
  emit("update:modelValue", val || "")
  const hit = options.value.find((x) => x.id === val)
  emit("change", hit || null)
}

onMounted(() => {
  remoteSearch("")
})

defineExpose({ remoteSearch })
</script>
