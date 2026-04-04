<template>
  <div class="video-studio">
    <div class="video-studio__toolbar">
      <div class="toolbar-row toolbar-row--main">
        <el-radio-group v-model="hubMode" size="small" @change="onHubModeChange">
          <el-radio-button value="text">文生视频</el-radio-button>
          <el-radio-button value="image">图生视频</el-radio-button>
          <el-radio-button value="canvas">画布</el-radio-button>
        </el-radio-group>

        <span class="sep" />

        <span class="label">项目</span>
        <el-input
          v-model="projectName"
          style="width: 200px"
          maxlength="80"
          show-word-limit
          placeholder="项目名称"
          @blur="saveProjectName"
        />
        <span v-if="saveState === 'saving'" class="save-badge muted">保存中…</span>
        <span v-else-if="saveState === 'saved'" class="save-badge ok">已保存</span>
        <span v-else-if="saveState === 'error'" class="save-badge err">保存失败</span>

        <el-button size="small" @click="createNewProject">新建项目</el-button>

        <span class="sep" />

        <span class="label">模型</span>
        <el-select
          v-model="selectedModelId"
          placeholder="选择接入点"
          style="width: 220px"
          filterable
        >
          <el-option
            v-for="m in models"
            :key="m.id"
            :label="m.isDefault ? `${m.name}（默认）` : m.name"
            :value="m.id"
          />
        </el-select>

        <div class="toolbar-spacer" />

        <el-button :icon="$icons.Tickets" size="small" @click="jobsDrawer = true">任务 / 成片</el-button>
      </div>

      <div class="toolbar-row toolbar-row--sub">
        <template v-if="hubMode === 'canvas'">
          <el-button type="primary" size="small" :icon="$icons.Plus" @click="addNode('text')">添加文生卡片</el-button>
          <el-button type="primary" size="small" plain :icon="$icons.Plus" @click="addNode('image')">
            添加图生卡片
          </el-button>
        </template>
        <el-button v-else type="primary" size="small" :icon="$icons.Plus" @click="addNode(hubMode === 'image' ? 'image' : 'text')">
          添加卡片
        </el-button>
        <span class="hint">画布可拖拽平移、滚轮缩放；生成记录与成片在「任务 / 成片」中查看。</span>
      </div>
    </div>

    <div class="video-studio__flow">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :node-types="nodeTypes"
        :default-viewport="{ zoom: 0.9 }"
        :min-zoom="0.2"
        :max-zoom="1.8"
        fit-view-on-init
        class="vue-flow-canvas"
      >
        <Background pattern-color="#aaa" :gap="18" />
        <Controls />
      </VueFlow>
    </div>

    <el-drawer v-model="jobsDrawer" title="任务与成片" size="420px" destroy-on-close @open="loadJobsPage">
      <div class="drawer-actions">
        <el-button type="primary" size="small" :loading="jobsLoading" @click="loadJobsPage">刷新</el-button>
      </div>
      <el-table :data="jobsList" size="small" stripe max-height="70vh">
        <el-table-column prop="id" label="ID" width="72" />
        <el-table-column prop="status" label="状态" width="88" />
        <el-table-column prop="mode" label="模式" width="72" />
        <el-table-column prop="prompt" label="提示词" min-width="120" show-overflow-tooltip />
        <el-table-column label="成片" width="88">
          <template #default="{ row }">
            <el-link v-if="row.resultUrl" type="primary" :href="row.resultUrl" target="_blank" rel="noopener">
              打开
            </el-link>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup name="aiVideoStudio">
import { markRaw, nextTick } from "vue"
import { VueFlow } from "@vue-flow/core"
import { Background } from "@vue-flow/background"
import { Controls } from "@vue-flow/controls"
import "@vue-flow/core/dist/style.css"
import "@vue-flow/controls/dist/style.css"
import request from "@/request"
import { debounce } from "@/utils/lodash"
import PromptNode from "./PromptNode.vue"

const nodeTypes = { prompt: markRaw(PromptNode) }

const hubMode = ref("text")
const models = ref([])
const selectedModelId = ref(null)
const nodes = ref([])
const edges = ref([])

const projectId = ref(null)
const projectName = ref("未命名项目")
const saveState = ref("")
const hydrating = ref(true)

const jobsDrawer = ref(false)
const jobsLoading = ref(false)
const jobsList = ref([])

const promptOptions = ref([])

provide("canvasVideoModelId", selectedModelId)
provide("studioProjectId", projectId)
provide("studioPromptOptions", promptOptions)

function makeNodeId() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function defaultNodeData(mode) {
  return {
    prompt: "",
    mode: mode === "image" ? "image" : "text",
    sourceImageUrl: "",
    sourceVideoUrl: "",
    status: "",
    resultUrl: "",
    errorMessage: "",
  }
}

function addNode(mode) {
  const m = mode === "image" ? "image" : "text"
  nodes.value.push({
    id: makeNodeId(),
    type: "prompt",
    position: { x: 40 + Math.random() * 160, y: 40 + Math.random() * 160 },
    data: defaultNodeData(m),
  })
}

function onHubModeChange() {
  /* 仅影响新增卡片类型，不改动已有节点 */
}

async function loadModels() {
  try {
    const res = await request({ url: "/admin-api/video/model/list-enabled", method: "GET" })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "加载模型失败")
      return
    }
    models.value = res.data || []
    const def = models.value.find((em) => em.isDefault)
    selectedModelId.value = def?.id ?? models.value[0]?.id ?? null
  } catch (e) {
    console.error(e)
    ElMessage.error("加载模型失败")
  }
}

