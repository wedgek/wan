<template>
  <el-dialog
    v-model="modalVisible"
    :title="modalMode === 'add' ? '新增视频模型' : '编辑视频模型'"
    width="640px"
    destroy-on-close
  >
    <el-form :model="formData" label-width="110px">
      <el-form-item label="显示名称" v-required-dot>
        <el-input v-model="formData.name" placeholder="如下拉中展示名称" clearable clear-icon="Close" />
      </el-form-item>
      <el-form-item label="方舟模型 ID" v-required-dot>
        <el-input
          v-model="formData.apiModelId"
          placeholder="控制台推理接入点对应的 model id（如 ep-xxxx 或 doubao-seedance-…）"
          clearable
          clear-icon="Close"
        />
      </el-form-item>
      <el-form-item label="参考视频">
        <el-switch
          v-model="formData.supportsReferenceVideo"
          active-text="支持"
          inactive-text="不支持"
        />
        <div class="form-item-tip">开启后，对话创作/画布等可在同任务中上传「参考视频」（智能参考）；仅对方舟支持多模态参考的接入点（如 Seedance 2.0）开启。</div>
      </el-form-item>
      <el-form-item label="默认模型">
        <el-switch v-model="formData.isDefault" active-text="是" inactive-text="否" />
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="formData.sort" :min="0" :max="9999" />
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="formData.status">
          <el-radio :value="0" border>启用</el-radio>
          <el-radio :value="1" border>停用</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="默认参数 JSON">
        <el-input
          v-model="formData.defaultParamsStr"
          type="textarea"
          :rows="5"
          placeholder='可选，合并进创建任务请求体，如 {"duration":8}（须符合方舟文档）'
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

const emit = defineEmits(["success"])

const modalVisible = ref(false)
const modalMode = ref("add")
const modalLoading = ref(false)

const defaultFormData = () => ({
  id: "",
  name: "",
  apiModelId: "",
  supportsReferenceVideo: false,
  sort: 0,
  status: 0,
  isDefault: false,
  remark: "",
  defaultParamsStr: "",
})
const formData = reactive(defaultFormData())

const showAdd = () => {
  modalMode.value = "add"
  resetState(formData, defaultFormData())
  modalVisible.value = true
}

const showEdit = (row) => {
  modalMode.value = "edit"
  resetState(formData, defaultFormData())
  modalVisible.value = true
  formData.id = row.id
  formData.name = row.name || ""
  formData.apiModelId = row.apiModelId || ""
  formData.supportsReferenceVideo = !!row.supportsReferenceVideo
  formData.sort = row.sort ?? 0
  formData.status = row.status ?? 0
  formData.isDefault = !!row.isDefault
  formData.remark = row.remark || ""
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
  if (!formData.name?.trim()) {
    ElMessage("请填写显示名称")
    return false
  }
  if (!formData.apiModelId?.trim()) {
    ElMessage("请填写方舟模型 ID")
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

  let defaultParams = null
  if (formData.defaultParamsStr?.trim()) {
    defaultParams = JSON.parse(formData.defaultParamsStr)
  }
  data.defaultParams = defaultParams
  data.isDefault = formData.isDefault ? 1 : 0
  data.supportsReferenceVideo = formData.supportsReferenceVideo ? 1 : 0

  modalLoading.value = true
  try {
    const result = await request({
      url: isAdd ? "/admin-api/system/video-model/create" : "/admin-api/system/video-model/update",
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

<style scoped>
.form-item-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.45;
}
</style>
