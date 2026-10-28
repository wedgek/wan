<template>
  <el-dialog
    :model-value="modelValue"
    title="批量打链接"
    width="520px"
    destroy-on-close
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
      <el-form-item label="投放账号" prop="channelId">
        <el-select v-model="form.channelId" placeholder="请选择投放账号" style="width: 100%" @change="loadTemplates">
          <el-option v-for="c in channels" :key="c.id" :label="c.label" :value="c.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="书籍ID" prop="bookIds">
        <el-input
          v-model="form.bookIds"
          type="textarea"
          :rows="5"
          placeholder="一个或多个书籍 ID，换行或逗号分隔&#10;11010566526&#10;11010558571"
        />
      </el-form-item>
    </el-form>
    <p class="hint">起始章节默认第 1 集，回传走公共配置。链接名称：点众-倾心书馆-公共配置-档位名。</p>
    <p class="preview">{{ previewText }}</p>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import request from "@/request"

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(["update:modelValue", "created"])

const formRef = ref(null)
const saving = ref(false)
const channels = ref([])
const templates = ref([])
const form = reactive({
  channelId: "",
  bookIds: "",
})

const rules = {
  channelId: [{ required: true, message: "请选择投放账号", trigger: "change" }],
  bookIds: [{ required: true, message: "请填写书籍ID", trigger: "blur" }],
}

const bookIdList = computed(() => {
  const seen = new Set()
  const out = []
  for (const part of String(form.bookIds || "").split(/[\s,，;；]+/)) {
    const id = part.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
})

const previewText = computed(() => {
  const books = bookIdList.value.length
  const tpls = templates.value.length
  if (!books && !tpls) return "请选择投放账号并填写书籍 ID"
  if (!tpls) return "该账号没有投入使用的充值模板，请先到充值模板页拉取并打开开关"
  return `${books} 本书 × ${tpls} 个档位 = ${books * tpls} 条`
})

const canSubmit = computed(() => bookIdList.value.length > 0 && templates.value.length > 0)

async function loadChannels() {
  const res = await request({ url: "/admin-api/novel/promo-links/dianzhong/channels" })
  if (res.code === 0 && Array.isArray(res.data)) {
    channels.value = res.data
    if (!form.channelId && res.data[0]) form.channelId = res.data[0].id
  } else {
    channels.value = []
    ElMessage.error(res.msg || "未配置投放账号")
  }
  await loadTemplates()
}

async function loadTemplates() {
  if (!form.channelId) {
    templates.value = []
    return
  }
  const res = await request({
    url: "/admin-api/novel/recharge-templates",
    params: { enabled: 1 },
  })
  const list = res.code === 0 && Array.isArray(res.data) ? res.data : []
  const channelId = String(form.channelId)
  templates.value = list.filter((r) => !r.channelId || String(r.channelId) === channelId)
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    form.channelId = channels.value[0]?.id || ""
    form.bookIds = ""
    loadChannels()
  },
)

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok || !canSubmit.value) return
  saving.value = true
  try {
    const res = await request({
      url: "/admin-api/novel/promo-links/dianzhong/batch-create",
      method: "POST",
      timeout: 180000,
      data: {
        channelId: form.channelId,
        bookIds: form.bookIds,
      },
    })
    if (res.code === 0) {
      const n = res.data?.createdCount || 0
      ElMessage.success(n ? `已创建 ${n} 条` : "已提交创建")
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

<style scoped>
.hint,
.preview {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.preview {
  color: var(--el-color-primary);
}
</style>
