<template>
  <div class="prompt-node" :class="{ 'is-selected': selected }">
    <Handle type="target" :position="Position.Left" class="handle" />
    <div class="prompt-node__title">{{ cardTitle }}</div>
    <el-select
      v-if="promptOptions.length"
      class="tpl-select"
      placeholder="插入提示词模板"
      clearable
      filterable
      size="small"
      :model-value="templatePickId"
      @update:model-value="onTemplatePick"
    >
      <el-option v-for="p in promptOptions" :key="p.id" :label="p.name" :value="p.id" />
    </el-select>
    <div v-if="isImageMode" class="prompt-node__img">
      <el-upload
        class="prompt-node__upload"
        :show-file-list="false"
        accept="image/*"
        :disabled="isBusy"
        :http-request="handleUpload"
      >
        <template v-if="imageUrl">
          <img :src="imageUrl" alt="" class="thumb" />
          <div class="thumb-mask">点击更换</div>
        </template>
        <el-button v-else size="small" type="primary" plain>上传参考图</el-button>
      </el-upload>
    </div>
    <div class="prompt-node__vid">
      <div class="vid-label">参考视频（可选）</div>
      <el-upload
        class="prompt-node__upload"
        :show-file-list="false"
        accept="video/*"
        :disabled="isBusy"
        :http-request="handleVideoUpload"
      >
        <template v-if="videoUrl">
          <template v-if="!refVideoLoadFailed">
            <video
              :src="videoUrl"
              class="vid-thumb"
              controls
              preload="none"
              @error="onRefVideoError"
            />
          </template>
          <div v-else class="vid-thumb vid-thumb--err">参考视频无法加载</div>
          <div class="thumb-mask">点击更换</div>
        </template>
        <el-button v-else size="small" type="primary" plain>上传参考视频</el-button>
      </el-upload>
    </div>
    <el-input
      v-model="promptModel"
      type="textarea"
      :rows="isImageMode ? 4 : 5"
      :placeholder="isImageMode ? '补充画面与运动描述（可选）…' : '描述你要生成的画面与运动…'"
      maxlength="2000"
      show-word-limit
    />
    <div class="prompt-node__actions">
      <el-button type="primary" size="small" :loading="isBusy" :disabled="isBusy" @click="handleGenerate">
        {{ statusLabel }}
      </el-button>
    </div>
    <div v-if="data?.errorMessage" class="prompt-node__err">{{ data.errorMessage }}</div>
    <div v-if="data?.resultUrl" class="prompt-node__video">
      <template v-if="!resultVideoLoadFailed">
        <video
          :src="data.resultUrl"
          controls
          playsinline
          preload="none"
          @error="onResultVideoError"
        />
      </template>
      <div v-else class="prompt-node__video-err">成片无法播放（链接无效或文件尚未就绪）</div>
    </div>
    <Handle type="source" :position="Position.Right" class="handle" />
  </div>
</template>

<script setup>
import { Handle, Position, useVueFlow } from "@vue-flow/core"
import request from "@/request"
import { uploadImage, uploadVideo } from "@/request/oss"

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
  selected: { type: Boolean, default: false },
})

const modelIdRef = inject("canvasVideoModelId", ref(null))
const projectIdRef = inject("studioProjectId", ref(null))
const promptOptions = inject("studioPromptOptions", ref([]))

const { updateNodeData } = useVueFlow()

const refVideoLoadFailed = ref(false)
const resultVideoLoadFailed = ref(false)

watch(
  () => props.data?.sourceVideoUrl,
  () => {
    refVideoLoadFailed.value = false
  }
)

watch(
  () => props.data?.resultUrl,
  () => {
    resultVideoLoadFailed.value = false
  }
)

function onRefVideoError() {
  refVideoLoadFailed.value = true
}

function onResultVideoError() {
  resultVideoLoadFailed.value = true
}

const isImageMode = computed(() => props.data?.mode === "image")

const templatePickId = ref(null)

const cardTitle = computed(() => {
  const v = !!(props.data?.sourceVideoUrl && String(props.data.sourceVideoUrl).trim())
  if (isImageMode.value) return v ? "图生视频（含参考视频）" : "图生视频卡片"
  return v ? "文生视频（含参考视频）" : "文生视频卡片"
})

const promptModel = computed({
  get: () => props.data?.prompt ?? "",
  set: (v) => updateNodeData(props.id, { prompt: v }),
})

const imageUrl = computed({
  get: () => props.data?.sourceImageUrl ?? "",
  set: (v) => updateNodeData(props.id, { sourceImageUrl: v }),
})

const videoUrl = computed({
  get: () => props.data?.sourceVideoUrl ?? "",
  set: (v) => updateNodeData(props.id, { sourceVideoUrl: v }),
})

function onTemplatePick(id) {
  templatePickId.value = null
  if (id == null) return
  const row = promptOptions.value.find((p) => p.id === id)
  if (row?.content) {
    updateNodeData(props.id, { prompt: row.content })
    ElMessage.success("已插入模板")
  }
}

const isBusy = computed(() => {
  const s = props.data?.status
  return s === "processing" || s === "提交中…" || s === "轮询中…"
})

const statusLabel = computed(() => {
  const s = props.data?.status
  if (s === "succeeded") return "已完成"
  if (isBusy.value) return s === "提交中…" ? "提交中…" : "生成中…"
  return "生成视频"
})

