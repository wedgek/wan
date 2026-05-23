<template>
  <el-dialog
    v-model="modalVisible"
    :title="modalMode === 'add' ? '新增目录条目' : '编辑目录条目'"
    width="680px"
    destroy-on-close
  >
    <el-form :model="formData" label-width="110px">
      <el-form-item label="模型 ID" v-required-dot>
        <el-input
          v-model="formData.apiModelId"
          placeholder="DMXAPI 模型名，如 doubao-seedance-2-0-260128"
          clearable
          clear-icon="Close"
        />
        <div class="form-item-tip">目录仅维护模型 ID；上架到模型商店时可再填写对外展示名称。</div>
      </el-form-item>
      <el-form-item label="模态" v-required-dot>
        <el-select v-model="formData.modality" placeholder="选择模态" style="width: 100%">
          <el-option label="视频" value="video" />
          <el-option label="图片" value="image" />
          <el-option label="文本" value="text" />
          <el-option label="未分类" value="unknown" />
        </el-select>
      </el-form-item>
      <el-form-item label="厂商">
        <el-input v-model="formData.vendor" placeholder="如 豆包 / OpenAI" clearable clear-icon="Close" />
      </el-form-item>
      <el-form-item label="标签">
        <el-input v-model="formData.tags" placeholder="逗号分隔，可选" clearable clear-icon="Close" />
      </el-form-item>
      <el-form-item v-if="formData.modality === 'video'" label="API Profile">
        <el-select
          v-model="formData.apiProfile"
          placeholder="自动推断"
          clearable
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="p in profileOptions"
            :key="p.id"
            :label="`${p.label} (${p.id})`"
            :value="p.id"
          />
        </el-select>
        <div class="form-item-tip">
          决定 DMXAPI 请求协议与对话页上传约束；留空则按模型 ID 自动推断。同 Profile 内换 model 无需改代码。
        </div>
      </el-form-item>
      <el-form-item v-if="formData.modality === 'video'" label="参考视频">
        <el-switch v-model="supportsReferenceVideo" active-text="支持" inactive-text="不支持" />
        <div class="form-item-tip">
          由 API Profile 推断为主；同步后请勿仅凭描述猜测。可灵 V3 不支持参考视频；可灵 V2 动作控制需图+视频。
        </div>
      </el-form-item>
      <el-form-item label="默认参数 JSON">
        <el-input
          v-model="formData.defaultParamsStr"
          type="textarea"
          :rows="4"
          placeholder='可选，如 {"duration":5,"ratio":"9:16"}'
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="formData.remark" placeholder="可选" clearable clear-icon="Close" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="modalVisible = false">取消</el-button>
      <el-button type="primary" @click="handleSubmit" :loading="modalLoading">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import request from "@/request"
import { resetState, cloneDeep } from "@/utils/lodash"
import { inferSupportsReferenceVideo, inferApiProfile } from "@/utils/catalogCapabilities"

const profileOptions = ref([])

async function loadProfileOptions() {
  try {
    const res = await request({ url: "/admin-api/system/model-catalog/profile-options", method: "GET" })
    if (res.code === 0 && Array.isArray(res.data)) profileOptions.value = res.data
  } catch (_) {
    profileOptions.value = []
  }
}
loadProfileOptions()

const emit = defineEmits(["success"])

const modalVisible = ref(false)
const modalMode = ref("add")
const modalLoading = ref(false)
const supportsReferenceVideo = ref(false)

const defaultFormData = () => ({
  id: "",
  apiModelId: "",
  modality: "video",
  vendor: "",
  tags: "",
  remark: "",
  defaultParamsStr: "",
  apiProfile: "",
})
const formData = reactive(defaultFormData())

watch(
  () => [formData.apiModelId, formData.modality, modalMode.value],
  ([id, modality, mode]) => {
    if (mode === "add" && modality === "video" && id) {
      if (!formData.apiProfile) formData.apiProfile = inferApiProfile(id) || ""
      supportsReferenceVideo.value = inferSupportsReferenceVideo(id)
    }
  },
)

const showAdd = () => {
  modalMode.value = "add"
  resetState(formData, defaultFormData())
  supportsReferenceVideo.value = false
  modalVisible.value = true
}

const showEdit = (row) => {
  modalMode.value = "edit"
  resetState(formData, defaultFormData())
  modalVisible.value = true
  formData.id = row.id
  formData.apiModelId = row.apiModelId || ""
  formData.modality = row.modality || "unknown"
  formData.vendor = row.vendor || ""
  formData.tags = row.tags || ""
  formData.remark = row.remark || ""
  formData.apiProfile = row.apiProfile || row.capabilities?.apiProfile || inferApiProfile(row.apiModelId) || ""
  supportsReferenceVideo.value = !!row.supportsReferenceVideo || !!row.capabilities?.supportsReferenceVideo
  if (row.defaultParams == null) {
    formData.defaultParamsStr = ""
  } else if (typeof row.defaultParams === "string") {
    formData.defaultParamsStr = row.defaultParams
  } else {
    try {
      formData.defaultParamsStr = JSON.stringify(row.defaultParams, null, 2)
    } catch (_) {
      formData.defaultParamsStr = ""
    }
  }
}

const validateForm = () => {
  if (!formData.apiModelId?.trim()) {
    ElMessage("请填写模型 ID")
    return false
  }
  if (formData.defaultParamsStr?.trim()) {
    try {
      JSON.parse(formData.defaultParamsStr)
    } catch (_) {
      ElMessage("默认参数须为合法 JSON")
      return false
    }
  }
  return true
}

const handleSubmit = async () => {
  if (!validateForm()) return

  const isAdd = modalMode.value === "add"
  const data = cloneDeep(formData)
  if (isAdd) delete data.id
  delete data.defaultParamsStr
  data.displayName = String(formData.apiModelId || "").trim()

  let defaultParams = null
  if (formData.defaultParamsStr?.trim()) {
    defaultParams = JSON.parse(formData.defaultParamsStr)
  }
  data.defaultParams = defaultParams

  const capabilities = {}
  if (formData.modality === "video") {
    capabilities.supportsReferenceVideo = supportsReferenceVideo.value
    if (formData.apiProfile) capabilities.apiProfile = formData.apiProfile
  }
  data.capabilities = capabilities
  data.apiProfile = formData.apiProfile || null

  modalLoading.value = true
  try {
    const result = await request({
      url: isAdd ? "/admin-api/system/model-catalog/create" : "/admin-api/system/model-catalog/update",
      method: isAdd ? "POST" : "PUT",
      data,
    })
    if (result.code === 0) {
      ElMessage.success(isAdd ? "创建成功" : "更新成功")
      modalVisible.value = false
      emit("success")
    } else {
      ElMessage.error(result.msg)
    }
  } finally {
    modalLoading.value = false
  }
}

defineExpose({ showAdd, showEdit })
</script>

<style scoped lang="scss">
.form-item-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  code {
    font-size: 11px;
  }
}
</style>
