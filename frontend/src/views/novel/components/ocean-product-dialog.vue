<template>
  <el-dialog
    v-model="visible"
    title="创建巨量商品"
    width="520px"
    destroy-on-close
    append-to-body
    @open="loadMeta"
  >
    <el-alert
      v-if="meta.message"
      :title="meta.message"
      type="warning"
      show-icon
      :closable="false"
      class="alert"
    />
    <el-form label-width="84px">
      <el-form-item label="商品库">
        <el-select v-model="form.platformId" placeholder="请选择通用版商品库" style="width: 100%" :loading="loading">
          <el-option v-for="item in meta.libraries" :key="item.id" :label="libraryLabel(item)" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="书名" required>
        <el-input v-model="form.name" maxlength="100" placeholder="输入书名，例如：老书新看" clearable />
      </el-form-item>
      <el-form-item label="书籍ID">
        <el-input v-model="form.bookId" placeholder="可选，用来做商品外部 ID" clearable />
      </el-form-item>
    </el-form>
    <p class="hint">建到所选通用版商品库。分类、主图和品牌沿用该库里已有商品，只把名称换成这本书。</p>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import request from "@/request"

const props = defineProps({
  appPk: { type: [Number, String], default: null },
})
const emit = defineEmits(["created"])
const visible = ref(false)
const loading = ref(false)
const saving = ref(false)
const form = reactive({
  platformId: "",
  name: "",
  bookId: "",
})
const meta = reactive({
  configured: false,
  authorized: false,
  needAuth: false,
  needScope: false,
  message: "",
  authorizeUrl: "",
  defaultPlatformId: "",
  libraries: [],
})

const canSubmit = computed(() => meta.authorized && String(form.name || "").trim() && form.platformId)

function libraryLabel(item) {
  return item.industry ? `${item.name}（${item.industry}）` : item.name || item.id
}

function open(payload) {
  form.name = (payload && payload.name) || ""
  form.bookId = (payload && payload.bookId) || ""
  if (payload && payload.platformId) form.platformId = payload.platformId
  visible.value = true
}

async function loadMeta() {
  loading.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/products/meta",
      timeout: 30000,
      params: { appPk: props.appPk || "" },
    })
    if (res.code !== 0) {
      meta.message = res.msg || "读取商品库失败"
      meta.authorized = false
      return
    }
    const data = res.data || {}
    meta.configured = !!data.configured
    meta.authorized = !!data.authorized
    meta.needAuth = !!data.needAuth
    meta.needScope = !!data.needScope
    meta.message = data.message || (data.authorized ? "" : "")
    meta.authorizeUrl = data.authorizeUrl || ""
    meta.defaultPlatformId = data.defaultPlatformId || ""
    meta.libraries = Array.isArray(data.libraries) ? data.libraries : []
    const ids = meta.libraries.map((item) => item.id)
    if (!ids.includes(form.platformId)) {
      form.platformId = ids.includes(meta.defaultPlatformId) ? meta.defaultPlatformId : ids[0] || meta.defaultPlatformId || ""
    }
  } finally {
    loading.value = false
  }
}

async function submit() {
  const name = String(form.name || "").trim()
  if (!name) {
    ElMessage.warning("请填写书名")
    return
  }
  saving.value = true
  try {
    const res = await request({
      url: "/admin-api/oceanengine/products",
      method: "POST",
      timeout: 30000,
      data: {
        name,
        bookId: String(form.bookId || "").trim(),
        platformId: form.platformId,
        appPk: props.appPk,
      },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "创建失败")
      if (/授权|权限|Secret|APP/.test(res.msg || "")) loadMeta()
      return
    }
    const id = res.data && res.data.productId
    ElMessage.success(id ? `已创建，商品 ID ${id}` : "已创建")
    emit("created")
    visible.value = false
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
</script>

<style scoped>
.alert {
  margin-bottom: 12px;
}
.hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
</style>