async function loadPromptTemplates() {
  try {
    const res = await request({
      url: "/admin-api/system/ai-prompt/page",
      method: "GET",
      params: { pageNo: 1, pageSize: 200, status: 0 },
    })
    if (res.code !== 0) return
    promptOptions.value = res.data?.list || []
  } catch (e) {
    console.error(e)
  }
}

function applyGraph(graph) {
  const g = graph || { nodes: [], edges: [], viewport: null }
  nodes.value = Array.isArray(g.nodes) ? JSON.parse(JSON.stringify(g.nodes)) : []
  edges.value = Array.isArray(g.edges) ? JSON.parse(JSON.stringify(g.edges)) : []
}

async function ensureProject() {
  const page = await request({
    url: "/admin-api/video/projects/page",
    method: "GET",
    params: { pageNo: 1, pageSize: 1 },
  })
  if (page.code !== 0) {
    ElMessage.error(page.msg || "加载项目失败")
    return
  }
  let id
  let graph = { nodes: [], edges: [], viewport: null }
  if (page.data?.list?.length) {
    id = page.data.list[0].id
    const full = await request({
      url: "/admin-api/video/projects/get",
      method: "GET",
      params: { id },
    })
    if (full.code !== 0) {
      ElMessage.error(full.msg || "读取项目失败")
      return
    }
    id = full.data.id
    projectName.value = full.data.name || "未命名项目"
    graph = full.data.graphJson || graph
  } else {
    const c = await request({
      url: "/admin-api/video/projects",
      method: "POST",
      data: { name: "默认项目" },
    })
    if (c.code !== 0) {
      ElMessage.error(c.msg || "创建项目失败")
      return
    }
    id = c.data.id
    projectName.value = c.data.name || "默认项目"
    graph = c.data.graphJson || graph
  }
  projectId.value = id
  applyGraph(graph)
  if (!nodes.value.length) addNode("text")
}

async function createNewProject() {
  try {
    await ElMessageBox.confirm("将创建新的空白项目，当前画布如有未保存改动会先尝试保存。", "新建项目", {
      type: "info",
      confirmButtonText: "创建",
      cancelButtonText: "取消",
    })
  } catch {
    return
  }
  await flushGraphSave()
  const c = await request({
    url: "/admin-api/video/projects",
    method: "POST",
    data: { name: "未命名项目" },
  })
  if (c.code !== 0) {
    ElMessage.error(c.msg || "创建失败")
    return
  }
  hydrating.value = true
  projectId.value = c.data.id
  projectName.value = c.data.name || "未命名项目"
  nodes.value = []
  edges.value = []
  addNode(hubMode.value === "image" ? "image" : "text")
  await nextTick()
  hydrating.value = false
  ElMessage.success("已新建项目")
}

async function saveProjectName() {
  const id = projectId.value
  if (!id) return
  const name = String(projectName.value || "").trim() || "未命名项目"
  try {
    const res = await request({
      url: "/admin-api/video/projects/save",
      method: "PUT",
      data: { id, name },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "更新名称失败")
      return
    }
    projectName.value = res.data?.name || name
  } catch (e) {
    console.error(e)
    ElMessage.error("更新名称失败")
  }
}

async function flushGraphSave() {
  const id = projectId.value
  if (!id || hydrating.value) return
  const graphJson = {
    nodes: JSON.parse(JSON.stringify(nodes.value)),
    edges: JSON.parse(JSON.stringify(edges.value)),
    viewport: null,
  }
  saveState.value = "saving"
  try {
    const res = await request({
      url: "/admin-api/video/projects/save",
      method: "PUT",
      data: { id, graphJson },
    })
    if (res.code !== 0) {
      saveState.value = "error"
      return
    }
    saveState.value = "saved"
    window.setTimeout(() => {
      if (saveState.value === "saved") saveState.value = ""
    }, 2000)
  } catch (e) {
    console.error(e)
    saveState.value = "error"
  }
}

const scheduleGraphSave = debounce(flushGraphSave, 800, { leading: false, trailing: true })

watch(
  [nodes, edges],
  () => {
    if (hydrating.value) return
    scheduleGraphSave()
  },
  { deep: true }
)

async function loadJobsPage() {
  jobsLoading.value = true
  try {
    const res = await request({
      url: "/admin-api/video/jobs/page",
      method: "GET",
      params: { pageNo: 1, pageSize: 50 },
    })
    if (res.code !== 0) {
      ElMessage.error(res.msg || "加载任务失败")
      return
    }
    jobsList.value = res.data?.list || []
  } catch (e) {
    console.error(e)
    ElMessage.error("加载任务失败")
  } finally {
    jobsLoading.value = false
  }
}

onMounted(async () => {
  await loadModels()
  await loadPromptTemplates()
  hydrating.value = true
  try {
    await ensureProject()
  } finally {
    await nextTick()
    hydrating.value = false
  }
})
</script>

<style scoped lang="scss">
.video-studio {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.video-studio__toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.toolbar-row--sub .hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex: 1 1 200px;
}

.toolbar-spacer {
  flex: 1;
  min-width: 8px;
}

.sep {
  width: 1px;
  height: 18px;
  background: var(--el-border-color-lighter);
  margin: 0 2px;
}

.label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.save-badge {
  font-size: 12px;

  &.ok {
    color: var(--el-color-success);
  }
  &.err {
    color: var(--el-color-danger);
  }
  &.muted {
    color: var(--el-text-color-secondary);
  }
}

.video-studio__flow {
  flex: 1;
  min-height: 420px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
  background: var(--el-fill-color-blank);
}

.vue-flow-canvas {
  width: 100%;
  height: 100%;
  min-height: 400px;
}

.drawer-actions {
  margin-bottom: 10px;
}

.muted {
  color: var(--el-text-color-placeholder);
}
</style>
