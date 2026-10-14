<template>
  <el-dialog
    :model-value="modelValue"
    title="创建推广链接"
    width="520px"
    destroy-on-close
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="108px">
      <el-form-item label="所属书籍" prop="bookId">
        <BookSelect v-model="form.bookId" :disabled="!!fixedBookId" />
      </el-form-item>
      <el-form-item label="链接名称" prop="name">
        <el-input v-model="form.name" maxlength="60" placeholder="派单渠道 / 链接名称，最多 60 字" />
      </el-form-item>
      <el-form-item label="回传媒体" prop="mediaSource">
        <el-select v-model="form.mediaSource" style="width: 100%">
          <el-option v-for="s in MEDIA_SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="起始章节" prop="chapterIdx">
        <el-input-number v-model="form.chapterIdx" :min="1" :max="20" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import request from "@/request"
import BookSelect from "./book-select.vue"
import { MEDIA_SOURCE_OPTIONS } from "../shared"

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  bookId: { type: [Number, String], default: "" },
})

const emit = defineEmits(["update:modelValue", "created"])

const formRef = ref(null)
const saving = ref(false)
const fixedBookId = computed(() => Number(props.bookId) || 0)
const form = reactive({
  bookId: "",
  name: "",
  mediaSource: "dy",
  chapterIdx: 1,
})

const rules = {
  bookId: [{ required: true, message: "请选择所属书籍", trigger: "change" }],
  name: [{ required: true, message: "请填写链接名称", trigger: "blur" }],
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    form.bookId = fixedBookId.value || ""
    form.name = ""
    form.mediaSource = "dy"
    form.chapterIdx = 1
  },
)

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  saving.value = true
  try {
    const res = await request({
      url: "/admin-api/novel/promo-links/dianzhong/create",
      method: "POST",
      data: {
        bookId: form.bookId,
        name: form.name,
        mediaSource: form.mediaSource,
        chapterIdx: form.chapterIdx,
      },
    })
    if (res.code === 0) {
      const n = res.data?.synced || 0
      ElMessage.success(n ? `已创建，并同步 ${n} 条` : "已提交创建")
      if (res.data?.warning) ElMessage.warning(res.data.warning)
      emit("update:modelValue", false)
      emit("created", res.data)
    } else {
      ElMessage.error(res.msg || "创建失败")
    }
  } finally {
    saving.value = false
  }
}
</script>
