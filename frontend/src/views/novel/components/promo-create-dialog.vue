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
      <el-form-item label="使用模板">
        <div class="tpl-row">
          <el-select
            v-model="form.templateId"
            placeholder="选模板后自动填账号 / 媒体 / 章节 / 条数 / 充值档"
            clearable
            style="flex: 1"
            @change="applyTemplate"
          >
            <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
          <el-button link type="primary" @click="goPage('/novel/promo-templates')">管理</el-button>
        </div>
      </el-form-item>
      <el-form-item label="所属书籍" prop="bookId">
        <BookSelect v-model="form.bookId" :disabled="!!fixedBookId" @change="onBookChange" />
      </el-form-item>
      <el-form-item label="投放账号" prop="channelId">
        <el-select v-model="form.channelId" placeholder="请选择投放账号" style="width: 100%" @change="fillDefaultName">
          <el-option v-for="c in channels" :key="c.id" :label="c.label" :value="c.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="生成条数" prop="count">
        <el-radio-group v-model="form.count">
          <el-radio-button v-for="n in PROMO_COUNT_OPTIONS" :key="n" :value="n">{{ n }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="链接名称" prop="name">
        <el-input
          v-model="form.name"
          maxlength="60"
          placeholder="派单渠道 / 链接名称，最多 60 字"
          @input="nameTouched = true"
        />
      </el-form-item>
      <el-form-item label="回传媒体" prop="mediaSource">
        <el-select v-model="form.mediaSource" style="width: 100%" @change="fillDefaultName">
          <el-option v-for="s in MEDIA_SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="起始章节" prop="chapterIdx">
        <el-input-number v-model="form.chapterIdx" :min="1" :max="20" />
      </el-form-item>
      <el-form-item label="充值模板">
        <div class="tpl-row">
          <el-select
            v-model="form.rechargeTemplateId"
            placeholder="可选，创建时带上点众档位"
            clearable
            style="flex: 1"
          >
            <el-option
              v-for="r in recharges"
              :key="r.id"
              :label="rechargeOptionLabel(r)"
              :value="r.id"
            />
          </el-select>
          <el-button link type="primary" @click="goPage('/novel/recharge-templates')">管理</el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="saveAsTemplate">存为模板</el-button>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { useRouter } from "vue-router"
import request from "@/request"
import BookSelect from "./book-select.vue"
import { MEDIA_SOURCE_OPTIONS, PROMO_COUNT_OPTIONS, defaultPromoName } from "../shared"

const router = useRouter()

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  bookId: { type: [Number, String], default: "" },
  bookName: { type: String, default: "" },
})

const emit = defineEmits(["update:modelValue", "created"])

const formRef = ref(null)
const saving = ref(false)
const channels = ref([])
const templates = ref([])
const recharges = ref([])
const nameTouched = ref(false)
const selectedBookName = ref("")
const fixedBookId = computed(() => Number(props.bookId) || 0)
const form = reactive({
  bookId: "",
  templateId: "",
  rechargeTemplateId: "",
  channelId: "",
  count: 1,
  name: "",
  mediaSource: "dy",
  chapterIdx: 1,
})

const rules = {
  bookId: [{ required: true, message: "请选择所属书籍", trigger: "change" }],
  channelId: [{ required: true, message: "请选择投放账号", trigger: "change" }],
  name: [{ required: true, message: "请填写链接名称", trigger: "blur" }],
}

function currentBookName() {
  return String(selectedBookName.value || props.bookName || "").trim()
}

function fillDefaultName() {
  if (nameTouched.value) return
  const ch = channels.value.find((c) => String(c.id) === String(form.channelId))
  form.name = defaultPromoName({
    bookName: currentBookName(),
    channelLabel: ch ? ch.label : "",
    mediaSource: form.mediaSource,
  })
}

function onBookChange(hit) {
  selectedBookName.value = hit && hit.name ? hit.name : ""
  fillDefaultName()
}

function rechargeOptionLabel(r) {
  const id = r.batchId ? `（${r.batchId}）` : ""
  return `${r.name}${id}`
}

function goPage(path) {
  emit("update:modelValue", false)
  router.push(path)
}

function applyTemplate(id) {
  const hit = templates.value.find((t) => t.id === id)
  if (!hit) return
  form.channelId = hit.channelId
  form.mediaSource = hit.mediaSource
  form.chapterIdx = hit.chapterIdx
  form.count = hit.count
  form.rechargeTemplateId = hit.rechargeTemplateId || ""
  nameTouched.value = false
  fillDefaultName()
}

async function loadTemplates() {
  const res = await request({ url: "/admin-api/novel/promo-links/templates" })
  if (res.code === 0 && Array.isArray(res.data)) templates.value = res.data
}

async function loadRecharges() {
  const res = await request({ url: "/admin-api/novel/recharge-templates" })
  if (res.code === 0 && Array.isArray(res.data)) recharges.value = res.data
}

async function saveAsTemplate() {
  if (!form.channelId) {
    ElMessage.warning("请先选择投放账号")
    return
  }
  const ch = channels.value.find((c) => String(c.id) === String(form.channelId))
  const media = MEDIA_SOURCE_OPTIONS.find((s) => s.value === form.mediaSource)
  const defaultName = [ch ? ch.label : "", media ? media.label : "", `${form.count}条`].filter(Boolean).join("-")
  const { value } = await ElMessageBox.prompt("模板名称", "存为模板", {
    inputValue: defaultName,
    confirmButtonText: "保存",
    cancelButtonText: "取消",
    inputPattern: /\S+/,
    inputErrorMessage: "请填写模板名称",
  }).catch(() => ({ value: "" }))
  const name = String(value || "").trim()
  if (!name) return
  const res = await request({
    url: "/admin-api/novel/promo-links/templates",
    method: "POST",
    data: {
      name,
      channelId: form.channelId,
      mediaSource: form.mediaSource,
      chapterIdx: form.chapterIdx,
      count: form.count,
      rechargeTemplateId: form.rechargeTemplateId || null,
    },
  })
  if (res.code === 0) {
    ElMessage.success("已保存模板")
    await loadTemplates()
    form.templateId = res.data?.id || ""
  } else {
    ElMessage.error(res.msg || "保存失败")
  }
}

async function loadChannels() {
  const res = await request({ url: "/admin-api/novel/promo-links/dianzhong/channels" })
  if (res.code === 0 && Array.isArray(res.data)) {
    channels.value = res.data
    if (!form.channelId && res.data[0]) form.channelId = res.data[0].id
  } else {
    channels.value = []
    ElMessage.error(res.msg || "未配置投放账号")
  }
  fillDefaultName()
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    nameTouched.value = false
    selectedBookName.value = props.bookName || ""
    form.bookId = fixedBookId.value || ""
    form.templateId = ""
    form.rechargeTemplateId = ""
    form.channelId = channels.value[0]?.id || ""
    form.count = 1
    form.name = ""
    form.mediaSource = "dy"
    form.chapterIdx = 1
    loadChannels()
    loadTemplates()
    loadRecharges()
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
        channelId: form.channelId,
        count: form.count,
        name: form.name,
        mediaSource: form.mediaSource,
        chapterIdx: form.chapterIdx,
        rechargeTemplateId: form.rechargeTemplateId || undefined,
      },
    })
    if (res.code === 0) {
      const n = res.data?.createdCount || 0
      ElMessage.success(n > 1 ? `已创建 ${n} 条` : n ? "已创建" : "已提交创建")
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
.tpl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
</style>