async function handleUpload({ file }) {
  try {
    const { url } = await uploadImage(file)
    updateNodeData(props.id, { sourceImageUrl: url })
    ElMessage.success("已上传")
  } catch (e) {
    console.error(e)
    ElMessage.error(e?.message || "上传失败")
  }
}

async function handleVideoUpload({ file }) {
  try {
    const { url } = await uploadVideo(file)
    updateNodeData(props.id, { sourceVideoUrl: url })
    ElMessage.success("视频已上传")
  } catch (e) {
    console.error(e)
    ElMessage.error(e?.message || "上传失败")
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function handleGenerate() {
  const prompt = String(promptModel.value || "").trim()
  const mid = modelIdRef?.value != null ? Number(modelIdRef.value) : 0
  if (!mid) {
    ElMessage.warning("请先选择视频模型")
    return
  }

  const img = String(imageUrl.value || "").trim()
  const vid = String(videoUrl.value || "").trim()
  const hasImg = isImageMode.value && !!img
  const hasVid = !!vid

  if (isImageMode.value && !img && !hasVid) {
    ElMessage.warning("请先上传参考图或参考视频")
    return
  }
  if (!isImageMode.value && !prompt && !hasVid) {
    ElMessage.warning("请填写提示词或上传参考视频")
    return
  }

  let mode = "text"
  if (hasImg && hasVid) mode = "multimodal"
  else if (hasImg) mode = "image"
  else if (hasVid) mode = "multimodal"
  else mode = "text"

  updateNodeData(props.id, {
    status: "提交中…",
    errorMessage: "",
    resultUrl: "",
  })

  const pid = projectIdRef?.value != null && Number(projectIdRef.value) > 0 ? Number(projectIdRef.value) : undefined

  const data = {
    prompt,
    videoModelId: mid,
    mode,
    projectId: pid,
  }
  if (hasImg) data.sourceImageUrl = img
  if (hasVid) data.sourceVideoUrls = [vid]

  let jobId
  try {
    const res = await request({
      url: "/admin-api/video/jobs",
      method: "POST",
      timeout: 120000,
      data,
    })
    if (res.code !== 0) {
      updateNodeData(props.id, { status: "", errorMessage: res.msg || "创建任务失败" })
      ElMessage.error(res.msg || "创建任务失败")
      return
    }
    jobId = res.data?.id
    if (!jobId) {
      updateNodeData(props.id, { status: "", errorMessage: "未返回任务 id" })
      return
    }
    updateNodeData(props.id, { status: "processing", jobId })
  } catch (e) {
    console.error(e)
    updateNodeData(props.id, { status: "", errorMessage: e?.message || "网络错误" })
    ElMessage.error("请求失败，请稍后重试")
    return
  }

  for (let i = 0; i < 120; i++) {
    await sleep(2000)
    updateNodeData(props.id, { status: "轮询中…" })
    try {
      const st = await request({
        url: "/admin-api/video/jobs/get",
        method: "GET",
        params: { id: jobId },
        timeout: 30000,
      })
      if (st.code !== 0) continue
      const row = st.data
      if (row.status === "succeeded" && row.resultUrl) {
        updateNodeData(props.id, { status: "succeeded", resultUrl: row.resultUrl, errorMessage: "" })
        ElMessage.success("生成成功")
        return
      }
      if (row.status === "failed" || row.status === "cancelled") {
        const msg = row.errorMessage || "生成失败"
        updateNodeData(props.id, { status: "", errorMessage: msg })
        ElMessage.error(msg)
        return
      }
    } catch (err) {
      console.error(err)
    }
  }
  updateNodeData(props.id, { status: "", errorMessage: "等待超时，请稍后在任务列表中查看" })
  ElMessage.warning("轮询超时")
}
</script>

<style scoped lang="scss">
.prompt-node {
  min-width: 280px;
  max-width: 360px;
  padding: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  box-shadow: var(--el-box-shadow-light);

  &.is-selected {
    border-color: var(--el-color-primary);
  }
}

.tpl-select {
  width: 100%;
  margin-bottom: 8px;
}

.prompt-node__title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
}

.prompt-node__vid {
  margin-bottom: 8px;
}

.vid-label {
  font-size: 12px;
  color: var(--el-text-color-regular);
  margin-bottom: 6px;
}

.vid-thumb {
  width: 100%;
  max-height: 120px;
  border-radius: 6px;
  background: #000;

  &--err {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 80px;
    font-size: 12px;
    color: var(--el-color-danger);
    background: var(--el-fill-color-lighter);
  }
}

.prompt-node__img {
  margin-bottom: 8px;
}

.prompt-node__upload {
  width: 100%;

  :deep(.el-upload) {
    width: 100%;
  }
}

.thumb {
  width: 100%;
  max-height: 140px;
  object-fit: contain;
  border-radius: 6px;
  display: block;
  background: var(--el-fill-color-dark);
  cursor: pointer;
}

.thumb-mask {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  text-align: center;
  margin-top: 4px;
}

.prompt-node__actions {
  margin-top: 10px;
}

.prompt-node__err {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.prompt-node__video {
  margin-top: 10px;

  video {
    width: 100%;
    max-height: 200px;
    border-radius: 6px;
    background: #000;
  }
}

.prompt-node__video-err {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-color-danger);
  padding: 8px 0;
}

.handle {
  width: 8px;
  height: 8px;
  background: var(--el-color-primary);
  border: none;
}
</style>
