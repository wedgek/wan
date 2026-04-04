<template>
  <div class="prompt-node" :class="{ 'is-selected': selected }">
    <Handle type="target" :position="Position.Left" class="handle" />
    <div class="prompt-node__title">视频创意卡片</div>
    <el-input
      v-model="promptModel"
      type="textarea"
      :rows="5"
      placeholder="描述你要生成的画面与运动…"
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

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
  selected: { type: Boolean, default: false },
})

const modelIdRef = inject("canvasVideoModelId", ref(null))
const { updateNodeData } = useVueFlow()

const resultVideoLoadFailed = ref(false)

watch(
  () => props.data?.resultUrl,
  () => {
    resultVideoLoadFailed.value = false
  }
)

function onResultVideoError() {
  resultVideoLoadFailed.value = true
}

const promptModel = computed({
  get: () => props.data?.prompt ?? "",
  set: (v) => updateNodeData(props.id, { prompt: v }),
})

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function handleGenerate() {
  const prompt = String(promptModel.value || "").trim()
  if (!prompt) {
    ElMessage.warning("请填写提示词")
    return
  }
  const mid = modelIdRef?.value != null ? Number(modelIdRef.value) : 0
  if (!mid) {
    ElMessage.warning("请先选择视频模型")
    return
  }

  updateNodeData(props.id, {
    status: "提交中…",
    errorMessage: "",
    resultUrl: "",
  })

  let jobId
  try {
    const res = await request({
      url: "/admin-api/video/jobs",
      method: "POST",
      timeout: 120000,
      data: { prompt, videoModelId: mid },
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

.prompt-node__title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
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
